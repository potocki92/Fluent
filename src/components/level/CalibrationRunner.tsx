"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { gradeCalibrationAnswer } from "@/actions/grade-calibration";
import { finishCalibration } from "@/actions/finish-calibration";
import { useCalibrationQuestions } from "@/hooks/useCalibrationQuestions";
import { useAbility } from "@/hooks/useAbility";
import { updateAbility, type AbilityRating } from "@/lib/elo";
import {
  finalizeRating,
  INITIAL_RATING,
  MAX_ITEMS,
  pickNextQuestion,
  shouldStop,
} from "@/lib/calibration-test";
import { abilityToCefr } from "@/lib/cefr";
import { LevelRing } from "@/components/level/LevelRing";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AbilityState, CalibrationQuestion } from "@/types";
import type { GradeCalibrationResult } from "@/actions/grade-calibration";

const REVEAL_MS = 1200;

/**
 * Adaptive German placement test. Items are picked near the running ability
 * estimate, each answer is folded in with the shared Elo update, and the test
 * stops once the estimate settles. The final level is written to the profile.
 */
export function CalibrationRunner() {
  const { data: pool, isLoading } = useCalibrationQuestions();
  const setAbility = useAbility((s) => s.setAbility);

  const [rating, setRating] = useState<AbilityRating>(INITIAL_RATING);
  const [asked, setAsked] = useState<number[]>([]);
  const [deltas, setDeltas] = useState<number[]>([]);
  const [current, setCurrent] = useState<CalibrationQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<GradeCalibrationResult | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<AbilityState | null>(null);
  const [error, setError] = useState(false);

  // Seed the first question once the pool has loaded.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !pool || pool.length === 0) return;
    started.current = true;
    setCurrent(pickNextQuestion(pool, INITIAL_RATING.ability, new Set()));
  }, [pool]);

  async function choose(idx: number) {
    if (!pool || !current || pending || result) return;
    setSelected(idx);
    setPending(true);
    try {
      const res = await gradeCalibrationAnswer({
        questionId: current.id,
        selectedIdx: idx,
      });
      setResult(res);

      const nextRating = updateAbility(rating, res.difficulty, res.isCorrect, {
        answered: asked.length,
      });
      const nextAsked = [...asked, current.id];
      const nextDeltas = [...deltas, nextRating.ability - rating.ability];

      const askedSet = new Set(nextAsked);
      const upcoming = pickNextQuestion(pool, nextRating.ability, askedSet);
      const finished = shouldStop(nextAsked.length, nextDeltas) || !upcoming;

      window.setTimeout(async () => {
        setRating(nextRating);
        setAsked(nextAsked);
        setDeltas(nextDeltas);

        if (finished) {
          try {
            const final = finalizeRating(nextRating);
            const snapshot = await finishCalibration({
              ability: final.ability,
              rd: final.rd,
              items: nextAsked.length,
            });
            setAbility(snapshot);
            setDone(snapshot);
          } catch {
            setError(true);
          }
          return;
        }

        setCurrent(upcoming);
        setSelected(null);
        setResult(null);
        setPending(false);
      }, REVEAL_MS);
    } catch {
      setError(true);
      setPending(false);
      setSelected(null);
    }
  }

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" /> Ładowanie testu…
      </p>
    );
  }

  if (!pool || pool.length === 0) {
    return (
      <p className="text-sm text-muted2">
        Brak pytań kalibracyjnych. Skontaktuj się z administratorem.
      </p>
    );
  }

  if (error) {
    return (
      <Card className="items-center gap-3 bg-[#2d3748] p-5 text-center">
        <p className="text-sm text-red">
          Coś poszło nie tak. Zaloguj się i spróbuj ponownie.
        </p>
        <Button asChild variant="ghost">
          <Link href="/learn">Wróć do nauki</Link>
        </Button>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="items-center gap-4 bg-[#2d3748] p-5 text-center">
        <span className="text-4xl">🎯</span>
        <p className="text-xl font-bold">Twój poziom: {abilityToCefr(done.ability)}</p>
        <LevelRing size="sm" ability={done.ability} answered={done.answered} />
        <p className="text-sm text-muted2">
          Test poziomujący ukończony. Od teraz teksty będą dobierane do Twojego
          poziomu.
        </p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <Button
            asChild
            className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
          >
            <Link href="/learn">Zacznij naukę</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/stats">Moje statystyki</Link>
          </Button>
        </div>
      </Card>
    );
  }

  if (!current) return null;

  const step = asked.length + 1;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted2">
            Pytanie {step} (maks. {MAX_ITEMS})
          </p>
          <span className="text-xs text-muted2">
            Test dobiera trudność do Twoich odpowiedzi
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#374151]">
          <div
            className="h-full rounded-full bg-gold transition-all"
            style={{ width: `${Math.min(100, (asked.length / MAX_ITEMS) * 100)}%` }}
          />
        </div>
      </div>

      <QuestionCard
        prompt={current.prompt}
        options={current.options}
        selected={selected}
        result={result}
        pending={pending}
        onChoose={choose}
      />
    </div>
  );
}
