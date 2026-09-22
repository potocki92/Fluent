"use client";

import Link from "next/link";
import { PartyPopper } from "lucide-react";

import type { ReviewGrade } from "@/lib/sm2";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface Result {
  wordId: number;
  grade: ReviewGrade;
  mastered: boolean;
}

/**
 * End-of-session summary shared by the flashcard and quiz review sessions, with
 * the option to re-drill failed cards. `firstLabel` distinguishes the leading
 * stat ("nauczonych" for flashcards, "poprawnych" for the quiz).
 */
export function SessionEnd({
  results,
  onRepeat,
  onContinue,
  firstLabel,
}: {
  results: Result[];
  onRepeat: () => void;
  /** When provided, offers a "ucz się dalej" button to extend the session. */
  onContinue?: () => void;
  firstLabel: string;
}) {
  const toRepeat = results.filter((r) => r.grade === "again").length;
  const learned = results.length - toRepeat;
  const mastered = results.filter((r) => r.mastered).length;

  return (
    <Card className="items-center gap-4 bg-[#2d3748] p-5 text-center">
      <PartyPopper className="size-8 text-gold" />
      <p className="text-lg font-semibold">Sesja zakończona!</p>

      <div className="grid w-full grid-cols-3 gap-3 text-center">
        <Summary value={learned} label={firstLabel} />
        <Summary value={toRepeat} label="do powtórki" />
        <Summary value={mastered} label="opanowanych" />
      </div>

      <div className="flex w-full flex-col gap-2">
        {onContinue && (
          <Button onClick={onContinue} className="bg-gold text-[#1a202c]">
            Ucz się dalej
          </Button>
        )}
        {toRepeat > 0 && (
          <Button
            onClick={onRepeat}
            className={
              onContinue
                ? "bg-[#374151] text-[#e2e8f0] hover:bg-[#4a5568]"
                : "bg-gold text-[#1a202c]"
            }
          >
            Powtórz błędy
          </Button>
        )}
        {/* Back to Today, not to the text list: a session opened from the daily
            plan should return to it, and the plan reconciles this session's
            progress the moment it renders. */}
        <Link
          href="/today"
          className="rounded-xl bg-[#374151] px-4 py-2 text-sm font-semibold text-[#e2e8f0] transition-colors hover:bg-[#4a5568]"
        >
          Wróć do planu
        </Link>
      </div>
    </Card>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-[#374151] p-3">
      <p className="text-xl font-bold text-gold">{value}</p>
      <p className="text-xs text-muted2">{label}</p>
    </div>
  );
}
