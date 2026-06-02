"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { submitAnswer } from "@/actions/submit-answer";
import { useAbility } from "@/hooks/useAbility";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Question } from "@/types";

export default function TestPage() {
  const params = useParams<{ textId: string }>();
  const textId = Number(params.textId);
  const router = useRouter();
  const applyResult = useAbility((s) => s.applyResult);

  const { data: questions, isLoading } = useQuery({
    queryKey: ["questions", textId],
    queryFn: async (): Promise<Question[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("questions")
        .select("id, text_id, prompt, options, difficulty, created_at")
        .eq("text_id", textId);
      if (error) throw error;
      return (data ?? []) as unknown as Question[];
    },
  });

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctIdx, setCorrectIdx] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [pending, setPending] = useState(false);

  if (isLoading) return <p className="text-sm text-muted2">Ładowanie pytań…</p>;
  if (!questions || questions.length === 0)
    return <p className="text-sm text-muted2">Brak pytań do tego tekstu.</p>;

  const question = questions[index];
  const answered = correctIdx !== null;
  const isLast = index === questions.length - 1;

  async function check() {
    if (selected === null) return;
    setPending(true);
    try {
      const result = await submitAnswer({
        questionId: question.id,
        selectedIdx: selected,
      });
      setCorrectIdx(result.correctIdx);
      applyResult(result);
      if (result.isCorrect) setScore((s) => s + 1);
    } finally {
      setPending(false);
    }
  }

  function next() {
    const finalScore = score;
    if (isLast) {
      router.push(
        `/learn/${textId}/results?correct=${finalScore}&total=${questions!.length}`,
      );
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
    setCorrectIdx(null);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Progress value={((index + 1) / questions.length) * 100} />
        <p className="text-xs text-muted2">
          Pytanie {index + 1} z {questions.length}
        </p>
      </div>

      <Card className="gap-4 bg-[#2d3748] p-5">
        <p className="font-medium">{question.prompt}</p>
        <div className="space-y-2">
          {question.options.map((option, i) => {
            const isSelected = selected === i;
            const isCorrect = answered && correctIdx === i;
            const isWrong = answered && isSelected && correctIdx !== i;
            return (
              <button
                key={i}
                type="button"
                disabled={answered}
                onClick={() => setSelected(i)}
                className={cn(
                  "w-full rounded-md border border-[#374151] bg-[#374151] px-4 py-3 text-left text-sm transition-colors",
                  isSelected && !answered && "border-gold",
                  isCorrect && "border-green bg-green/15 text-green",
                  isWrong && "border-red bg-red/15 text-red",
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </Card>

      {answered ? (
        <Button
          onClick={next}
          className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          {isLast ? "Zobacz wynik" : "Następne pytanie"}
        </Button>
      ) : (
        <Button
          onClick={check}
          disabled={selected === null || pending}
          className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          Sprawdź odpowiedź
        </Button>
      )}
    </div>
  );
}
