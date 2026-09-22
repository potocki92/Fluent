/**
 * Writing reading progress — as a coordinator rather than a callback.
 *
 * WHAT THIS REPLACES, AND WHY IT MATTERED. `ReaderShell.flush` was a
 * `useCallback` that did five things at once and got two of them wrong. Both
 * failures are of the kind nobody reports, because the reader keeps working:
 * the learner simply finds, later, that a chapter they read for twenty minutes
 * says four.
 *
 *  1. **DRAINED TIME WAS LOST ON A FAILED WRITE.** `clock.drain()` ran BEFORE
 *     the request, so the seconds left the clock immediately. If the report
 *     failed, `persistedRef` was reset — the POSITION would be resent — but the
 *     seconds were gone: the clock no longer had them and no retry carried
 *     them. The comment beside that line read "seconds taken and then dropped
 *     are seconds of reading nobody ever gets back", which is exactly what the
 *     failure path did.
 *
 *  2. **A RETRY COULD DOUBLE-COUNT.** `active_seconds` is an INCREMENT in
 *     `record_reading_progress` (`p.active_seconds + v_seconds`) with nothing
 *     to deduplicate on. A request that reached the database and whose RESPONSE
 *     was lost is indistinguishable, from here, from one that never arrived —
 *     so "just retry it" turns a dropped response into time counted twice.
 *
 * Fixing either one alone makes the other worse: keeping the seconds for a
 * retry is precisely what makes double-counting possible. They need one answer,
 * and the answer is a RECEIPT.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 *
 * **A report is identified, not just sent.** Every report carries a
 * `reportId`, minted once per attempt-to-deliver. A retry of a report that was
 * not confirmed reuses the SAME id, and the database applies an id it has
 * already seen exactly once — returning the state it already has, adding no
 * seconds. Retrying is therefore safe, which is what lets the seconds be kept.
 *
 * **Seconds are held, not dropped.** They are taken from the clock when a
 * report is built and only CONSUMED when the server confirms it. A report that
 * fails keeps its seconds inside the unconfirmed report, and the next attempt
 * carries them plus whatever has accumulated since. Nothing is lost, and
 * nothing is counted twice.
 *
 * **One report at a time, in order.** A flush that arrives while another is in
 * flight does not open a second request; it marks the coordinator so that one
 * more runs when the first settles. Each report carries a `seq` that only goes
 * up within a reading, and the database refuses to move the RESUME bookmark
 * backwards for a report whose `seq` it has already passed — so a slow report
 * landing after a faster one cannot rewind the learner's place.
 * `furthest` needs no such guard: it was already `greatest(...)` in SQL and
 * stays monotonic by construction.
 *
 * **A sealed session is reopened, once, and the report is re-sent unchanged.**
 * Same `reportId`, same seconds, new session — so reopening cannot duplicate
 * the time either.
 *
 * **A late RESULT is ignored.** `mergeServer` is applied only for the report
 * that is still the newest one; an older reply arriving afterwards would push
 * the on-screen ratio backwards.
 *
 * This module is pure: no React, no Supabase, no clock of its own. Everything
 * it does to the world it does through {@link FlushPorts}.
 */

import type { FluentFailure } from "@/lib/errors";
import {
  hasUnsavedPosition,
  type ReadingAnchor,
  type ReadingPositionState,
} from "@/lib/reading/position";

/** What one report says. Stable across retries of the same report. */
export interface ProgressReport {
  /** The receipt. The database applies one id exactly once. */
  reportId: string;
  /** Monotonic within a reading. Guards the resume bookmark's ordering. */
  seq: number;
  resume: ReadingAnchor;
  furthest: ReadingAnchor;
  /** Seconds held by this report until the server confirms it. */
  activeSeconds: number;
}

/** What the server says back. */
export interface ProgressAccepted {
  ok: true;
  progressRatio: number;
}

export interface FlushPorts {
  /** Where the learner is, resolved NOW rather than at the last sample. */
  sample: () => ReadingPositionState;
  /** Seconds accumulated since the last time this was called. Drains them. */
  takeSeconds: () => number;
  /**
   * Hand seconds back to the clock.
   *
   * Used only when a report is ABANDONED rather than retried — the reader is
   * unmounting, say. A report that will be retried keeps its own seconds.
   */
  refundSeconds: (seconds: number) => void;
  send: (
    sessionId: string,
    report: ProgressReport,
  ) => Promise<ProgressAccepted | FluentFailure>;
  /** Open a fresh session after the current one turned out to be sealed. */
  reopen: () => Promise<
    { ok: true; sessionId: string; progressRatio: number } | FluentFailure
  >;
  /** Tell the UI what the server now believes. Newest report only. */
  onAccepted: (progressRatio: number) => void;
  /** A new session id, after a reopen. */
  onSessionChanged: (sessionId: string) => void;
  now: () => number;
  newReportId: () => string;
}

/** The coordinator's whole memory. Mutable on purpose — it lives in a ref. */
export interface FlushState {
  sessionId: string | null;
  /** True while a report is in flight. */
  inFlight: boolean;
  /** A flush asked for while one was in flight, to run when it settles. */
  queued: boolean;
  /** The last `seq` handed out. */
  seq: number;
  /** Sent but never confirmed. Retried verbatim, seconds and id included. */
  unconfirmed: ProgressReport | null;
  /** The position the server last confirmed. Null means "assume nothing". */
  persisted: { resumeOffset: number; furthestOffset: number } | null;
  lastFlushAt: number;
  /** The newest `seq` whose reply has been applied to the screen. */
  appliedSeq: number;
}

export function initialFlushState(sessionId: string | null): FlushState {
  return {
    sessionId,
    inFlight: false,
    queued: false,
    seq: 0,
    unconfirmed: null,
    persisted: null,
    lastFlushAt: 0,
    appliedSeq: 0,
  };
}

/**
 * True when there is reading the server has not been told about.
 *
 * The position half is {@link hasUnsavedPosition}, which already knows that a
 * bookmark moves in BOTH directions — the rule that a learner who read to 42%,
 * scrolled back to 31% and closed the app must not come back to 42%. This adds
 * only what the coordinator knows and the position module cannot: that a report
 * which was sent and never acknowledged is always worth sending again.
 */
function worthSending(
  state: FlushState,
  position: ReadingPositionState,
  seconds: number,
): boolean {
  if (state.unconfirmed) return true;
  return hasUnsavedPosition(position, state.persisted, seconds);
}

/**
 * Run one flush.
 *
 * Resolves once the server has answered (or refused). Never rejects: callers
 * that merely keep the bookmark warm ignore the result; finishing the chapter
 * CANNOT, because `complete_reading_chapter` only knows what the last accepted
 * report told it.
 */
export async function runFlush(
  state: FlushState,
  ports: FlushPorts,
  options: { force?: boolean } = {},
): Promise<{ ok: true } | FluentFailure> {
  if (!state.sessionId) return { ok: true };

  // ONE AT A TIME. Two reports racing is how the resume bookmark ends up
  // written by whichever request happened to finish second.
  if (state.inFlight) {
    state.queued = true;
    return { ok: true };
  }

  const position = ports.sample();

  // A report that was sent and never confirmed is retried VERBATIM — same id,
  // same seconds — so the database can recognise it. Its position is stale by
  // now, but correcting it would change the receipt, and a changed receipt is
  // a second report: the next flush carries the newer position.
  let report = state.unconfirmed;

  if (!report) {
    const seconds = ports.takeSeconds();
    if (!options.force && !worthSending(state, position, seconds)) {
      // Nothing to say. Give the seconds straight back rather than dropping
      // them on the floor — they are reading either way.
      if (seconds > 0) ports.refundSeconds(seconds);
      return { ok: true };
    }
    state.seq += 1;
    report = {
      reportId: ports.newReportId(),
      seq: state.seq,
      resume: position.resume,
      furthest: position.furthest,
      activeSeconds: seconds,
    };
  }

  state.inFlight = true;
  state.unconfirmed = report;
  state.lastFlushAt = ports.now();

  try {
    let sessionId = state.sessionId;
    let result = await ports.send(sessionId, report);

    // A SEALED SESSION IS NOT A DEAD END. A second tab, a restore from the
    // back/forward cache, or simply having been away long enough can leave the
    // reader holding a session the server has finished with — and without this
    // the rest of the sitting would silently write nothing and the chapter
    // could never be completed. The report goes again UNCHANGED, so reopening
    // cannot duplicate its seconds.
    if (!result.ok && isStaleSession(result.code)) {
      const reopened = await ports.reopen();
      if (reopened.ok) {
        sessionId = reopened.sessionId;
        state.sessionId = sessionId;
        ports.onSessionChanged(sessionId);
        result = await ports.send(sessionId, report);
      }
    }

    if (!result.ok) {
      // The report stays unconfirmed: its seconds are still inside it and the
      // next attempt sends the same receipt. Nothing is assumed about what the
      // server persisted, so the position is re-sent too.
      state.persisted = null;
      return result;
    }

    state.unconfirmed = null;
    state.persisted = {
      resumeOffset: position.resumeOffset,
      furthestOffset: position.furthestOffset,
    };

    // A reply older than one already applied would push the on-screen ratio
    // backwards. It still counted — the seconds and the furthest mark are
    // committed — it just must not repaint.
    if (report.seq >= state.appliedSeq) {
      state.appliedSeq = report.seq;
      ports.onAccepted(result.progressRatio);
    }
    return { ok: true };
  } finally {
    state.inFlight = false;
    if (state.queued) {
      state.queued = false;
      // Whatever arrived while this was in flight still needs writing. Fired
      // rather than awaited so a caller waiting on THIS report is not made to
      // wait on the next one too.
      void runFlush(state, ports);
    }
  }
}

/**
 * Give an abandoned report's seconds back to the clock.
 *
 * Called when the reader unmounts with a report still unconfirmed: it will
 * never be retried, so the time belongs back where it was measured rather than
 * inside an object about to be garbage collected. (In practice the page is
 * usually going away too — but a client-side navigation is not.)
 */
export function abandonFlush(state: FlushState, ports: FlushPorts): void {
  const report = state.unconfirmed;
  if (!report) return;
  state.unconfirmed = null;
  if (report.activeSeconds > 0) ports.refundSeconds(report.activeSeconds);
}

/** The session is gone or finished — codes that a reopen can recover from. */
export function isStaleSession(code: FluentFailure["code"]): boolean {
  return code === "not_found" || code === "session_completed";
}
