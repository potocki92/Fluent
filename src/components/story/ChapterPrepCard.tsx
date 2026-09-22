import Link from "next/link";
import { BookOpen, Gauge, Sparkles } from "lucide-react";

import type { ChapterStoryState } from "@/lib/story/contracts";
import { cn } from "@/lib/utils";

/**
 * What a learner is told BEFORE a chapter.
 *
 * THE HARD PART IS WHAT NOT TO SAY. Coverage is an estimate over a few hundred
 * words, most of which Fluent has never watched this learner meet; rendered as
 * "91,4%" it becomes a measurement they will make a decision with. So the
 * percentage is whole-numbered, it carries its own confidence in words next to
 * it, and below the evidence floor it is simply absent — replaced by a sentence
 * saying what would change that, which is both honest and actionable.
 *
 * "Dla Ciebie: Wymagający" is a statement about the PAIRING, never about the
 * learner's level. The chapter's CEFR band is a separate fact, shown separately,
 * and a globally-B1 chapter can legitimately be łatwy for one reader and bardzo
 * wymagający for another.
 *
 * TWO BUTTONS, AND THE SECOND ONE ALWAYS WORKS. A learner who wants to read
 * right now is doing the thing this whole product exists for, so "Zacznij
 * czytać" is never gated on preparation and never hidden behind it.
 */
export function ChapterPrepCard({
  state,
  href,
}: {
  state: ChapterStoryState;
  /** Where "Zacznij czytać" goes. */
  href: string;
}) {
  const chapterLabel = state.title ?? `Rozdział ${state.position}`;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">{chapterLabel}</h2>
        <p className="text-xs text-muted2">
          ok. {state.estimatedMinutes} min
          {state.wordCount > 0 &&
            ` · ${state.wordCount.toLocaleString("pl-PL")} słów`}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-[#374151]/40 px-3 py-2">
          <dt className="flex items-center gap-1 text-xs text-muted2">
            <Gauge className="size-3" /> Dla Ciebie
          </dt>
          <dd
            className={cn(
              "mt-0.5 font-semibold",
              state.difficultyLabel === "very_challenging" && "text-red",
              state.difficultyLabel === "challenging" && "text-gold",
              state.difficultyLabel === "easy" && "text-green",
            )}
          >
            {state.difficultyLabelPl}
          </dd>
        </div>

        <div className="rounded-lg bg-[#374151]/40 px-3 py-2">
          <dt className="flex items-center gap-1 text-xs text-muted2">
            <Sparkles className="size-3" /> Znane słownictwo
          </dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {/* No number is the honest answer below the evidence floor, and it
                is a better one than a confident fiction. */}
            {state.coveragePercent === null ? "—" : `${state.coveragePercent}%`}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-muted2">
        {state.coveragePercent === null
          ? "Za mało danych, aby wiarygodnie oszacować pokrycie słownictwa."
          : `Szacunek — ${state.coverageConfidenceLabel}.`}
      </p>

      <div className="space-y-2 pt-1">
        {state.preparation && (
          <Link
            href={`${href}/przygotowanie`}
            className="block w-full rounded-xl bg-gold px-4 py-3 text-center text-base font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark"
          >
            Przygotuj się · {state.preparation.estimatedMinutes} min
          </Link>
        )}

        <Link
          href={href}
          className={cn(
            "block w-full rounded-xl px-4 py-3 text-center font-semibold transition-colors",
            state.preparation
              ? "border border-border text-main hover:border-gold/50"
              : "bg-gold text-[#1a202c] hover:bg-gold-dark",
          )}
        >
          {state.preparation ? "Pomiń i czytaj" : "Zacznij czytać"}
        </Link>
      </div>

      {state.preparation && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted2">
          <BookOpen className="size-3" />
          {/* The claim is deliberately hedged. The ranking is good at "probably
              unknown and frequent"; it cannot know that a word is the one that
              will actually stop this reader. */}
          {state.preparation.wordCount === 1
            ? "1 słowo może najbardziej utrudnić czytanie"
            : `${state.preparation.wordCount} słowa/słów mogą najbardziej utrudnić czytanie`}
        </p>
      )}
    </section>
  );
}
