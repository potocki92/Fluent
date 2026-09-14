"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import {
  answerPreparationItem,
  finalizeChapterPreparation,
  skipChapterPreparation,
  type PreparationCard,
} from "@/actions/chapter-preparation";
import { FLUENT_ERROR_MESSAGES } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * The preparation screen — a two-minute warm-up, and nothing more.
 *
 * DESIGNED TO BE ESCAPABLE. "Pomiń i czytaj" is present on every card, not
 * buried at the end, because a learner who decides mid-preparation that they are
 * ready to read should be reading five seconds later. An engine that made that
 * awkward would be optimising for its own completion rate.
 *
 * DESIGNED TO BE SHORT. Three to eight cards, one screen each, no score at the
 * end beyond a count. This is not an exercise the learner is meant to feel
 * assessed by — it exists to make the next fifteen minutes of reading smoother,
 * and then to get out of the way.
 *
 * The answer key never reaches this component until the answer is committed:
 * `answerPreparationItem` grades server-side and returns the key with the
 * result, which is the same boundary every graded screen in Fluent holds.
 */
export function PreparationRunner({
  sessionId,
  chapterId,
  cards,
  resumeAt,
  readerHref,
}: {
  sessionId: string;
  chapterId: string;
  cards: readonly PreparationCard[];
  resumeAt: number;
  readerHref: string;
}) {
  const router = useRouter();

  const [index, setIndex] = useState(Math.min(resumeAt, Math.max(0, cards.length - 1)));
  const [selected, setSelected] = useState<number | null>(null);
  const [correctIdx, setCorrectIdx] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  // The clock starts when the card is on screen, never during render.
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  const card = cards[index];
  const isLast = index >= cards.length - 1;

  const answer = useCallback(
    async (optionIdx: number) => {
      if (pending || correctIdx !== null || !card) return;
      setPending(true);
      setSelected(optionIdx);
      setError(null);

      const result = await answerPreparationItem({
        sessionId,
        wordId: card.wordId,
        selectedIdx: optionIdx,
        responseMs: Date.now() - startedAt.current,
      });

      setPending(false);
      if (!result.ok) {
        setSelected(null);
        setError(result.message);
        return;
      }

      setCorrectIdx(result.correctIdx);
      if (result.isCorrect) setCorrectCount((count) => count + 1);
    },
    [card, correctIdx, pending, sessionId],
  );

  const advance = useCallback(async () => {
    if (!isLast) {
      setIndex((current) => current + 1);
      setSelected(null);
      setCorrectIdx(null);
      return;
    }

    setPending(true);
    const result = await finalizeChapterPreparation(sessionId);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Straight into the chapter. The preparation exists to start the reading,
    // so it ends by starting it rather than with a summary screen nobody wants.
    router.push(readerHref);
  }, [isLast, readerHref, router, sessionId]);

  const skip = useCallback(async () => {
    setPending(true);
    const result = await skipChapterPreparation(chapterId);
    setPending(false);
    if (!result.ok) {
      setError(FLUENT_ERROR_MESSAGES[result.code]);
      return;
    }
    router.push(readerHref);
  }, [chapterId, readerHref, router]);

  if (!card) {
    return (
      <p className="py-10 text-center text-sm text-muted2">
        Nie ma nic do przygotowania — możesz zaczynać czytać.
      </p>
    );
  }

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted2">
          <span className="tabular-nums">
            {index + 1} z {cards.length}
          </span>
          <button
            type="button"
            onClick={skip}
            disabled={pending}
            className="underline-offset-2 transition-colors hover:text-main hover:underline disabled:opacity-50"
          >
            Pomiń i czytaj
          </button>
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-[#374151]"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={cards.length}
          aria-label="Postęp przygotowania"
        >
          <div
            className="h-full bg-gold transition-all"
            style={{ width: `${((index + 1) / cards.length) * 100}%` }}
          />
        </div>
      </header>

      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-center">
        <p className="text-2xl font-semibold" lang="de">
          {card.display}
        </p>
        {card.contextSentence && (
          <p className="text-sm italic leading-relaxed text-muted2" lang="de">
            {card.contextSentence}
          </p>
        )}
      </div>

      <div className="space-y-2" role="group" aria-label="Wybierz tłumaczenie">
        {card.options.map((option, optionIdx) => {
          const isChosen = selected === optionIdx;
          const isKey = correctIdx === optionIdx;
          const revealed = correctIdx !== null;

          return (
            <button
              key={option}
              type="button"
              onClick={() => answer(optionIdx)}
              disabled={pending || revealed}
              aria-pressed={isChosen}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-base transition-colors",
                "disabled:cursor-default",
                !revealed && "border-border hover:border-gold/60",
                // Selected state is never colour alone: the icon carries it too,
                // which is what makes this legible without colour vision.
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

      {error && (
        <p role="alert" className="text-center text-sm text-red">
          {error}
        </p>
      )}

      {correctIdx !== null && (
        <button
          type="button"
          onClick={advance}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-base font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {isLast ? "Zacznij czytać" : "Dalej"}
        </button>
      )}

      <p className="text-center text-xs text-muted2 tabular-nums">
        {correctCount} / {cards.length}
      </p>
    </section>
  );
}
