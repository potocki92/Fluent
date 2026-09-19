import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getChapterStoryState } from "@/actions/chapter-analysis";
import { ReaderProse } from "@/components/reader/ReaderProse";
import { ReaderRestoreScript } from "@/components/reader/ReadingRestoreScript";
import { ReaderShell } from "@/components/reader/ReaderShell";
import {
  getChapterReadingPosition,
  getReaderChapter,
  getReaderChapterTitle,
} from "@/lib/library/queries";
import {
  DEFAULT_READER_PREFERENCES,
  parseReaderPreferences,
} from "@/lib/reading/preferences";
import { requireAccountUser } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; chapter: string }>;
}): Promise<Metadata> {
  const { slug, chapter } = await params;
  const supabase = await createServerSupabaseClient();
  // The TITLE, not the chapter: metadata and the page body both run for one
  // request, and loading a whole chapter — and resolving its vocabulary — twice
  // to fill in a `<title>` would double the cost of opening a book.
  const loaded = await getReaderChapterTitle(supabase, slug, Number(chapter));
  if (!loaded) return { title: "Rozdział — Fluent" };
  return {
    title: `${loaded.title ?? `Rozdział ${loaded.position}`} — ${loaded.itemTitle}`,
  };
}

/**
 * Opening a chapter can trigger reconciliation — the pass that writes down what
 * this render already resolved (see `syncChapterDictionary`). It is batched and
 * resumable, and nothing on screen waits for it, but a chapter that has never
 * been reconciled does real work on its first open, and Next applies a page's
 * `maxDuration` to the Server Actions invoked from it.
 */
export const maxDuration = 60;

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
  searchParams,
}: {
  params: Promise<{ slug: string; chapter: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, chapter } = await params;
  const position = Number(chapter);
  if (!Number.isInteger(position) || position < 1) notFound();

  const supabase = await createServerSupabaseClient();
  // Reading a chapter is an account activity: it records progress, logs lookups
  // and writes the personal notebook, and a privately imported book is readable
  // by exactly one person. The proxy enforces this for the route; this is the
  // page's own lock (§7, §81).
  const user = await requireAccountUser(`/library/${slug}/${position}`, supabase);

  const loaded = await getReaderChapter(supabase, slug, position);
  if (!loaded) notFound();

  // An unprocessed chapter is not half-shown: partially parsed text is worse
  // than an honest "jeszcze nie gotowe".
  if (loaded.status !== "ready") {
    return <NotReady slug={slug} title={loaded.item.title} />;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("reader_preferences")
    .eq("id", user.id)
    .maybeSingle();

  const preferences = profile
    ? parseReaderPreferences(profile.reader_preferences)
    : DEFAULT_READER_PREFERENCES;

  // Whether the completion card may offer a Challenge. Resolved here rather than
  // in the client so the reader never has to ask, and so a chapter with no bank
  // simply does not show the button instead of showing one that fails.
  const story = await getChapterStoryState(loaded.id);

  // WHERE THIS LEARNER STOPPED, IN THE FIRST RESPONSE. Read here rather than
  // waited for from `startReadingSession`, because a Server Action answers after
  // the page has painted — which is the difference between opening a book at
  // page 94 and opening it at page 1 and being thrown to page 94.
  const stored = await getChapterReadingPosition(supabase, user.id, loaded.id);

  // A DEEP LINK BEATS RESUME (§24). Resolved on the server so that the
  // pre-hydration restore below knows not to fire at all, rather than jumping to
  // the bookmark and then being corrected to the linked sentence.
  const deepLinkedSentence = sentenceParam((await searchParams).sentence);

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
        // The prose above was rendered against the CURRENT dictionary, whatever
        // the stored rows say. This only asks the reader to have that written
        // down, for the screens built on the stored rows.
        needsDictionarySync: loaded.needsDictionarySync,
        // The chapter on the WORD scale, built from rows this page loaded
        // anyway. It is what lets the reader answer "how far through am I?" on
        // an animation frame without counting anything.
        wordIndex: loaded.wordIndex,
      }}
      initialPreferences={preferences}
      initialPosition={
        stored
          ? {
              resume: stored.resume,
              furthest: stored.furthest,
              progressRatio: stored.progressRatio,
            }
          : null
      }
      deepLinkedSentence={deepLinkedSentence}
    >
      <ReaderProse paragraphs={loaded.paragraphs} />
      {/* AFTER the prose, deliberately: it runs while the document is still
          being parsed, so the paragraphs exist and nothing has been painted.
          That is the only point in the page lifecycle where the chapter can be
          opened at the right place instead of jumped to it. */}
      {deepLinkedSentence === null && (
        <ReaderRestoreScript anchor={stored?.resume ?? null} />
      )}
    </ReaderShell>
  );
}

/** `?sentence=` as a row id, or nothing. Never a string reaching a selector. */
function sentenceParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
