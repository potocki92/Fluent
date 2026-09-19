"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { ReadingLine } from "@/hooks/useReadingLine";
import {
  CHAPTER_COMPLETION_RATIO,
  DEEP_LINK_RESUME_ARM_MS,
  MAX_SAMPLE_GAP_MS,
  READ_DWELL_MS,
  READING_SAMPLE_MS,
} from "@/lib/reading/constants";
import {
  applyReadingSample,
  mergeServerProgress,
  offsetRatio,
  readingPositionFrom,
  type ChapterWordIndex,
  type ReadingAnchor,
  type ReadingPositionState,
} from "@/lib/reading/position";

/**
 * Where the learner is, where they were, and how far they have read — kept live
 * while they scroll, without re-rendering the reader.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALMOST NO REACT STATE HERE
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrolling a book produces hundreds of samples a minute. Routing each of them
 * through `setState` would re-render a component tree holding a chapter's worth
 * of prose, several sheets and an action bar — on a phone, while the learner's
 * thumb is moving. So the position lives in a ref and interested components
 * SUBSCRIBE to it; the progress bar writes its own styles from the callback and
 * never renders at all. The one piece of React state is the integer percentage,
 * which changes at most a hundred times in a chapter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SAMPLING CHANNELS, AND BOTH ARE NEEDED
 * ─────────────────────────────────────────────────────────────────────────────
 *   scroll → requestAnimationFrame   at most one resolve per frame, however
 *                                    many scroll events the browser fires
 *   a {@link READING_SAMPLE_MS} tick  so dwell can COMPLETE after scrolling has
 *                                    stopped — which is exactly the moment a
 *                                    fling turns into reading
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DWELL: FURTHEST FOLLOWS CURRENT, LATE
 * ─────────────────────────────────────────────────────────────────────────────
 * The engine keeps a short trail of samples stamped with ACTIVE reading time,
 * and the furthest position is allowed to advance only as far as the sample
 * that is {@link READ_DWELL_MS} old. Reading normally, the trail moves a line or
 * two — the lag is invisible. A fling outruns it completely, and only once the
 * learner has actually sat at the new place for a dwell does the progress bar
 * catch up.
 *
 * "Active" is the same predicate the reading clock uses, so a hidden tab or an
 * idle reader parked on the last page confirms nothing at all.
 */
export interface ReadingPositionEngine {
  /** The live position. Read it in callbacks, never during render. */
  stateRef: RefObject<ReadingPositionState>;
  /** Integer percent of the FURTHEST position — what the header shows. */
  furthestPercent: number;
  /**
   * Has the learner read far enough to finish the chapter?
   *
   * Kept beside the percentage rather than derived from it, because the
   * percentage is ROUNDED: at 94.6% the header honestly says 95% and the
   * database would still refuse. A button that appears before the action behind
   * it works is worse than one that appears a paragraph late.
   */
  canComplete: boolean;
  /** Called after every change. Returns an unsubscribe. */
  subscribe(listener: (state: ReadingPositionState) => void): () => void;
  /** Resolve the reading line now — before a flush, or after a restore. */
  sample(): ReadingPositionState;
  /** Raise `furthest` to a ratio the server knows about. Forward only. */
  mergeServer(ratio: number): void;
}

export function useReadingPosition({
  contentRef,
  line,
  index,
  stored,
  isActive,
  /**
   * A deep link owns the position, so the bookmark must not follow until the
   * learner has genuinely started reading here (§24). `false` for an ordinary
   * open, where the bookmark follows from the first sample.
   */
  deepLinked,
}: {
  contentRef: RefObject<HTMLElement | null>;
  line: ReadingLine;
  index: ChapterWordIndex;
  stored: { resume: ReadingAnchor | null; furthest: ReadingAnchor | null };
  isActive: () => boolean;
  deepLinked: boolean;
}): ReadingPositionEngine {
  // Seeded once. A later prop change must not reset a position the learner has
  // been moving — the server's own answer arrives through `mergeServer`, which
  // can only ever raise `furthest`.
  const [initial] = useState(() => readingPositionFrom(index, stored));
  const stateRef = useRef<ReadingPositionState>(initial);
  const [furthestPercent, setFurthestPercent] = useState(() =>
    Math.round(offsetRatio(index, initial.furthestOffset) * 100),
  );
  const [canComplete, setCanComplete] = useState(
    () => offsetRatio(index, initial.furthestOffset) >= CHAPTER_COMPLETION_RATIO,
  );

  const listenersRef = useRef(new Set<(state: ReadingPositionState) => void>());

  // Mirrored into refs so the sampling loop — which runs from timers and
  // animation frames, and must not re-subscribe when a parent re-renders — can
  // read the latest value without being rebuilt.
  const indexRef = useRef(index);
  const activeRef = useRef(isActive);
  useEffect(() => {
    indexRef.current = index;
    activeRef.current = isActive;
  }, [index, isActive]);

  /** The dwell trail: `{ at }` is ACTIVE milliseconds, not wall time. */
  const trailRef = useRef<{ at: number; anchor: ReadingAnchor }[]>([]);
  const activeMsRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const trackResumeRef = useRef(!deepLinked);

  const publish = useCallback((next: ReadingPositionState) => {
    const previous = stateRef.current;
    if (
      next.currentOffset === previous.currentOffset &&
      next.furthestOffset === previous.furthestOffset &&
      next.resumeOffset === previous.resumeOffset
    ) {
      return;
    }

    stateRef.current = next;
    for (const listener of listenersRef.current) listener(next);

    // Only when the INTEGER moves: the header is the only thing that needs React
    // to know, and it cannot tell the difference. Both updates are batched into
    // the one render React was going to do anyway.
    const ratio = offsetRatio(indexRef.current, next.furthestOffset);
    const percent = Math.round(ratio * 100);
    setFurthestPercent((current) => (current === percent ? current : percent));
    setCanComplete((current) =>
      current === ratio >= CHAPTER_COMPLETION_RATIO
        ? current
        : ratio >= CHAPTER_COMPLETION_RATIO,
    );
  }, []);

  const sample = useCallback((): ReadingPositionState => {
    const now = Date.now();
    const elapsed = lastSampleAtRef.current === 0 ? 0 : now - lastSampleAtRef.current;
    lastSampleAtRef.current = now;

    // Active time only, and capped: a throttled timer or a tab that was hidden
    // for an hour must not hand back an hour of reading credit.
    if (activeRef.current()) {
      activeMsRef.current += Math.min(elapsed, MAX_SAMPLE_GAP_MS);
    }

    const anchor = line.resolve();
    if (!anchor) return stateRef.current;

    const trail = trailRef.current;
    trail.push({ at: activeMsRef.current, anchor });

    // Keep exactly one sample older than the dwell window — that one IS the
    // confirmed position — and everything newer.
    const cutoff = activeMsRef.current - READ_DWELL_MS;
    while (trail.length > 1 && trail[1].at <= cutoff) trail.shift();
    const confirmed = trail[0].at <= cutoff ? trail[0].anchor : null;

    // A DEEP LINK IS NOT A READING POSITION — until it is. Somebody who arrives
    // from the notebook and reads here for a while is reading here, and their
    // bookmark should follow; somebody who glances and leaves keeps the place
    // they actually stopped at.
    if (!trackResumeRef.current && activeMsRef.current >= DEEP_LINK_RESUME_ARM_MS) {
      trackResumeRef.current = true;
    }

    const next = applyReadingSample(indexRef.current, stateRef.current, {
      at: anchor,
      confirmed,
      trackResume: trackResumeRef.current,
    });
    publish(next);
    return next;
  }, [line, publish]);

  // ── the scroll channel ────────────────────────────────────────────────────
  // One resolve per frame at most. The browser can fire scroll events far faster
  // than it paints, and resolving twice between two frames answers the same
  // question twice.
  useEffect(() => {
    let frame = 0;

    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        sample();
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [sample]);

  // ── the heartbeat ─────────────────────────────────────────────────────────
  // Dwell completes when scrolling STOPS, so something has to keep asking after
  // the last scroll event. It runs only while the document is visible, and each
  // tick is one hit test.
  useEffect(() => {
    let timer = 0;

    const start = () => {
      if (timer !== 0) return;
      lastSampleAtRef.current = Date.now();
      timer = window.setInterval(sample, READING_SAMPLE_MS);
    };
    const stop = () => {
      if (timer === 0) return;
      window.clearInterval(timer);
      timer = 0;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sample]);

  // The first reading is taken once the prose is laid out, so the bar and the
  // bookmark control are correct before the learner touches anything.
  useEffect(() => {
    if (!contentRef.current) return;
    const frame = window.requestAnimationFrame(() => sample());
    return () => window.cancelAnimationFrame(frame);
  }, [contentRef, sample]);

  const mergeServer = useCallback(
    (ratio: number) => {
      publish(mergeServerProgress(indexRef.current, stateRef.current, ratio));
    },
    [publish],
  );

  const subscribe = useCallback(
    (listener: (state: ReadingPositionState) => void) => {
      listenersRef.current.add(listener);
      // Immediately, so a subscriber mounting mid-chapter does not render an
      // empty bar for one frame.
      listener(stateRef.current);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  // A STABLE OBJECT, so the flush loop and the two subscribing components are
  // not torn down and rebuilt because the reader re-rendered for a word sheet.
  // Its identity changes only when the header's number does.
  return useMemo(
    () => ({ stateRef, furthestPercent, canComplete, subscribe, sample, mergeServer }),
    [canComplete, furthestPercent, mergeServer, sample, subscribe],
  );
}
