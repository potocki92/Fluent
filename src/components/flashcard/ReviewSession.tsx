"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Lightbulb } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { updateSrs, type ReviewGrade } from "@/actions/update-srs";
import { ensureInteractionId, newInteractionId } from "@/lib/interaction-id";
import { WORD_GOAL_KEY } from "@/lib/word-goal";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { MnemonicDialog } from "@/components/words/MnemonicDialog";
import { MasteryBar } from "@/components/flashcard/MasteryBar";
import { speakGerman } from "@/lib/speech";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ARTICLE_CHIP, TYPE_LABEL } from "@/components/flashcard/word-chip";
import { SessionEnd, type Result } from "@/components/flashcard/SessionEnd";
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
export function ReviewSession({
  cards,
  extra,
}: {
  cards: SavedWordWithWord[];
  extra?: SavedWordWithWord[];
}) {
  const queryClient = useQueryClient();
  const [deck, setDeck] = useState(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [exitDir, setExitDir] = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True once the "ucz się dalej" extras have been folded into the deck.
  const [extended, setExtended] = useState(false);
  // One idempotency token per card presentation, plus when it appeared. The
  // token is what stops a double tap from advancing the schedule twice; the
  // timestamp is analytics only and is never allowed to affect the grade. Both
  // are seeded in an effect rather than in render, which must stay pure.
  const interactionId = useRef("");
  const shownAt = useRef(0);

  const current = deck[index];
  const finished = index >= deck.length;

  useEffect(() => {
    interactionId.current = newInteractionId();
    shownAt.current = Date.now();
  }, [index]);

  const rate = useCallback(
    async (grade: ReviewGrade) => {
      if (!current || busy) return;
      setBusy(true);
      setExitDir(grade === "again" ? -1 : 1);
      setError(null);
      try {
        const result = await updateSrs({
          wordId: current.word_id,
          grade,
          // Stable for as long as this card is on screen, so a double tap or a
          // retried request settles the same review instead of a second one.
          interactionId: ensureInteractionId(interactionId),
          mode: "flashcard",
          // The learner reads the German and recalls the Polish: recognition,
          // and therefore receptive evidence only.
          direction: "de_to_pl",
          responseMs: Date.now() - shownAt.current,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setResults((r) => [
          ...r,
          { wordId: current.word_id, grade, mastered: result.isMastered },
        ]);
        // The action bumped today's review count and the vocabulary streak in
        // the DB; refresh the daily-goal ring so its count + "passa słówkowa"
        // update live instead of staying frozen until the next page load.
        void queryClient.invalidateQueries({ queryKey: WORD_GOAL_KEY });
        // Only advance once the schedule is persisted — otherwise the card stays
        // so the user can retry instead of silently losing progress.
        setFlipped(false);
        setIndex((i) => i + 1);
      } catch (err) {
        console.error("Failed to update SRS:", err);
        setError("Coś poszło nie tak. Spróbuj ponownie za chwilę.");
      } finally {
        setBusy(false);
      }
    },
    [current, busy, queryClient],
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

  // Reflect a freshly saved mnemonic on the current card without a refetch.
  function handleMnemonicSaved(value: string | null) {
    setDeck((d) =>
      d.map((c, i) =>
        i === index ? { ...c, word: { ...c.word, mnemonic: value } } : c,
      ),
    );
  }

  function repeatMistakes() {
    const againIds = new Set(
      results.filter((r) => r.grade === "again").map((r) => r.wordId),
    );
    setDeck(deck.filter((c) => againIds.has(c.word_id)));
    setIndex(0);
    setFlipped(false);
    setResults([]);
  }

  // Append the study-ahead / new cards onto the finished deck. `index` already
  // sits at the old length, so it lands on the first appended card.
  function continueAhead() {
    if (!extra || extra.length === 0) return;
    setDeck((d) => [...d, ...extra]);
    setExtended(true);
    setFlipped(false);
  }

  const canContinue = !extended && (extra?.length ?? 0) > 0;

  if (finished) {
    return (
      <SessionEnd
        results={results}
        onRepeat={repeatMistakes}
        onContinue={canContinue ? continueAhead : undefined}
        firstLabel="nauczonych"
      />
    );
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
                {/* The chip already shows the type for non-nouns; only nouns
                    (chip = der/die/das) need the spelled-out type below. */}
                {word.article && (
                  <p className="text-xs uppercase tracking-wide text-muted2">
                    {TYPE_LABEL[word.word_type]}
                  </p>
                )}
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
                {word.mnemonic && (
                  <div className="mt-1 flex items-start gap-1.5 text-left">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p className="text-xs text-muted2">{word.mnemonic}</p>
                  </div>
                )}
              </Card>
            </motion.div>
          </button>
        </motion.div>
      </AnimatePresence>

      <MasteryBar interval={current.interval} />

      {flipped && (
        <div className="space-y-2">
          <MnemonicDialog
            wordId={word.id}
            display={word.display}
            mnemonic={word.mnemonic}
            onSaved={handleMnemonicSaved}
            trigger={
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Lightbulb className="size-3.5" />
                {word.mnemonic ? "Edytuj skojarzenie" : "Dodaj skojarzenie"}
              </button>
            }
          />
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
          {error && (
            <p role="alert" className="text-center text-xs text-red">
              {error}
            </p>
          )}
          <p className="hidden text-center text-xs text-muted2 sm:block">
            Spacja — odwróć · 1–4 — oceń
          </p>
        </div>
      )}
    </div>
  );
}
