import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ChapterList } from "@/components/library/ChapterList";
import { CoverageNote } from "@/components/library/CoverageNote";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getChapterCoverage, getLibraryItem } from "@/lib/library/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const item = await getLibraryItem(supabase, slug, null);
  return { title: item ? `${item.title} — Fluent` : "Biblioteka — Fluent" };
}

/**
 * A book's front page.
 *
 * The one job of this screen is the resume button: someone who is eight
 * chapters in should be back inside the text in a single tap, and someone who
 * has never opened it should be able to start without deciding anything. The
 * chapter list is below that, unlocked — a learner who wants chapter 8 first
 * gets chapter 8. Artificial gating buys nothing here; spoiler protection is a
 * separate, deliberate feature.
 */
export default async function LibraryItemPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const item = await getLibraryItem(supabase, slug, user?.id ?? null);
  if (!item) notFound();

  const percent = Math.round(item.progressRatio * 100);
  const resume = item.resumeChapter;
  const started = percent > 0;

  // Coverage for the chapter they are about to read, never for the whole book:
  // the question "will I understand this?" is about the next chapter.
  const coverage = resume
    ? await getChapterCoverage(supabase, resume.id, user?.id ?? null)
    : null;

  return (
    <article className="space-y-6">
      <header className="space-y-3">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 text-sm text-muted2 transition-colors hover:text-main"
        >
          <ArrowLeft className="size-4" /> Biblioteka
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight">{item.title}</h1>
            {item.subtitle && (
              <p className="mt-0.5 text-sm text-muted2">{item.subtitle}</p>
            )}
            {item.author && (
              <p className="mt-1 text-sm text-muted2">{item.author}</p>
            )}
          </div>
          {item.cefr && (
            <Badge className="shrink-0 bg-gold text-[#1a202c]">{item.cefr}</Badge>
          )}
        </div>

        {item.description && (
          <p className="text-sm leading-relaxed text-muted2">{item.description}</p>
        )}

        <p className="text-xs text-muted2">
          {[
            item.chapterCount === 1
              ? "1 rozdział"
              : `${item.chapterCount} rozdziałów`,
            item.wordCount > 0 ? `${item.wordCount.toLocaleString("pl-PL")} słów` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {started && (
        <div className="space-y-1.5">
          <Progress value={percent} />
          <p className="text-xs text-muted2">
            {percent}% · {item.completedChapters} z {item.chapters.length} rozdziałów
          </p>
        </div>
      )}

      {resume ? (
        <div className="space-y-2">
          <Link
            href={`/library/${item.slug}/${resume.position}`}
            className="block w-full rounded-xl bg-gold px-4 py-3 text-center text-base font-semibold text-[#1a202c] transition-colors hover:bg-gold-dark"
          >
            {started ? "Kontynuuj czytanie" : "Zacznij czytać"}
          </Link>
          <p className="text-center text-xs text-muted2">
            {resume.title ?? `Rozdział ${resume.position}`} · ok.{" "}
            {resume.estimatedMinutes} min
          </p>
          {coverage && <CoverageNote coverage={coverage} />}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted2">
          Ta pozycja nie ma jeszcze gotowych rozdziałów.
        </p>
      )}

      <ChapterList slug={item.slug} chapters={item.chapters} />
    </article>
  );
}
