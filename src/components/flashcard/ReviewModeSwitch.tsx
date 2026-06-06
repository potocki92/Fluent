"use client";

import { useState } from "react";

import { ReviewSession } from "@/components/flashcard/ReviewSession";
import { QuizSession } from "@/components/flashcard/QuizSession";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";

type Mode = "flashcard" | "quiz";

export function ReviewModeSwitch({ cards }: { cards: SavedWordWithWord[] }) {
  const [mode, setMode] = useState<Mode>("flashcard");

  return (
    <div className="flex flex-col gap-4">
      {/* Mode toggle */}
      <div className="flex rounded-xl bg-[#2d3748] p-1">
        {(["flashcard", "quiz"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              mode === m
                ? "flex-1 rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-[#1a202c] transition-colors"
                : "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium text-muted2 transition-colors hover:text-[#e2e8f0]"
            }
          >
            {m === "flashcard" ? "🃏 Fiszki" : "❓ Quiz"}
          </button>
        ))}
      </div>

      {mode === "flashcard" ? (
        <ReviewSession key="flashcard" cards={cards} />
      ) : (
        <QuizSession key="quiz" cards={cards} />
      )}
    </div>
  );
}
