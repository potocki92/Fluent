"use client";

import Link from "next/link";
import { BookOpenCheck } from "lucide-react";

import type { ChallengeResult } from "@/actions/chapter-assessment";

/**
 * What a learner sees when a Chapter Challenge ends.
 *
 * REAL NUMBERS, AND NO MODEL SCORES. "Fabuła 5 / 6" is a count of questions they
 * answered; `user_skill_state.score = 0.71` is a debugging artefact that happens
 * to be about them. The first is worth showing and the second is not, and the
 * difference is not presentation — it is whether the number means what the
 * learner will think it means.
 *
 * THE COACHING LINE IS EITHER EARNED OR ABSENT. "Fabułę rozumiesz dobrze —
 * najwięcej problemu sprawiło słownictwo" is only shown when the answers
 * actually say that. With two answered questions there is no pattern to see, and
 * `challengeFeedback` says so in as many words rather than inventing one. A
 * fabricated analysis is worse than none: a learner who acts on it is learning
 * the wrong thing, and one who notices stops believing the rest.
 *
 * A SUBTLE CELEBRATION AND NOTHING MORE. No confetti cannon, no streak
 * multiplier, no badge. The reward for finishing a chapter is the next chapter.
 */
export function ChallengeResultCard({
  result,
  nextChapterHref,
  bookHref,
}: {
  result: ChallengeResult;
  nextChapterHref: string | null;
  bookHref: string;
}) {
  return (
    <section className="space-y-5 text-center">
      <header className="space-y-2">
        <BookOpenCheck className="mx-auto size-8 text-gold" />
        <h1 className="text-xl font-semibold">{result.headlinePl}</h1>
        {result.detailPl && (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted2">
            {result.detailPl}
          </p>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-3 text-left">
        {result.comprehension.total > 0 && (
          <Score label="Historia" {...result.comprehension} />
        )}
        {result.vocabulary.total > 0 && (
          <Score label="Słownictwo" {...result.vocabulary} />
        )}
        {result.grammar.total > 0 && <Score label="Gramatyka" {...result.grammar} />}
        <Score label="Razem" correct={result.correct} total={result.total} />
      </dl>

      {result.reviewTargets.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-left">
          <p className="text-sm font-semibold">Najbardziej warto powtórzyć</p>
          <ul className="mt-2 space-y-1 text-sm text-muted2">
            {result.reviewTargets.map((target) => (
              <li key={`${target.kind}-${target.label}`}>
                <span aria-hidden="true">• </span>
                <span lang={target.kind === "word" ? "de" : undefined}>
                  {target.label}
                </span>
              </li>
            ))}
          </ul>
          {/* The targets are a recommendation the planner may act on, not cards
              silently added to a deck. A deck the app fills by itself is a deck
              nobody trusts. */}
          <p className="mt-2 text-xs text-muted2">
            Fluent uwzględni je w kolejnych planach nauki.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {nextChapterHref && (
          <Link
            href={nextChapterHref}
            className="block w-full rounded-xl bg-gold px-4 py-3 text-base font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark"
          >
            Następny rozdział
          </Link>
        )}
        <Link
          href={bookHref}
          className="block w-full rounded-xl border border-border px-4 py-3 text-sm text-muted2 transition-colors hover:border-gold/50 hover:text-main"
        >
          Wróć do książki
        </Link>
        <Link
          href="/today"
          className="block py-1 text-xs text-muted2 underline-offset-2 transition-colors hover:text-main hover:underline"
        >
          Wróć do dzisiejszego planu
        </Link>
      </div>
    </section>
  );
}

function Score({
  label,
  correct,
  total,
}: {
  label: string;
  correct: number;
  total: number;
}) {
  return (
    <div className="rounded-lg bg-[#374151]/40 px-3 py-2">
      <dt className="text-xs text-muted2">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">
        {correct} / {total}
      </dd>
    </div>
  );
}
