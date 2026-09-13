"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  startTestSession,
  type TestSessionQuestion,
} from "@/actions/start-test-session";
import { answerTestQuestion } from "@/actions/answer-test-question";
import { finalizeTestSession } from "@/actions/finalize-test-session";
import { useAbility } from "@/hooks/useAbility";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { abilityToCefr } from "@/lib/cefr";
import { cn } from "@/lib/utils";
import { shuffleWithOrder } from "@/lib/shuffle";
import type { Profile } from "@/types";

/** How long the answer feedback stays on screen before moving on. */
const REVEAL_MS = 1500;

interface ActiveSession {
  sessionId: string;
  questions: TestSessionQuestion[];
  /** Per-question display order; `order[displayed]` is the stored index. */
  shuffled: { items: string[]; order: number[] }[];
}

interface AnswerFeedback {
  isCorrect: boolean;
  correctIdx: number;
}

/**
 * Runs one comprehension test from start to result.
 *
 * The component holds no authority over the outcome. It asks the server to open
 * a session (which decides the questions), posts one answer at a time to that
 * session, and asks the server to finalize it; the score, the rating change and
 * the result screen all come from the database. Everything kept in React state
 * here is presentation: which question is on screen, the shuffled option order,
 * and the feedback currently showing.
 */
export function TestRunner({ textId }: { textId: number }) {
  const router = useRouter();
  const setAbility = useAbility((s) => s.setAbility);
  const queryClient = useQueryClient();

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the current question was first shown, to measure response time.
  const questionShownAt = useRef<number>(0);
  // Guards against React 19 Strict Mode running the start effect twice. The
  // action is idempotent anyway (it resumes rather than duplicating), so this is
  // only about avoiding a redundant round trip.
  const startedRef = useRef(false);

  /**
   * Score the session and move to its result page. Finalizing is idempotent
   * server-side, so a second call — a retry, or a session already finalized in
   * another tab — returns the stored result instead of scoring twice.
   */
  const finalize = useCallback(
    async (sessionId: string) => {
      const result = await finalizeTestSession(sessionId);
      if (!result.ok) {
        setPending(false);
        setError(result.message);
        return;
      }

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

  // Open (or resume) the session as soon as the test screen mounts.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const started = await startTestSession(textId);
      if (!started.ok) {
        setError(started.message);
        return;
      }

      setSession({
        sessionId: started.sessionId,
        questions: started.questions,
        shuffled: started.questions.map((q) => shuffleWithOrder(q.options)),
      });

      // A resumed session whose questions are all answered never got its result
      // written (the finalize failed or the tab closed first) — finish it now
      // rather than showing a test with nothing left to answer.
      if (started.resumeAt >= started.questions.length) {
        setPending(true);
        await finalize(started.sessionId);
        return;
      }
      setIndex(started.resumeAt);
    })();
  }, [textId, finalize]);

  // Reset the response-time clock whenever a new question is shown.
  useEffect(() => {
    questionShownAt.current = Date.now();
  }, [index]);

  async function choose(displayedIdx: number) {
    if (!session || pending || feedback) return;
    const question = session.questions[index];
    const isLast = index === session.questions.length - 1;

    setSelected(displayedIdx);
    setPending(true);

    // `displayedIdx` is the on-screen position; the server grades against the
    // stored option order.
    const answer = await answerTestQuestion({
      sessionId: session.sessionId,
      questionId: question.questionId,
      selectedIdx: session.shuffled[index].order[displayedIdx],
      responseMs: Date.now() - questionShownAt.current,
    });

    if (!answer.ok) {
      // A session finalized elsewhere (another tab, a replayed submit) is not a
      // failure for the learner — their result exists, so show it.
      if (answer.code === "session_completed") {
        router.push(`/learn/${textId}/results/${session.sessionId}`);
        return;
      }
      setPending(false);
      setSelected(null);
      setError(answer.message);
      return;
    }

    setFeedback({ isCorrect: answer.isCorrect, correctIdx: answer.correctIdx });

    if (isLast) {
      window.setTimeout(() => void finalize(session.sessionId), REVEAL_MS);
      return;
    }

    window.setTimeout(() => {
      setIndex((i) => i + 1);
      setSelected(null);
      setFeedback(null);
      setPending(false);
    }, REVEAL_MS);
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

  if (!session) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" /> Przygotowujemy test…
      </p>
    );
  }

  const total = session.questions.length;
  const question = session.questions[index];
  const view = session.shuffled[index];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted2">
            Pytanie {index + 1}/{total}
          </p>
          <div className="flex items-center gap-1.5">
            {session.questions.map((q, i) => (
              <span
                key={q.questionId}
                className={cn(
                  "size-2 rounded-full",
                  i < index || (i === index && feedback)
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
        options={view.items}
        selected={selected}
        result={
          feedback
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
