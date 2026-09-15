/**
 * The importer's read layer.
 *
 * RLS DOES THE AUTHORISATION. Every query here runs on the caller's own client,
 * so another learner's import is not filtered out — it is invisible. There is no
 * `.eq("user_id", …)` in this file and there must not be one: a filter that
 * looks like security is worse than no filter, because it hides the fact that
 * the policy is what is actually protecting the row.
 *
 * NO BOOK IS EVER LOADED WHOLE. The preview lists chapters with a short snippet
 * each; the full source text of a 300 000-word import stays in the database. A
 * list screen that shipped every chapter's text to the browser would be a 2 MB
 * response to render seventy titles.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { PREVIEW_SNIPPET_CHARS } from "@/lib/import/constants";
import type { ImportStage, ImportStatus } from "@/lib/import/state";
import type { ChapterConfidence, ExtractionQuality, ImportErrorCode } from "@/lib/import/types";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** One proposed chapter, as the review screen sees it. */
export interface ImportChapterPreview {
  id: string;
  position: number;
  title: string | null;
  detectedTitle: string | null;
  wordCount: number;
  confidence: ChapterConfidence;
  isFrontMatter: boolean;
  included: boolean;
  edited: boolean;
  pageStart: number | null;
  pageEnd: number | null;
  /** The first couple of lines, so a learner can check where a split landed. */
  snippet: string;
  /** How many paragraphs it has — the split control's range. */
  paragraphCount: number;
}

export interface BookImportSummary {
  id: string;
  fileName: string;
  fileType: "pdf" | "epub" | "txt";
  fileSize: number;
  status: ImportStatus;
  stage: ImportStage | null;
  title: string | null;
  author: string | null;
  detectedTitle: string | null;
  detectedAuthor: string | null;
  language: string | null;
  languageConfidence: number | null;
  pageCount: number | null;
  wordCount: number;
  chapterCount: number;
  totalChapters: number;
  processedChapters: number;
  failedChapters: number;
  quality: ExtractionQuality | null;
  errorCode: ImportErrorCode | null;
  finalItemId: string | null;
  finalSlug: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookImportDetail extends BookImportSummary {
  chapters: ImportChapterPreview[];
}

const IMPORT_COLUMNS =
  "id, file_name, file_type, file_size, status, stage, title, author, detected_title, detected_author, detected_language, language_confidence, page_count, word_count, chapter_count, total_chapters, processed_chapters, failed_chapters, quality, error_code, final_library_item_id, created_at, updated_at";

/** Every import this learner has, newest first. */
export async function listBookImports(
  supabase: Client,
  limit = 30,
): Promise<BookImportSummary[]> {
  const { data, error } = await supabase
    .from("book_imports")
    .select(IMPORT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  return withSlugs(supabase, rows);
}

/** One import with its proposed chapters. */
export async function getBookImport(
  supabase: Client,
  importId: string,
): Promise<BookImportDetail | null> {
  const { data: row, error } = await supabase
    .from("book_imports")
    .select(IMPORT_COLUMNS)
    .eq("id", importId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [summary] = await withSlugs(supabase, [row]);

  const { data: chapters, error: chaptersError } = await supabase
    .from("book_import_chapters")
    .select(
      "id, position, title, detected_title, word_count, confidence, is_front_matter, included, edited, source_page_start, source_page_end, source_text",
    )
    .eq("import_id", importId)
    .order("position", { ascending: true });
  if (chaptersError) throw chaptersError;

  return {
    ...summary,
    chapters: (chapters ?? []).map((chapter) => {
      const text = chapter.source_text ?? "";
      return {
        id: chapter.id,
        position: chapter.position,
        title: chapter.title,
        detectedTitle: chapter.detected_title,
        wordCount: chapter.word_count,
        confidence: chapter.confidence as ChapterConfidence,
        isFrontMatter: chapter.is_front_matter,
        included: chapter.included,
        edited: chapter.edited,
        pageStart: chapter.source_page_start,
        pageEnd: chapter.source_page_end,
        snippet: snippetOf(text),
        paragraphCount: text.split(/\n{2,}/).filter(Boolean).length,
      };
    }),
  };
}

/**
 * "Have I imported this file before?"
 *
 * Scoped to the caller by RLS, so it never answers a question about anybody
 * else's shelf. A hit is a WARNING and nothing more — wanting a second copy is
 * legitimate, and refusing it would be Fluent deciding what a learner may keep.
 */
export async function findDuplicateImport(
  supabase: Client,
  fileHash: string,
): Promise<{ importId: string; title: string | null; itemId: string | null } | null> {
  const { data, error } = await supabase
    .from("book_imports")
    .select("id, title, detected_title, file_name, final_library_item_id")
    .eq("file_hash", fileHash)
    .not("status", "in", "(cancelled,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;

  return {
    importId: data.id,
    title: data.title ?? data.detected_title ?? data.file_name,
    itemId: data.final_library_item_id,
  };
}

/**
 * The library item an import produced, if it has one.
 *
 * Resolved separately rather than with a join because the shelf needs the SLUG
 * (the URL) and the import only stores the id — and because a join would make
 * every import query depend on the library's RLS as well as its own.
 */
async function withSlugs(
  supabase: Client,
  rows: readonly ImportRow[],
): Promise<BookImportSummary[]> {
  const itemIds = rows
    .map((row) => row.final_library_item_id)
    .filter((id): id is string => Boolean(id));

  const slugs = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data } = await supabase
      .from("library_items")
      .select("id, slug")
      .in("id", itemIds);
    for (const item of data ?? []) slugs.set(item.id, item.slug);
  }

  return rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: Number(row.file_size),
    status: row.status as ImportStatus,
    stage: (row.stage as ImportStage | null) ?? null,
    title: row.title,
    author: row.author,
    detectedTitle: row.detected_title,
    detectedAuthor: row.detected_author,
    language: row.detected_language,
    languageConfidence:
      row.language_confidence === null ? null : Number(row.language_confidence),
    pageCount: row.page_count,
    wordCount: row.word_count,
    chapterCount: row.chapter_count,
    totalChapters: row.total_chapters,
    processedChapters: row.processed_chapters,
    failedChapters: row.failed_chapters,
    quality: (row.quality ?? null) as ExtractionQuality | null,
    errorCode: (row.error_code as ImportErrorCode | null) ?? null,
    finalItemId: row.final_library_item_id,
    finalSlug: row.final_library_item_id
      ? (slugs.get(row.final_library_item_id) ?? null)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Exactly the columns {@link IMPORT_COLUMNS} selects, in row shape. */
type ImportRow = Pick<
  Database["public"]["Tables"]["book_imports"]["Row"],
  | "id"
  | "file_name"
  | "file_type"
  | "file_size"
  | "status"
  | "stage"
  | "title"
  | "author"
  | "detected_title"
  | "detected_author"
  | "detected_language"
  | "language_confidence"
  | "page_count"
  | "word_count"
  | "chapter_count"
  | "total_chapters"
  | "processed_chapters"
  | "failed_chapters"
  | "quality"
  | "error_code"
  | "final_library_item_id"
  | "created_at"
  | "updated_at"
>;

/** The first sentence or two, flattened. Enough to verify a split, never a page. */
function snippetOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_SNIPPET_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_SNIPPET_CHARS).trimEnd()}…`;
}
