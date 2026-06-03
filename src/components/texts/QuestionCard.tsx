"use client";

import { Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const LETTERS = ["A", "B", "C", "D"];

/** The graded outcome of the current question, or `null` before answering. */
export interface QuestionResult {
  correctIdx: number;
  isCorrect: boolean;
}

/**
 * Presentational single-question card: a prompt, the answer options, and the
 * post-answer feedback line. Shared by the text test and the calibration test so
 * the option styling and feedback stay in sync.
 */
export function QuestionCard({
  prompt,
  options,
  selected,
  result,
  pending,
  onChoose,
}: {
  prompt: string;
  options: string[];
  selected: number | null;
  result: QuestionResult | null;
  pending: boolean;
  onChoose: (idx: number) => void;
}) {
  return (
    <>
      <Card className="min-h-[260px] justify-center gap-4 bg-[#2d3748] p-4 text-center">
        <p className="text-lg font-semibold">{prompt}</p>

        <div className="space-y-3">
          {options.map((option, i) => {
            const isSelected = selected === i;
            const isLoading = pending && isSelected;
            const showCorrect = result && result.correctIdx === i;
            const showWrong = result && isSelected && !result.isCorrect;

            return (
              <button
                key={i}
                type="button"
                disabled={pending || result !== null}
                onClick={() => onChoose(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border-2 px-3 py-3 text-left text-sm transition-colors",
                  "border-transparent bg-[#374151]",
                  isLoading && "animate-pulse border-[#a0aec0]",
                  showCorrect && "border-[#48bb78] bg-green-900/50",
                  showWrong && "border-[#f56565] bg-red-900/50",
                  !result &&
                    !isLoading &&
                    "hover:border-[#a0aec0] disabled:hover:border-transparent",
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#1a202c] text-sm font-bold text-muted2">
                  {LETTERS[i]}
                </span>
                <span className="flex-1">{option}</span>
                {isLoading && <Loader2 className="size-4 animate-spin" />}
              </button>
            );
          })}
        </div>
      </Card>

      {result && (
        <p
          className={cn(
            "text-center text-sm font-medium",
            result.isCorrect ? "text-green" : "text-red",
          )}
        >
          {result.isCorrect
            ? "✓ Poprawnie!"
            : `✗ Błąd. Poprawna: ${LETTERS[result.correctIdx]}`}
        </p>
      )}
    </>
  );
}
