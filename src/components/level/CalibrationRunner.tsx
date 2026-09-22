"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { startCalibrationSession } from "@/actions/start-calibration-session";
import { answerCalibrationQuestion } from "@/actions/answer-calibration-question";
import { finalizeCalibrationSession } from "@/actions/finalize-calibration-session";
import { useCalibrationQuestions } from "@/hooks/useCalibrationQuestions";
import { useAbility } from "@/hooks/useAbility";
import { useOwnedTimeout } from "@/hooks/useOwnedTimeout";
import { settleAction } from "@/lib/errors";
import { updateAbility, type AbilityRating } from "@/lib/elo";
import {
  INITIAL_RATING,
  MAX_ITEMS,
  pickNextQuestion,
  shouldStop,
} from "@/lib/calibration-test";
import { abilityToCefr } from "@/lib/cefr";
import { shuffleWithOrder } from "@/lib/shuffle";
import { LevelRing } from "@/components/level/LevelRing";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AbilityState, CalibrationQuestion } from "@/types";

/**
 * Longer than a test's reveal: a placement item is the learner's first contact
 * with the level system, and the on-screen estimate moves at the same moment.
 * Kept here rather than in `src/lib/session/constants.ts` because it is a
 * different number for a different reason, not a copy that drifted.
 */
const REVEAL_MS = 1200;

interface ItemFeedback {
  isCorrect: boolean;
  correctIdx: number;
}

/**
 * Adaptive German placement test.
 *
 * The browser still chooses which item to ask next — that is a UX decision, not
 * a security one, since picking an easy item only makes the estimate worse for
 * the learner. The running `rating` below exists purely to drive that choice and
 * the progress the learner sees.
 *
 * What it is NOT is the result. Every answer is committed to a server-side
 * placement session, and `finalizeCalibrationSession` replays those stored
 * answers through the same Elo update to produce the level that is written to
 * the profile. The client sends a session id and nothing else, so the previous
 * "post me your ability and rd" hole is closed while the on-screen experience is
 * unchanged.
 */
export function CalibrationRunner() {
  const { data: pool, isLoading } = useCalibrationQuestions();
  const setAbility = useAbility((s) => s.setAbility);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rating, setRating] = useState<AbilityRating>(INITIAL_RATING);
  const [asked, setAsked] = useState<number[]>([]);
  const [deltas, setDeltas] = useState<number[]>([]);
  const [current, setCurrent] = useState<CalibrationQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<ItemFeedback | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<AbilityState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shuffle the current item's options so the correct answer is not always under
  // the same letter. Re-shuffled whenever a new item is shown. `order[displayed]`
  // is the stored index, used to map the choice back before grading.
  const view = useMemo(
    () => (current ? shuffleWithOrder(current.options) : null),
    [current],
  );

  const questionShownAt = useRef<number>(0);
  const startedRef = useRef(false);
  const reveal = useOwnedTimeout();

  // Open the session and seed the first item once the pool has loaded.
  useEffect(() => {
    if (startedRef.current || !pool || pool.length === 0) return;
    startedRef.current = true;

    void (async () => {
      const started = await settleAction(
        startCalibrationSession,
        "startCalibrationSession",
      );
      if (!started.ok) {
        setError(started.message);
        return;
      }
      setSessionId(started.sessionId);
      setCurrent(pickNextQuestion(pool, INITIAL_RATING.ability, new Set()));
      questionShownAt.current = Date.now();
    })();
  }, [pool]);

  const finish = useCallback(
    async (session: string) => {
      const result = await settleAction(
        () => finalizeCalibrationSession(session),
        `finalizeCalibrationSession ${session}`,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Drop the action-result envelope; only the ability snapshot belongs in
      // the store.
      const snapshot: AbilityState = {
        ability: result.ability,
        rd: result.rd,
        answered: result.answered,
        cefrEstimate: result.cefrEstimate,
      };
      setAbility(snapshot);
      setDone(snapshot);
    },
    [setAbility],
  );

  async function choose(displayedIdx: number) {
    if (!pool || !current || !view || !sessionId || pending || feedback) return;
    setSelected(displayedIdx);
    setPending(true);

    // Settled, so a REJECTED action (a dropped connection, a redacted
    // production error) becomes Polish copy instead of an unhandled rejection
    // that leaves `pending` true and every option disabled for good.
    const answered = await settleAction(
      () =>
        answerCalibrationQuestion({
          sessionId,
          questionId: current.id,
          selectedIdx: view.order[displayedIdx],
          responseMs: Date.now() - questionShownAt.current,
        }),
      `answerCalibrationQuestion ${sessionId}`,
    );

    if (!answered.ok) {
      setError(answered.message);
      setPending(false);
      setSelected(null);
      return;
    }

    setFeedback({ isCorrect: answered.isCorrect, correctIdx: answered.correctIdx });

    // Advance the on-screen estimate. This mirrors the replay the server will
    // run over the same stored answers, so the learner sees the level they
    // watched being built.
    const nextRating = updateAbility(rating, answered.difficulty, answered.isCorrect, {
      answered: asked.length,
    });
    const nextAsked = [...asked, current.id];
    const nextDeltas = [...deltas, nextRating.ability - rating.ability];
    const upcoming = pickNextQuestion(pool, nextRating.ability, new Set(nextAsked));
    const finished = shouldStop(nextAsked.length, nextDeltas) || !upcoming;

    // Owned: walking away during the reveal cancels it, rather than going on
    // to finalize a placement test the learner has left.
    reveal.schedule(() => {
      setRating(nextRating);
      setAsked(nextAsked);
      setDeltas(nextDeltas);

      if (finished) {
        void finish(sessionId);
        return;
      }

      setCurrent(upcoming);
      setSelected(null);
      setFeedback(null);
      setPending(false);
      questionShownAt.current = Date.now();
    }, REVEAL_MS);
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
        <p className="text-sm text-red">{error}</p>
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

  if (!current) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" /> Przygotowujemy test…
      </p>
    );
  }

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
        options={view?.items ?? current.options}
        selected={selected}
        result={
          feedback && view
            ? {
                isCorrect: feedback.isCorrect,
                // Map the stored correct index to its displayed position.
                correctIdx: view.order.indexOf(feedback.correctIdx),
              }
            : null
        }
        pending={pending}
        onChoose={choose}
      />
    </div>
  );
}
