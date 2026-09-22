"use server";

import { revalidatePath } from "next/cache";

import {
  loadDictionarySnapshot,
  processChapterById,
} from "@/lib/content/processor";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { analyzeBook } from "@/lib/import/analyze";
import {
  BOOK_IMPORT_BUCKET,
  IMPORT_PROCESS_BATCH_SIZE,
  MAX_BOOK_IMPORT_BYTES,
} from "@/lib/import/constants";
import { sha256Hex } from "@/lib/import/hash";
import { findDuplicateImport } from "@/lib/import/queries";
import type { ImportErrorCode } from "@/lib/import/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { toJson } from "@/lib/json";

/**
 * The private book importer's write paths.
 *
 * THE SHAPE OF THE FEATURE, and why it is shaped this way.
 *
 * 1. THE FILE NEVER PASSES THROUGH NEXT. A Server Action body is capped at about
 *    a megabyte by default, and raising that would mean streaming a 30 MB novel
 *    through a serverless function to hand it straight to Storage. The browser
 *    uploads DIRECTLY to Supabase Storage with a short-lived signed URL minted
 *    here, scoped to one path that this server chose. The function then reads
 *    the stored object. Fewer hops, real upload progress, and no request body
 *    limit to fight.
 *
 * 2. WORK IS RESUMABLE BECAUSE IT IS PERSISTED. Every stage reads the import's
 *    state from the database and writes it back. A learner who closes the tab
 *    mid-analysis comes back to an import that is exactly where they left it —
 *    the React state is a view of the row, never the source of truth.
 *
 * 3. PROCESSING IS BATCHED, HONESTLY. Fluent deploys to Vercel and has no job
 *    queue, no worker and no cron. Rather than pretend otherwise,
 *    {@link processImportBatch} does a few chapters per call and says how many
 *    are left; the review screen keeps calling it while it is open, and any
 *    later visit to the import — or to the book — picks up exactly where the
 *    last call stopped. Nothing is lost if the tab closes; the remaining
 *    chapters simply wait for the next call. `docs/architecture/` records what
 *    it would take to make that a real background job.
 *
 * 4. NO AI. Extraction, cleanup, chapter detection and language detection are
 *    arithmetic over the learner's own bytes. Nothing in this file calls a
 *    model, and the whole book is never sent anywhere.
 *
 * AUTHORISATION. Every function below establishes the acting learner from the
 * cookie-bound client and then calls a SECURITY DEFINER function that derives
 * the owner from `auth.uid()` all over again. The service-role client appears
 * only for Storage reads and for `replace_chapter_content`, and only after
 * ownership has been established — never to decide who the caller is.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Upload
// ─────────────────────────────────────────────────────────────────────────────

export interface StartImportInput {
  fileName: string;
  fileType: "pdf" | "epub" | "txt";
  fileSize: number;
  /** SHA-256, computed in the browser. Verified server-side during analysis. */
  fileHash: string;
}

export interface StartImportResult {
  importId: string;
  storagePath: string;
  /** Short-lived, single-path, single-use. The browser PUTs the file to it. */
  signedUrl: string;
  /** A previous import of the same bytes, if this learner has one. A warning. */
  duplicate: { importId: string; title: string | null } | null;
}

/**
 * Mint an import and a signed upload URL for it.
 *
 * THE SIGNED URL IS NARROW BY CONSTRUCTION: it authorises one PUT, to one path,
 * for a short time, and the path is `<user_id>/<import_id>/original.<ext>` —
 * chosen by `create_book_import` from `auth.uid()`, never supplied by the
 * caller. The bucket's own policies enforce the same prefix rule underneath, so
 * the URL being unguessable is a convenience rather than the security model.
 */
export async function startBookImport(
  input: StartImportInput,
): Promise<ActionResult<StartImportResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startBookImport: no session");

  if (input.fileSize <= 0 || input.fileSize > MAX_BOOK_IMPORT_BYTES) {
    return fail("invalid_input", `startBookImport: size ${input.fileSize}`);
  }

  const duplicate = input.fileHash
    ? await findDuplicateImport(supabase, input.fileHash)
    : null;

  const { data, error } = await supabase.rpc("create_book_import", {
    p_file_name: input.fileName,
    p_file_type: input.fileType,
    p_file_size: input.fileSize,
    p_file_hash: input.fileHash || null,
  });
  if (error || !data) return failFrom(error, "startBookImport: create");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return fail("config_error", "startBookImport: service role", cause);
  }

  const { data: signed, error: signError } = await service.storage
    .from(BOOK_IMPORT_BUCKET)
    .createSignedUploadUrl(data.storage_path, { upsert: true });
  if (signError || !signed) {
    await service.rpc("set_book_import_state", {
      p_import_id: data.id,
      p_status: "failed",
      p_error_code: "storage_failed" satisfies ImportErrorCode,
      p_error_message: signError?.message ?? "no signed url",
    });
    return fail("config_error", "startBookImport: signed url", signError);
  }

  revalidatePath("/library/import");

  return {
    ok: true,
    importId: data.id,
    storagePath: data.storage_path,
    signedUrl: signed.signedUrl,
    duplicate: duplicate
      ? { importId: duplicate.importId, title: duplicate.title }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the uploaded file and turn it into a chapter proposal.
 *
 * ONE CALL, ALL OF IT: extract, clean, detect, persist. The alternative —
 * splitting the stages across requests — would mean storing the whole extracted
 * book somewhere between them, which is a third full copy of a 300 000-word
 * novel to save a few seconds of wall clock. The page that hosts this action
 * raises `maxDuration`, which is the supported way to give a Server Action the
 * time a large PDF needs.
 *
 * SAFE TO REPEAT. Analysis is idempotent at the row level — the proposal is
 * replaced wholesale — so a learner who reloads mid-analysis, or retries after a
 * timeout, gets one clean result rather than two half ones. The one thing it
 * will not do is overwrite manual corrections: `apply_book_import_analysis`
 * refuses that, and the refusal surfaces as `stale_state`.
 */
export async function analyzeBookImport(
  importId: string,
): Promise<ActionResult<{ status: string }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "analyzeBookImport: no session");

  // RLS decides this, not the filter: a learner selecting somebody else's import
  // gets nothing back, whatever id they send.
  const { data: record, error } = await supabase
    .from("book_imports")
    .select("id, file_name, file_type, storage_path, status, final_library_item_id")
    .eq("id", importId)
    .maybeSingle();
  if (error) return failFrom(error, `analyzeBookImport: load ${importId}`);
  if (!record) return fail("not_found", `analyzeBookImport: ${importId}`);
  if (record.final_library_item_id) {
    return fail("session_completed", `analyzeBookImport: already a book ${importId}`);
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return fail("config_error", "analyzeBookImport: service role", cause);
  }

  const markFailed = async (code: ImportErrorCode, detail: string) => {
    await service.rpc("set_book_import_state", {
      p_import_id: importId,
      p_status: "failed",
      p_stage: null,
      p_error_code: code,
      p_error_message: detail,
    });
    revalidatePath(`/library/import/${importId}`);
  };

  await service.rpc("set_book_import_state", {
    p_import_id: importId,
    p_status: "extracting",
    p_stage: "extract_text",
  });

  const { data: file, error: downloadError } = await service.storage
    .from(BOOK_IMPORT_BUCKET)
    .download(record.storage_path);
  if (downloadError || !file) {
    await markFailed("upload_failed", downloadError?.message ?? "object missing");
    return fail("not_found", `analyzeBookImport: object ${importId}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const analysis = await analyzeBook({
    bytes,
    fileName: record.file_name,
    mimeType: file.type || null,
  });
  if (!analysis.ok) {
    await markFailed(analysis.code, analysis.detail);
    return fail("invalid_input", `analyzeBookImport: ${analysis.code}`, analysis.detail);
  }

  await service.rpc("set_book_import_state", {
    p_import_id: importId,
    p_status: "analyzing",
    p_stage: "detect_chapters",
  });

  const { book } = analysis;
  const { error: applyError } = await service.rpc("apply_book_import_analysis", {
    p_import_id: importId,
    p_payload: toJson({
      file_hash: await sha256Hex(bytes),
      detected_title: book.metadata.title,
      detected_author: book.metadata.author,
      // The file's own language tag when it has one (EPUB), otherwise what the
      // text itself says. A `dc:language` an author set beats a guess.
      detected_language: book.metadata.language ?? book.language.language,
      language_confidence: book.language.confidence,
      page_count: book.pageCount,
      word_count: book.wordCount,
      pipeline_version: book.pipelineVersion,
      detector_version: book.detection.detectorVersion,
      quality: { ...book.quality },
      chapters: book.detection.chapters.map((chapter) => ({
        title: chapter.title,
        text: chapter.text,
        word_count: chapter.wordCount,
        start_page: chapter.startPage,
        end_page: chapter.endPage,
        confidence: chapter.confidence,
        href: chapter.sourceHref,
        signals: chapter.signals,
        is_front_matter: chapter.isFrontMatter,
      })),
    }),
  });
  if (applyError) {
    // FL423 — manual corrections exist. That is not a failed import, it is a
    // question for the learner, so the import's state is left alone.
    if (applyError.code !== "FL423") {
      await markFailed("persist_failed", applyError.message);
    }
    return failFrom(applyError, `analyzeBookImport: apply ${importId}`);
  }

  // OBSERVABILITY WITHOUT CONTENT. Ids, counts and timings — never a word of the
  // book. `console.log(bookText)` is the one thing this feature must never do.
  console.info("[fluent:import] analyzed", {
    importId,
    format: book.format,
    pages: book.quality.totalPages,
    words: book.wordCount,
    chapters: book.detection.chapters.length,
    pattern: book.detection.structuralPattern,
    language: book.language.language,
  });

  revalidatePath(`/library/import/${importId}`);
  return { ok: true, status: "awaiting_review" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Review
// ─────────────────────────────────────────────────────────────────────────────

/** The learner's own title and author, overriding whatever the file claimed. */
export async function updateImportMetadata(input: {
  importId: string;
  title: string;
  author: string;
}): Promise<ActionResult<{ importId: string }>> {
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.rpc("update_book_import_metadata", {
    p_import_id: input.importId,
    p_title: input.title,
    p_author: input.author,
  });
  if (error) return failFrom(error, `updateImportMetadata: ${input.importId}`);

  revalidatePath(`/library/import/${input.importId}`);
  return { ok: true, importId: input.importId };
}

export type ImportChapterEdit =
  | { op: "rename"; chapterId: string; title: string }
  | { op: "include"; chapterId: string; included: boolean }
  | { op: "merge_up"; chapterId: string }
  | { op: "split"; chapterId: string; paragraph: number }
  | { op: "move"; chapterId: string; direction: "up" | "down" };

/**
 * One correction to the chapter list.
 *
 * Every operation is a single database transaction that also renumbers, so the
 * list is never left with a gap — which matters because a gap becomes a book
 * with chapter 7 missing. The action is a thin pass-through on purpose: the
 * invariant belongs next to the data, not in TypeScript.
 */
export async function editImportChapter(
  importId: string,
  edit: ImportChapterEdit,
): Promise<ActionResult<{ importId: string }>> {
  const supabase = await createServerSupabaseClient();

  const payload: Record<string, unknown> = { chapter_id: edit.chapterId };
  if (edit.op === "rename") payload.title = edit.title;
  if (edit.op === "include") payload.included = edit.included;
  if (edit.op === "split") payload.paragraph = edit.paragraph;
  if (edit.op === "move") payload.direction = edit.direction;

  const { error } = await supabase.rpc("edit_book_import_chapters", {
    p_import_id: importId,
    p_op: edit.op,
    p_payload: toJson(payload),
  });
  if (error) return failFrom(error, `editImportChapter: ${edit.op}`);

  revalidatePath(`/library/import/${importId}`);
  return { ok: true, importId };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Finalize
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn the reviewed proposal into a private book.
 *
 * ONE BOOK, WHATEVER HAPPENS. The atomicity, the ownership check and the
 * idempotency all live in `finalize_book_import`, which locks the import row and
 * returns the existing library item if there is one. Two clicks, two tabs and
 * two concurrent requests all end with the same id — and this action returns
 * that id rather than an error, because "you already did this" is not a failure
 * from the learner's side.
 */
export async function confirmBookImport(
  importId: string,
): Promise<ActionResult<{ itemId: string; slug: string }>> {
  const supabase = await createServerSupabaseClient();

  const { data: itemId, error } = await supabase.rpc("finalize_book_import", {
    p_import_id: importId,
  });
  if (error || !itemId) return failFrom(error, `confirmBookImport: ${importId}`);

  const { data: item } = await supabase
    .from("library_items")
    .select("slug")
    .eq("id", itemId)
    .maybeSingle();

  console.info("[fluent:import] finalized", { importId, itemId });

  revalidatePath("/library");
  revalidatePath(`/library/import/${importId}`);

  return { ok: true, itemId, slug: item?.slug ?? "" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Processing
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportProcessingProgress {
  total: number;
  ready: number;
  failed: number;
  /** Nothing is pending. The book is as finished as it is going to get. */
  done: boolean;
}

/**
 * Process the next few chapters of an imported book.
 *
 * BATCHED BECAUSE THE DEPLOYMENT IS SERVERLESS. A 42-chapter novel processed in
 * one request would exceed every function timeout Fluent runs under, so each
 * call does {@link IMPORT_PROCESS_BATCH_SIZE} chapters and reports what is left.
 * The caller loops. That is a smaller, more honest machine than a queue Fluent
 * has nowhere to run.
 *
 * PARTIAL READINESS IS A FEATURE. Chapters are processed in reading order, so a
 * learner can open chapter 1 while chapter 42 is still being built — and one
 * chapter that fails leaves the other forty-one readable, exactly as it does for
 * first-party content.
 *
 * `retryFailed` is the difference between "keep going" and "try that again". By
 * default a failed chapter is left alone, so a chapter that cannot be processed
 * cannot put the caller in an infinite loop; the retry button opts in.
 */
export async function processImportBatch(input: {
  importId: string;
  retryFailed?: boolean;
}): Promise<ActionResult<ImportProcessingProgress>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "processImportBatch: no session");

  const { data: record, error } = await supabase
    .from("book_imports")
    .select("id, final_library_item_id")
    .eq("id", input.importId)
    .maybeSingle();
  if (error) return failFrom(error, `processImportBatch: load ${input.importId}`);
  if (!record?.final_library_item_id) {
    return fail("not_found", `processImportBatch: not finalized ${input.importId}`);
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return fail("config_error", "processImportBatch: service role", cause);
  }

  const pending: ("draft" | "failed")[] = input.retryFailed
    ? ["draft", "failed"]
    : ["draft"];
  const { data: chapters, error: chaptersError } = await supabase
    .from("chapters")
    .select("id")
    .eq("library_item_id", record.final_library_item_id)
    .in("status", pending)
    .order("position", { ascending: true })
    .limit(IMPORT_PROCESS_BATCH_SIZE);
  if (chaptersError) return failFrom(chaptersError, "processImportBatch: chapters");

  if (chapters && chapters.length > 0) {
    let snapshot;
    try {
      snapshot = await loadDictionarySnapshot(supabase);
    } catch (cause) {
      return fail("database_error", "processImportBatch: dictionary", cause);
    }

    for (const chapter of chapters) {
      const started = Date.now();
      const result = await processChapterById({
        read: supabase,
        service,
        chapterId: chapter.id,
        snapshot,
      });
      console.info("[fluent:import] chapter", {
        importId: input.importId,
        chapterId: chapter.id,
        ok: result.ok,
        ms: Date.now() - started,
      });
    }
  }

  // DERIVED, NEVER ASSERTED. The counts come from the chapter rows that recorded
  // the work, so a retried batch cannot double-count and a client cannot claim a
  // chapter is ready.
  const { data: progress, error: syncError } = await supabase.rpc(
    "sync_book_import_processing",
    { p_import_id: input.importId },
  );
  if (syncError) return failFrom(syncError, "processImportBatch: sync");

  const counts = (progress ?? {}) as {
    total?: number;
    ready?: number;
    failed?: number;
  };

  revalidatePath("/library");
  revalidatePath(`/library/import/${input.importId}`);

  const total = counts.total ?? 0;
  const ready = counts.ready ?? 0;
  const failed = counts.failed ?? 0;

  return { ok: true, total, ready, failed, done: ready + failed >= total };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cancel and delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abandon an import that has not become a book yet.
 *
 * The proposal is deleted and the uploaded original is removed from Storage, so
 * a cancelled import leaves no orphan file behind. The import ROW survives, as
 * history, so the list can say "anulowane" rather than show a hole.
 *
 * Storage is not transactional with Postgres, which is why the function returns
 * the path rather than trying to delete it itself: the database commits first,
 * and a failed object delete leaves a file with no row rather than a row with no
 * file. Of the two, the first is the one a cleanup pass can fix.
 */
export async function cancelBookImport(
  importId: string,
): Promise<ActionResult<{ importId: string }>> {
  const supabase = await createServerSupabaseClient();

  const { data: path, error } = await supabase.rpc("cancel_book_import", {
    p_import_id: importId,
  });
  if (error) return failFrom(error, `cancelBookImport: ${importId}`);

  await removeStoredObjects(path ? [path] : []);

  revalidatePath("/library/import");
  revalidatePath(`/library/import/${importId}`);
  return { ok: true, importId };
}

/**
 * Delete a private book the caller owns.
 *
 * WHAT GOES: the book, its chapters, its structure, its reading progress and the
 * uploaded original. WHAT STAYS: everything the learner learned. Vocabulary
 * knowledge, review schedules, skill and concept state and the learning event
 * log survive, because reading German from a book you later deleted is still
 * reading German — and losing a month of spaced repetition because somebody
 * tidied their shelf would be indefensible. The one thing stripped from what
 * stays is the private TEXT: a saved word keeps its scheduling and loses the
 * sentence it was copied out of.
 */
export async function deletePrivateBook(
  itemId: string,
): Promise<ActionResult<{ itemId: string }>> {
  const supabase = await createServerSupabaseClient();

  const { data: paths, error } = await supabase.rpc("delete_private_library_item", {
    p_item_id: itemId,
  });
  if (error) return failFrom(error, `deletePrivateBook: ${itemId}`);

  await removeStoredObjects(paths ?? []);

  revalidatePath("/library");
  revalidatePath("/library/import");
  return { ok: true, itemId };
}

/**
 * Remove originals from the private bucket.
 *
 * Best effort, and deliberately so: the database has already committed, and a
 * file that outlives its row is a cleanup problem rather than a correctness one.
 * Failing the whole action here would leave the learner looking at a book they
 * asked to delete.
 */
async function removeStoredObjects(paths: readonly string[]): Promise<void> {
  const wanted = paths.filter(Boolean);
  if (wanted.length === 0) return;

  try {
    const service = createServiceRoleSupabaseClient();
    const { error } = await service.storage.from(BOOK_IMPORT_BUCKET).remove([...wanted]);
    if (error) console.error("[fluent:import] storage cleanup failed", error.message);
  } catch (cause) {
    console.error("[fluent:import] storage cleanup unavailable", cause);
  }
}
