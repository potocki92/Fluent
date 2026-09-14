"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Flag, Loader2, X } from "lucide-react";

import {
  answerChallengeQuestion,
  finalizeChapterChallenge,
  reportChallengeQuestion,
  type ChallengeQuestion,
  type ChallengeResult,
} from "@/actions/chapter-assessment";
import { ChallengeResultCard } from "@/components/story/ChallengeResultCard";
import { cn } from "@/lib/utils";

/**
 * The Chapter Challenge.
 *
 * FOUR ANSWER MECHANICS, ONE SCREEN. Multiple choice and true/false are the same
 * control; a cloze is a text input; a sequence is a reorderable list. They are
 * kept in one component rather than four because everything around the answer —
 * progress, feedback, the report button, advancing — is identical, and four
 * near-identical runners drift apart within a month.
 *
 * NOT ALL MULTIPLE CHOICE, deliberately. A cloze makes the learner produce the
 * German with nothing to pick from, which is the only thing in the Challenge
 * that can earn ACTIVE vocabulary evidence. Recognition is cheaper to build and
 * cheaper to answer, and a Challenge made entirely of it would measure only half
 * of what it claims to.
 *
 * NOTHING HERE KNOWS AN ANSWER before the learner commits one. Grading happens
 * in the database; the key comes back with the result. For a sequence question
 * the items arrive already shuffled, and the correct order is expressed in
 * PRESENTED positions, so the stored order never leaves the server.
 *
 * REORDERING IS BUTTON-BASED, not drag-and-drop. Dragging is unusable with a
 * keyboard, awkward with a screen reader, and fiddly on a phone — which is most
 * of the audience for a reading app.
 */
export function ChallengeRunner({
  sessionId,
  questions,
  resumeAt,
  nextChapterHref,
  bookHref,
}: {
  sessionId: string;
  questions: readonly ChallengeQuestion[];
  resumeAt: number;
  nextChapterHref: string | null;
  bookHref: string;
}) {
  const router = useRouter();

  const [index, setIndex] = useState(
    Math.min(resumeAt, Math.max(0, questions.length - 1)),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [order, setOrder] = useState<number[]>(() => {
    const first = questions[Math.min(resumeAt, Math.max(0, questions.length - 1))];
    return first?.type === "sequence" && first.sequenceItems
      ? first.sequenceItems.map((_, i) => i)
      : [];
  });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [reported, setReported] = useState(false);

  const startedAt = useRef(0);
  const question = questions[index];

  // The clock starts when the question is on screen, never during render.
  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  /**
   * Per-question state, reset in the handler rather than in an effect.
   *
   * An effect that clears state on `index` renders the NEW question with the OLD
   * question's answer still selected for one frame — which on a slow phone is
   * long enough to see, and on a sequence question means seeing somebody else's
   * ordering.
   */
  const showQuestion = useCallback(
    (next: number) => {
      setIndex(next);
      setSelected(null);
      setTyped("");
      setFeedback(null);
      setReported(false);
      const upcoming = questions[next];
      setOrder(
        upcoming?.type === "sequence" && upcoming.sequenceItems
          ? upcoming.sequenceItems.map((_, i) => i)
          : [],
      );
    },
    [questions],
  );

  const submit = useCallback(async () => {
    if (!question || pending || feedback) return;
    setPending(true);
    setError(null);

    const response = await answerChallengeQuestion({
      sessionId,
      questionId: question.questionId,
      selectedIdx:
        question.type === "multiple_choice" || question.type === "true_false"
          ? selected
          : null,
      typedAnswer: question.type === "cloze" ? typed : null,
      sequenceAnswer: question.type === "sequence" ? order : null,
      responseMs: Date.now() - startedAt.current,
    });

    setPending(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }

    setFeedback({
      isCorrect: response.isCorrect,
      correctIdx: response.correctIdx,
      correctText: response.correctText,
      correctOrder: response.correctOrder,
      explanationPl: response.explanationPl,
    });
  }, [feedback, order, pending, question, selected, sessionId, typed]);

  const advance = useCallback(async () => {
    if (index < questions.length - 1) {
      showQuestion(index + 1);
      return;
    }

    setPending(true);
    const finalized = await finalizeChapterChallenge(sessionId);
    setPending(false);
    if (!finalized.ok) {
      setError(finalized.message);
      return;
    }
    setResult(finalized);
    // The plan reads its completion from the session, so today's page has to be
    // re-fetched rather than trusted.
    router.refresh();
  }, [index, questions.length, router, sessionId, showQuestion]);

  const report = useCallback(async () => {
    if (!question || reported) return;
    const response = await reportChallengeQuestion({
      questionId: question.questionId,
      reason: "unclear",
    });
    if (response.ok) setReported(true);
  }, [question, reported]);

  if (result) {
    return (
      <ChallengeResultCard
        result={result}
        nextChapterHref={nextChapterHref}
        bookHref={bookHref}
      />
    );
  }

  if (!question) {
    return (
      <p className="py-10 text-center text-sm text-muted2">
        To wyzwanie nie ma pytań.
      </p>
    );
  }

  const canSubmit =
    question.type === "cloze"
      ? typed.trim().length > 0
      : question.type === "sequence"
        ? order.length > 0
        : selected !== null;

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted2">
          <span className="tabular-nums">
            {index + 1} z {questions.length}
          </span>
          <span>{KIND_LABEL_PL[question.kind]}</span>
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[#374151]"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-label="Postęp wyzwania"
        >
          <div
            className="h-full bg-gold transition-all"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </header>

      <p className="text-lg font-medium leading-relaxed">{question.prompt}</p>

      {(question.type === "multiple_choice" || question.type === "true_false") &&
        question.options && (
          <div className="space-y-2" role="group" aria-label="Wybierz odpowiedź">
            {question.options.map((option, optionIdx) => {
              const isChosen = selected === optionIdx;
              const isKey = feedback?.correctIdx === optionIdx;
              const revealed = feedback !== null;

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => !revealed && setSelected(optionIdx)}
                  disabled={pending || revealed}
                  aria-pressed={isChosen}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default",
                    !revealed && isChosen && "border-gold bg-gold/10",
                    !revealed && !isChosen && "border-border hover:border-gold/60",
                    revealed && isKey && "border-green bg-green/10",
                    revealed && isChosen && !isKey && "border-red bg-red/10",
                    revealed && !isKey && !isChosen && "border-border opacity-60",
                  )}
                >
                  <span>{option}</span>
                  {revealed && isKey && (
                    <Check className="size-4 shrink-0 text-green" aria-label="Poprawnie" />
                  )}
                  {revealed && isChosen && !isKey && (
                    <X className="size-4 shrink-0 text-red" aria-label="Niepoprawnie" />
                  )}
                </button>
              );
            })}
          </div>
        )}

      {question.type === "cloze" && (
        <div className="space-y-2">
          <label htmlFor="cloze-answer" className="sr-only">
            Wpisz brakujące słowo
          </label>
          <input
            id="cloze-answer"
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit && !feedback) void submit();
            }}
            disabled={pending || feedback !== null}
            lang="de"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Wpisz po niemiecku…"
            className={cn(
              "w-full rounded-xl border bg-card px-4 py-3 text-lg outline-none transition-colors",
              "focus:border-gold focus:ring-2 focus:ring-gold/30",
              feedback?.isCorrect === true && "border-green",
              feedback?.isCorrect === false && "border-red",
              !feedback && "border-border",
            )}
          />
          {feedback && !feedback.isCorrect && feedback.correctText && (
            <p className="text-sm text-muted2">
              Poprawnie:{" "}
              <span className="font-semibold text-main" lang="de">
                {feedback.correctText}
              </span>
            </p>
          )}
        </div>
      )}

      {question.type === "sequence" && question.sequenceItems && (
        <ol className="space-y-2">
          {order.map((itemIdx, position) => (
            <li
              key={itemIdx}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5",
                feedback
                  ? feedback.correctOrder?.[position] === itemIdx
                    ? "border-green bg-green/10"
                    : "border-red bg-red/10"
                  : "border-border",
              )}
            >
              <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-muted2">
                {position + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {question.sequenceItems?.[itemIdx]}
              </span>
              {!feedback && (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Przesuń „${question.sequenceItems?.[itemIdx]}” w górę`}
                    disabled={position === 0}
                    onClick={() => setOrder(move(order, position, -1))}
                    className="rounded-md border border-border p-1.5 transition-colors hover:border-gold/60 disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Przesuń „${question.sequenceItems?.[itemIdx]}” w dół`}
                    disabled={position === order.length - 1}
                    onClick={() => setOrder(move(order, position, 1))}
                    className="rounded-md border border-border p-1.5 transition-colors hover:border-gold/60 disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {feedback?.explanationPl && (
        <p className="rounded-lg bg-[#374151]/40 px-3 py-2 text-sm text-muted2">
          {feedback.explanationPl}
        </p>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-red">
          {error}
        </p>
      )}

      {feedback === null ? (
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || pending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-base font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark disabled:opacity-50"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Sprawdź
        </button>
      ) : (
        <button
          type="button"
          onClick={advance}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-base font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {index < questions.length - 1 ? "Dalej" : "Zakończ"}
        </button>
      )}

      {/* WHEN A MODEL WRITES THE QUESTIONS, THE REPORT BUTTON IS PART OF THE
          SYSTEM. Structural validation catches shape; only a reader catches
          "both of these are right". */}
      <button
        type="button"
        onClick={report}
        disabled={reported}
        className="mx-auto flex items-center gap-1.5 text-xs text-muted2 transition-colors hover:text-main disabled:opacity-60"
      >
        <Flag className="size-3" />
        {reported ? "Zgłoszono — dziękujemy" : "Zgłoś problem z pytaniem"}
      </button>
    </section>
  );
}

interface Feedback {
  isCorrect: boolean;
  correctIdx: number | null;
  correctText: string | null;
  correctOrder: number[] | null;
  explanationPl: string | null;
}

const KIND_LABEL_PL: Readonly<Record<ChallengeQuestion["kind"], string>> = {
  comprehension: "Fabuła",
  contextual_vocabulary: "Słownictwo",
  grammar: "Gramatyka",
  transfer: "Zastosowanie",
};

function move(order: readonly number[], from: number, delta: number): number[] {
  const to = from + delta;
  if (to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
