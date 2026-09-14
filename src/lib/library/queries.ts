/**
 * The library's read layer.
 *
 * Every query here is scoped to ONE chapter or ONE item. That is the rule this
 * whole phase exists to make possible: opening chapter 12 of a 300 000-word book
 * must cost what opening chapter 1 costs, and it does because the content is
 * rows keyed by chapter rather than a column on the book.
 *
 * NO N+1. A chapter is exactly three queries — paragraphs, sentences,
 * occurrences — each a single indexed range scan, assembled in memory. The
 * obvious alternative (a query per paragraph for its sentences) would be a
 * thousand round trips for one chapter.
 *
 * RLS DOES THE AUTHORISATION. These run on the caller's own client, so a private
 * import belonging to someone else is not filtered out here — it is invisible.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { estimateCoverage, type CoverageEstimate } from "@/lib/reading/coverage";
import { itemProgressRatio } from "@/lib/reading/progress";
import type { Database } from "@/types/database";
import type { StoredCefrLevel } from "@/types";

type Client = SupabaseClient<Database>;

/**
 * How many rows one page of a chapter's content is read in.
 *
 * PostgREST caps a single response, and a Supabase project can lower that cap
 * further (`db-max-rows`). A 15 000-word chapter is several thousand sentences
 * and occurrences, so a single `select` would SILENTLY return a prefix — the
 * reader would show two thirds of a chapter and nothing would look broken. The
 * only safe read is a paged one.
 */
const CONTENT_PAGE_SIZE = 1000;

/** How many of a chapter's distinct words vocabulary coverage is judged on. */
const COVERAGE_WORD_LIMIT = 500;

/**
 * Read every row of one bounded query, a page at a time.
 *
 * Bounded is the operative word: this is used for "everything in THIS chapter",
 * never for "everything in this book", which is the distinction the whole
 * chapter model exists to make possible.
 */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += CONTENT_PAGE_SIZE) {
    const { data, error } = await page(from, from + CONTENT_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < CONTENT_PAGE_SIZE) break;
  }

  return rows;
}

export interface LibraryItemSummary {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;
  coverUrl: string | null;
  contentType: "story" | "book" | "article" | "lesson";
  rights: "first_party" | "public_domain" | "licensed" | "private_import";
  cefr: StoredCefrLevel | null;
  wordCount: number;
  chapterCount: number;
  legacyTextId: number | null;
}

export interface ChapterSummary {
  id: string;
  position: number;
  title: string | null;
  wordCount: number;
  paragraphCount: number;
  estimatedMinutes: number;
  status: "draft" | "processing" | "ready" | "failed";
}

/** A chapter plus this learner's state in it. */
export interface ChapterWithProgress extends ChapterSummary {
  progressRatio: number;
  completedAt: string | null;
  lastReadAt: string | null;
  resumeParagraph: number;
}

export interface LibraryItemDetail extends LibraryItemSummary {
  chapters: ChapterWithProgress[];
  /** Word-weighted, so a 500-word chapter is not worth a 20 000-word one. */
  progressRatio: number;
  completedChapters: number;
  /** Where "Kontynuuj czytanie" goes: the furthest unfinished chapter. */
  resumeChapter: ChapterWithProgress | null;
}

/** An item on the shelf, with just enough progress to sort and label it. */
export interface ShelfEntry extends LibraryItemSummary {
  progressRatio: number;
  completedChapters: number;
  startedChapters: number;
  lastReadAt: string | null;
  resumeChapterPosition: number | null;
}

const ITEM_COLUMNS =
  "id, slug, title, subtitle, author, description, cover_url, content_type, rights, cefr_estimate, word_count, chapter_count, legacy_text_id";

const CHAPTER_COLUMNS =
  "id, position, title, word_count, paragraph_count, estimated_reading_minutes, status";

type ItemRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  description: string | null;
  cover_url: string | null;
  content_type: LibraryItemSummary["contentType"];
  rights: LibraryItemSummary["rights"];
  cefr_estimate: StoredCefrLevel | null;
  word_count: number;
  chapter_count: number;
  legacy_text_id: number | null;
};

function toSummary(row: ItemRow): LibraryItemSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    description: row.description,
    coverUrl: row.cover_url,
    contentType: row.content_type,
    rights: row.rights,
    cefr: row.cefr_estimate,
    wordCount: row.word_count,
    chapterCount: row.chapter_count,
    legacyTextId: row.legacy_text_id,
  };
}

/**
 * The library page.
 *
 * Two queries whatever the size of the library: the visible items, and this
 * learner's reading state across all of them. Ordering happens here rather than
 * in SQL because "currently reading first" is a judgement about several columns
 * at once, and it is the kind of rule that should be readable.
 */
export async function getLibraryShelf(
  supabase: Client,
  userId: string | null,
  limit = 60,
): Promise<ShelfEntry[]> {
  const { data: items, error } = await supabase
    .from("library_items")
    .select(ITEM_COLUMNS)
    .is("archived_at", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  if (!items || items.length === 0) return [];

  const itemIds = items.map((item) => item.id);

  const [{ data: chapters }, progress] = await Promise.all([
    supabase
      .from("chapters")
      .select("id, library_item_id, position, word_count, status")
      .in("library_item_id", itemIds)
      .eq("status", "ready")
      .order("position", { ascending: true }),
    userId
      ? supabase
          .from("reading_progress")
          .select("chapter_id, library_item_id, progress_ratio, completed_at, last_read_at")
          .eq("user_id", userId)
          .in("library_item_id", itemIds)
      : Promise.resolve({ data: [] }),
  ]);

  const progressByChapter = new Map(
    (progress.data ?? []).map((row) => [row.chapter_id, row]),
  );

  const entries: ShelfEntry[] = items
    .filter((item) =>
      (chapters ?? []).some((chapter) => chapter.library_item_id === item.id),
    )
    .map((item) => {
      const own = (chapters ?? []).filter(
        (chapter) => chapter.library_item_id === item.id,
      );

      let completedChapters = 0;
      let startedChapters = 0;
      let lastReadAt: string | null = null;
      let resumeChapterPosition: number | null = null;

      const weighted = own.map((chapter) => {
        const state = progressByChapter.get(chapter.id);
        const ratio = state ? Number(state.progress_ratio) : 0;
        if (state?.completed_at) completedChapters += 1;
        else if (ratio > 0) startedChapters += 1;
        if (state && (!lastReadAt || state.last_read_at > lastReadAt)) {
          lastReadAt = state.last_read_at;
        }
        if (resumeChapterPosition === null && !state?.completed_at) {
          resumeChapterPosition = chapter.position;
        }
        return { wordCount: chapter.word_count, ratio };
      });

      return {
        ...toSummary(item),
        progressRatio: itemProgressRatio(weighted),
        completedChapters,
        startedChapters,
        lastReadAt,
        resumeChapterPosition,
      };
    });

  // Currently reading, then untouched, then finished. Not fifteen filters — the
  // question a learner actually has on this screen is "where was I?".
  return entries.sort((a, b) => rank(a) - rank(b) || recency(b) - recency(a));
}

function rank(entry: ShelfEntry): number {
  if (entry.startedChapters > 0 || (entry.progressRatio > 0 && entry.progressRatio < 1)) {
    return 0;
  }
  if (entry.completedChapters === 0) return 1;
  return entry.completedChapters >= entry.chapterCount ? 3 : 2;
}

function recency(entry: ShelfEntry): number {
  return entry.lastReadAt ? Date.parse(entry.lastReadAt) : 0;
}

/** One item with its chapters and this learner's place in each. */
export async function getLibraryItem(
  supabase: Client,
  slug: string,
  userId: string | null,
): Promise<LibraryItemDetail | null> {
  const { data: item, error } = await supabase
    .from("library_items")
    .select(ITEM_COLUMNS)
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!item) return null;

  const [{ data: chapters }, progress] = await Promise.all([
    supabase
      .from("chapters")
      .select(CHAPTER_COLUMNS)
      .eq("library_item_id", item.id)
      .order("position", { ascending: true }),
    userId
      ? supabase
          .from("reading_progress")
          .select(
            "chapter_id, progress_ratio, completed_at, last_read_at, resume_paragraph_position",
          )
          .eq("user_id", userId)
          .eq("library_item_id", item.id)
      : Promise.resolve({ data: [] }),
  ]);

  const byChapter = new Map((progress.data ?? []).map((row) => [row.chapter_id, row]));

  const withProgress: ChapterWithProgress[] = (chapters ?? []).map((chapter) => {
    const state = byChapter.get(chapter.id);
    return {
      id: chapter.id,
      position: chapter.position,
      title: chapter.title,
      wordCount: chapter.word_count,
      paragraphCount: chapter.paragraph_count,
      estimatedMinutes: chapter.estimated_reading_minutes,
      status: chapter.status,
      progressRatio: state ? Number(state.progress_ratio) : 0,
      completedAt: state?.completed_at ?? null,
      lastReadAt: state?.last_read_at ?? null,
      resumeParagraph: state?.resume_paragraph_position ?? 0,
    };
  });

  const readable = withProgress.filter((chapter) => chapter.status === "ready");

  return {
    ...toSummary(item),
    chapters: withProgress,
    progressRatio: itemProgressRatio(
      readable.map((chapter) => ({
        wordCount: chapter.wordCount,
        ratio: chapter.progressRatio,
      })),
    ),
    completedChapters: readable.filter((chapter) => chapter.completedAt).length,
    // Resume means "the earliest thing still unfinished" — which is the chapter
    // in progress if there is one, otherwise the next one never opened.
    resumeChapter:
      readable.find((chapter) => !chapter.completedAt && chapter.progressRatio > 0) ??
      readable.find((chapter) => !chapter.completedAt) ??
      null,
  };
}

/** One interactive word, as the reader renders it. */
export interface ReaderOccurrence {
  id: number;
  position: number;
  surface: string;
  lemma: string;
  wordId: number | null;
  charStart: number;
  charEnd: number;
}

export interface ReaderSentence {
  id: number;
  position: number;
  text: string;
  occurrences: ReaderOccurrence[];
}

export interface ReaderParagraph {
  id: number;
  position: number;
  kind: "paragraph" | "heading" | "list_item";
  text: string;
  sentences: ReaderSentence[];
}

export interface ReaderChapter {
  id: string;
  position: number;
  title: string | null;
  wordCount: number;
  paragraphCount: number;
  estimatedMinutes: number;
  status: "draft" | "processing" | "ready" | "failed";
  item: LibraryItemSummary;
  previousPosition: number | null;
  nextPosition: number | null;
  paragraphs: ReaderParagraph[];
}

/**
 * Load one chapter's structured content.
 *
 * The whole chapter, and nothing but the chapter. Three queries, all bounded by
 * `chapter_id`, so the cost tracks the chapter's length and not the book's.
 */
export async function getReaderChapter(
  supabase: Client,
  slug: string,
  position: number,
): Promise<ReaderChapter | null> {
  const { data: item, error } = await supabase
    .from("library_items")
    .select(ITEM_COLUMNS)
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!item) return null;

  const { data: chapter } = await supabase
    .from("chapters")
    .select(CHAPTER_COLUMNS)
    .eq("library_item_id", item.id)
    .eq("position", position)
    .maybeSingle();
  if (!chapter) return null;

  const [{ data: neighbours }, paragraphs, sentences, occurrences] =
    await Promise.all([
      supabase
        .from("chapters")
        .select("position")
        .eq("library_item_id", item.id)
        .eq("status", "ready")
        .order("position", { ascending: true }),
      readAll((from, to) =>
        supabase
          .from("paragraphs")
          .select("id, position, kind, text")
          .eq("chapter_id", chapter.id)
          .order("position", { ascending: true })
          .range(from, to),
      ),
      readAll((from, to) =>
        supabase
          .from("sentences")
          .select("id, paragraph_id, position, text")
          .eq("chapter_id", chapter.id)
          .order("chapter_position", { ascending: true })
          .range(from, to),
      ),
      readAll((from, to) =>
        supabase
          .from("word_occurrences")
          .select("id, sentence_id, position, surface, lemma, word_id, char_start, char_end")
          .eq("chapter_id", chapter.id)
          .order("sentence_id", { ascending: true })
          .order("position", { ascending: true })
          .range(from, to),
      ),
    ]);

  const occurrencesBySentence = new Map<number, ReaderOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = occurrencesBySentence.get(occurrence.sentence_id) ?? [];
    list.push({
      id: occurrence.id,
      position: occurrence.position,
      surface: occurrence.surface,
      lemma: occurrence.lemma,
      wordId: occurrence.word_id,
      charStart: occurrence.char_start,
      charEnd: occurrence.char_end,
    });
    occurrencesBySentence.set(occurrence.sentence_id, list);
  }

  const sentencesByParagraph = new Map<number, ReaderSentence[]>();
  for (const sentence of sentences) {
    const list = sentencesByParagraph.get(sentence.paragraph_id) ?? [];
    list.push({
      id: sentence.id,
      position: sentence.position,
      text: sentence.text,
      occurrences: (occurrencesBySentence.get(sentence.id) ?? []).sort(
        (a, b) => a.charStart - b.charStart,
      ),
    });
    sentencesByParagraph.set(sentence.paragraph_id, list);
  }

  const positions = (neighbours ?? []).map((row) => row.position);
  const index = positions.indexOf(chapter.position);

  return {
    id: chapter.id,
    position: chapter.position,
    title: chapter.title,
    wordCount: chapter.word_count,
    paragraphCount: chapter.paragraph_count,
    estimatedMinutes: chapter.estimated_reading_minutes,
    status: chapter.status,
    item: toSummary(item),
    previousPosition: index > 0 ? positions[index - 1] : null,
    nextPosition:
      index >= 0 && index < positions.length - 1 ? positions[index + 1] : null,
    paragraphs: paragraphs.map((paragraph) => ({
      id: paragraph.id,
      position: paragraph.position,
      kind: paragraph.kind,
      text: paragraph.text,
      sentences: (sentencesByParagraph.get(paragraph.id) ?? []).sort(
        (a, b) => a.position - b.position,
      ),
    })),
  };
}

/**
 * "How much of this chapter's vocabulary do I already know?"
 *
 * Two bounded queries — the chapter's distinct words, and what the learner knows
 * about exactly those — handed to {@link estimateCoverage}, which is where the
 * honesty lives: below the evidence floor it returns `insufficient_data` rather
 * than a number, because a coverage figure based on forty observed words is a
 * decision a learner would make on fiction.
 */
export async function getChapterCoverage(
  supabase: Client,
  chapterId: string,
  userId: string | null,
): Promise<CoverageEstimate> {
  const vocabulary = await readAll((from, to) =>
    supabase
      .from("chapter_vocabulary")
      .select("word_id, occurrence_count")
      .eq("chapter_id", chapterId)
      .order("occurrence_count", { ascending: false })
      .order("word_id", { ascending: true })
      .range(from, to),
  );

  /**
   * Coverage is estimated over the chapter's most FREQUENT words, not all of
   * them.
   *
   * Two reasons, and they point the same way. The tail of a chapter's vocabulary
   * is words that appear once, which barely affect the experience of reading it;
   * and the learner's knowledge has to be fetched for whatever is counted, which
   * cannot be an unbounded `in (...)`. Slicing BOTH sides identically is what
   * keeps the ratio honest — counting 500 words' worth of knowledge against
   * 3 000 words of chapter would depress every estimate silently.
   */
  const chapterWords = vocabulary.slice(0, COVERAGE_WORD_LIMIT).map((row) => ({
    wordId: row.word_id,
    occurrenceCount: row.occurrence_count,
  }));

  if (!userId || chapterWords.length === 0) {
    return {
      status: "insufficient_data",
      observedWords: 0,
      totalWords: chapterWords.length,
      neededWords: Math.max(1, chapterWords.length),
    };
  }

  const { data: knowledge } = await supabase
    .from("user_word_knowledge")
    .select("word_id, receptive_score, receptive_confidence")
    .eq("user_id", userId)
    .in(
      "word_id",
      chapterWords.map((word) => word.wordId),
    );

  return estimateCoverage(
    chapterWords,
    (knowledge ?? []).map((row) => ({
      wordId: row.word_id,
      receptiveScore: row.receptive_score === null ? null : Number(row.receptive_score),
      receptiveConfidence: Number(row.receptive_confidence ?? 0),
    })),
  );
}

/**
 * The library item a legacy `texts` row became, when its chapter is readable.
 *
 * This is the compatibility seam in one function: `/learn/[textId]` uses it to
 * hand a learner to the structured reader, and falls back to rendering
 * `texts.body` when the chapter has not been processed yet. That fallback is
 * what lets an already-provisioned project upgrade without a content freeze.
 */
export async function getReaderRouteForText(
  supabase: Client,
  textId: number,
): Promise<{ slug: string; position: number } | null> {
  const { data: item } = await supabase
    .from("library_items")
    .select("id, slug")
    .eq("legacy_text_id", textId)
    .is("archived_at", null)
    .maybeSingle();
  if (!item) return null;

  const { data: chapter } = await supabase
    .from("chapters")
    .select("position")
    .eq("library_item_id", item.id)
    .eq("status", "ready")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!chapter) return null;

  return { slug: item.slug, position: chapter.position };
}
