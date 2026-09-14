import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { startChapterChallenge } from "@/actions/chapter-assessment";
import { ChallengeRunner } from "@/components/story/ChallengeRunner";
import { getReaderChapter } from "@/lib/library/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Wyzwanie rozdziału — Fluent" };

/**
 * The AFTER screen.
 *
 * A CHAPTER IS NEVER GATED ON THIS. Reading is complete when the reader says it
 * is; the Challenge is an offer, reachable from the completion card, from the
 * book page and from today's plan, and skippable forever. What it buys the
 * learner is a measurement of what actually stuck — and what it buys Fluent is
 * the evidence to plan the following week with.
 *
 * NO BANK IS NOT AN ERROR. A chapter with no validated questions simply has no
 * Challenge, and this says so rather than showing a broken screen. That is the
 * difference between a feature that degrades and one that breaks: reading works
 * either way.
 */
export default async function ChapterChallengePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; chapter: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { slug, chapter } = await params;
  const { item: planItemId } = await searchParams;

  const position = Number(chapter);
  if (!Number.isInteger(position) || position < 1) notFound();

  const supabase = await createServerSupabaseClient();
  const loaded = await getReaderChapter(supabase, slug, position);
  if (!loaded || loaded.status !== "ready") notFound();

  const bookHref = `/library/${slug}`;
  const started = await startChapterChallenge({
    chapterId: loaded.id,
    planItemId: planItemId ?? null,
  });

  if (!started.ok) {
    return <NoChallenge bookHref={bookHref} message={started.message} />;
  }

  return (
    <article className="mx-auto max-w-md space-y-5">
      <header className="space-y-1">
        <Link
          href={bookHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted2 transition-colors hover:text-main"
        >
          <ArrowLeft className="size-4" /> {loaded.item.title}
        </Link>
        <h1 className="text-xl font-bold leading-tight">
          Wyzwanie · rozdział {loaded.position}
        </h1>
        <p className="text-sm text-muted2">
          Sprawdźmy, co zostało. Około {started.estimatedMinutes} min.
        </p>
        {started.shortened && (
          <p className="text-xs text-muted2">
            Ten rozdział ma na razie mniej ćwiczeń, więc wyzwanie jest krótsze.
          </p>
        )}
      </header>

      <ChallengeRunner
        sessionId={started.sessionId}
        questions={started.questions}
        resumeAt={started.resumeAt}
        nextChapterHref={
          loaded.nextPosition === null
            ? null
            : `/library/${slug}/${loaded.nextPosition}`
        }
        bookHref={bookHref}
      />
    </article>
  );
}

function NoChallenge({ bookHref, message }: { bookHref: string; message: string }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-10 text-center">
      <p className="text-sm text-muted2">
        {message === "Nie znaleźliśmy tego testu."
          ? "Ćwiczenia do tego rozdziału nie są jeszcze gotowe."
          : message}
      </p>
      <Link
        href={bookHref}
        className="inline-block rounded-xl border border-border px-5 py-2.5 text-sm text-muted2 transition-colors hover:border-gold/50 hover:text-main"
      >
        Wróć do książki
      </Link>
    </div>
  );
}
