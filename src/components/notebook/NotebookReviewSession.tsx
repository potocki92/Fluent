"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { PartyPopper } from "lucide-react";

import { gradeNotebookCard } from "@/actions/review-notebook";
import type { ReviewGrade } from "@/actions/update-srs";
import { settleAction } from "@/lib/errors";
import { Progress } from "@/components/ui/progress";
import type { DueNotebookCard } from "@/lib/notebook/queries";
import {
  buildPhraseCard,
  buildTranslationCard,
  buildWordCard,
  type NotebookCard,
} from "@/lib/notebook/review";
import { ensureInteractionId } from "@/lib/interaction-id";
import { CLOZE_BLANK } from "@/lib/notebook/constants";
import { cn } from "@/lib/utils";

/** The recall ratings, in the same order and wording as the word deck. */
const RATINGS: { grade: ReviewGrade; label: string; className: string }[] = [
  { grade: "again", label: "❌ Jeszcze raz", className: "border-red bg-red/20 text-red" },
  { grade: "hard", label: "😓 Trudne", className: "border-gold bg-gold/20 text-gold" },
  { grade: "good", label: "✅ Dobrze", className: "border-green bg-green/20 text-green" },
  { grade: "easy", label: "🚀 Łatwe", className: "border-blue bg-blue/20 text-blue" },
];

/**
 * Reviewing the notebook.
 *
 * WHY THIS IS A DIFFERENT SCREEN FROM THE WORD DECK, and not a different
 * SCHEDULER. What a notebook card shows is genuinely different — a sentence with
 * a hole in it, a phrase with its source, the learner's own Polish asking for
 * the German back — and cramming four presentations into `ReviewSession`, which
 * exists to flip a dictionary card, would make both worse. What happens when the
 * learner rates it is identical: the same SM-2 from `src/lib/sm2.ts`, the same
 * `review_events` history, the same idempotency token per presentation. One
 * algorithm, two presentations (§70).
 *
 * THE CONTEXT IS NEVER HIDDEN (§68). Every card says which book and chapter it
 * came from, and links back to the sentence — because the reason to review a
 * note from a novel rather than a dictionary entry is that it HAS a place it
 * came from.
 */
export function NotebookReviewSession({ cards }: { cards: DueNotebookCard[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  // One idempotency token per card PRESENTATION — what stops a double tap from
  // advancing the schedule twice. Minted lazily at grading time and cleared when
  // the deck moves on, so nothing has to happen in an effect: advancing is an
  // event, not something to synchronise with afterwards.
  const interactionId = useRef("");

  const current = cards[index];
  const card = current ? buildCard(current) : null;

  const rate = useCallback(
    async (grade: ReviewGrade) => {
      if (!current || busy) return;
      setBusy(true);
      setError(null);

      // Settled: `setBusy(false)` is after the await, so a rejected action
      // used to leave every grade button disabled with nothing to explain it.
      // Retrying is safe — the interaction id is not cleared on a failure, so
      // the second attempt settles the SAME review rather than a new one.
      const result = await settleAction(
        () =>
          gradeNotebookCard({
            annotationId: current.annotationId,
            sentenceNoteId: current.sentenceNoteId,
            grade,
            interactionId: ensureInteractionId(interactionId),
            // What the card DEMANDED, decided by the card builder rather than
            // here — it is the same judgement the evidence map makes, and it
            // must not be re-made by the UI.
            mode: card!.mode,
            direction: card!.direction,
          }),
        `gradeNotebookCard ${current.annotationId ?? current.sentenceNoteId}`,
      );

      setBusy(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone((value) => value + 1);
      interactionId.current = "";
      setRevealed(false);
      setIndex((value) => value + 1);
    },
    [busy, card, current],
  );

  if (!current || !card) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-[#374151] bg-[#2d3748] px-6 py-10 text-center">
        <PartyPopper className="size-8 text-gold" />
        <p className="font-semibold">Zeszyt powtórzony!</p>
        <p className="text-sm text-muted2">
          {done > 0
            ? `Powtórzono ${done} ${done === 1 ? "notatkę" : "notatek"}.`
            : "Nic nie czeka na powtórkę."}
        </p>
        <Link
          href="/notebook"
          className="rounded-xl bg-[#374151] px-4 py-2 text-sm font-semibold text-main transition-colors hover:bg-[#4a5568]"
        >
          Wróć do zeszytu
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Progress value={(index / cards.length) * 100} />
      <p className="text-center text-xs text-muted2">
        {index + 1} / {cards.length}
      </p>

      <div className="rounded-xl border border-[#374151] bg-[#2d3748] p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted2">
          {card.prompt}
        </p>

        <div className="mt-3 text-lg leading-relaxed">
          {card.cloze ? (
            <p>
              {card.cloze.before}
              <span className="mx-0.5 font-semibold text-gold">{CLOZE_BLANK}</span>
              {card.cloze.after}
            </p>
          ) : (
            <p className={cn(card.kind === "phrase" && "font-semibold")}>
              {card.front}
            </p>
          )}
        </div>

        {card.context && !revealed && (
          <p className="mt-2 text-sm text-gold">{card.context}</p>
        )}

        {revealed ? (
          <div className="mt-4 space-y-2 border-t border-[#4b5563] pt-4">
            <p className="text-lg font-semibold text-gold">{card.back}</p>
            {card.context && card.kind !== "context_cloze" && (
              <p className="text-sm italic text-muted2">{card.context}</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-4 h-11 w-full rounded-xl bg-[#374151] text-sm font-semibold text-main transition-colors hover:bg-[#4a5568]"
          >
            Pokaż odpowiedź
          </button>
        )}

        <p className="mt-4 text-xs text-muted2">
          <Link
            href={`/library/${current.itemSlug}/${current.chapterPosition}${
              current.sentenceId ? `?sentence=${current.sentenceId}` : ""
            }`}
            className="hover:text-main"
          >
            {current.itemTitle} · rozdział {current.chapterPosition}
          </Link>
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red"
        >
          {error}
        </p>
      )}

      {revealed && (
        <div className="grid grid-cols-2 gap-2">
          {RATINGS.map((rating) => (
            <button
              key={rating.grade}
              type="button"
              onClick={() => void rate(rating.grade)}
              disabled={busy}
              className={cn(
                "h-12 rounded-xl border text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50",
                rating.className,
              )}
            >
              {rating.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which presentation a due item gets. The three kinds, and nothing else. */
function buildCard(due: DueNotebookCard): NotebookCard {
  if (due.kind === "phrase") return buildPhraseCard(due.source);
  if (due.kind === "sentence") return buildTranslationCard(due.source);
  return buildWordCard(due.source);
}
