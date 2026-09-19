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

import { getDictionarySnapshot } from "@/lib/content/dictionary-snapshot";
import { resolveNormalizedForms } from "@/lib/content/dictionary-match";
import { normalizeToken, tokenize } from "@/lib/content/tokenize";
import {
  buildChapterWordIndex,
  type ChapterWordIndex,
  type ReadingAnchor,
} from "@/lib/reading/position";
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
  /**
   * The item's own state, as distinct from any chapter's.
   *
   * It matters on the shelf for exactly one reason: a private import appears the
   * moment it is created and fills in chapter by chapter, so `processing` is
   * what the card renders instead of a progress bar it has no numbers for.
   */
  status: "draft" | "processing" | "ready" | "published" | "failed";
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
  "id, slug, title, subtitle, author, description, cover_url, content_type, rights, status, cefr_estimate, word_count, chapter_count, legacy_text_id";

const CHAPTER_COLUMNS =
  "id, position, title, word_count, paragraph_count, estimated_reading_minutes, status";

/** The reader also needs the dictionary this chapter's `word_id`s came from. */
const READER_CHAPTER_COLUMNS =
  "id, position, title, word_count, paragraph_count, estimated_reading_minutes, status, dictionary_revision";

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
  status: LibraryItemSummary["status"];
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
    status: row.status,
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
    // An item with no readable chapter is normally an unprocessed shell and has
    // no business on a shelf. A private import is the exception: it appears the
    // moment its owner confirms it and fills in chapter by chapter, because
    // waiting for a 42-chapter book to finish before admitting it exists is how
    // an import feels broken.
    .filter(
      (item) =>
        (chapters ?? []).some((chapter) => chapter.library_item_id === item.id) ||
        item.status === "processing",
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

/**
 * One interactive word, as the reader renders it.
 *
 * `id` IS NULLABLE, and that is not a defect. A chapter processed before every
 * lexical token got a row has gaps in its occurrences; rather than leave those
 * words dead until a maintenance pass has run, the reader fills them in from the
 * same tokenizer that produced the stored rows. Such a token has everything that
 * matters — its surface, its offsets and its position, which is what a notebook
 * note is anchored on — but no row id yet. Reconciliation gives it one, and until
 * then the reader simply does not claim an occurrence it does not have.
 *
 * `wordId` is the CURRENT dictionary's answer, which is not necessarily the one
 * stored with the row: see {@link getReaderChapter}.
 */
export interface ReaderOccurrence {
  /** The `word_occurrences` row, or null for a token not stored as one yet. */
  id: number | null;
  position: number;
  surface: string;
  lemma: string;
  wordId: number | null;
  charStart: number;
  charEnd: number;
}

export interface ReaderSentence {
  id: number;
  /** Position within its PARAGRAPH — the render order. */
  position: number;
  /**
   * Position within the CHAPTER (`sentences.chapter_position`).
   *
   * This is what a reading anchor is addressed by: unique per chapter, stable
   * across a reprocess, and rendered as `data-sentence-position` so the reading
   * line can turn a DOM hit straight into a bookmark.
   */
  chapterPosition: number;
  /** Lexical tokens of the chapter before this sentence (`word_start`). */
  wordStart: number;
  /** Lexical tokens in this sentence. */
  wordCount: number;
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
  /**
   * Everything needed to turn a place in the text into a percentage, in O(1).
   *
   * Built here rather than in the browser because the rows it is made of were
   * being loaded anyway, and because the reader must be able to answer "how far
   * through am I?" on an animation frame without counting anything.
   */
  wordIndex: ChapterWordIndex;
  /**
   * The stored rows disagree with today's dictionary, and the page was rendered
   * from the dictionary.
   *
   * The reader passes this to `syncChapterDictionary`, which writes down what
   * this render worked out — so the aggregate views (coverage, preparation, the
   * question bank) catch up too, and the next render takes the cheap path.
   * Nothing on screen depends on it: the words are already correct.
   */
  needsDictionarySync: boolean;
}

/**
 * Load one chapter's structured content, resolved against TODAY's dictionary.
 *
 * The whole chapter, and nothing but the chapter. Three queries, all bounded by
 * `chapter_id`, so the cost tracks the chapter's length and not the book's.
 *
 * AND THEN THE SECOND LAYER. What is stored is what the dictionary knew when the
 * chapter was processed. That is a fact about the past, and a learner who added
 * *ziehen* to the dictionary this morning is asking a question about the present,
 * so before any of it reaches the page the unresolved tokens are offered to the
 * current dictionary — through the very same `matchToken` the processor used, so
 * *zog* resolves here exactly as it would have resolved there.
 *
 * WHAT THIS BUYS. A word added at any point after an import is tappable in every
 * existing book on the next page view. No reprocessing, no "odśwież słownictwo",
 * no `force: true`, no rewritten paragraphs — and therefore no risk to a single
 * bookmark, note or saved word, because none of those rows are touched.
 *
 * WHAT IT COSTS. Nothing on the common path: a chapter already stamped with the
 * current `dictionary_revision` skips the whole pass, and the revision itself is
 * a cached primary-key read. When a chapter IS behind, the cost is one map lookup
 * per DISTINCT unresolved form — a few thousand, once, in memory.
 *
 * IT IS A READ. It writes nothing: a GET that repairs the database is how a page
 * view becomes a transaction. Persisting the same conclusion is a Server Action,
 * triggered by the reader (see {@link ReaderChapter.needsDictionarySync}).
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
    .select(READER_CHAPTER_COLUMNS)
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
          // `word_count` is the sentence's LEXICAL TOKEN count, written by the
          // pipeline. It is what makes "does this sentence have all its
          // occurrences?" a comparison rather than a re-tokenization.
          //
          // `word_start` is the running total of the ones before it, derived by
          // the database. Together they place every sentence on the word scale
          // reading progress is measured on — see `src/lib/reading/position.ts`.
          .select("id, paragraph_id, position, chapter_position, text, word_count, word_start")
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

  const readerSentences: PendingSentence[] = sentences.map(
    (sentence) => ({
      paragraphId: sentence.paragraph_id,
      id: sentence.id,
      position: sentence.position,
      chapterPosition: sentence.chapter_position,
      wordStart: sentence.word_start,
      wordCount: sentence.word_count,
      text: sentence.text,
      occurrences: (occurrencesBySentence.get(sentence.id) ?? []).sort(
        (a, b) => a.charStart - b.charStart,
      ),
    }),
  );

  const needsDictionarySync = await resolveAgainstCurrentDictionary(
    supabase,
    chapter.dictionary_revision === null ? null : Number(chapter.dictionary_revision),
    readerSentences,
  );

  const sentencesByParagraph = new Map<number, ReaderSentence[]>();
  for (const sentence of readerSentences) {
    const list = sentencesByParagraph.get(sentence.paragraphId) ?? [];
    list.push(sentence);
    sentencesByParagraph.set(sentence.paragraphId, list);
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
    wordIndex: buildChapterWordIndex(
      paragraphs.flatMap((paragraph) =>
        (sentencesByParagraph.get(paragraph.id) ?? []).map((sentence) => ({
          paragraphPosition: paragraph.position,
          sentencePosition: sentence.chapterPosition,
          wordStart: sentence.wordStart,
          wordCount: sentence.wordCount,
        })),
      ),
      paragraphs.length,
    ),
    needsDictionarySync,
  };
}

/**
 * Where this learner stopped in this chapter, read on the SERVER.
 *
 * WHY IT IS NOT JUST `startReadingSession`'s ANSWER. Opening a session is a
 * Server Action: it runs after the page has been sent, hydrated and painted, so
 * restoring from it means the learner sees the top of the chapter and is then
 * thrown several screens down. Read here instead, the position is in the first
 * response — early enough that the page can be scrolled before it is ever
 * painted (see `ReadingRestoreScript`), which is the difference between "the app
 * knows where I read" and "the app scrolled me somewhere".
 *
 * `startReadingSession` still returns it, and is still the authority: it is what
 * notices that another device has read further since. This is the fast copy.
 *
 * RLS DOES THE SCOPING. `reading_progress` is readable only by its owner, so
 * this cannot return anybody else's bookmark even if asked to.
 */
export async function getChapterReadingPosition(
  supabase: Client,
  userId: string,
  chapterId: string,
): Promise<StoredReadingPosition | null> {
  const { data, error } = await supabase
    .from("reading_progress")
    .select(READING_POSITION_COLUMNS)
    .eq("user_id", userId)
    .eq("chapter_id", chapterId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    resume: {
      paragraphPosition: data.resume_paragraph_position ?? 0,
      sentencePosition: data.resume_sentence_position,
      tokenPosition: data.resume_token_position,
    },
    furthest: {
      paragraphPosition: data.furthest_paragraph_position ?? 0,
      sentencePosition: data.furthest_sentence_position,
      tokenPosition: data.furthest_token_position,
    },
    progressRatio: Number(data.progress_ratio ?? 0),
    completedAt: data.completed_at,
  };
}

/**
 * A single literal, not a concatenation: PostgREST infers the row type from the
 * string, and anything it cannot read at compile time comes back as `unknown`.
 */
const READING_POSITION_COLUMNS =
  "resume_paragraph_position, resume_sentence_position, resume_token_position, furthest_paragraph_position, furthest_sentence_position, furthest_token_position, progress_ratio, completed_at";

/** A learner's stored place in one chapter — the two anchors and the bar. */
export interface StoredReadingPosition {
  /** Where to put them back. Moves in both directions. */
  resume: ReadingAnchor;
  /** How far they have read. Only ever moves forward. */
  furthest: ReadingAnchor;
  progressRatio: number;
  completedAt: string | null;
}

/**
 * Just enough of a chapter to title a page.
 *
 * `generateMetadata` and the page body both run for one request, and loading the
 * whole chapter twice to put a string in `<title>` was always wasteful. It stopped
 * being merely wasteful once rendering also resolves the chapter's unresolved
 * tokens against the current dictionary: that is real work, and doing it for a
 * heading would double it for nothing.
 */
export async function getReaderChapterTitle(
  supabase: Client,
  slug: string,
  position: number,
): Promise<{ title: string | null; position: number; itemTitle: string } | null> {
  const { data, error } = await supabase
    .from("chapters")
    .select("title, position, library_items!inner(title, slug, archived_at)")
    .eq("library_items.slug", slug)
    .eq("position", position)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // PostgREST types an embedded one-to-one as an array in some versions and an
  // object in others; normalising here keeps the ambiguity out of the caller.
  const item = (Array.isArray(data.library_items)
    ? data.library_items[0]
    : data.library_items) as { title: string; archived_at: string | null } | null;
  if (!item || item.archived_at !== null) return null;

  return { title: data.title, position: data.position, itemTitle: item.title };
}

/** A sentence being assembled: its paragraph, and the token count the pipeline recorded. */
type PendingSentence = ReaderSentence & { paragraphId: number };

/**
 * Bring one chapter's occurrences up to date with the current dictionary, in
 * memory, for this render only.
 *
 * TWO REPAIRS, AND THEY ARE DIFFERENT AGES OF THE SAME BUG:
 *
 *   GAPS — a chapter processed before every lexical token got a row simply has
 *     no occurrence for *zog* at all. The sentence's stored `word_count` says how
 *     many tokens it should have, so a mismatch is detected without tokenizing,
 *     and only a mismatched sentence is re-tokenized. The synthesized occurrences
 *     carry no row id, which is honest: there is no row yet.
 *   UNRESOLVED — an occurrence exists with `word_id = null` because nothing
 *     matched it then. It is offered to the dictionary again now.
 *
 * Returns whether anything was found to be behind, which is what the reader uses
 * to ask for the same conclusion to be written down.
 *
 * The lookup key is `normalizeToken(surface)` — the tokenizer's own rule, not a
 * second lowercasing — so a stored row and a filled gap are asked the identical
 * question. `normalized` itself is deliberately not shipped to the browser: it is
 * derivable, and one fewer string per token is real bytes over a whole chapter.
 *
 * FAILURE IS NOT FATAL. If the dictionary cannot be read, the chapter renders
 * from exactly what is stored — which is what it did before this existed. A
 * degraded gloss is a much smaller problem than a chapter that will not open.
 */
async function resolveAgainstCurrentDictionary(
  supabase: Client,
  storedRevision: number | null,
  sentences: PendingSentence[],
): Promise<boolean> {
  let snapshot;
  try {
    snapshot = await getDictionarySnapshot(supabase);
  } catch (error) {
    console.error("[fluent:reader] dictionary unavailable", error);
    return false;
  }

  const behind = storedRevision === null || storedRevision !== snapshot.revision;
  const gaps = sentences.some(
    (sentence) => sentence.occurrences.length < sentence.wordCount,
  );
  if (!behind && !gaps) return false;

  for (const sentence of sentences) {
    if (sentence.occurrences.length >= sentence.wordCount) continue;

    const byPosition = new Map(
      sentence.occurrences.map((occurrence) => [occurrence.position, occurrence]),
    );
    // The SAME tokenizer that produced the stored rows, over the STORED text, so
    // a filled gap lands on exactly the position the reconciler will insert.
    sentence.occurrences = tokenize(sentence.text).map(
      (token) =>
        byPosition.get(token.position) ?? {
          id: null,
          position: token.position,
          surface: token.surface,
          lemma: token.normalized,
          wordId: null,
          charStart: token.charStart,
          charEnd: token.charEnd,
        },
    );
  }

  const unresolved = new Set<string>();
  for (const sentence of sentences) {
    for (const occurrence of sentence.occurrences) {
      if (occurrence.wordId === null) {
        unresolved.add(normalizeToken(occurrence.surface));
      }
    }
  }
  if (unresolved.size === 0) return behind || gaps;

  const resolved = resolveNormalizedForms(unresolved, snapshot.index);
  for (const sentence of sentences) {
    for (const occurrence of sentence.occurrences) {
      if (occurrence.wordId !== null) continue;
      const hit = resolved.get(normalizeToken(occurrence.surface));
      if (!hit) continue;
      occurrence.wordId = hit.wordId;
      occurrence.lemma = hit.lemma;
    }
  }

  return true;
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
