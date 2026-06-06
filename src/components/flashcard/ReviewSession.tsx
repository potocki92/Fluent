"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { PartyPopper } from "lucide-react";

import { updateSrs, type ReviewGrade } from "@/actions/update-srs";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { speakGerman } from "@/lib/speech";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ARTICLE_CHIP, TYPE_LABEL } from "@/components/flashcard/word-chip";
import { cn } from "@/lib/utils";

/**
 * The recall ratings, mapped onto the SM-2 grades the action accepts, in
 * keyboard order (1–4). "easy" stretches the interval the most.
 */
const RATINGS: { grade: ReviewGrade; label: string; className: string }[] = [
  {
    grade: "again",
    label: "❌ Jeszcze raz",
    className: "border-[#f56565] bg-[#f56565]/20 text-[#f56565]",
  },
  {
    grade: "hard",
    label: "😓 Trudne",
    className: "border-[#d4a574] bg-[#d4a574]/20 text-[#d4a574]",
  },
  {
    grade: "good",
    label: "✅ Dobrze",
    className: "border-[#48bb78] bg-[#48bb78]/20 text-[#48bb78]",
  },
  {
    grade: "easy",
    label: "🚀 Łatwe",
    className: "border-[#4299e1] bg-[#4299e1]/20 text-[#4299e1]",
  },
];

interface Result {
  wordId: number;
  grade: ReviewGrade;
  mastered: boolean;
}

/** Slide-in / slide-out variants; `exit` direction comes from the rating. */
const cardVariants: Variants = {
  enter: { opacity: 0, scale: 0.95, x: 0 },
  center: { opacity: 1, scale: 1, x: 0 },
  exit: (dir: number) => ({ x: dir * 400, opacity: 0 }),
};

/**
 * A full spaced-repetition review session: a flip flashcard, progress bar,
 * recall ratings, and an end-of-session summary. Each rating persists through
 * the `updateSrs` server action (SM-2 scheduling lives in `src/lib/sm2.ts`).
 */
export function ReviewSession({ cards }: { cards: SavedWordWithWord[] }) {
  const [deck, setDeck] = useState(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [exitDir, setExitDir] = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  const current = deck[index];
  const finished = index >= deck.length;

  const rate = useCallback(
    async (grade: ReviewGrade) => {
      if (!current || busy) return;
      setBusy(true);
      setExitDir(grade === "again" ? -1 : 1);
      try {
        const { isMastered } = await updateSrs(current.word_id, grade);
        setResults((r) => [
          ...r,
          { wordId: current.word_id, grade, mastered: isMastered },
        ]);
        // Only advance once the schedule is persisted — otherwise the card stays
        // so the user can retry instead of silently losing progress.
        setFlipped(false);
        setIndex((i) => i + 1);
      } catch (err) {
        console.error("Failed to update SRS:", err);
      } finally {
        setBusy(false);
      }
    },
    [current, busy],
  );

  // Read the German word aloud the moment the card is revealed.
  useEffect(() => {
    if (flipped && current) speakGerman(current.word.display);
  }, [flipped, current]);

  // Keyboard shortcuts (desktop): Space/Enter flips the card; 1–4 grade it once
  // revealed. Ignored while typing in a field. Mobile keeps the tap-to-flip UX.
  useEffect(() => {
    if (finished) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (!flipped || busy) return;
      const idx = Number(e.key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < RATINGS.length) {
        e.preventDefault();
        void rate(RATINGS[idx].grade);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, flipped, busy, rate]);

  function repeatMistakes() {
    const againIds = new Set(
      results.filter((r) => r.grade === "again").map((r) => r.wordId),
    );
    setDeck(cards.filter((c) => againIds.has(c.word_id)));
    setIndex(0);
    setFlipped(false);
    setResults([]);
  }

  if (finished) {
    return <SessionEnd results={results} onRepeat={repeatMistakes} />;
  }

  const word = current.word;
  const progress = (index / deck.length) * 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted2">
          <span>Powtórki</span>
          <span>
            {index + 1} / {deck.length}
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
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            className="block w-full text-left [perspective:1000px]"
            aria-label="Odwróć fiszkę"
          >
            <motion.div
              className="relative min-h-52 [transform-style:preserve-3d]"
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.4 }}
            >
              {/* Front — German prompt */}
              <Card className="absolute inset-0 items-center justify-center gap-3 bg-[#2d3748] p-4 text-center [backface-visibility:hidden]">
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
                <p className="text-2xl font-bold text-[#d4a574]">{word.display}</p>
                <p className="text-xs uppercase tracking-wide text-muted2">
                  {TYPE_LABEL[word.word_type]}
                </p>
                <p className="mt-2 text-xs italic text-muted2">
                  Dotknij, aby zobaczyć
                </p>
              </Card>

              {/* Back — Polish translation + examples */}
              <Card className="absolute inset-0 items-center justify-center gap-3 bg-[#2d3748] p-4 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <p className="text-lg font-semibold">
                  {word.translation_pl ?? "—"}
                </p>
                {word.example_de && (
                  <p className="text-sm italic text-muted2">{word.example_de}</p>
                )}
                {word.example_pl && (
                  <p className="text-xs text-muted2">{word.example_pl}</p>
                )}
              </Card>
            </motion.div>
          </button>
        </motion.div>
      </AnimatePresence>

      {flipped && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RATINGS.map(({ grade, label, className }, i) => (
              <button
                key={grade}
                type="button"
                disabled={busy}
                onClick={() => rate(grade)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-sm font-semibold transition-colors disabled:opacity-50",
                  className,
                )}
              >
                <span className="mr-1 opacity-60">{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <p className="hidden text-center text-xs text-muted2 sm:block">
            Spacja — odwróć · 1–4 — oceń
          </p>
        </div>
      )}
    </div>
  );
}

/** End-of-session summary with the option to re-drill failed cards. */
function SessionEnd({
  results,
  onRepeat,
}: {
  results: Result[];
  onRepeat: () => void;
}) {
  const toRepeat = results.filter((r) => r.grade === "again").length;
  const learned = results.length - toRepeat;
  const mastered = results.filter((r) => r.mastered).length;

  return (
    <Card className="items-center gap-4 bg-[#2d3748] p-5 text-center">
      <PartyPopper className="size-8 text-gold" />
      <p className="text-lg font-semibold">Sesja zakończona!</p>

      <div className="grid w-full grid-cols-3 gap-3 text-center">
        <Summary value={learned} label="nauczonych" />
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
