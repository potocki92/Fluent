"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/server";
import type { ActionResult } from "@/lib/errors";
import {
  COVER_MAGIC_WINDOW,
  COVER_MIME_EXTENSIONS,
  coverFailure,
  coverObjectPath,
  coverPathExtension,
  coverPublicUrl,
  coverStoragePath,
  isCoverMimeType,
  isCoverPathForItem,
  isManagedCoverPath,
  MATERIAL_COVER_BUCKET,
  MAX_COVER_BYTES,
  MIN_COVER_BYTES,
  sniffCoverType,
  validateCoverFile,
  type CoverErrorCode,
} from "@/lib/library/covers";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * The admin half of material artwork: getting an image into Storage, recording
 * it on the material, and taking it away again.
 *
 * THE FILE NEVER PASSES THROUGH NEXT, the same way a book import does not
 * (`src/actions/book-import.ts`). A Server Action body is capped around a
 * megabyte, and raising that limit to carry a photograph would mean streaming
 * every upload through a serverless function to hand it straight to Storage.
 * Instead {@link prepareTextCoverUpload} mints a short-lived signed URL for ONE
 * path that this server chose, the browser PUTs the bytes to it, and
 * {@link commitTextCoverUpload} records the result. No base64, no blob in
 * Postgres, no raised body limit.
 *
 * THREE STEPS BECAUSE THERE ARE THREE DIFFERENT FAILURES. Preparing can fail
 * because the file is wrong or the material has no library item yet; uploading
 * can fail on the network; committing can fail because the bytes that arrived
 * are not what was promised. Collapsing them into one action would make every
 * one of those "coś poszło nie tak", and would leave an admin with no way to
 * retry the half that failed.
 *
 * ONE SOURCE OF TRUTH. Everything below writes `library_items.cover_url` and
 * nothing else. A passage gets its item through `legacy_text_id`, created by the
 * existing `backfill_library_from_texts()` when an admin has just written the
 * passage and the library has not caught up yet.
 *
 * AUTHORISATION IS NOT THE PANEL'S DOING. Every entry point calls
 * `requireAdmin()`, the `library_items` update runs on the cookie-bound client
 * so `library_item_writable` re-decides it in the database, and the bucket's own
 * policies refuse a non-admin write. The service-role client appears only for
 * Storage, and only after the caller has been established.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Prepare
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareCoverInput {
  textId: number;
  fileName: string;
  /** `File.type`. A mobile picker may leave it empty; the extension covers that. */
  mimeType: string | null;
  fileSize: number;
}

export interface PreparedCoverUpload {
  /** The material the cover will belong to. The browser echoes it back on commit. */
  libraryItemId: string;
  /** Chosen HERE. A client never supplies a storage path. */
  storagePath: string;
  /** Short-lived, single-path. The browser PUTs the image to it. */
  signedUrl: string;
}

/**
 * Mint a place for this material's new cover.
 *
 * THE PATH IS THE SERVER'S. `library/<library_item_id>/<uuid>.<ext>` — the item
 * id comes from the database, the file id from `crypto.randomUUID()`, and the
 * extension from a validated type. Accepting a path from the browser would make
 * every later "does this object belong to this material?" check meaningless.
 *
 * A NEW UUID EVERY TIME is the cache story: replacing a cover produces a
 * different public URL, so no CDN or browser can serve the previous picture
 * under it. The old object is removed on commit, once the new one is recorded.
 */
export async function prepareTextCoverUpload(
  input: PrepareCoverInput,
): Promise<ActionResult<PreparedCoverUpload>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "prepareTextCoverUpload");

  const check = validateCoverFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.fileSize,
  });
  if (!check.ok) {
    return failCover(check.code, `prepareTextCoverUpload: ${input.textId}`);
  }

  const resolved = await resolveLibraryItem(admin.supabase, input.textId);
  if (!resolved.ok) return failCover(resolved.code, `prepareTextCoverUpload: ${input.textId}`);

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return failCover("signed_url_failed", "prepareTextCoverUpload: service role", cause);
  }

  const storagePath = coverObjectPath(
    resolved.libraryItemId,
    crypto.randomUUID(),
    check.extension,
  );

  const { data: signed, error } = await service.storage
    .from(MATERIAL_COVER_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !signed) {
    return failCover("signed_url_failed", "prepareTextCoverUpload: signed url", error);
  }

  return {
    ok: true,
    libraryItemId: resolved.libraryItemId,
    storagePath,
    signedUrl: signed.signedUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Commit
// ─────────────────────────────────────────────────────────────────────────────

export interface CommitCoverInput {
  textId: number;
  storagePath: string;
}

/**
 * Record an uploaded image as this material's cover.
 *
 * WHAT IS RE-CHECKED, AND WHY EACH ONE. The admin role, because a session can
 * end between two requests. The material's library item, resolved again from the
 * database rather than taken from the browser. That the path is one WE could
 * have minted for THIS item — the whole point of choosing paths server-side is
 * lost if the commit accepts any string. And finally the object's own BYTES: the
 * declared MIME type and the extension were both claims a browser made, so the
 * stored file's magic number is the only statement about it the client could not
 * author. An object that turns out to be something else is deleted rather than
 * published in a public bucket.
 *
 * ORDER MATTERS. The new URL is written first and the previous object deleted
 * only after that write succeeds, so a failure never leaves a material with no
 * picture and no way back. An object that outlives its row is a cleanup problem;
 * a row pointing at an object that no longer exists is a broken screen.
 */
export async function commitTextCoverUpload(
  input: CommitCoverInput,
): Promise<ActionResult<{ coverUrl: string }>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "commitTextCoverUpload");

  const resolved = await resolveLibraryItem(admin.supabase, input.textId);
  if (!resolved.ok) return failCover(resolved.code, `commitTextCoverUpload: ${input.textId}`);

  if (!isCoverPathForItem(input.storagePath, resolved.libraryItemId)) {
    return failCover("commit_failed", `commitTextCoverUpload: foreign path ${input.storagePath}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return failCover("commit_failed", "commitTextCoverUpload: no NEXT_PUBLIC_SUPABASE_URL");
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return failCover("commit_failed", "commitTextCoverUpload: service role", cause);
  }

  const stored = await inspectStoredObject(service, input.storagePath);
  if (!stored) {
    return failCover("upload_failed", `commitTextCoverUpload: missing ${input.storagePath}`);
  }
  // Anything the bytes do not support is deleted rather than published: an
  // object nobody can decode has no business under a public URL.
  if (stored.size < MIN_COVER_BYTES || stored.size > MAX_COVER_BYTES) {
    await removeObjects(input.storagePath);
    return failCover(
      stored.size > MAX_COVER_BYTES ? "file_too_large" : "file_too_small",
      `commitTextCoverUpload: rejected ${stored.size} bytes`,
    );
  }
  if (
    !isCoverMimeType(stored.sniffed) ||
    COVER_MIME_EXTENSIONS[stored.sniffed] !== coverPathExtension(input.storagePath)
  ) {
    await removeObjects(input.storagePath);
    return failCover(
      "unsupported_type",
      `commitTextCoverUpload: bytes say ${stored.sniffed ?? "unknown"}`,
    );
  }

  const coverUrl = coverPublicUrl(supabaseUrl, input.storagePath);

  // Through the ADMIN'S OWN CLIENT, so `library_item_writable` decides this in
  // the database: an admin may set the artwork of first-party content and of no
  // private import, whatever this code asks for.
  const { data: updated, error } = await admin.supabase
    .from("library_items")
    .update({ cover_url: coverUrl })
    .eq("id", resolved.libraryItemId)
    .is("owner_user_id", null)
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    await removeObjects(input.storagePath);
    return failCover("commit_failed", `commitTextCoverUpload: update ${resolved.libraryItemId}`, error);
  }

  // Only now, and only if the old URL was ours AND this material's. A previous
  // URL pointing anywhere else is simply forgotten — see `coverStoragePath`.
  const previous = coverStoragePath(resolved.coverUrl, supabaseUrl);
  if (
    previous &&
    previous !== input.storagePath &&
    isCoverPathForItem(previous, resolved.libraryItemId)
  ) {
    await removeObjects(previous);
  }

  revalidateCoverPaths(input.textId);

  return { ok: true, coverUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Remove
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take a material's artwork away.
 *
 * THE URL IS READ FROM THE DATABASE, never from the caller, and the object is
 * deleted only if that URL resolves to a path inside OUR bucket under THIS
 * material's prefix. `cover_url` is a general column — a book's cover may one
 * day be a publisher's URL — so "clear the column" and "delete the file" are two
 * decisions, and only the first is unconditional.
 */
export async function removeTextCover(
  textId: number,
): Promise<ActionResult<{ textId: number }>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "removeTextCover");

  const resolved = await resolveLibraryItem(admin.supabase, textId, { backfill: false });
  if (!resolved.ok) {
    // No library item means no cover to remove. Saying so as a success keeps the
    // button idempotent: pressing it twice is not an error.
    if (resolved.code === "item_missing") return { ok: true, textId };
    return failCover(resolved.code, `removeTextCover: ${textId}`);
  }

  const { error } = await admin.supabase
    .from("library_items")
    .update({ cover_url: null })
    .eq("id", resolved.libraryItemId)
    .is("owner_user_id", null);
  if (error) return failCover("remove_failed", `removeTextCover: update ${textId}`, error);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const path = coverStoragePath(resolved.coverUrl, supabaseUrl);
  if (path && isCoverPathForItem(path, resolved.libraryItemId)) {
    await removeObjects(path);
  }

  revalidateCoverPaths(textId);

  return { ok: true, textId };
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

type AdminClient = Awaited<ReturnType<typeof requireAdmin>>;

/**
 * `requireAdmin()` throws, and a thrown Server Action error is redacted in
 * production — so the UI would get an opaque digest instead of a sentence. Every
 * entry point above returns a classified failure instead.
 */
async function requireAdminOrNull(): Promise<AdminClient | null> {
  try {
    return await requireAdmin();
  } catch (cause) {
    console.error("[fluent:covers] admin check failed", cause);
    return null;
  }
}

type ResolvedItem =
  | { ok: true; libraryItemId: string; coverUrl: string | null }
  | { ok: false; code: CoverErrorCode };

/**
 * The library item a passage belongs to, creating it if the library has not
 * caught up yet.
 *
 * THE BACKFILL IS THE EXISTING ONE. An admin who writes a passage in
 * `/admin/texts` creates a `texts` row with no library item; `processPendingChapters`
 * already closes that gap the same way, with the same service-role function. A
 * second "create the item" path here would be a second content model.
 */
async function resolveLibraryItem(
  supabase: AdminClient["supabase"],
  textId: number,
  options: { backfill?: boolean } = {},
): Promise<ResolvedItem> {
  if (!Number.isInteger(textId)) return { ok: false, code: "text_not_found" };

  const { data: text } = await supabase
    .from("texts")
    .select("id")
    .eq("id", textId)
    .maybeSingle();
  if (!text) return { ok: false, code: "text_not_found" };

  const existing = await loadItem(supabase, textId);
  if (existing) return { ok: true, ...existing };

  if (options.backfill === false) return { ok: false, code: "item_missing" };

  try {
    const service = createServiceRoleSupabaseClient();
    const { error } = await service.rpc("backfill_library_from_texts");
    if (error) console.error("[fluent:covers] backfill failed", error);
  } catch (cause) {
    console.error("[fluent:covers] backfill unavailable", cause);
  }

  const created = await loadItem(supabase, textId);
  return created ? { ok: true, ...created } : { ok: false, code: "item_missing" };
}

async function loadItem(
  supabase: AdminClient["supabase"],
  textId: number,
): Promise<{ libraryItemId: string; coverUrl: string | null } | null> {
  const { data } = await supabase
    .from("library_items")
    .select("id, cover_url")
    .eq("legacy_text_id", textId)
    .maybeSingle();
  return data ? { libraryItemId: data.id, coverUrl: data.cover_url } : null;
}

type ServiceClient = ReturnType<typeof createServiceRoleSupabaseClient>;

/**
 * What the stored object actually IS, from its own bytes.
 *
 * The file is read back once, here, and its magic number is what decides
 * whether it becomes a cover. That costs one download of at most
 * {@link MAX_COVER_BYTES} on an action an admin runs by hand, once per image —
 * cheap enough that trusting a `Content-Type` header the client set instead
 * would be a choice rather than a constraint.
 */
async function inspectStoredObject(
  service: ServiceClient,
  storagePath: string,
): Promise<{ sniffed: string | null; size: number } | null> {
  const { data, error } = await service.storage
    .from(MATERIAL_COVER_BUCKET)
    .download(storagePath);
  if (error || !data) {
    console.error("[fluent:covers] could not read back the upload", error);
    return null;
  }

  const head = new Uint8Array(
    await data.slice(0, COVER_MAGIC_WINDOW).arrayBuffer(),
  );

  return { sniffed: sniffCoverType(head), size: data.size };
}

/**
 * Remove objects we minted.
 *
 * Best effort by design: the database has already committed, and an object that
 * outlives its row is a cleanup problem rather than a correctness one. Failing
 * the action here would tell an admin their change did not happen when it did.
 */
async function removeObjects(...paths: string[]): Promise<void> {
  // The last gate before a delete: only paths this feature could have minted.
  const wanted = paths.filter(isManagedCoverPath);
  if (wanted.length === 0) return;

  try {
    const service = createServiceRoleSupabaseClient();
    const { error } = await service.storage.from(MATERIAL_COVER_BUCKET).remove(wanted);
    if (error) console.error("[fluent:covers] storage cleanup failed", error.message);
  } catch (cause) {
    console.error("[fluent:covers] storage cleanup unavailable", cause);
  }
}

/**
 * What a cover change actually invalidates.
 *
 * The admin screens that render it, the library, and Today — whose
 * „Kontynuuj naukę" card resolves the artwork server-side. Not the whole cache:
 * a picture does not change a plan, a score or a schedule.
 */
function revalidateCoverPaths(textId: number): void {
  revalidatePath("/today");
  revalidatePath("/library");
  revalidatePath(`/learn/${textId}`);
  revalidatePath(`/admin/texts/${textId}`);
}

function failCover(code: CoverErrorCode, context: string, detail?: unknown) {
  console.error(`[fluent:covers:${code}] ${context}`, detail ?? "");
  return coverFailure(code);
}
