"use client";

import Link from "next/link";
import { NotebookPen } from "lucide-react";

import type { NotebookSummary } from "@/lib/notebook/summary";

/**
 * "Twoja nauka" — what this chapter produced, at the end of it.
 *
 * WHY IT SITS AT THE END OF THE CHAPTER. A learner who has just read twenty
 * pages and looked up thirty words has no sense of having done anything; the
 * words are behind them and the chapter is over. Four numbers are the evidence
 * that reading WAS the work — which is the claim the whole product rests on.
 *
 * DERIVED, NEVER COUNTED SEPARATELY (§60, §146). The numbers come from the
 * entries the reader already loaded to mark the prose, so this card costs no
 * request at all — and cannot drift away from the list it summarises.
 *
 * NOTHING IS SHOWN FOR NOTHING. A chapter read without a single note gets no
 * card, rather than a row of zeroes telling the learner they failed at a task
 * nobody set them.
 */
export function ChapterNotebookSummary({
  summary,
  libraryItemId,
}: {
  summary: NotebookSummary;
  libraryItemId: string;
}) {
  if (summary.total === 0) return null;

  const stats = [
    { value: summary.words, label: plural(summary.words, "słowo", "słowa", "słów") },
    { value: summary.phrases, label: plural(summary.phrases, "zwrot", "zwroty", "zwrotów") },
    {
      value: summary.translations,
      label: plural(summary.translations, "tłumaczenie", "tłumaczenia", "tłumaczeń"),
    },
    {
      value: summary.unclear,
      label: plural(summary.unclear, "zdanie do wyjaśnienia", "zdania do wyjaśnienia", "zdań do wyjaśnienia"),
    },
  ].filter((stat) => stat.value > 0);

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--reader-rule)" }}
    >
      <h3
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: "var(--reader-fg)" }}
      >
        <NotebookPen className="size-4" style={{ color: "var(--reader-accent)" }} />
        Twoja nauka
      </h3>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd
              className="text-lg font-semibold tabular-nums"
              style={{ color: "var(--reader-accent)" }}
            >
              {stat.value}{" "}
              <span
                className="text-xs font-normal"
                style={{ color: "var(--reader-muted)" }}
              >
                {stat.label}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <Link
        href={`/notebook?book=${libraryItemId}`}
        className="mt-3 inline-flex text-sm font-medium hover:opacity-80"
        style={{ color: "var(--reader-accent)" }}
      >
        Otwórz mój zeszyt →
      </Link>
    </section>
  );
}

/**
 * Polish plurals: 1, 2–4, and everything else — with the teens exception.
 *
 * "12 zwroty" is the kind of mistake that makes an app feel machine-translated,
 * and Fluent's copy is Polish-first by design.
 */
function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
