"use server";

import { revalidatePath } from "next/cache";

import { loadDictionaryEntries } from "@/lib/content/dictionary-source";
import {
  contentHash,
  processWithIndex,
  type ProcessedChapter,
} from "@/lib/content/process";
import { buildDictionaryIndex } from "@/lib/content/dictionary-match";
import { CONTENT_PROCESSOR_VERSION } from "@/lib/content/version";
import { estimatedChapterMinutes } from "@/lib/reading/progress";
import { requireAdmin } from "@/lib/admin";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { StoredCefrLevel } from "@/types";

/**
 * The admin half of the library: creating content, and running the pipeline
 * over it.
 *
 * WHY PROCESSING LIVES IN A SERVER ACTION rather than a migration or a job
 * queue. The linguistics are TypeScript — paragraph and sentence splitting,
 * tokenizing and dictionary matching are pure functions in `src/lib/content/`
 * with unit tests — and re-implementing any of that in PL/pgSQL would give
 * Fluent two tokenizers that disagree. A queue would be the right answer for
 * hundreds of books; for the amount of content Fluent has, one admin action that
 * processes a chapter (or every pending chapter) is the honest amount of
 * machinery. The pipeline is idempotent, so re-running it is always safe.
 */

/** One chapter as the admin inspector sees it. */
export interface AdminChapterRow {
  id: string;
  position: number;
  title: string | null;
  status: "draft" | "processing" | "ready" | "failed";
  wordCount: number;
  paragraphCount: number;
  sentenceCount: number;
  estimatedMinutes: number;
  processorVersion: string | null;
  processedAt: string | null;
  processingError: string | null;
  matchRate: number | null;
  unmatchedSample: { token: string; count: number }[];
  sourceLength: number;
}

export interface AdminLibraryItemRow {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  contentType: "story" | "book" | "article" | "lesson";
  rights: "first_party" | "public_domain" | "licensed" | "private_import";
  status: "draft" | "processing" | "ready" | "published" | "failed";
  cefr: StoredCefrLevel | null;
  wordCount: number;
  chapterCount: number;
  legacyTextId: number | null;
  archivedAt: string | null;
  chapters: AdminChapterRow[];
}

const ITEM_COLUMNS =
  "id, slug, title, author, content_type, rights, status, cefr_estimate, word_count, chapter_count, legacy_text_id, archived_at";

const CHAPTER_COLUMNS =
  "id, library_item_id, position, title, status, word_count, paragraph_count, sentence_count, estimated_reading_minutes, processor_version, processed_at, processing_error, dictionary_match_rate, unmatched_sample, source_text";

/**
 * Everything in the library, with its processing state.
 *
 * Private imports are excluded, and not merely hidden: the query filters them
 * out and RLS would refuse them anyway. An admin panel is a content tool, not a
 * reason to read someone's personal library.
 */
export async function listLibraryContent(): Promise<AdminLibraryItemRow[]> {
  const { supabase } = await requireAdmin();

  const { data: items, error } = await supabase
    .from("library_items")
    .select(ITEM_COLUMNS)
    .is("owner_user_id", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const itemIds = (items ?? []).map((item) => item.id);
  if (itemIds.length === 0) return [];

  const { data: chapters, error: chaptersError } = await supabase
    .from("chapters")
    .select(CHAPTER_COLUMNS)
    .in("library_item_id", itemIds)
    .order("position", { ascending: true });
  if (chaptersError) throw chaptersError;

  const byItem = new Map<string, AdminChapterRow[]>();
  for (const chapter of chapters ?? []) {
    const list = byItem.get(chapter.library_item_id) ?? [];
    list.push({
      id: chapter.id,
      position: chapter.position,
      title: chapter.title,
      status: chapter.status,
      wordCount: chapter.word_count,
      paragraphCount: chapter.paragraph_count,
      sentenceCount: chapter.sentence_count,
      estimatedMinutes: chapter.estimated_reading_minutes,
      processorVersion: chapter.processor_version,
      processedAt: chapter.processed_at,
      processingError: chapter.processing_error,
      matchRate:
        chapter.dictionary_match_rate === null
          ? null
          : Number(chapter.dictionary_match_rate),
      unmatchedSample: (chapter.unmatched_sample ??
        []) as unknown as AdminChapterRow["unmatchedSample"],
      sourceLength: (chapter.source_text ?? "").length,
    });
    byItem.set(chapter.library_item_id, list);
  }

  return (items ?? []).map((item) => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    author: item.author,
    contentType: item.content_type,
    rights: item.rights,
    status: item.status,
    cefr: item.cefr_estimate,
    wordCount: item.word_count,
    chapterCount: item.chapter_count,
    legacyTextId: item.legacy_text_id,
    archivedAt: item.archived_at,
    chapters: byItem.get(item.id) ?? [],
  }));
}

/**
 * Create a library item.
 *
 * `private_import` is deliberately not creatable here: a private book has an
 * owner, and an admin form has no owner to give it. That path belongs to the
 * import feature, when there is one.
 */
export async function createLibraryItem(input: {
  title: string;
  author?: string | null;
  description?: string | null;
  contentType?: "story" | "book" | "article" | "lesson";
  rights?: "first_party" | "public_domain" | "licensed";
  rightsNote?: string | null;
  cefr?: StoredCefrLevel | null;
}): Promise<ActionResult<{ id: string; slug: string }>> {
  const { supabase } = await requireAdmin();

  const title = input.title.trim();
  if (!title) return fail("invalid_input", "createLibraryItem: empty title");

  const { data: slugBase, error: slugError } = await supabase.rpc("slugify", {
    p_value: title,
  });
  if (slugError) return failFrom(slugError, "createLibraryItem: slug");

  // The suffix keeps two books with the same title apart. It is short, stable
  // once written, and never re-derived — the slug is a convenience, the id is
  // the identity.
  const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;

  const { data, error } = await supabase
    .from("library_items")
    .insert({
      slug,
      title,
      author: input.author?.trim() || null,
      description: input.description?.trim() || null,
      content_type: input.contentType ?? "story",
      rights: input.rights ?? "first_party",
      rights_note: input.rightsNote?.trim() || null,
      cefr_estimate: input.cefr ?? null,
      status: "draft",
    })
    .select("id, slug")
    .single();
  if (error || !data) return failFrom(error, "createLibraryItem: insert");

  revalidatePath("/admin/library");
  return { ok: true, id: data.id, slug: data.slug };
}

/** Add a chapter. Its structure appears only once it has been processed. */
export async function createChapter(input: {
  libraryItemId: string;
  title?: string | null;
  sourceText: string;
}): Promise<ActionResult<{ id: string; position: number }>> {
  const { supabase } = await requireAdmin();

  if (!input.sourceText.trim()) {
    return fail("invalid_input", "createChapter: empty source");
  }

  const { data: last, error: lastError } = await supabase
    .from("chapters")
    .select("position")
    .eq("library_item_id", input.libraryItemId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return failFrom(lastError, "createChapter: position");

  const position = (last?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from("chapters")
    .insert({
      library_item_id: input.libraryItemId,
      position,
      title: input.title?.trim() || null,
      source_text: input.sourceText,
      status: "draft",
    })
    .select("id, position")
    .single();
  if (error || !data) return failFrom(error, "createChapter: insert");

  revalidatePath("/admin/library");
  return { ok: true, id: data.id, position: data.position };
}

/** Replace a chapter's source. The structure is rebuilt on the next process. */
export async function updateChapterSource(input: {
  chapterId: string;
  sourceText: string;
  title?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();

  const { error } = await supabase
    .from("chapters")
    .update({
      source_text: input.sourceText,
      title: input.title?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.chapterId);
  if (error) return failFrom(error, `updateChapterSource: ${input.chapterId}`);

  revalidatePath("/admin/library");
  return { ok: true, id: input.chapterId };
}

/** The quality report one processing run produces. */
export interface ProcessingReport {
  chapterId: string;
  skipped: boolean;
  paragraphCount: number;
  sentenceCount: number;
  wordCount: number;
  matchRate: number;
  unmatchedTokenCount: number;
  distinctWordCount: number;
}

/**
 * Process (or reprocess) one chapter.
 *
 * IDEMPOTENT, AND CHEAPLY SO. If the source has not changed and the processor
 * has not changed, the stored structure is already exactly what this run would
 * produce — so it writes nothing at all. That is not just an optimisation: every
 * rewrite replaces paragraph rows, and a reprocess that changed nothing but
 * still churned the table would be pure risk for zero gain.
 *
 * When it does run, the replacement is one transaction
 * (`replace_chapter_content`): paragraphs, sentences, occurrences and the
 * vocabulary aggregate are swapped together, so a chapter is never half-old.
 */
export async function processChapter(input: {
  chapterId: string;
  force?: boolean;
}): Promise<ActionResult<ProcessingReport>> {
  const { supabase } = await requireAdmin();

  const { data: chapter, error } = await supabase
    .from("chapters")
    .select("id, source_text, status, content_hash, processor_version")
    .eq("id", input.chapterId)
    .maybeSingle();
  if (error) return failFrom(error, `processChapter: load ${input.chapterId}`);
  if (!chapter) return fail("not_found", `processChapter: ${input.chapterId}`);

  const hash = contentHash(chapter.source_text ?? "");
  const unchanged =
    chapter.status === "ready" &&
    chapter.content_hash === hash &&
    chapter.processor_version === CONTENT_PROCESSOR_VERSION;

  if (unchanged && !input.force) {
    return {
      ok: true,
      chapterId: chapter.id,
      skipped: true,
      paragraphCount: 0,
      sentenceCount: 0,
      wordCount: 0,
      matchRate: 0,
      unmatchedTokenCount: 0,
      distinctWordCount: 0,
    };
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return fail("config_error", "processChapter: service role unavailable", cause);
  }

  let processed: ProcessedChapter;
  try {
    const entries = await loadDictionaryEntries(supabase);
    processed = processWithIndex(
      chapter.source_text ?? "",
      buildDictionaryIndex(entries),
    );
  } catch (cause) {
    // ONE BAD CHAPTER IS NOT A BAD BOOK. The failure is recorded against the
    // chapter for an admin to look at; every other chapter stays readable.
    await service.rpc("fail_chapter_processing", {
      p_chapter_id: input.chapterId,
      p_error: cause instanceof Error ? cause.message : String(cause),
    });
    return fail("database_error", `processChapter: pipeline ${input.chapterId}`, cause);
  }

  const { error: writeError } = await service.rpc("replace_chapter_content", {
    p_chapter_id: input.chapterId,
    p_payload: chapterPayload(processed, hash) as unknown as Json,
  });
  if (writeError) {
    await service.rpc("fail_chapter_processing", {
      p_chapter_id: input.chapterId,
      p_error: writeError.message,
    });
    return failFrom(writeError, `processChapter: write ${input.chapterId}`);
  }

  // A migrated passage that was already published stays published — the admin
  // made that decision when they published the `texts` row and must not have to
  // make it twice.
  await service.rpc("publish_processed_legacy_items");

  revalidatePath("/admin/library");
  revalidatePath("/library");

  return {
    ok: true,
    chapterId: input.chapterId,
    skipped: false,
    paragraphCount: processed.paragraphCount,
    sentenceCount: processed.sentenceCount,
    wordCount: processed.wordCount,
    matchRate: processed.stats.matchRate,
    unmatchedTokenCount: processed.stats.unmatchedTokenCount,
    distinctWordCount: processed.stats.matchedWordCount,
  };
}

/**
 * Process everything that is not ready yet.
 *
 * This is how a project that already had passages gets a library: the migration
 * created the shells, this turns them into readable content. The dictionary is
 * loaded ONCE for the whole batch — it is the expensive part, and building the
 * index per chapter would make a 40-chapter run forty times slower for no
 * different result.
 */
export async function processPendingChapters(
  limit = 25,
): Promise<ActionResult<{ processed: number; failed: number; reports: ProcessingReport[] }>> {
  const { supabase } = await requireAdmin();

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return fail("config_error", "processPendingChapters: service role", cause);
  }

  // A passage written after the Phase 4 migration has a `texts` row and no
  // library item, and a passage that never reaches the library is one the reader
  // cannot open. Catching up here rather than in a migration is what keeps the
  // two models from drifting apart as content keeps being written.
  const { error: backfillError } = await service.rpc("backfill_library_from_texts");
  if (backfillError) {
    console.error("[fluent:library] backfill failed", backfillError);
  }

  const { data: chapters, error } = await supabase
    .from("chapters")
    .select("id, source_text")
    .in("status", ["draft", "processing", "failed"])
    .order("position", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) return failFrom(error, "processPendingChapters: load");
  if (!chapters || chapters.length === 0) {
    return { ok: true, processed: 0, failed: 0, reports: [] };
  }

  let index;
  try {
    index = buildDictionaryIndex(await loadDictionaryEntries(supabase));
  } catch (cause) {
    return fail("database_error", "processPendingChapters: dictionary", cause);
  }

  const reports: ProcessingReport[] = [];
  let failed = 0;

  for (const chapter of chapters) {
    const source = chapter.source_text ?? "";
    try {
      const processed = processWithIndex(source, index);
      const { error: writeError } = await service.rpc("replace_chapter_content", {
        p_chapter_id: chapter.id,
        p_payload: chapterPayload(processed, contentHash(source)) as unknown as Json,
      });
      if (writeError) throw writeError;

      reports.push({
        chapterId: chapter.id,
        skipped: false,
        paragraphCount: processed.paragraphCount,
        sentenceCount: processed.sentenceCount,
        wordCount: processed.wordCount,
        matchRate: processed.stats.matchRate,
        unmatchedTokenCount: processed.stats.unmatchedTokenCount,
        distinctWordCount: processed.stats.matchedWordCount,
      });
    } catch (cause) {
      failed += 1;
      await service.rpc("fail_chapter_processing", {
        p_chapter_id: chapter.id,
        p_error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  await service.rpc("publish_processed_legacy_items");

  revalidatePath("/admin/library");
  revalidatePath("/library");

  return { ok: true, processed: reports.length, failed, reports };
}

/** Publish or withdraw an item. Withdrawing archives; it never deletes. */
export async function setLibraryItemStatus(input: {
  itemId: string;
  status: "draft" | "published";
  archived?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const { supabase } = await requireAdmin();

  const now = new Date().toISOString();
  const update = {
    status: input.status,
    updated_at: now,
    archived_at: input.archived ? now : null,
    ...(input.status === "published" ? { published_at: now } : {}),
  };

  const { error } = await supabase
    .from("library_items")
    .update(update)
    .eq("id", input.itemId);
  if (error) return failFrom(error, `setLibraryItemStatus: ${input.itemId}`);

  revalidatePath("/admin/library");
  revalidatePath("/library");
  return { ok: true, id: input.itemId };
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/** The jsonb envelope `replace_chapter_content` unpacks. Transport, not storage. */
function chapterPayload(processed: ProcessedChapter, hash: string) {
  return {
    processor_version: processed.processorVersion,
    content_hash: hash,
    word_count: processed.wordCount,
    paragraph_count: processed.paragraphCount,
    sentence_count: processed.sentenceCount,
    estimated_reading_minutes: estimatedChapterMinutes(processed.wordCount),
    dictionary_match_rate: processed.stats.matchRate,
    unmatched_sample: processed.stats.unmatchedSample,
    vocabulary_stats: {
      unique_word_count: processed.stats.uniqueWordCount,
      lexical_token_count: processed.stats.lexicalTokenCount,
      matched_token_count: processed.stats.matchedTokenCount,
      unmatched_token_count: processed.stats.unmatchedTokenCount,
      matched_word_count: processed.stats.matchedWordCount,
    },
    paragraphs: processed.paragraphs.map((paragraph) => ({
      position: paragraph.position,
      kind: paragraph.kind,
      text: paragraph.text,
      word_count: paragraph.wordCount,
      sentences: paragraph.sentences.map((sentence) => ({
        position: sentence.position,
        chapter_position: sentence.chapterPosition,
        text: sentence.text,
        char_start: sentence.charStart,
        char_end: sentence.charEnd,
        word_count: sentence.wordCount,
        occurrences: sentence.occurrences.map((occurrence) => ({
          position: occurrence.position,
          surface: occurrence.surface,
          normalized: occurrence.normalized,
          lemma: occurrence.lemma,
          word_id: occurrence.wordId,
          char_start: occurrence.charStart,
          char_end: occurrence.charEnd,
        })),
      })),
    })),
    vocabulary: processed.vocabulary.map((entry) => ({
      word_id: entry.wordId,
      occurrence_count: entry.occurrenceCount,
      first_paragraph_position: entry.firstParagraphPosition,
      first_sentence_position: entry.firstSentencePosition,
    })),
  };
}
