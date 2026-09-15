"use client";

import { useEffect } from "react";

/** One thing the learner can do with what they just touched. */
export interface ReaderAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

/**
 * The contextual action bar.
 *
 * CONTEXTUAL MEANS CONTEXTUAL (§44). It never shows every action Fluent has: a
 * tapped sentence offers "Przetłumacz" and "Nie rozumiem"; a selected phrase
 * offers "Zapisz zwrot"; a selection that ran past the end of a sentence offers
 * nothing but an explanation. Three buttons is the most that ever appears,
 * because a menu of six on a phone is a menu nobody reads.
 *
 * IT SITS BELOW WHAT IT IS ABOUT, deliberately. iOS puts its own selection
 * callout — Copy / Look Up / Share — ABOVE the selection, and two bars fighting
 * for the same strip of screen is how a reader ends up with an action the
 * learner cannot reach. Below is free, and it is where a thumb already is.
 *
 * IT DOES NOT MOVE THE PAGE. No `scrollIntoView`, no focus steal, no scroll
 * lock: the bar is positioned in viewport coordinates over the text and
 * disappears on the next scroll or tap. Losing the learner's place in a chapter
 * to show them a button would be a bad trade (§92).
 */
export function ReaderActionBar({
  rect,
  actions,
  note,
  onDismiss,
}: {
  rect: DOMRect | null;
  actions: readonly ReaderAction[];
  /** Shown instead of the actions when the selection cannot be used (§131). */
  note?: string | null;
  onDismiss: () => void;
}) {
  // Any scroll dismisses it. A bar anchored to a rectangle that has moved is
  // worse than no bar, and re-measuring on every scroll event is exactly the
  // per-frame work the reader is built to avoid.
  useEffect(() => {
    if (!rect) return;
    const dismiss = () => onDismiss();
    window.addEventListener("scroll", dismiss, { passive: true, once: true });
    window.addEventListener("resize", dismiss, { once: true });
    return () => {
      window.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [rect, onDismiss]);

  if (!rect) return null;

  // Clamped to the viewport with a 12px gutter, so a selection at the very edge
  // of a narrow screen still gets a reachable bar.
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.min(
    Math.max(12, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 12,
  );
  const top = Math.min(rect.bottom + 8, window.innerHeight - 96);

  return (
    <div
      role="group"
      aria-label="Działania dla zaznaczenia"
      className="fixed z-40 flex flex-wrap items-center gap-1 rounded-xl border border-[#4b5563] bg-[#2d3748] p-1 shadow-lg"
      style={{ left, top, width }}
    >
      {note ? (
        <p className="px-2 py-1.5 text-xs text-muted2">{note}</p>
      ) : (
        actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onSelect}
            className="flex min-h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium text-main transition-colors hover:bg-[#374151] focus-visible:bg-[#374151] focus-visible:outline-none"
          >
            {action.icon}
            {action.label}
          </button>
        ))
      )}
    </div>
  );
}
