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
  isAdminManagedMaterial,
  isCoverMimeType,
  isCoverPathForItem,
  isLibraryItemId,
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
 * THE SUBJECT IS THE LIBRARY ITEM. `library_items.cover_url` is where a picture
 * lives, so `library_item_id` is what every action below takes. That is not a
 * detail of naming: keying this API on `text_id` made artwork reachable only for
 * materials that began life as a legacy passage, and left everything authored
 * directly in the library — a story with chapters and no `texts` row, like
 * „Der Schlüssel" — with no way to be given a picture at all. A legacy passage
 * is now the special case, served by three thin adapters at the bottom of this
 * file that resolve `text_id → library_item_id` and call the same code. There is
 * ONE implementation of upload, commit and removal.
 *
 * THE FILE NEVER PASSES THROUGH NEXT, the same way a book import does not
 * (`src/actions/book-import.ts`). A Server Action body is capped around a
 * megabyte, and raising that limit to carry a photograph would mean streaming
 * every upload through a serverless function to hand it straight to Storage.
 * Instead {@link prepareMaterialCoverUpload} mints a short-lived signed URL for
 * ONE path that this server chose, the browser PUTs the bytes to it, and
 * {@link commitMaterialCoverUpload} records the result. No base64, no blob in
 * Postgres, no raised body limit.
 *
 * THREE STEPS BECAUSE THERE ARE THREE DIFFERENT FAILURES. Preparing can fail
 * because the file is wrong or the material is not one this panel manages;
 * uploading can fail on the network; committing can fail because the bytes that
 * arrived are not what was promised. Collapsing them into one action would make
 * every one of those "coś poszło nie tak", and would leave an admin with no way
 * to retry the half that failed.
 *
 * AUTHORISATION IS NOT THE PANEL'S DOING. Every entry point calls
 * `requireAdmin()`; the id that arrives from the browser is then looked up and
 * checked against `isAdminManagedMaterial` before anything is minted, so a
 * private import is refused up front rather than discovered when an update
 * matches no rows; the `library_items` update runs on the cookie-bound client so
 * `library_item_writable` re-decides it in the database; and the bucket's own
 * policies refuse a non-admin write. The service-role client appears only for
 * Storage, and only after the caller has been established.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Prepare
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareMaterialCoverInput {
  libraryItemId: string;
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
 * id is the one the database confirmed, the file id comes from
 * `crypto.randomUUID()`, and the extension from a validated type. Accepting a
 * path from the browser would make every later "does this object belong to this
 * material?" check meaningless.
 *
 * A NEW UUID EVERY TIME is the cache story: replacing a cover produces a
 * different public URL, so no CDN or browser can serve the previous picture
 * under it. The old object is removed on commit, once the new one is recorded.
 */
export async function prepareMaterialCoverUpload(
  input: PrepareMaterialCoverInput,
): Promise<ActionResult<PreparedCoverUpload>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "prepareMaterialCoverUpload");
  return prepareFor(admin, input.libraryItemId, input);
}

/** The body of the action, once the caller has been established. */
async function prepareFor(
  admin: AdminClient,
  libraryItemId: string,
  file: { fileName: string; mimeType: string | null; fileSize: number },
): Promise<ActionResult<PreparedCoverUpload>> {
  const check = validateCoverFile({
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.fileSize,
  });
  if (!check.ok) {
    return failCover(check.code, `prepareMaterialCoverUpload: ${libraryItemId}`);
  }

  const item = await loadManagedItem(admin.supabase, libraryItemId);
  if (!item.ok) {
    return failCover(item.code, `prepareMaterialCoverUpload: ${libraryItemId}`);
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return failCover("signed_url_failed", "prepareMaterialCoverUpload: service role", cause);
  }

  const storagePath = coverObjectPath(item.id, crypto.randomUUID(), check.extension);

  const { data: signed, error } = await service.storage
    .from(MATERIAL_COVER_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !signed) {
    return failCover("signed_url_failed", "prepareMaterialCoverUpload: signed url", error);
  }

  return {
    ok: true,
    libraryItemId: item.id,
    storagePath,
    signedUrl: signed.signedUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Commit
// ─────────────────────────────────────────────────────────────────────────────

export interface CommitMaterialCoverInput {
  libraryItemId: string;
  storagePath: string;
}

/**
 * Record an uploaded image as this material's cover.
 *
 * WHAT IS RE-CHECKED, AND WHY EACH ONE. The admin role, because a session can
 * end between two requests. The material, loaded again from the database rather
 * than taken on the browser's word — including that it is still one this panel
 * manages. That the path is one WE could have minted for THIS item — the whole
 * point of choosing paths server-side is lost if the commit accepts any string.
 * And finally the object's own BYTES: the declared MIME type and the extension
 * were both claims a browser made, so the stored file's magic number is the only
 * statement about it the client could not author. An object that turns out to be
 * something else is deleted rather than published in a public bucket.
 *
 * ORDER MATTERS. The new URL is written first and the previous object deleted
 * only after that write succeeds, so a failure never leaves a material with no
 * picture and no way back. An object that outlives its row is a cleanup problem;
 * a row pointing at an object that no longer exists is a broken screen.
 */
export async function commitMaterialCoverUpload(
  input: CommitMaterialCoverInput,
): Promise<ActionResult<{ coverUrl: string }>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "commitMaterialCoverUpload");
  return commitFor(admin, input.libraryItemId, input.storagePath);
}

/** The body of the action, once the caller has been established. */
async function commitFor(
  admin: AdminClient,
  libraryItemId: string,
  storagePath: string,
): Promise<ActionResult<{ coverUrl: string }>> {
  const item = await loadManagedItem(admin.supabase, libraryItemId);
  if (!item.ok) {
    return failCover(item.code, `commitMaterialCoverUpload: ${libraryItemId}`);
  }

  if (!isCoverPathForItem(storagePath, item.id)) {
    return failCover(
      "commit_failed",
      `commitMaterialCoverUpload: foreign path ${storagePath}`,
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return failCover("commit_failed", "commitMaterialCoverUpload: no NEXT_PUBLIC_SUPABASE_URL");
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (cause) {
    return failCover("commit_failed", "commitMaterialCoverUpload: service role", cause);
  }

  const stored = await inspectStoredObject(service, storagePath);
  if (!stored) {
    return failCover("upload_failed", `commitMaterialCoverUpload: missing ${storagePath}`);
  }
  // Anything the bytes do not support is deleted rather than published: an
  // object nobody can decode has no business under a public URL. In every one of
  // these branches the material keeps the cover it already had.
  if (stored.size < MIN_COVER_BYTES || stored.size > MAX_COVER_BYTES) {
    await removeObjects(storagePath);
    return failCover(
      stored.size > MAX_COVER_BYTES ? "file_too_large" : "file_too_small",
      `commitMaterialCoverUpload: rejected ${stored.size} bytes`,
    );
  }
  if (
    !isCoverMimeType(stored.sniffed) ||
    COVER_MIME_EXTENSIONS[stored.sniffed] !== coverPathExtension(storagePath)
  ) {
    await removeObjects(storagePath);
    return failCover(
      "unsupported_type",
      `commitMaterialCoverUpload: bytes say ${stored.sniffed ?? "unknown"}`,
    );
  }

  const coverUrl = coverPublicUrl(supabaseUrl, storagePath);

  // Through the ADMIN'S OWN CLIENT, so `library_item_writable` decides this in
  // the database: an admin may set the artwork of first-party content and of no
  // private import, whatever this code asks for. The two filters repeat that
  // rule rather than relying on it, so a misconfigured policy cannot turn into a
  // write nobody intended.
  const { data: updated, error } = await admin.supabase
    .from("library_items")
    .update({ cover_url: coverUrl })
    .eq("id", item.id)
    .is("owner_user_id", null)
    .neq("rights", "private_import")
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    await removeObjects(storagePath);
    return failCover("commit_failed", `commitMaterialCoverUpload: update ${item.id}`, error);
  }

  // Only now, and only if the old URL was ours AND this material's. A previous
  // URL pointing anywhere else is simply forgotten — see `coverStoragePath`.
  const previous = coverStoragePath(item.coverUrl, supabaseUrl);
  if (previous && previous !== storagePath && isCoverPathForItem(previous, item.id)) {
    await removeObjects(previous);
  }

  revalidateMaterial(item);

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
export async function removeMaterialCover(input: {
  libraryItemId: string;
}): Promise<ActionResult<{ libraryItemId: string }>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "removeMaterialCover");
  return removeFor(admin, input.libraryItemId);
}

/** The body of the action, once the caller has been established. */
async function removeFor(
  admin: AdminClient,
  libraryItemId: string,
): Promise<ActionResult<{ libraryItemId: string }>> {
  const item = await loadManagedItem(admin.supabase, libraryItemId);
  if (!item.ok) return failCover(item.code, `removeMaterialCover: ${libraryItemId}`);

  const { error } = await admin.supabase
    .from("library_items")
    .update({ cover_url: null })
    .eq("id", item.id)
    .is("owner_user_id", null)
    .neq("rights", "private_import");
  if (error) return failCover("remove_failed", `removeMaterialCover: update ${item.id}`, error);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const path = coverStoragePath(item.coverUrl, supabaseUrl);
  if (path && isCoverPathForItem(path, item.id)) {
    await removeObjects(path);
  }

  revalidateMaterial(item);

  return { ok: true, libraryItemId: item.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. The legacy adapter: a passage still knows only its own id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `/admin/texts/[id]` edits a `texts` row and has no library item in hand.
 *
 * THIS IS A TRANSLATION, NOT A SECOND IMPLEMENTATION. Each adapter resolves the
 * passage's library item — creating it through the EXISTING
 * `backfill_library_from_texts()` when the library has not caught up with a
 * just-written passage — and then calls the material action above. Nothing about
 * validation, signing, byte-sniffing or deletion is repeated here, which is what
 * keeps the two admin screens incapable of disagreeing about what a cover is.
 */

export interface PrepareCoverInput {
  textId: number;
  fileName: string;
  mimeType: string | null;
  fileSize: number;
}

export async function prepareTextCoverUpload(
  input: PrepareCoverInput,
): Promise<ActionResult<PreparedCoverUpload>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "prepareTextCoverUpload");

  const resolved = await resolveLegacyItemId(admin, input.textId);
  if (!resolved.ok) return failCover(resolved.code, `prepareTextCoverUpload: ${input.textId}`);

  return prepareFor(admin, resolved.libraryItemId, input);
}

export interface CommitCoverInput {
  textId: number;
  storagePath: string;
}

export async function commitTextCoverUpload(
  input: CommitCoverInput,
): Promise<ActionResult<{ coverUrl: string }>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "commitTextCoverUpload");

  const resolved = await resolveLegacyItemId(admin, input.textId, { backfill: false });
  if (!resolved.ok) return failCover(resolved.code, `commitTextCoverUpload: ${input.textId}`);

  return commitFor(admin, resolved.libraryItemId, input.storagePath);
}

export async function removeTextCover(
  textId: number,
): Promise<ActionResult<{ textId: number }>> {
  const admin = await requireAdminOrNull();
  if (!admin) return failCover("forbidden", "removeTextCover");

  const resolved = await resolveLegacyItemId(admin, textId, { backfill: false });
  if (!resolved.ok) {
    // No library item means no cover to remove. Saying so as a success keeps the
    // button idempotent: pressing it twice is not an error.
    if (resolved.code === "item_missing") return { ok: true, textId };
    return failCover(resolved.code, `removeTextCover: ${textId}`);
  }

  const result = await removeFor(admin, resolved.libraryItemId);
  return result.ok ? { ok: true, textId } : result;
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

/** Everything the actions need about a material, and nothing the client said. */
interface ManagedItem {
  ok: true;
  id: string;
  slug: string;
  coverUrl: string | null;
  legacyTextId: number | null;
}

type LoadedItem = ManagedItem | { ok: false; code: CoverErrorCode };

/**
 * The material this request is about — established from the database.
 *
 * AN ID FROM A BROWSER IS A CLAIM. It is checked for shape, looked up, and then
 * checked for whether this panel manages it at all. RLS would already refuse a
 * private import to an admin, so the miss usually happens one line earlier; the
 * explicit test is here so the refusal has an honest sentence attached to it and
 * so a future policy change cannot quietly turn "an admin cannot read this" into
 * "an admin may redecorate this".
 *
 * `slug` and `legacy_text_id` come along because they are what
 * {@link revalidateMaterial} needs, and a second round trip for two columns
 * already on the row would be pure waste.
 */
async function loadManagedItem(
  supabase: AdminClient["supabase"],
  libraryItemId: string,
): Promise<LoadedItem> {
  if (!isLibraryItemId(libraryItemId)) return { ok: false, code: "item_not_found" };

  const { data, error } = await supabase
    .from("library_items")
    .select("id, slug, cover_url, legacy_text_id, rights, owner_user_id")
    .eq("id", libraryItemId.trim())
    .maybeSingle();
  if (error) {
    console.error("[fluent:covers] could not load the material", error);
    return { ok: false, code: "item_not_found" };
  }
  if (!data) return { ok: false, code: "item_not_found" };

  if (!isAdminManagedMaterial({ ownerUserId: data.owner_user_id, rights: data.rights })) {
    return { ok: false, code: "item_not_editable" };
  }

  return {
    ok: true,
    id: data.id,
    slug: data.slug,
    coverUrl: data.cover_url,
    legacyTextId: data.legacy_text_id,
  };
}

type ResolvedLegacy =
  | { ok: true; libraryItemId: string }
  | { ok: false; code: CoverErrorCode };

/**
 * The library item a passage belongs to, creating it if the library has not
 * caught up yet.
 *
 * THE BACKFILL IS THE EXISTING ONE. An admin who writes a passage in
 * `/admin/texts` creates a `texts` row with no library item;
 * `processPendingChapters` already closes that gap the same way, with the same
 * service-role function. A second "create the item" path here would be a second
 * content model.
 */
async function resolveLegacyItemId(
  admin: AdminClient,
  textId: number,
  options: { backfill?: boolean } = {},
): Promise<ResolvedLegacy> {
  if (!Number.isInteger(textId)) return { ok: false, code: "text_not_found" };

  const { data: text } = await admin.supabase
    .from("texts")
    .select("id")
    .eq("id", textId)
    .maybeSingle();
  if (!text) return { ok: false, code: "text_not_found" };

  const existing = await legacyItemId(admin.supabase, textId);
  if (existing) return { ok: true, libraryItemId: existing };

  if (options.backfill === false) return { ok: false, code: "item_missing" };

  try {
    const service = createServiceRoleSupabaseClient();
    const { error } = await service.rpc("backfill_library_from_texts");
    if (error) console.error("[fluent:covers] backfill failed", error);
  } catch (cause) {
    console.error("[fluent:covers] backfill unavailable", cause);
  }

  const created = await legacyItemId(admin.supabase, textId);
  return created ? { ok: true, libraryItemId: created } : { ok: false, code: "item_missing" };
}

async function legacyItemId(
  supabase: AdminClient["supabase"],
  textId: number,
): Promise<string | null> {
  const { data } = await supabase
    .from("library_items")
    .select("id")
    .eq("legacy_text_id", textId)
    .maybeSingle();
  return data?.id ?? null;
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
 * The admin screens that render it, the shelf, this material's own page, and
 * Today — whose „Kontynuuj naukę" card resolves the artwork server-side. Not the
 * whole cache: a picture does not change a plan, a score or a schedule, and the
 * plan is deliberately left alone because a cover is presentation metadata that
 * was never snapshotted into `daily_plan_items` in the first place.
 *
 * The legacy paths are added only for a material that HAS a passage behind it,
 * so a library-native story does not revalidate a `/learn/null` that does not
 * exist.
 */
function revalidateMaterial(item: ManagedItem): void {
  revalidatePath("/today");
  revalidatePath("/library");
  revalidatePath(`/library/${item.slug}`);
  revalidatePath("/admin/library");

  if (item.legacyTextId !== null) {
    revalidatePath(`/learn/${item.legacyTextId}`);
    revalidatePath(`/admin/texts/${item.legacyTextId}`);
  }
}

function failCover(code: CoverErrorCode, context: string, detail?: unknown) {
  console.error(`[fluent:covers:${code}] ${context}`, detail ?? "");
  return coverFailure(code);
}
