import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";

import { getChapterStoryState } from "@/actions/chapter-analysis";
import { ChapterList } from "@/components/library/ChapterList";
import { MaterialCover } from "@/components/library/MaterialCover";
import { DeletePrivateBook } from "@/components/library/import/DeletePrivateBook";
import { ChapterPrepCard } from "@/components/story/ChapterPrepCard";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getLibraryItem } from "@/lib/library/queries";
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
/**
 * `maxDuration` is raised for the one genuinely long Server Action this page
 * invokes: deleting a private import, which cascades a whole book's paragraphs,
 * sentences and occurrences. Next applies a page's `maxDuration` to the Server
 * Actions called from it, and this is the supported knob for that.
 *
 * It is no longer about "Odśwież słownictwo". That button re-ran the content
 * pipeline over the owner's entire book so that words added to the dictionary
 * since the import would become tappable; nothing needs to do that any more —
 * see `src/lib/content/dictionary-sync.ts` — and the button is gone.
 */
export const maxDuration = 300;

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

  // READING PROGRESS AND LEARNING PROGRESS ARE TWO DIMENSIONS, and merging them
  // into one percentage would produce a number that means neither. The chapter
  // list shows them side by side: read, and whether the Challenge is still open.
  const { data: states } = user
    ? await supabase
        .from("user_chapter_learning_state")
        .select("chapter_id, status")
        .eq("user_id", user.id)
        .eq("library_item_id", item.id)
    : { data: null };

  const learningState = new Map(
    (states ?? []).map((row) => [row.chapter_id, row.status]),
  );

  const percent = Math.round(item.progressRatio * 100);
  const resume = item.resumeChapter;
  const started = percent > 0;

  // The analysis is for the chapter they are about to read, never for the whole
  // book: "will I understand this?" is a question about the next chapter, and a
  // book-wide average would answer it for a chapter that does not exist.
  const story = resume ? await getChapterStoryState(resume.id) : null;

  return (
    <article className="space-y-6">
      <header className="space-y-3">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 text-sm text-muted2 transition-colors hover:text-main"
        >
          <ArrowLeft className="size-4" /> Biblioteka
        </Link>

        {/* THE COVER SITS BESIDE THE TITLE, NOT ABOVE IT. A full-width banner at
            this measure would be half a phone screen of picture before the one
            thing this page exists for — the resume button — and it would crop
            the image to a letterbox, which is not the 4:3 frame the admin
            approved. Beside the title it identifies the book and costs four
            lines of height. A material with no picture gets no placeholder here:
            the title is already the strongest thing on the screen. */}
        <div className="flex items-start gap-4">
          {item.coverUrl && (
            <MaterialCover
              coverUrl={item.coverUrl}
              sizes="(min-width: 640px) 160px, 112px"
              className="aspect-[4/3] w-28 rounded-xl border border-border sm:w-40"
              eager
              fallback={
                <span className="flex size-full items-center justify-center bg-[#374151] text-gold">
                  <BookOpen className="size-6" />
                </span>
              }
            />
          )}

          <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
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
        // Once the learner is INSIDE a chapter, the prep card is the wrong
        // screen: pre-teaching words to someone forty paragraphs in is a warm-up
        // after the race. They get the resume button they came for instead.
        story?.ok && resume.progressRatio === 0 ? (
          <ChapterPrepCard
            state={story.state}
            href={`/library/${item.slug}/${resume.position}`}
          />
        ) : (
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
          </div>
        )
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted2">
          {item.status === "processing"
            ? "Przygotowuję rozdziały — pierwszy będzie gotowy za chwilę."
            : "Ta pozycja nie ma jeszcze gotowych rozdziałów."}
        </p>
      )}

      <ChapterList
        slug={item.slug}
        chapters={item.chapters}
        learningState={learningState}
      />

      {/* Only an owner sees this, and only for their own import: RLS means
          nobody else can even load this page for a private book.

          THERE IS NO "ODŚWIEŻ SŁOWNICTWO" HERE ANY MORE, and its absence is the
          feature. It used to sit next to this button and tell the owner that
          adding words to the dictionary meant rebuilding their book; a chapter
          now resolves its unknown tokens against the current dictionary when it
          is opened, so there is nothing to press. */}
      {item.rights === "private_import" && (
        <div className="space-y-3 pt-2">
          <DeletePrivateBook itemId={item.id} />
        </div>
      )}
    </article>
  );
}
