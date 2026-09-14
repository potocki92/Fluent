"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  startPracticeSession,
  type PracticeQuestion,
} from "@/actions/start-practice-session";
import { answerPracticeQuestion } from "@/actions/answer-practice-question";
import { finalizePracticeSession } from "@/actions/finalize-practice-session";
import { QuestionCard } from "@/components/texts/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { shuffleWithOrder } from "@/lib/shuffle";
import { cn } from "@/lib/utils";

/** How long the answer feedback stays on screen. Matches the reading test. */
const REVEAL_MS = 1500;

interface ActiveSession {
  sessionId: string;
  conceptLabel: string;
  questions: PracticeQuestion[];
  /** Per-question display order; `order[displayed]` is the stored index. */
  shuffled: { items: string[]; order: number[] }[];
}

interface Feedback {
  isCorrect: boolean;
  correctIdx: number;
}

/**
 * Runs one weakness drill.
 *
 * Same shape as {@link TestRunner} and for the same reason: the component holds
 * no authority over the outcome. It asks the server for a session (which decides
 * the items), posts one answer at a time, and asks the server to seal it. What
 * lives in React state here is presentation — which question is showing, the
 * shuffled option order, the feedback currently on screen.
 *
 * WHAT A DRILL IS NOT: a test. Finishing it moves the learner's concept
 * knowledge and today's plan, and touches neither their Elo rating nor their
 * CEFR band. Somebody who practises their worst area should never watch their
 * level drop for it.
 */
export function PracticeRunner({
  conceptCode,
  planItemId,
}: {
  conceptCode: string;
  planItemId: string | null;
}) {
  const router = useRouter();

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ correct: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const questionShownAt = useRef(0);
  // React 19 Strict Mode runs effects twice; starting is idempotent server-side
  // (it resumes), so this only avoids a redundant round trip.
  const startedRef = useRef(false);

  const finalize = useCallback(
    async (sessionId: string) => {
      const finished = await finalizePracticeSession(sessionId);
      if (!finished.ok) {
        setPending(false);
        setError(finished.message);
        return;
      }
      setResult({ correct: finished.correct, total: finished.total });
      // The drill moved the plan inside its own transaction; refreshing makes
      // Today show it without the learner having to reload anything.
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const started = await startPracticeSession({ conceptCode, planItemId });
      if (!started.ok) {
        setError(started.message);
        return;
      }

      setSession({
        sessionId: started.sessionId,
        conceptLabel: started.conceptLabel,
        questions: started.questions,
        shuffled: started.questions.map((question) =>
          shuffleWithOrder(question.options),
        ),
      });

      // A resumed drill with every item answered never got sealed (the tab
      // closed, or the finalize failed): finish it rather than showing a screen
      // with nothing left to answer.
      if (started.resumeAt >= started.questions.length) {
        setPending(true);
        await finalize(started.sessionId);
        return;
      }
      setIndex(started.resumeAt);
    })();
  }, [conceptCode, planItemId, finalize]);

  useEffect(() => {
    questionShownAt.current = Date.now();
  }, [index]);

  async function choose(displayedIdx: number) {
    if (!session || pending || feedback) return;
    const question = session.questions[index];
    const isLast = index === session.questions.length - 1;

    setSelected(displayedIdx);
    setPending(true);

    const answer = await answerPracticeQuestion({
      sessionId: session.sessionId,
      questionId: question.questionId,
      selectedIdx: session.shuffled[index].order[displayedIdx],
      responseMs: Date.now() - questionShownAt.current,
    });

    if (!answer.ok) {
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
      <Card className="items-center gap-3 p-5 text-center">
        <p className="text-sm text-red">{error}</p>
        <Button asChild variant="ghost">
          <Link href="/today">Wróć do planu</Link>
        </Button>
      </Card>
    );
  }

  if (result) {
    return (
      <Card className="items-center gap-3 p-5 text-center">
        <CheckCircle2 className="size-8 text-green" aria-hidden />
        <p className="text-lg font-bold">Ćwiczenie zakończone</p>
        <p className="text-sm text-muted2">
          {result.correct} z {result.total} poprawnie
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

  if (!session) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Przygotowujemy
        ćwiczenie…
      </p>
    );
  }

  const total = session.questions.length;
  const question = session.questions[index];
  const view = session.shuffled[index];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted2">
          Pytanie {index + 1}/{total}
        </p>
        <div className="flex items-center gap-1.5" aria-hidden>
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

      <QuestionCard
        prompt={question.prompt}
        options={view.items}
        selected={selected}
        result={
          feedback
            ? {
                isCorrect: feedback.isCorrect,
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
