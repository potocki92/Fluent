"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { ACTIVE_TICK_MS, IDLE_TIMEOUT_MS } from "@/lib/reading/constants";

/**
 * How long the learner has ACTUALLY been reading.
 *
 * A TAB OPEN FOR TWO HOURS IS NOT TWO HOURS OF READING. Recording it as such
 * would not just be inaccurate, it would poison everything computed from it —
 * reading speed, lookup rate ("one word in 9" vs "one in 31"), the chapter
 * summary, and eventually a personalised time estimate. So the clock only runs
 * when both of these hold:
 *
 *   - the document is visible (`visibilitychange`), and
 *   - something happened within {@link IDLE_TIMEOUT_MS} — a scroll, a tap, a
 *     key, a pointer move.
 *
 * The idle window is a minute rather than a few seconds on purpose: reading is
 * mostly *not* interacting. Someone absorbed in a page produces no events for
 * thirty seconds at a time, and a clock that stopped then would under-count the
 * most engaged reading in the session.
 *
 * This is not laboratory-accurate and does not try to be. It is the difference
 * between a number that is roughly true and one that is fiction.
 */
export function useActiveReadingClock() {
  const secondsRef = useRef(0);
  // Seeded inside the effect, not at render: render must stay pure, and the
  // clock only has any meaning once the reader is actually on screen.
  const lastActivityRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    lastTickRef.current = Date.now();

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const tick = () => {
      const now = Date.now();
      const since = now - lastTickRef.current;
      lastTickRef.current = now;

      if (document.visibilityState !== "visible") return;
      if (now - lastActivityRef.current > IDLE_TIMEOUT_MS) return;
      // Never credit more than one interval, however long the timer was
      // throttled for — a backgrounded tab that wakes up must not hand back the
      // hour it was asleep.
      secondsRef.current += Math.min(since, ACTIVE_TICK_MS) / 1000;
    };

    const onVisibility = () => {
      // Coming back is activity, and it also resets the tick baseline so the
      // time spent away is never counted.
      lastTickRef.current = Date.now();
      markActive();
    };

    const events: (keyof WindowEventMap)[] = [
      "scroll",
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
    ];
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    const timer = window.setInterval(tick, ACTIVE_TICK_MS);

    return () => {
      window.clearInterval(timer);
      for (const event of events) window.removeEventListener(event, markActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /**
   * Take the seconds accumulated since the last call, and reset.
   *
   * Draining rather than reading is what makes the server-side accumulation
   * correct: each report carries an increment that has been counted exactly
   * once, so a lost request loses a few seconds instead of double-counting the
   * whole session.
   */
  const drain = useCallback(() => {
    const whole = Math.floor(secondsRef.current);
    secondsRef.current -= whole;
    return whole;
  }, []);

  /** Seconds accumulated but not yet drained — for the live summary. */
  const peek = useCallback(() => Math.floor(secondsRef.current), []);

  /**
   * Is the learner reading RIGHT NOW?
   *
   * The same two conditions the clock itself runs on, asked as a question so the
   * Reading Position Engine can measure its dwell in the same currency. Without
   * it, a chapter left open at the last page would confirm itself as read after
   * `READ_DWELL_MS` of wall time — and "furthest read" would go back to
   * meaning "furthest scrolled", which is the bug the dwell exists to fix.
   */
  const isActive = useCallback(
    () =>
      document.visibilityState === "visible" &&
      Date.now() - lastActivityRef.current <= IDLE_TIMEOUT_MS,
    [],
  );

  // ONE OBJECT, FOR THE LIFE OF THE READER. A fresh literal here is not a
  // cosmetic problem: an effect that depends on the clock then re-runs on every
  // render, and any cleanup it has runs with it. That is precisely how the
  // reader came to seal its own reading session while the learner was still
  // reading — after which every progress report was refused as belonging to a
  // finished session, and with it the chapter's completion.
  return useMemo(() => ({ drain, peek, isActive }), [drain, isActive, peek]);
}
