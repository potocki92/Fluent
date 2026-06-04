"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { submitAnswer, type SubmitAnswerResult } from "@/actions/submit-answer";
import { completeTest } from "@/actions/complete-test";
import { useAbility } from "@/hooks/useAbility";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { shuffleWithOrder } from "@/lib/shuffle";
import type { Question } from "@/types";

export function TestRunner({
  questions,
  textId,
}: {
  questions: Question[];
  textId: number;
}) {
  const router = useRouter();
  const setAbility = useAbility((s) => s.setAbility);

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitAnswerResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  // Shuffle each question's options once per page load so the correct answer is
  // not always under the same letter. `order[displayedIdx]` is the stored index,
  // used to map the learner's choice back before grading (which compares against
  // the original `correct_idx`).
  const [shuffled] = useState(() =>
    questions.map((q) => shuffleWithOrder(q.options)),
  );

  // Collect every answer; Elo is only scored once, after the last question.
  const answers = useRef<
    { questionId: number; selectedIdx: number; responseMs: number }[]
  >([]);
  // When the current question was first shown, to measure response time.
  const questionShownAt = useRef<number>(0);

  const question = questions[index];
  const total = questions.length;
  const isLast = index === total - 1;

  // Reset the response-time clock whenever a new question is shown.
  useEffect(() => {
    questionShownAt.current = Date.now();
  }, [index]);

  async function choose(idx: number) {
    if (pending || result) return;
    setSelected(idx);
    setPending(true);
    // `idx` is the displayed position; grade against the stored option order.
    const originalIdx = shuffled[index].order[idx];
    try {
      const res = await submitAnswer({
        questionId: question.id,
        selectedIdx: originalIdx,
      });
      setResult(res);
      answers.current.push({
        questionId: question.id,
        selectedIdx: originalIdx,
        responseMs: Date.now() - questionShownAt.current,
      });

      if (isLast) {
        // Score the whole test in one shot (the server re-grades authoritatively).
        let summary;
        try {
          summary = await completeTest({ textId, answers: answers.current });
        } catch {
          // Scoring failed — undo the recorded answer and surface the failure
          // instead of silently resetting (which looks like the test is broken).
          answers.current.pop();
          setResult(null);
          setSelected(null);
          setPending(false);
          setError(true);
          return;
        }
        setAbility({
          ability: summary.abilityAfter,
          rd: summary.rd,
          answered: summary.answered,
        });
        window.setTimeout(() => {
          const params = new URLSearchParams({
            correct: String(summary.correct),
            total: String(summary.total),
            abilityBefore: String(Math.round(summary.abilityBefore)),
            abilityAfter: String(Math.round(summary.abilityAfter)),
          });
          router.push(`/learn/${textId}/results?${params.toString()}`);
        }, 1500);
        return;
      }

      window.setTimeout(() => {
        setIndex((i) => i + 1);
        setSelected(null);
        setResult(null);
      }, 1500);
    } catch {
      // Grading failed — surface it instead of silently resetting, so the
      // learner sees why nothing happened rather than a dead-end click.
      setPending(false);
      setSelected(null);
      setError(true);
    }
  }

  if (error) {
    return (
      <Card className="items-center gap-3 bg-[#2d3748] p-5 text-center">
        <p className="text-sm text-red">
          Coś poszło nie tak przy sprawdzaniu odpowiedzi. Zaloguj się i spróbuj
          ponownie.
        </p>
        <Button asChild variant="ghost">
          <Link href="/learn">Wróć do nauki</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
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

      <QuestionCard
        prompt={question.prompt}
        options={shuffled[index].items}
        selected={selected}
        result={
          result
            ? {
                isCorrect: result.isCorrect,
                // Map the stored correct index to its displayed position.
                correctIdx: shuffled[index].order.indexOf(result.correctIdx),
              }
            : null
        }
        pending={pending}
        onChoose={choose}
      />
    </div>
  );
}
