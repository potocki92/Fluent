"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpenCheck, Loader2 } from "lucide-react";

import { deferChapterChallenge } from "@/actions/chapter-assessment";
import type { ChapterSummary } from "@/lib/reading/contracts";

/**
 * What a finished chapter is worth saying.
 *
 * REAL NUMBERS ONLY. Every figure here was measured: words from the learner's
 * furthest position, minutes from the active-reading clock (not from how long
 * the tab was open), lookups from `reading_lookups`, saved words from the cards
 * that were actually created. There is deliberately no comprehension score on
 * this card — nothing here knows whether the chapter was understood, and a
 * summary that implied otherwise would be the reader claiming knowledge it never
 * measured.
 *
 * WHAT PHASE 5 ADDS is the offer to find out. "Gotowy sprawdzić, co zostało?" is
 * the one place a comprehension measurement can honestly be taken, and it is an
 * OFFER: "Później" is a real button, the next chapter is never gated on it, and
 * a deferred Challenge stays available from the book page while Today may bring
 * it back for a few days.
 */
export function ChapterCompleteCard({
  summary,
  nextHref,
  nextLabel,
  testHref,
  challengeHref,
  chapterId,
}: {
  summary: ChapterSummary;
  nextHref: string;
  nextLabel: string;
  /** A migrated passage still has its comprehension test. */
  testHref: string | null;
  /** The Chapter Challenge, when this chapter has a validated question bank. */
  challengeHref: string | null;
  chapterId: string;
}) {
  const minutes = Math.max(1, Math.round(summary.activeSeconds / 60));
  const [deferring, setDeferring] = useState(false);
  const [deferred, setDeferred] = useState(false);

  return (
    <section
      className="rounded-2xl border p-5 text-center"
      style={{
        borderColor: "var(--reader-rule)",
        backgroundColor: "color-mix(in srgb, var(--reader-accent) 8%, transparent)",
      }}
    >
      <BookOpenCheck
        className="mx-auto mb-2 size-7"
        style={{ color: "var(--reader-accent)" }}
      />
      <h2 className="text-lg font-semibold">Rozdział ukończony</h2>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-left text-sm">
        <Stat label="przeczytanych słów" value={summary.wordsRead.toLocaleString("pl-PL")} />
        <Stat label="aktywnego czytania" value={`${minutes} min`} />
        <Stat label="sprawdzonych słów" value={String(summary.lookupCount)} />
        <Stat label="zapisanych do powtórek" value={String(summary.savedWordCount)} />
      </dl>

      {summary.uniqueLookupCount > 0 &&
        summary.uniqueLookupCount !== summary.lookupCount && (
          <p className="mt-3 text-xs" style={{ color: "var(--reader-muted)" }}>
            {summary.uniqueLookupCount}{" "}
            {summary.uniqueLookupCount === 1 ? "różne słowo" : "różnych słów"}
          </p>
        )}

      {challengeHref && !deferred && (
        <p className="mt-4 text-sm" style={{ color: "var(--reader-muted)" }}>
          Gotowy sprawdzić, co zostało?
        </p>
      )}

      <div className="mt-5 space-y-2">
        {challengeHref && !deferred && (
          <Link
            href={challengeHref}
            className="block w-full rounded-xl px-4 py-3 text-base font-semibold"
            style={{
              backgroundColor: "var(--reader-accent)",
              color: "var(--reader-bg)",
            }}
          >
            Wyzwanie rozdziału · ~4 min
          </Link>
        )}

        {challengeHref && !deferred && (
          <button
            type="button"
            onClick={async () => {
              setDeferring(true);
              // Recorded rather than merely dismissed: a deferred Challenge is
              // something Today may usefully bring back, and a dismissal that
              // left no trace could not be.
              await deferChapterChallenge(chapterId);
              setDeferring(false);
              setDeferred(true);
            }}
            disabled={deferring}
            className="flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: "var(--reader-rule)", color: "var(--reader-muted)" }}
          >
            {deferring && <Loader2 className="size-4 animate-spin" />}
            Później
          </button>
        )}

        <Link
          href={nextHref}
          className="block w-full rounded-xl px-4 py-3 text-base font-semibold"
          style={
            challengeHref && !deferred
              ? { border: "1px solid var(--reader-rule)", color: "var(--reader-fg)" }
              : {
                  backgroundColor: "var(--reader-accent)",
                  color: "var(--reader-bg)",
                }
          }
        >
          {nextLabel}
        </Link>
        {/* Never forced: Phase 4 deliberately does not gate the next chapter
            behind a test. */}
        {testHref && (
          <Link
            href={testHref}
            className="block w-full rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: "var(--reader-rule)", color: "var(--reader-muted)" }}
          >
            Sprawdź się w pytaniach
          </Link>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{ backgroundColor: "color-mix(in srgb, var(--reader-fg) 6%, transparent)" }}
    >
      <dt className="text-xs" style={{ color: "var(--reader-muted)" }}>
        {label}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
