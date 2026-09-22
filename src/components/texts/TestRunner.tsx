"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  startTestSession,
  type StartedTestSession,
  type TestSessionQuestion,
} from "@/actions/start-test-session";
import {
  answerTestQuestion,
  type AnsweredTestQuestion,
} from "@/actions/answer-test-question";
import {
  finalizeTestSession,
  type FinalizedTestSession,
} from "@/actions/finalize-test-session";
import { useAbility } from "@/hooks/useAbility";
import { useQuestionSession } from "@/hooks/useQuestionSession";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { SessionError } from "@/components/ui/session-error";
import { SessionProgress } from "@/components/ui/session-progress";
import { abilityToCefr } from "@/lib/cefr";
import { REVEAL_MS } from "@/lib/session/constants";
import { displayedIndex, isBusy } from "@/lib/session/question-session";
import type { Profile } from "@/types";

/**
 * Runs one comprehension test from start to result.
 *
 * The component holds no authority over the outcome. It asks the server to open
 * a session (which decides the questions), posts one answer at a time to that
 * session, and asks the server to finalize it; the score, the rating change and
 * the result screen all come from the database.
 *
 * The mechanics it shares with the weakness drill — the phases, the reveal
 * timer, staleness, settling a rejected action — live in `useQuestionSession`.
 * What stays here is what a TEST means and a drill does not: an Elo change, a
 * CEFR band, a completion row, and the result page they are shown on.
 */
export function TestRunner({ textId }: { textId: number }) {
  const router = useRouter();
  const setAbility = useAbility((s) => s.setAbility);
  const queryClient = useQueryClient();

  const onFinalized = useCallback(
    (result: FinalizedTestSession, sessionId: string) => {
      setAbility({
        ability: result.abilityAfter,
        rd: result.rd,
        answered: result.answered,
      });
      // This text now has a fresh completion row — refetch so the learn page
      // moves it to the right section (passed → "read & passed", failed → retry).
      queryClient.invalidateQueries({ queryKey: ["completedTexts"] });
      // Keep the ["profile"] cache in step with the authoritative result, so a
      // later remount of useProfile re-hydrates the store from fresh data
      // instead of clobbering it with the pre-test profile.
      queryClient.setQueryData<Profile | null>(["profile"], (prev) =>
        prev
          ? {
              ...prev,
              ability: result.abilityAfter,
              rd: result.rd,
              answered: result.answered,
              cefr_estimate: abilityToCefr(result.abilityAfter),
            }
          : prev,
      );

      router.push(`/learn/${textId}/results/${sessionId}`);
    },
    [queryClient, router, setAbility, textId],
  );

  const { state, choose, retry } = useQuestionSession<
    TestSessionQuestion,
    StartedTestSession,
    AnsweredTestQuestion,
    FinalizedTestSession
  >(
    useMemo(
      () => ({
        start: () => startTestSession(textId),
        readStarted: (started) => ({
          sessionId: started.sessionId,
          questions: started.questions,
          resumeAt: started.resumeAt,
        }),
        optionsOf: (question) => question.options,
        answer: ({ sessionId, question, selectedIdx, responseMs }) =>
          answerTestQuestion({
            sessionId,
            questionId: question.questionId,
            selectedIdx,
            responseMs,
          }),
        readVerdict: (answered) => ({
          isCorrect: answered.isCorrect,
          correctIdx: answered.correctIdx,
        }),
        finalize: finalizeTestSession,
        onFinalized,
        onAnswerFailure: (failure, sessionId) => {
          // A session finalized elsewhere (another tab, a replayed submit) is
          // not a failure for the learner — their result exists, so show it.
          if (failure.code !== "session_completed") return false;
          router.push(`/learn/${textId}/results/${sessionId}`);
          return true;
        },
        revealMs: REVEAL_MS,
      }),
      [textId, onFinalized, router],
    ),
  );

  if (state.phase === "failed" && state.error) {
    return (
      <SessionError
        message={state.error}
        onRetry={state.retry ? retry : undefined}
        backHref="/learn"
        backLabel="Wróć do nauki"
      />
    );
  }

  if (state.questions.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" /> Przygotowujemy test…
      </p>
    );
  }

  const question = state.questions[state.index];
  // While the test is being sealed there is no question left to paint.
  if (!question) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" /> Zapisujemy wynik…
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

      {/* A failed answer leaves the session open, so the error sits beside the
          question the learner can simply answer again. */}
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
                // Map the stored correct index to its displayed position.
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
