"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { Check, Frown, Lightbulb, Rocket, Volume2, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { updateSrs, type ReviewGrade } from "@/actions/update-srs";
import { ensureInteractionId, newInteractionId } from "@/lib/interaction-id";
import { WORD_GOAL_KEY } from "@/lib/word-goal";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { MnemonicDialog } from "@/components/words/MnemonicDialog";
import { MasteryBar } from "@/components/flashcard/MasteryBar";
import { LandscapeBackdrop } from "@/components/today/hero/LandscapeBackdrop";
import { speakGerman } from "@/lib/speech";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ARTICLE_CHIP, TYPE_LABEL } from "@/components/flashcard/word-chip";
import { buildCloze } from "@/lib/notebook/cloze";
import { CLOZE_BLANK } from "@/lib/notebook/constants";
import { SessionEnd, type Result } from "@/components/flashcard/SessionEnd";
import { cn } from "@/lib/utils";

/**
 * The recall ratings, mapped onto the SM-2 grades the action accepts, in
 * keyboard order (1–4). "easy" stretches the interval the most.
 *
 * LUCIDE, NOT EMOJI (§23). ❌😓✅🚀 are four different typefaces drawn by four
 * different vendors: they do not share a size, a weight, an optical centre or a
 * colour, and none of them can take the semantic tone the rating means. The
 * glyphs below are the same stroke weight as every other icon in Fluent.
 *
 * THE COLOUR IS A BORDER AND A LABEL, NEVER A FILL (§24). Four saturated
 * rectangles under a flashcard is a traffic light, not a study screen — so the
 * surface stays the app's own dark and the meaning is carried by the outline.
 * These are the tokens, not new hexes: the palette is unchanged.
 */
const RATINGS: {
  grade: ReviewGrade;
  label: string;
  icon: typeof Check;
  className: string;
}[] = [
  {
    grade: "again",
    label: "Jeszcze raz",
    icon: X,
    className: "border-red/45 bg-red/10 text-red",
  },
  {
    grade: "hard",
    label: "Trudne",
    icon: Frown,
    className: "border-gold/45 bg-gold/10 text-gold",
  },
  {
    grade: "good",
    label: "Dobrze",
    icon: Check,
    className: "border-green/45 bg-green/10 text-green",
  },
  {
    grade: "easy",
    label: "Łatwe",
    icon: Rocket,
    className: "border-blue/45 bg-blue/10 text-blue",
  },
];

/** Slide-in / slide-out variants; `exit` direction comes from the rating. */
const cardVariants: Variants = {
  enter: { opacity: 0, scale: 0.95, x: 0 },
  center: { opacity: 1, scale: 1, x: 0 },
  exit: (dir: number) => ({ x: dir * 400, opacity: 0 }),
};

/**
 * How long the card takes to turn, in seconds — and, at half of it, when the
 * two faces swap.
 *
 * THE CURVE HAS TO BE SYMMETRIC, WHICH IS WHY IT IS NAMED. The face that is
 * turning away is switched off at the halfway point in TIME (`--flip-half`,
 * read by `.review-card-face` in `globals.css`), and that is only the halfway
 * point in ANGLE — the edge-on moment where the swap is invisible — if the
 * easing is symmetric about its midpoint. `easeInOut` is; Framer's default
 * tween curve is not, and with it the card spends about 40ms showing the wrong
 * face MIRRORED before the swap catches up. Anything replacing `FLIP_EASE`
 * must satisfy `f(0.5) === 0.5`.
 */
const FLIP_SECONDS = 0.38;
const FLIP_EASE = "easeInOut" as const;

/**
 * The frame the CSS switch is late by, because the two clocks do not start
 * together: the attribute change is committed by React and the transition's
 * delay starts counting from THAT paint, while Framer does not take its first
 * step until the animation frame after it. Without this the card spends one
 * frame past edge-on still showing the outgoing face — measured, not guessed,
 * and small enough that a 120Hz screen overshooting it by half is invisible.
 */
const FLIP_CLOCK_SKEW = 1 / 60;

/**
 * How wide the flashcard is actually painted. The review screen sits in the
 * shell's `max-w-2xl` column with a 16px gutter, so 640px is its real ceiling —
 * the optimizer must not be left fetching a 2172px original for a 361px card.
 */
const CARD_SIZES = "(min-width: 768px) 640px, 100vw";

/**
 * A full spaced-repetition review session: a flip flashcard, progress bar,
 * recall ratings, and an end-of-session summary. Each rating persists through
 * the `updateSrs` server action (SM-2 scheduling lives in `src/lib/sm2.ts`).
 *
 * IT IS A COLUMN WITH ONE FLEXIBLE ROW (§39). Progress, mastery, the mnemonic
 * and the four ratings are all measured and `shrink-0`; the card takes whatever
 * is left of the viewport. That is the whole reason the ratings are reachable
 * without scrolling — nothing here has a height it chose for itself.
 *
 * THE RATINGS ARE ALWAYS IN THE LAYOUT, and disabled until the card is turned.
 * Mounting them on flip would shrink the card by ~100px mid-animation, which is
 * both ugly and a moving target for the thumb already heading for „Dobrze";
 * reserving their space keeps the two faces exactly the same size (§41) and the
 * screen perfectly still from the first card to the last.
 */
export function ReviewSession({
  cards,
  extra,
  className,
}: {
  cards: SavedWordWithWord[];
  extra?: SavedWordWithWord[];
  className?: string;
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
      <div className={cn("flex items-center justify-center", className)}>
        <SessionEnd
          results={results}
          onRepeat={repeatMistakes}
          onContinue={canContinue ? continueAhead : undefined}
          firstLabel="nauczonych"
        />
      </div>
    );
  }

  const word = current.word;
  const progress = (index / deck.length) * 100;

  return (
    <div className={cn("review-screen flex flex-col", className)}>
      <div className="shrink-0 space-y-0.5">
        <div className="flex justify-between text-xs leading-tight text-muted2">
          <span>Powtórki</span>
          <span>
            {index + 1} / {deck.length}
          </span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* THE ONE THING THAT FLEXES. `min-h-0` is what allows it to give height
          back to the rows below when the viewport is short (§40); `.review-card`
          supplies the floor and the ceiling it may not cross. */}
      <div className="review-card relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout" custom={exitDir}>
          <motion.div
            key={index}
            custom={exitDir}
            variants={cardVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="absolute inset-0"
          >
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              className="block size-full text-left [perspective:1000px]"
              aria-label="Odwróć fiszkę"
            >
              <motion.div
                className="review-card-stage relative size-full"
                style={
                  {
                    "--flip-half": `${FLIP_SECONDS / 2 + FLIP_CLOCK_SKEW}s`,
                  } as CSSProperties
                }
                animate={{ rotateY: flipped ? 180 : 0 }}
                transition={{ duration: FLIP_SECONDS, ease: FLIP_EASE }}
              >
                {/* Front — German prompt */}
                <CardFace facingAway={flipped}>
                  <span
                    className={cn(
                      "rounded-lg px-2 py-0.5 text-xs font-semibold",
                      word.article
                        ? ARTICLE_CHIP[word.article]
                        : "bg-dark/55 text-muted2",
                    )}
                  >
                    {word.article ?? TYPE_LABEL[word.word_type]}
                  </span>
                  <p className="text-[clamp(1.75rem,7vw,2.125rem)] font-bold leading-tight text-gold">
                    {word.display}
                  </p>
                  {/* The chip already shows the type for non-nouns; only nouns
                      (chip = der/die/das) need the spelled-out type below. */}
                  {word.article && (
                    <p className="text-[0.625rem] uppercase tracking-wide text-muted2">
                      {TYPE_LABEL[word.word_type]}
                    </p>
                  )}
                  <p className="text-[0.8125rem] italic text-muted2">
                    Dotknij, aby zobaczyć
                  </p>
                </CardFace>

                {/* Back — Polish translation + examples */}
                <CardFace back facingAway={!flipped}>
                  <p className="text-lg font-semibold leading-snug">
                    {word.translation_pl ?? "—"}
                  </p>
                  {word.example_de && (
                    <p className="line-clamp-2 text-[0.8125rem] italic leading-snug text-muted2">
                      {word.example_de}
                    </p>
                  )}
                  {word.example_pl && (
                    <p className="line-clamp-2 text-xs leading-snug text-muted2">
                      {word.example_pl}
                    </p>
                  )}
                  {word.mnemonic && (
                    <div className="flex items-start gap-1.5 text-left">
                      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-gold" />
                      <p className="line-clamp-2 text-xs text-muted2">
                        {word.mnemonic}
                      </p>
                    </div>
                  )}
                  {/* THE SENTENCE IT WAS MET IN. A word saved while reading has a
                      place it came from, and a card that shows only the headword
                      has thrown away the reason it meant anything (§61). It is on
                      the BACK, with the answer: on the front it would either give
                      the answer away or replace the DE → PL card with a different
                      exercise, and this card's evidence is recorded as DE → PL. */}
                  <OriginContext card={current} />
                </CardFace>
              </motion.div>
            </button>
          </motion.div>
        </AnimatePresence>

        {/* A SIBLING OF THE FLIP BUTTON, NEVER A CHILD OF IT (§20). A button
            inside a button is invalid markup and unreachable by keyboard; over
            it, the speaker gets its own 44px target without stealing the tap
            that turns the card. */}
        <button
          type="button"
          onClick={() => speakGerman(word.display)}
          aria-label={`Przeczytaj: ${word.display}`}
          className="absolute right-1 top-1 z-20 flex size-11 items-center justify-center rounded-full text-muted2 transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
        >
          <Volume2 className="size-[1.125rem]" aria-hidden />
        </button>
      </div>

      <MasteryBar className="shrink-0" interval={current.interval} />

      <div className="review-screen flex shrink-0 flex-col">
        <MnemonicDialog
          wordId={word.id}
          display={word.display}
          mnemonic={word.mnemonic}
          onSaved={handleMnemonicSaved}
          trigger={
            <button
              type="button"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-secondary text-[0.8125rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Lightbulb className="size-3.5" />
              {word.mnemonic ? "Edytuj skojarzenie" : "Dodaj skojarzenie"}
            </button>
          }
        />

        <div
          className={cn(
            "grid grid-cols-2 gap-2 transition-opacity",
            !flipped && "opacity-45",
          )}
        >
          {RATINGS.map(({ grade, label, icon: Icon, className: tone }, i) => (
            <button
              key={grade}
              type="button"
              disabled={busy || !flipped}
              onClick={() => rate(grade)}
              className={cn(
                "flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl border text-[0.8125rem] font-semibold transition-colors",
                "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
                tone,
              )}
            >
              <span className="flex items-center gap-1.5 leading-none">
                <span className="text-[0.625rem] font-medium opacity-60">
                  {i + 1}
                </span>
                <Icon className="size-4" aria-hidden />
              </span>
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-center text-xs text-red">
            {error}
          </p>
        )}
        <p className="review-hint hidden text-center text-xs text-muted2 sm:block">
          Spacja — odwróć · 1–4 — oceń
        </p>
      </div>
    </div>
  );
}

/**
 * One side of the flashcard: the landscape, the scrim that makes it readable,
 * and the content on top.
 *
 * THE SAME SKY AS „DZIEŃ DOBRY" (§14, §47). `LandscapeBackdrop` is the one
 * definition of that composition — the five files, their order and their crop —
 * so this is the greeting's landscape rather than a copy of it, and there is no
 * `review-background.jpg` anywhere. It is rendered STILL (§15): a learner
 * reading one German word does not need the mountains to breathe, and the
 * `motion={false}` also takes back the five compositor layers the hero promotes.
 *
 * ONLY THE CURRENT CARD HAS ONE (§49). `AnimatePresence` mounts exactly one
 * card at a time, so the deck behind it costs nothing.
 *
 * BOTH FACES ARE `absolute inset-0`, which is what makes them the same size
 * whatever they contain (§41) — a three-line example sentence can never make
 * the back taller than the front and shove the ratings off the screen.
 *
 * AND BOTH ARE TOLD WHICH WAY THEY FACE, rather than being left to backface
 * culling to work it out. On iOS Safari that culling does not survive a face
 * that clips its own overflow and carries composited children, and when it
 * fails the two coplanar faces z-fight: the German word paints MIRRORED over
 * its own translation and the landscape vanishes. `.review-card-face` switches
 * the away-facing one off at the halfway point of the turn — where the card is
 * edge-on and there is nothing to see either way.
 */
function CardFace({
  back = false,
  facingAway,
  children,
}: {
  back?: boolean;
  /** True while this side is the one turned away from the viewer. */
  facingAway: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card
      data-facing={facingAway ? "away" : "toward"}
      className={cn(
        "review-card-face absolute inset-0 gap-0 overflow-hidden rounded-2xl border-border/70 p-0 py-0 shadow-none",
        back && "[transform:rotateY(180deg)]",
      )}
    >
      <LandscapeBackdrop
        className="review-card-scene"
        sizes={CARD_SIZES}
        motion={false}
      />
      <span
        aria-hidden
        data-face={back ? "back" : "front"}
        className="review-card-scrim absolute inset-0 z-50"
      />
      <div className="relative z-[60] flex size-full flex-col items-center justify-center gap-2 overflow-y-auto px-5 py-4 text-center">
        {children}
      </div>
    </Card>
  );
}

/**
 * The book sentence a card was saved from, with the word itself blanked out.
 *
 * WHY A CLOZE AND NOT THE PLAIN SENTENCE. The plain sentence contains the German
 * word the learner has just been shown on the front, so it adds nothing; blanked,
 * the same sentence is a second, harder pass at the same fact — "and here is
 * where you met it" becomes "and this is the shape of the hole it fills".
 *
 * CUT AT STORED OFFSETS, NEVER SEARCHED FOR. `saved_words` records where in the
 * sentence the word stood, so "Er sah sie an, und sie sah ihn an." blanks the one
 * that was saved rather than the first match (§66). A card saved before those
 * offsets existed, or whose chapter has been reprocessed, simply shows the
 * sentence whole — a weaker card, never a wrong one.
 */
function OriginContext({ card }: { card: SavedWordWithWord }) {
  if (!card.origin_context) return null;

  const cloze = buildCloze(
    card.origin_context,
    card.origin_char_start,
    card.origin_char_end,
  );

  return (
    <blockquote className="line-clamp-3 w-full border-l-2 border-gold/40 pl-2 text-left text-xs italic leading-snug text-muted2">
      {cloze ? (
        <>
          {cloze.before}
          <span className="font-semibold not-italic text-gold">
            {CLOZE_BLANK}
          </span>
          {cloze.after}
        </>
      ) : (
        card.origin_context
      )}
    </blockquote>
  );
}
