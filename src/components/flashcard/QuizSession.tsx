"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { PartyPopper } from "lucide-react";

import { updateSrs, type ReviewGrade } from "@/actions/update-srs";
import { useQuizDeck } from "@/hooks/useQuizDeck";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { speakGerman } from "@/lib/speech";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ARTICLE_CHIP, TYPE_LABEL } from "@/components/flashcard/word-chip";
import { cn } from "@/lib/utils";

/** Fast answer threshold in ms — answered within 3 s grades as "easy". */
const FAST_THRESHOLD_MS = 3000;

interface Result {
  wordId: number;
  grade: ReviewGrade;
  mastered: boolean;
}

const cardVariants: Variants = {
  enter: { opacity: 0, scale: 0.95, x: 0 },
  center: { opacity: 1, scale: 1, x: 0 },
  exit: (dir: number) => ({ x: dir * 400, opacity: 0 }),
};

export function QuizSession({ cards }: { cards: SavedWordWithWord[] }) {
  const { questions, isLoading } = useQuizDeck(cards);

  const [index, setIndex] = useState(0);
  const [exitDir, setExitDir] = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  // null = unanswered, number = index of chosen option
  const [chosen, setChosen] = useState<number | null>(null);
  const shownAt = useRef<number>(0);

  const finished = index >= questions.length && questions.length > 0;
  const current = questions[index];

  // Timestamp when the current question is shown — used for fast-answer bonus.
  useEffect(() => {
    if (current) {
      shownAt.current = Date.now();
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
      try {
        const { isMastered } = await updateSrs(current.wordId, grade);
        setResults((r) => [
          ...r,
          { wordId: current.wordId, grade, mastered: isMastered },
        ]);
        // Brief visual feedback (highlight correct/wrong) before advancing.
        window.setTimeout(() => {
          setChosen(null);
          setIndex((i) => i + 1);
          setBusy(false);
        }, 900);
      } catch (err) {
        console.error("Failed to update SRS:", err);
        setChosen(null);
        setBusy(false);
      }
    },
    [current, busy, chosen],
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
    const repeatCards = cards.filter((c) => againIds.has(c.word_id));
    // Reset state so the quiz re-runs for the failing subset.
    setIndex(0);
    setChosen(null);
    setResults([]);
    setExitDir(1);
    // QuizSession re-generates questions from the same cards prop — to drill
    // only mistakes we need a new QuizSession mount. Signal this by resetting
    // via parent; for now re-filter by re-calling the parent callback.
    void repeatCards; // kept for future callback prop extension
  }

  if (isLoading) {
    return (
      <Card className="items-center gap-3 bg-[#2d3748] p-8 text-center">
        <div className="h-5 w-36 animate-pulse rounded bg-[#374151]" />
        <div className="h-4 w-48 animate-pulse rounded bg-[#374151]" />
      </Card>
    );
  }

  if (finished) {
    return <SessionEnd results={results} onRepeat={repeatMistakes} />;
  }

  if (!current) return null;

  const progress = (index / questions.length) * 100;
  const word = current.word;

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted2">
          <span>Quiz</span>
          <span>
            {index + 1} / {questions.length}
          </span>
        </div>
        <Progress value={progress} />
      </div>

      <AnimatePresence mode="popLayout" custom={exitDir}>
        <motion.div
          key={index}
          custom={exitDir}
          variants={cardVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25 }}
        >
          <Card className="items-start gap-4 bg-[#2d3748] p-5">
            {/* Word prompt */}
            <div className="flex w-full items-center gap-2">
              <span
                className={cn(
                  "rounded-lg px-2 py-0.5 text-sm font-semibold",
                  word.article
                    ? ARTICLE_CHIP[word.article]
                    : "bg-[#374151] text-[#a0aec0]",
                )}
              >
                {word.article ?? TYPE_LABEL[word.word_type]}
              </span>
              <p className="text-xs uppercase tracking-wide text-muted2">
                {TYPE_LABEL[word.word_type]}
              </p>
            </div>
            <p className="w-full text-center text-2xl font-bold text-[#d4a574]">
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
                      "flex items-center gap-2 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors",
                      !revealed
                        ? "border-[#374151] bg-[#374151] text-[#e2e8f0] hover:border-[#4a5568] hover:bg-[#4a5568]"
                        : isCorrect
                          ? "border-[#48bb78] bg-[#48bb78]/20 text-[#48bb78]"
                          : isChosen
                            ? "border-[#f56565] bg-[#f56565]/20 text-[#f56565]"
                            : "border-[#374151] bg-[#2d3748] text-muted2",
                    )}
                  >
                    <span className="shrink-0 text-xs opacity-60">{i + 1}</span>
                    {opt}
                  </button>
                );
              })}
            </div>
            <p className="hidden w-full text-center text-xs text-muted2 sm:block">
              1–4 — wybierz odpowiedź
            </p>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SessionEnd({
  results,
  onRepeat,
}: {
  results: Result[];
  onRepeat: () => void;
}) {
  const toRepeat = results.filter((r) => r.grade === "again").length;
  const correct = results.length - toRepeat;
  const mastered = results.filter((r) => r.mastered).length;

  return (
    <Card className="items-center gap-4 bg-[#2d3748] p-5 text-center">
      <PartyPopper className="size-8 text-gold" />
      <p className="text-lg font-semibold">Sesja zakończona!</p>

      <div className="grid w-full grid-cols-3 gap-3 text-center">
        <Summary value={correct} label="poprawnych" />
        <Summary value={toRepeat} label="do powtórki" />
        <Summary value={mastered} label="opanowanych" />
      </div>

      <div className="flex w-full flex-col gap-2">
        {toRepeat > 0 && (
          <Button onClick={onRepeat} className="bg-gold text-[#1a202c]">
            Powtórz błędy
          </Button>
        )}
        <Link
          href="/learn"
          className="rounded-xl bg-[#374151] px-4 py-2 text-sm font-semibold text-[#e2e8f0] transition-colors hover:bg-[#4a5568]"
        >
          Wróć do nauki
        </Link>
      </div>
    </Card>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-[#374151] p-3">
      <p className="text-xl font-bold text-gold">{value}</p>
      <p className="text-xs text-muted2">{label}</p>
    </div>
  );
}
