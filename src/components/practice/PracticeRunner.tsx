"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  startPracticeSession,
  type PracticeQuestion,
  type StartedPracticeSession,
} from "@/actions/start-practice-session";
import {
  answerPracticeQuestion,
  type AnsweredPracticeQuestion,
} from "@/actions/answer-practice-question";
import {
  finalizePracticeSession,
  type FinalizedPracticeSession,
} from "@/actions/finalize-practice-session";
import { useQuestionSession } from "@/hooks/useQuestionSession";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SessionError } from "@/components/ui/session-error";
import { SessionProgress } from "@/components/ui/session-progress";
import { REVEAL_MS } from "@/lib/session/constants";
import { displayedIndex, isBusy } from "@/lib/session/question-session";

/**
 * Runs one weakness drill.
 *
 * Same mechanics as {@link TestRunner} — both drive `useQuestionSession`, so
 * the phases, the reveal timer, staleness and a settled transport are decided
 * in one place rather than twice.
 *
 * WHAT A DRILL IS NOT: a test. Finishing it moves the learner's concept
 * knowledge and today's plan, and touches neither their Elo rating nor their
 * CEFR band. Somebody who practises their worst area should never watch their
 * level drop for it — which is why that difference lives in the actions this
 * file injects and not in the shared controller.
 */
export function PracticeRunner({
  conceptCode,
  planItemId,
}: {
  conceptCode: string;
  planItemId: string | null;
}) {
  const router = useRouter();

  const onFinalized = useCallback(() => {
    // The drill moved the plan inside its own transaction; refreshing makes
    // Today show it without the learner having to reload anything.
    router.refresh();
  }, [router]);

  const { state, choose, retry } = useQuestionSession<
    PracticeQuestion,
    StartedPracticeSession,
    AnsweredPracticeQuestion,
    FinalizedPracticeSession
  >(
    useMemo(
      () => ({
        start: () => startPracticeSession({ conceptCode, planItemId }),
        readStarted: (started) => ({
          sessionId: started.sessionId,
          questions: started.questions,
          resumeAt: started.resumeAt,
        }),
        optionsOf: (question) => question.options,
        answer: ({ sessionId, question, selectedIdx, responseMs }) =>
          answerPracticeQuestion({
            sessionId,
            questionId: question.questionId,
            selectedIdx,
            responseMs,
          }),
        readVerdict: (answered) => ({
          isCorrect: answered.isCorrect,
          correctIdx: answered.correctIdx,
        }),
        finalize: finalizePracticeSession,
        onFinalized,
        revealMs: REVEAL_MS,
      }),
      [conceptCode, planItemId, onFinalized],
    ),
  );

  if (state.phase === "failed" && state.error) {
    return (
      <SessionError
        message={state.error}
        onRetry={state.retry ? retry : undefined}
        backHref="/today"
        backLabel="Wróć do planu"
      />
    );
  }

  if (state.phase === "finished" && state.result) {
    return (
      <Card className="items-center gap-3 p-5 text-center">
        <CheckCircle2 className="size-8 text-green" aria-hidden />
        <p className="text-lg font-bold">Ćwiczenie zakończone</p>
        <p className="text-sm text-muted2">
          {state.result.correct} z {state.result.total} poprawnie
        </p>
        <p className="max-w-xs text-xs text-muted2">
          Te odpowiedzi trafiły do Twojego profilu — kolejne plany uwzględnią je
          automatycznie.
        </p>
        <Button asChild>
          <Link href="/today">Wróć do planu</Link>
        </Button>
      </Card>
    );
  }

  if (state.questions.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Przygotowujemy
        ćwiczenie…
      </p>
    );
  }

  const question = state.questions[state.index];
  if (!question) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Zapisujemy
        wynik…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <SessionProgress
        index={state.index}
        total={state.questions.length}
        answered={state.feedback !== null}
      />

      {/* A failed answer leaves the item untouched and the drill open: the way
          back is to answer again, so the error sits beside the question. */}
      {state.error && state.phase === "answering" && (
        <p className="text-sm text-red" role="alert">
          {state.error}
        </p>
      )}

      <QuestionCard
        prompt={question.prompt}
        options={state.shuffled[state.index].items}
        selected={state.selected}
        result={
          state.feedback
            ? {
                isCorrect: state.feedback.isCorrect,
                correctIdx: displayedIndex(state, state.feedback.correctIdx),
              }
            : null
        }
        pending={isBusy(state.phase)}
        onChoose={choose}
      />
    </div>
  );
}
