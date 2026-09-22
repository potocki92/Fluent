"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A `setTimeout` whose handle somebody owns.
 *
 * A bare `window.setTimeout(() => { … })` inside a callback keeps no handle, so
 * nothing can cancel it. That is harmless for a toast and not harmless at all
 * for a session: the reveal timer in each runner went on to finalize a session,
 * advance to the next card, or set state on a tree the learner had already left
 * — a write nobody asked for, attributed to somebody who had navigated away.
 *
 * This clears the pending timer on unmount and whenever a new one is scheduled,
 * so "the last thing scheduled wins, and leaving cancels it" is the default
 * rather than something each call site remembers.
 */
export function useOwnedTimeout(): {
  /** Schedule `run` after `ms`, replacing any timer already pending. */
  schedule: (run: () => void, ms: number) => void;
  /** Cancel the pending timer, if there is one. */
  cancel: () => void;
} {
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback(
    (run: () => void, ms: number) => {
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        run();
      }, ms);
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
