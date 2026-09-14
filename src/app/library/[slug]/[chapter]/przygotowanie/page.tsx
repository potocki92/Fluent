import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { startChapterPreparation } from "@/actions/chapter-preparation";
import { PreparationRunner } from "@/components/story/PreparationRunner";
import { getReaderChapter } from "@/lib/library/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Przygotowanie — Fluent" };

/**
 * The BEFORE screen.
 *
 * A separate route rather than a step inside the reader, for one reason: the
 * reader must open straight into the text. Someone tapping a chapter expects
 * prose, and a preparation that intercepted them would make the library feel
 * like a course. Preparation is offered from the book page and from today's
 * plan, and it is reached only by someone who chose it.
 *
 * WHEN THERE IS NOTHING TO PREPARE this sends the learner straight to the
 * chapter rather than rendering an empty screen — "0 słów" is not a state worth
 * showing anybody.
 */
export default async function ChapterPreparationPage({
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

  const readerHref = `/library/${slug}/${position}`;
  const started = await startChapterPreparation({
    chapterId: loaded.id,
    planItemId: planItemId ?? null,
  });

  if (!started.ok) {
    return <NoPreparation readerHref={readerHref} message={started.message} />;
  }

  return (
    <article className="mx-auto max-w-md space-y-5">
      <header className="space-y-1">
        <Link
          href={`/library/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted2 transition-colors hover:text-main"
        >
          <ArrowLeft className="size-4" /> {loaded.item.title}
        </Link>
        <h1 className="text-xl font-bold leading-tight">
          Przed rozdziałem {loaded.position}
        </h1>
        <p className="text-sm text-muted2">
          Przygotujemy tylko te słowa, które mogą najbardziej utrudnić czytanie.
        </p>
      </header>

      <PreparationRunner
        sessionId={started.sessionId}
        chapterId={loaded.id}
        cards={started.cards}
        resumeAt={started.resumeAt}
        readerHref={readerHref}
      />
    </article>
  );
}

/**
 * No preparation is a normal outcome, not a failure — the learner already knows
 * this chapter's vocabulary, or the chapter has none Fluent can teach. Either
 * way the right next step is the chapter.
 */
function NoPreparation({
  readerHref,
  message,
}: {
  readerHref: string;
  message: string;
}) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-10 text-center">
      <p className="text-sm text-muted2">{message}</p>
      <Link
        href={readerHref}
        className="inline-block rounded-xl bg-gold px-5 py-2.5 text-sm font-semibold text-[#1a202c]"
      >
        Zacznij czytać
      </Link>
    </div>
  );
}
