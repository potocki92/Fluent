"use client";

import { useEffect, useState } from "react";

/**
 * How much of the screen the on-screen keyboard is covering, in pixels.
 *
 * WHY THIS EXISTS. On iOS Safari the layout viewport does NOT shrink when the
 * keyboard opens: `100vh`, `100svh` and `position: fixed; bottom: 0` all keep
 * pointing at the bottom of the screen, which is now behind the keyboard. A
 * bottom sheet with a textarea in it therefore ends up with its input — and its
 * save button — under the keys, and the learner is typing into something they
 * cannot see. That is the single most common way a "write a note" feature is
 * broken on a phone, and §90 of this phase exists because of it.
 *
 * `visualViewport` is the API that does report the change, and it is available
 * in every browser Fluent supports. The difference between the layout height and
 * the visual viewport's bottom edge is exactly the covered strip, which the
 * caller adds to its own bottom padding.
 *
 * DEGRADES TO ZERO. Without `visualViewport` — an old WebView, a server render —
 * this returns 0 and the sheet is laid out as it always was: correct on desktop,
 * and no worse than not having the hook. It never returns a negative number, so
 * a bouncing scroll cannot pull the sheet off the bottom of the screen.
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  // SUBSCRIBE ONLY. The keyboard appearing is itself a `resize`, so there is no
  // initial measurement to take: this effect wires up the listener and every
  // value comes from the browser telling us something changed. Measuring
  // synchronously on mount would be a setState in an effect body — a cascading
  // render for a number that is always 0 at that moment anyway.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;

    const measure = () => {
      const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
      // Sub-pixel noise from the address bar animating is not a keyboard.
      setInset(covered > 24 ? Math.round(covered) : 0);
    };

    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, [enabled]);

  // Disabled means zero, decided here rather than by clearing the state: a sheet
  // that has just closed must not keep a stale inset until a resize arrives.
  return enabled ? inset : 0;
}
