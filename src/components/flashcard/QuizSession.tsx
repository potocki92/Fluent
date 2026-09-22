"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";

import { updateSrs, type ReviewGrade } from "@/actions/update-srs";
import { ensureInteractionId, newInteractionId } from "@/lib/interaction-id";
import { WORD_GOAL_KEY } from "@/lib/word-goal";
import { useOwnedTimeout } from "@/hooks/useOwnedTimeout";
import { useQuizDeck } from "@/hooks/useQuizDeck";
import { settleAction } from "@/lib/errors";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { speakGerman } from "@/lib/speech";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ARTICLE_CHIP, TYPE_LABEL } from "@/components/flashcard/word-chip";
import { MasteryBar } from "@/components/flashcard/MasteryBar";
import { SessionEnd, type Result } from "@/components/flashcard/SessionEnd";
import { cn } from "@/lib/utils";

/** Fast answer threshold in ms — answered within 3 s grades as "easy". */
const FAST_THRESHOLD_MS = 3000;

/**
 * How long the correct/wrong highlight holds before the next card.
 *
 * Shorter than a test's reveal: a quiz card is one word, and there is no
 * explanation to read. It was the literal `900` inside the callback.
 */
const REVEAL_MS = 900;

const cardVariants: Variants = {
  enter: { opacity: 0, scale: 0.95, x: 0 },
  center: { opacity: 1, scale: 1, x: 0 },
  exit: (dir: number) => ({ x: dir * 400, opacity: 0 }),
};

export function QuizSession({
  cards,
  extra,
  className,
}: {
  cards: SavedWordWithWord[];
  extra?: SavedWordWithWord[];
  /** The height the review screen has left for it — see `ReviewModeSwitch`. */
  className?: string;
}) {
  const queryClient = useQueryClient();
  // The active deck — narrowed to mistakes when re-drilling.
  const [deck, setDeck] = useState(cards);
  const { questions, isLoading } = useQuizDeck(deck);

  const [index, setIndex] = useState(0);
  const [exitDir, setExitDir] = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = unanswered, number = index of chosen option
  const [chosen, setChosen] = useState<number | null>(null);
  // True once the "ucz się dalej" extras have been folded into the deck.
  const [extended, setExtended] = useState(false);
  const shownAt = useRef<number>(0);
  const reveal = useOwnedTimeout();
  // One idempotency token per question presentation, so a double tap (or a
  // retried request) settles the same review rather than a second one.
  const interactionId = useRef("");

  // word id -> SM-2 interval, to drive the per-card mastery bar.
  const intervalById = useMemo(
    () => new Map(deck.map((c) => [c.word_id, c.interval])),
    [deck],
  );

  const finished = index >= questions.length && questions.length > 0;
  const current = questions[index];

  // Timestamp when the current question is shown — used for fast-answer bonus.
  useEffect(() => {
    if (current) {
      shownAt.current = Date.now();
      interactionId.current = newInteractionId();
      speakGerman(current.word.display);
    }
  }, [current]);

  const answer = useCallback(
    async (chosenIdx: number) => {
      if (!current || busy || chosen !== null) return;
      setChosen(chosenIdx);
      const elapsed = Date.now() - shownAt.current;
      const correct = chosenIdx === current.answerIdx;
      const grade: ReviewGrade = !correct
        ? "again"
        : elapsed < FAST_THRESHOLD_MS
          ? "easy"
          : "good";

      setExitDir(correct ? 1 : -1);
      setBusy(true);
      setError(null);
      // Settled rather than `try`/`catch`: a rejected action now arrives as a
      // classified failure carrying Polish copy from the taxonomy, so one
      // branch handles both shapes and the catch that guessed at a message is
      // gone. Retrying is safe — the interaction id is not cleared on a
      // failure, so the next attempt settles the SAME review.
      const result = await settleAction(
        () =>
          updateSrs({
            wordId: current.wordId,
            grade,
            interactionId: ensureInteractionId(interactionId),
            mode: "quiz",
            // German prompt, Polish options: picking the right one is
            // recognition, so this feeds receptive vocabulary and never the
            // active channel.
            direction: "de_to_pl",
            responseMs: elapsed,
          }),
        `updateSrs ${current.wordId}`,
      );
      if (!result.ok) {
        setError(result.message);
        setChosen(null);
        setBusy(false);
        return;
      }
      setResults((r) => [
        ...r,
        { wordId: current.wordId, grade, mastered: result.isMastered },
      ]);
      // The action bumped today's review count and the vocabulary streak in
      // the DB; refresh the daily-goal ring so its count + "passa słówkowa"
      // update live instead of staying frozen until the next page load.
      void queryClient.invalidateQueries({ queryKey: WORD_GOAL_KEY });
      // Brief visual feedback (highlight correct/wrong) before advancing.
      // Owned, so leaving the quiz mid-reveal cancels it instead of advancing
      // a deck that is no longer on screen.
      reveal.schedule(() => {
        setChosen(null);
        setIndex((i) => i + 1);
        setBusy(false);
      }, REVEAL_MS);
    },
    [current, busy, chosen, queryClient, reveal],
  );

  // Keyboard: 1–4 choose option.
  useEffect(() => {
    if (finished || !current) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const idx = Number(e.key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < current.options.length) {
        e.preventDefault();
        void answer(idx);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, current, answer]);

  function repeatMistakes() {
    const againIds = new Set(
      results.filter((r) => r.grade === "again").map((r) => r.wordId),
    );
    // Narrow the deck to the failed cards; useQuizDeck rebuilds the questions.
    setDeck(deck.filter((c) => againIds.has(c.word_id)));
    setIndex(0);
    setChosen(null);
    setResults([]);
    setExitDir(1);
  }

  // Fold the study-ahead / new cards onto the deck; useQuizDeck appends their
  // questions and `index` lands on the first one.
  function continueAhead() {
    if (!extra || extra.length === 0) return;
    setDeck((d) => [...d, ...extra]);
    setExtended(true);
    setChosen(null);
    setExitDir(1);
  }

  const canContinue = !extended && (extra?.length ?? 0) > 0;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <Card className="w-full items-center gap-3 bg-card p-8 text-center">
          <div className="h-5 w-36 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-48 animate-pulse rounded bg-secondary" />
        </Card>
      </div>
    );
  }

  if (finished) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <SessionEnd
          results={results}
          onRepeat={repeatMistakes}
          onContinue={canContinue ? continueAhead : undefined}
          firstLabel="poprawnych"
        />
      </div>
    );
  }

  if (!current) return null;

  const progress = (index / questions.length) * 100;
  const word = current.word;

  return (
    // THE SAME COLUMN THE FLASHCARD SESSION IS (§39): a measured progress row, a
    // question that takes what is left, a measured mastery bar. The quiz stays
    // visually neutral though (§50) — the landscape is the flashcard's, and a
    // painting behind four answer buttons is decoration competing with a
    // decision.
    <div className={cn("review-screen flex flex-col", className)}>
      <div className="shrink-0 space-y-0.5">
        <div className="flex justify-between text-xs leading-tight text-muted2">
          <span>Quiz</span>
          <span>
            {index + 1} / {questions.length}
          </span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <AnimatePresence mode="popLayout" custom={exitDir}>
        <motion.div
          key={index}
          custom={exitDir}
          variants={cardVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Card className="min-h-0 flex-1 items-start gap-3 overflow-y-auto bg-card p-4">
            {/* Word prompt */}
            <div className="flex w-full items-center gap-2">
              <span
                className={cn(
                  "rounded-lg px-2 py-0.5 text-xs font-semibold",
                  word.article
                    ? ARTICLE_CHIP[word.article]
                    : "bg-secondary text-muted2",
                )}
              >
                {word.article ?? TYPE_LABEL[word.word_type]}
              </span>
              {/* The chip already shows the type for non-nouns; only nouns
                  (chip = der/die/das) need the spelled-out type beside it. */}
              {word.article && (
                <p className="text-xs uppercase tracking-wide text-muted2">
                  {TYPE_LABEL[word.word_type]}
                </p>
              )}
            </div>
            <p className="w-full text-center text-[clamp(1.5rem,6vw,1.875rem)] font-bold leading-tight text-gold">
              {word.display}
            </p>

            {/* Answer options */}
            <div className="flex w-full flex-col gap-2">
              {current.options.map((opt, i) => {
                const isChosen = chosen === i;
                const isCorrect = i === current.answerIdx;
                const revealed = chosen !== null;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={busy || revealed}
                    onClick={() => answer(i)}
                    className={cn(
                      // 44px is the iOS touch-target floor, and an answer is
                      // the one control here a learner taps in a hurry (§37).
                      "flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-left text-[0.8125rem] font-medium transition-colors",
                      !revealed
                        ? "border-secondary bg-secondary text-main hover:border-[#4a5568] hover:bg-[#4a5568]"
                        : isCorrect
                          ? "border-green/45 bg-green/10 text-green"
                          : isChosen
                            ? "border-red/45 bg-red/10 text-red"
                            : "border-secondary bg-card text-muted2",
                    )}
                  >
                    <span className="shrink-0 text-xs opacity-60">{i + 1}</span>
                    {opt}
                  </button>
                );
              })}
            </div>
            {error && (
              <p role="alert" className="w-full text-center text-xs text-red">
                {error}
              </p>
            )}
            <p className="review-hint hidden w-full text-center text-xs text-muted2 sm:block">
              1–4 — wybierz odpowiedź
            </p>
          </Card>
        </motion.div>
      </AnimatePresence>

      <MasteryBar
        className="shrink-0"
        interval={intervalById.get(current.wordId) ?? 0}
      />
    </div>
  );
}
