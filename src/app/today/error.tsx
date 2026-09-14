"use client";

import Link from "next/link";

/**
 * The last line of defence.
 *
 * `getOrCreateTodayPlan` already returns classified failures, so reaching this
 * boundary means something unexpected broke. Even here the learner is not stuck:
 * reviews and reading do not depend on the planner, so both stay one tap away.
 */
export default function TodayError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-lg font-semibold">Nie udało się przygotować planu</p>
      <p className="max-w-sm text-sm text-muted2">
        Możesz nadal przejść do powtórek albo do czytania — Twój postęp jest
        bezpieczny.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-colors hover:bg-gold-dark"
        >
          Spróbuj ponownie
        </button>
        <Link
          href="/review"
          className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-main transition-colors hover:bg-accent"
        >
          Powtórki
        </Link>
        <Link
          href="/learn"
          className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-main transition-colors hover:bg-accent"
        >
          Czytaj
        </Link>
      </div>
    </div>
  );
}
