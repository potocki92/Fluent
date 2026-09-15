"use server";

import { revalidatePath } from "next/cache";

import {
  loadDictionaryIndex,
  processChapterById,
  type ProcessingReport,
} from "@/lib/content/processor";
import { requireAdmin } from "@/lib/admin";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
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
 *
 * WHAT MOVED, AND WHY. The processing itself now lives in
 * `src/lib/content/processor.ts`, because private book imports need exactly the
 * same work done under completely different authorisation. This file keeps the
 * admin's authority — `requireAdmin()` on every entry point — and the importer
 * keeps its own; neither grants the other anything.
 */

export type { ProcessingReport } from "@/lib/content/processor";

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

/**
 * Process (or reprocess) one chapter of first-party content.
 *
 * The work is `processChapterById`; what this adds is the admin's authority and
 * the legacy-publication follow-up. A private import runs the same pipeline
 * through `src/actions/book-import.ts`, where the authority is ownership.
 */
export async function processChapter(input: {
  chapterId: string;
  force?: boolean;
}): Promise<ActionResult<ProcessingReport>> {
  const { supabase } = await requireAdmin();

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return fail("config_error", "processChapter: service role unavailable", cause);
  }

  const result = await processChapterById({
    read: supabase,
    service,
    chapterId: input.chapterId,
    force: input.force,
  });
  if (!result.ok) return result;

  // A migrated passage that was already published stays published — the admin
  // made that decision when they published the `texts` row and must not have to
  // make it twice.
  await service.rpc("publish_processed_legacy_items");

  revalidatePath("/admin/library");
  revalidatePath("/library");

  return result;
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

  // Private imports are excluded here, and not merely by convention: an admin
  // batch is a content tool, and a learner's own book is processed by the
  // learner's own import, which checks ownership instead of admin rights.
  const { data: publicItems } = await supabase
    .from("library_items")
    .select("id")
    .is("owner_user_id", null);

  const { data: chapters, error } = await supabase
    .from("chapters")
    .select("id")
    .in("library_item_id", (publicItems ?? []).map((item) => item.id))
    .in("status", ["draft", "processing", "failed"])
    .order("position", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) return failFrom(error, "processPendingChapters: load");
  if (!chapters || chapters.length === 0) {
    return { ok: true, processed: 0, failed: 0, reports: [] };
  }

  let index;
  try {
    index = await loadDictionaryIndex(supabase);
  } catch (cause) {
    return fail("database_error", "processPendingChapters: dictionary", cause);
  }

  const reports: ProcessingReport[] = [];
  let failed = 0;

  for (const chapter of chapters) {
    const result = await processChapterById({
      read: supabase,
      service,
      chapterId: chapter.id,
      index,
    });
    if (result.ok) reports.push(result);
    else failed += 1;
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
