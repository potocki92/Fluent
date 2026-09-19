"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ReadingLine } from "@/hooks/useReadingLine";
import type { ReadingAnchor } from "@/lib/reading/position";

/**
 * Putting the learner back where they were — and keeping them there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INITIAL RESTORE IS INSTANT, AND IT HAPPENS BEFORE PAINT
 * ─────────────────────────────────────────────────────────────────────────────
 * A smooth scroll from the top of the chapter to 31% is a two-second animation
 * through text the learner has already read, and it announces that the app had
 * to go and look. So the restore is `behavior: "auto"` and runs in a LAYOUT
 * effect: React has committed the prose, the browser has not painted, and the
 * first frame the learner sees is already the right one.
 *
 * On a full page load even that is late — the server HTML paints before React
 * hydrates — which is why `ReadingRestoreScript` does the same jump during
 * parsing. This hook is what covers a client-side navigation into the chapter,
 * and what corrects the first jump once webfonts have settled.
 *
 * Everything the LEARNER asks for is smooth, because there the animation is
 * feedback rather than an apology.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THEN IT KEEPS THE ANCHOR THROUGH EVERY RELAYOUT
 * ─────────────────────────────────────────────────────────────────────────────
 * Changing the type size, rotating the phone or resizing the window moves every
 * pixel in the document. Because the bookmark is a place in the TEXT, the fix is
 * the same in all three cases: remember the anchor, let the layout change, put
 * the anchor back on the reading line. The text then appears to have re-flowed
 * AROUND the sentence being read, which is what a paper book does when you
 * change your glasses.
 *
 * A HEIGHT-ONLY CHANGE IS NOT A RELAYOUT. On a phone that is Safari's toolbar
 * collapsing or the keyboard opening — the text has not moved, and re-anchoring
 * there would fight the browser for the scroll position on every gesture.
 */
export interface ReadingRestore {
  /** True once the learner has been put back — what the resume marker waits for. */
  restored: boolean;
  /** Run a change that reflows the prose, keeping the anchor under the eye. */
  preserveAnchor(mutate: () => void): void;
}

/** Long enough for a rotation to settle, short enough not to feel like a lag. */
const RELAYOUT_SETTLE_MS = 180;

export function useReadingRestore({
  line,
  target,
  anchorRef,
  enabled,
}: {
  line: ReadingLine;
  /** Where to land on open, or null when a deep link owns the position. */
  target: ReadingAnchor | null;
  /** The live current anchor — read before a relayout, applied after it. */
  anchorRef: React.RefObject<ReadingAnchor | null>;
  enabled: boolean;
}): ReadingRestore {
  const [restored, setRestored] = useState(false);
  const doneRef = useRef(false);

  // ── the initial restore ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!enabled || doneRef.current) return;
    doneRef.current = true;

    if (!target) return;
    // An anchor at the very start of the chapter is where the browser already
    // is; scrolling to it would only fight a `#hash` or a back-navigation. And
    // there is nothing for the resume marker to mark, so `restored` stays false.
    if (
      target.paragraphPosition === 0 &&
      (target.sentencePosition ?? 0) === 0 &&
      (target.tokenPosition ?? 0) === 0
    ) {
      return;
    }

    if (!line.scrollTo(target, "auto")) return;

    // Reported on the NEXT frame rather than synchronously. The resume marker
    // positions itself from the layout this scroll just produced, and rendering
    // it in the middle of the layout effect would measure the layout from
    // before. Waiting a frame also keeps the scroll off React's critical path.
    const frame = window.requestAnimationFrame(() => setRestored(true));
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, line, target]);

  // ── the second pass, once the fonts have arrived ──────────────────────────
  // A webfont swapping in after the restore moves every line on the page, so the
  // first jump lands close but not exactly. Correcting it is free while the
  // learner has not touched anything; the moment they have, their scroll is the
  // only one that matters and this stands down for good.
  useEffect(() => {
    if (!enabled || !target || !restored) return;

    let cancelled = false;
    const takenOver = { value: false };
    const surrender = () => {
      takenOver.value = true;
    };

    const events: (keyof WindowEventMap)[] = [
      "wheel",
      "touchstart",
      "pointerdown",
      "keydown",
    ];
    for (const event of events) {
      window.addEventListener(event, surrender, { passive: true, once: true });
    }

    void document.fonts?.ready
      .then(() => {
        if (cancelled || takenOver.value) return;
        window.requestAnimationFrame(() => {
          if (cancelled || takenOver.value) return;
          line.scrollTo(target, "auto");
        });
      })
      .catch(() => {
        // A browser without the Font Loading API keeps the first jump. It is
        // close enough, and a missing API is not a reason to do anything.
      });

    return () => {
      cancelled = true;
      for (const event of events) window.removeEventListener(event, surrender);
    };
  }, [enabled, line, restored, target]);

  // ── rotation and resize ───────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let width = window.innerWidth;
    let timer = 0;
    // CAPTURED ON THE FIRST EVENT OF A BURST. A rotation fires several resizes,
    // and by the time the last one arrives the sampler may already have recorded
    // a position from the NEW layout — which is the one thing that must not be
    // used to restore the old one.
    let pending: ReadingAnchor | null = null;

    const schedule = () => {
      pending ??= anchorRef.current;
      if (timer !== 0) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        const anchor = pending;
        pending = null;
        if (anchor) line.scrollTo(anchor, "auto");
      }, RELAYOUT_SETTLE_MS);
    };

    const onResize = () => {
      // Height-only: the mobile toolbar collapsing or the keyboard opening. The
      // text has not moved, so neither should the learner.
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      schedule();
    };

    const onOrientation = () => {
      width = window.innerWidth;
      schedule();
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      if (timer !== 0) window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [anchorRef, enabled, line]);

  // ── typography ────────────────────────────────────────────────────────────
  // The anchor is read BEFORE the change and applied after two frames: one for
  // React to commit the new custom properties, one for the browser to lay the
  // prose out again. `auto` rather than smooth — the learner asked for a bigger
  // typeface, not for a tour of the chapter.
  const preserveAnchor = useCallback(
    (mutate: () => void) => {
      const anchor = anchorRef.current;
      mutate();
      if (!anchor) return;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          line.scrollTo(anchor, "auto");
        });
      });
    },
    [anchorRef, line],
  );

  // Stable while `restored` is: the reader holds on to `preserveAnchor` through
  // every typography change, and a new object per render would make the
  // settings callback unstable for nothing.
  return useMemo(() => ({ restored, preserveAnchor }), [preserveAnchor, restored]);
}
