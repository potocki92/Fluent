"use client";

import { useState, type ReactNode } from "react";
import { CircleHelp, Layers } from "lucide-react";

import { ReviewSession } from "@/components/flashcard/ReviewSession";
import { QuizSession } from "@/components/flashcard/QuizSession";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { cn } from "@/lib/utils";

type Mode = "flashcard" | "quiz";

const MODES: { id: Mode; label: string; icon: typeof Layers }[] = [
  { id: "flashcard", label: "Fiszki", icon: Layers },
  { id: "quiz", label: "Quiz", icon: CircleHelp },
];

/**
 * The two ways to work through the same deck.
 *
 * IT IS A LINK IN THE HEIGHT CHAIN, NOT A WRAPPER. The review screen is a fixed
 * column and the flashcard is the only thing in it that flexes (§39), so this
 * component has to pass the flex down rather than absorb it: the switch itself
 * is a measured 44px row, and the session below it gets `min-h-0 flex-1`.
 * Without the `min-h-0` a flex child refuses to shrink below its content and
 * the whole arrangement quietly becomes a long page again (§40).
 *
 * THE ICONS ARE LUCIDE, NOT EMOJI (§12). 🃏 and ❓ render at a different size,
 * weight and colour on every platform, and neither of them can be gold when
 * selected.
 *
 * `trailing` SHARES THE ROW RATHER THAN ADDING ONE. The way into the notebook
 * deck used to be a full-width card of its own, which cost 51px of the review
 * screen's budget — about a third of the flashcard — to hold one number. Beside
 * a 44px switch there is room for a 44px control and the row is already there.
 */
export function ReviewModeSwitch({
  cards,
  extra,
  className,
  trailing,
}: {
  cards: SavedWordWithWord[];
  extra?: SavedWordWithWord[];
  className?: string;
  /** A control that sits beside the switch, in the same 44px row. */
  trailing?: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("flashcard");

  return (
    <div className={cn("review-screen flex flex-col", className)}>
      <div className="flex h-12 shrink-0 items-stretch gap-2">
        <div
          role="tablist"
          aria-label="Tryb powtórki"
          className="flex flex-1 rounded-xl bg-card p-1"
        >
          {MODES.map(({ id, label, icon: Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg text-sm transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "bg-gold font-semibold text-dark"
                    : "font-medium text-muted2 hover:text-main",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        {trailing}
      </div>

      {mode === "flashcard" ? (
        <ReviewSession
          key="flashcard"
          className="min-h-0 flex-1"
          cards={cards}
          extra={extra}
        />
      ) : (
        <QuizSession
          key="quiz"
          className="min-h-0 flex-1"
          cards={cards}
          extra={extra}
        />
      )}
    </div>
  );
}
