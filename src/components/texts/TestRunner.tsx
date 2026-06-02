"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { submitAnswer, type SubmitAnswerResult } from "@/actions/submit-answer";
import { useAbility } from "@/hooks/useAbility";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Question } from "@/types";

const LETTERS = ["A", "B", "C", "D"];

export function TestRunner({
  questions,
  textId,
}: {
  questions: Question[];
  textId: number;
}) {
  const router = useRouter();
  const ability = useAbility((s) => s.ability);
  const applyResult = useAbility((s) => s.applyResult);

  // Snapshot the ability at the start so results can show before → after.
  const abilityBefore = useRef(ability).current;

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitAnswerResult | null>(null);
  const [pending, setPending] = useState(false);
  const [score, setScore] = useState(0);

  const question = questions[index];
  const total = questions.length;
  const isLast = index === total - 1;

  async function choose(idx: number) {
    if (pending || result) return;
    setSelected(idx);
    setPending(true);
    try {
      const res = await submitAnswer({
        questionId: question.id,
        selectedIdx: idx,
      });
      setResult(res);
      applyResult(res);
      const nextScore = res.isCorrect ? score + 1 : score;
      if (res.isCorrect) setScore(nextScore);

      window.setTimeout(() => {
        if (isLast) {
          const params = new URLSearchParams({
            correct: String(nextScore),
            total: String(total),
            abilityBefore: String(Math.round(abilityBefore)),
            abilityAfter: String(Math.round(res.abilityAfter)),
          });
          router.push(`/learn/${textId}/results?${params.toString()}`);
          return;
        }
        setIndex((i) => i + 1);
        setSelected(null);
        setResult(null);
      }, 1500);
    } catch {
      // Allow a retry if the grading request failed.
      setPending(false);
      setSelected(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted2">
            Pytanie {index + 1}/{total}
          </p>
          <div className="flex items-center gap-1.5">
            {questions.map((q, i) => (
              <span
                key={q.id}
                className={cn(
                  "size-2 rounded-full",
                  i < index || (i === index && result)
                    ? "bg-gold"
                    : i === index
                      ? "bg-[#a0aec0]"
                      : "bg-[#374151]",
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <Card className="min-h-[300px] justify-center gap-6 bg-[#2d3748] p-6 text-center">
        <p className="text-xl font-semibold">{question.prompt}</p>

        <div className="space-y-3">
          {question.options.map((option, i) => {
            const isSelected = selected === i;
            const isLoading = pending && isSelected;
            const showCorrect = result && result.correctIdx === i;
            const showWrong = result && isSelected && !result.isCorrect;

            return (
              <button
                key={i}
                type="button"
                disabled={pending || result !== null}
                onClick={() => choose(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border-2 px-4 py-3.5 text-left text-base transition-colors",
                  "border-transparent bg-[#374151]",
                  isLoading && "animate-pulse border-[#a0aec0]",
                  showCorrect && "border-[#48bb78] bg-green-900/50",
                  showWrong && "border-[#f56565] bg-red-900/50",
                  !result &&
                    !isLoading &&
                    "hover:border-[#a0aec0] disabled:hover:border-transparent",
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[#1a202c] text-sm font-bold text-muted2">
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
    </div>
  );
}
