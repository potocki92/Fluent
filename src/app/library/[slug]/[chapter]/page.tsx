import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getChapterStoryState } from "@/actions/chapter-analysis";
import { ReaderProse } from "@/components/reader/ReaderProse";
import { ReaderShell } from "@/components/reader/ReaderShell";
import { getReaderChapter } from "@/lib/library/queries";
import {
  DEFAULT_READER_PREFERENCES,
  parseReaderPreferences,
} from "@/lib/reading/preferences";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; chapter: string }>;
}): Promise<Metadata> {
  const { slug, chapter } = await params;
  const supabase = await createServerSupabaseClient();
  const loaded = await getReaderChapter(supabase, slug, Number(chapter));
  if (!loaded) return { title: "Rozdział — Fluent" };
  return {
    title: `${loaded.title ?? `Rozdział ${loaded.position}`} — ${loaded.item.title}`,
  };
}

/**
 * The reader.
 *
 * A SERVER COMPONENT THAT RENDERS THE PROSE, wrapping a client component that
 * adds behaviour. That is the inversion this phase is built around: the old
 * reader shipped an HTML blob and rebuilt it in the browser with `DOMParser`, so
 * the text did not exist until hydration and the cost grew with the length of
 * the passage. Here the chapter is real document text in the first response —
 * selectable, searchable by the browser, and correct with JavaScript disabled —
 * and `ReaderShell` layers the gloss, the progress observer and the settings on
 * top of it.
 *
 * Typography is resolved here too, from the learner's profile, so the chosen
 * size and theme are on the FIRST paint rather than applied after hydration.
 */
export default async function ChapterPage({
  params,
}: {
  params: Promise<{ slug: string; chapter: string }>;
}) {
  const { slug, chapter } = await params;
  const position = Number(chapter);
  if (!Number.isInteger(position) || position < 1) notFound();

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const loaded = await getReaderChapter(supabase, slug, position);
  if (!loaded) notFound();

  // An unprocessed chapter is not half-shown: partially parsed text is worse
  // than an honest "jeszcze nie gotowe".
  if (loaded.status !== "ready") {
    return <NotReady slug={slug} title={loaded.item.title} />;
  }

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("reader_preferences")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const preferences = profile
    ? parseReaderPreferences(profile.reader_preferences)
    : DEFAULT_READER_PREFERENCES;

  // Whether the completion card may offer a Challenge. Resolved here rather than
  // in the client so the reader never has to ask, and so a chapter with no bank
  // simply does not show the button instead of showing one that fails.
  const story = user ? await getChapterStoryState(loaded.id) : null;

  return (
    <ReaderShell
      chapter={{
        id: loaded.id,
        position: loaded.position,
        title: loaded.title,
        paragraphCount: loaded.paragraphCount,
        wordCount: loaded.wordCount,
        estimatedMinutes: loaded.estimatedMinutes,
        itemId: loaded.item.id,
        itemSlug: loaded.item.slug,
        itemTitle: loaded.item.title,
        previousPosition: loaded.previousPosition,
        nextPosition: loaded.nextPosition,
        legacyTextId: loaded.item.legacyTextId,
        hasChallenge: story?.ok === true && story.state.hasChallenge,
      }}
      initialPreferences={preferences}
    >
      <ReaderProse paragraphs={loaded.paragraphs} />
    </ReaderShell>
  );
}

function NotReady({ slug, title }: { slug: string; title: string }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-semibold text-main">Rozdział jest przygotowywany</p>
      <p className="text-sm text-muted2">
        Treść tego rozdziału nie została jeszcze przetworzona. Spróbuj ponownie za
        chwilę.
      </p>
      <Link
        href={`/library/${slug}`}
        className="mt-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-[#1a202c]"
      >
        Wróć do „{title}”
      </Link>
    </div>
  );
}
