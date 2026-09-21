/**
 * Material artwork — what a cover file may be, where its bytes live, and how a
 * stored URL maps back to the object behind it.
 *
 * ONE SOURCE OF TRUTH FOR THE IMAGE ITSELF. A material's artwork is
 * `library_items.cover_url` and nothing else. The column already existed for
 * books; a passage reaches it through `library_items.legacy_text_id`, which is
 * the same mapping questions, attempts and today's plan already travel. A
 * second `texts.image_url` would be a second answer to "what does this material
 * look like?", and the two would disagree the first time a passage was imported,
 * renamed or reprocessed.
 *
 * ONE PLACE FOR THE NUMBERS, like `src/lib/import/constants.ts` and
 * `src/lib/reading/constants.ts`: the size cap, the accepted types and the
 * storage layout are read by the browser (so nobody waits to upload a file the
 * server was always going to refuse), by the Server Action (because a check in a
 * browser is a courtesy, not a control) and by the Storage bucket itself. A
 * limit written three times is a limit that drifts.
 *
 * PURE. No Supabase, no environment, no React — every function here is a
 * function of its arguments, which is what makes the path rules testable.
 */

import type { FluentErrorCode, FluentFailure } from "@/lib/errors";

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The public bucket cover images live in.
 *
 * PUBLIC IS THE POINT, and it is not the same decision as the importer's. These
 * are the artwork of published teaching material — the same bytes every learner
 * is meant to see — so serving them from a CDN URL rather than minting a signed
 * URL per render is both cheaper and simpler. WRITES are another matter
 * entirely: insert, update and delete on this bucket are admin-only, enforced by
 * Storage policies rather than by which button the panel renders.
 */
export const MATERIAL_COVER_BUCKET = "content-covers";

/** Marker Supabase puts in every public object URL. Part of the contract below. */
const PUBLIC_OBJECT_PREFIX = "/storage/v1/object/public/";

/**
 * Every managed object lives under `library/<library_item_id>/`.
 *
 * The prefix is what makes "is this object ours to delete?" answerable from the
 * path alone — see {@link isCoverPathForItem}. The server picks the whole path;
 * a client never supplies one.
 */
const COVER_PATH_ROOT = "library";

// ─────────────────────────────────────────────────────────────────────────────
// What a cover file may be
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The accepted types, and the extension each one is stored under.
 *
 * AVIF is deliberately absent: `next/image` would serve it happily, but the
 * admin panel's own preview, the byte-type check below and the bucket's
 * allow-list would all have to agree about a format Fluent has never produced,
 * for a gain of a few kilobytes on an image that is at most 104 px wide on
 * screen.
 */
export const COVER_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type CoverMimeType = keyof typeof COVER_MIME_EXTENSIONS;

export const COVER_MIME_TYPES = Object.keys(COVER_MIME_EXTENSIONS) as CoverMimeType[];

/** What `<input type="file">` offers, so the picker does the first filtering. */
export const COVER_FILE_INPUT_ACCEPT = COVER_MIME_TYPES.join(",");

/** Extension → the type it claims to be. `jpeg` and `jpg` are the same file. */
const COVER_EXTENSION_MIME: Readonly<Record<string, CoverMimeType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The largest cover Fluent accepts, in megabytes.
 *
 * Generous for what the image is used as — a 104 px thumbnail and a faded
 * backdrop — and deliberately so: an admin should be able to drop the photo
 * their camera produced without opening an editor first. What it is not is a
 * licence to store a 40 MB scan.
 */
export const MAX_COVER_MB = 5;

/**
 * Duplicated once, in the bucket's own `file_size_limit`
 * (`supabase/migrations/20260921120000_material_covers.sql`), because Storage
 * cannot import a TypeScript constant. Change both together.
 */
export const MAX_COVER_BYTES = MAX_COVER_MB * 1024 * 1024;

/** Below this there is no image here — an empty file, or a failed export. */
export const MIN_COVER_BYTES = 512;

/**
 * What the panel asks for, and what the card actually renders.
 *
 * The thumbnail is 4:3 and small; the ambient backdrop is the same bytes,
 * blurred. Neither needs a big file, but a cover that is smaller than the
 * thumbnail's densest rendering looks soft on a phone, so the copy asks for
 * something comfortably larger.
 */
export const RECOMMENDED_COVER_WIDTH = 1200;
export const RECOMMENDED_COVER_HEIGHT = 900;
export const MIN_USEFUL_COVER_WIDTH = 800;
export const MIN_USEFUL_COVER_HEIGHT = 600;

// ─────────────────────────────────────────────────────────────────────────────
// Failures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What can go wrong with a cover, in terms the admin panel can act on.
 *
 * Distinct from {@link import("@/lib/errors").FluentErrorCode} for the same
 * reason the importer keeps its own codes: "Nie masz dostępu do tego testu." is
 * the wrong sentence to show someone whose PNG was 9 MB. The mapping back onto
 * the shared taxonomy is {@link COVER_FLUENT_CODES}, so a cover failure is still
 * an ordinary `ActionResult` the UI already knows how to branch on.
 */
export type CoverErrorCode =
  | "unsupported_type"
  | "file_too_large"
  | "file_too_small"
  | "forbidden"
  | "text_not_found"
  | "item_missing"
  | "signed_url_failed"
  | "upload_failed"
  | "commit_failed"
  | "remove_failed";

/** Polish copy for the admin panel. No SQLSTATE, no `StorageApiError`. */
export const COVER_ERROR_MESSAGES: Readonly<Record<CoverErrorCode, string>> = {
  unsupported_type: "Nieobsługiwany format. Wybierz plik JPG, PNG lub WebP.",
  file_too_large: `Plik jest za duży. Maksymalnie ${MAX_COVER_MB} MB.`,
  file_too_small: "Ten plik wygląda na pusty lub uszkodzony.",
  forbidden: "Nie masz uprawnień do zmiany obrazu materiału.",
  text_not_found: "Nie znaleźliśmy tego tekstu.",
  item_missing: "Nie udało się powiązać tekstu z biblioteką. Zapisz tekst i spróbuj ponownie.",
  signed_url_failed: "Nie udało się przygotować przesyłania. Spróbuj ponownie.",
  upload_failed: "Nie udało się przesłać obrazu. Spróbuj ponownie.",
  commit_failed: "Obraz został przesłany, ale nie udało się go zapisać. Spróbuj ponownie.",
  remove_failed: "Nie udało się usunąć obrazu. Spróbuj ponownie.",
};

/**
 * How a cover failure reads to code that only knows the shared taxonomy.
 *
 * The UI branches on `ok` and renders `message`; anything that inspects `code`
 * — a retry rule, a redirect to sign-in — still sees a {@link FluentErrorCode}
 * that means what it always meant.
 */
const COVER_FLUENT_CODES: Readonly<Record<CoverErrorCode, FluentErrorCode>> = {
  unsupported_type: "invalid_input",
  file_too_large: "invalid_input",
  file_too_small: "invalid_input",
  forbidden: "forbidden",
  text_not_found: "not_found",
  item_missing: "stale_state",
  signed_url_failed: "config_error",
  upload_failed: "database_error",
  commit_failed: "database_error",
  remove_failed: "database_error",
};

/** A cover failure, shaped like every other Server Action failure. */
export function coverFailure(code: CoverErrorCode): FluentFailure {
  return {
    ok: false,
    code: COVER_FLUENT_CODES[code],
    message: COVER_ERROR_MESSAGES[code],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export type CoverValidation =
  | { ok: true; mimeType: CoverMimeType; extension: string }
  | { ok: false; code: CoverErrorCode };

export interface CoverCandidate {
  fileName: string;
  /** `File.type`, which a mobile picker is allowed to leave empty. */
  mimeType: string | null;
  size: number;
}

/**
 * Is this a cover Fluent will store?
 *
 * THE EXTENSION IS NOT THE ANSWER, and neither is the declared MIME type on its
 * own — a browser will report whatever the OS associates with `.png`. So both
 * are checked, and both must AGREE: `photo.png` announced as `image/jpeg` is
 * refused rather than quietly stored under the wrong extension, which is how a
 * CDN ends up serving a file no browser will decode. A picker that reports no
 * type at all (Android, mostly) falls back to the extension, and the real bytes
 * are confirmed server-side after the upload, from what Storage itself saw.
 */
export function validateCoverFile(candidate: CoverCandidate): CoverValidation {
  if (!Number.isFinite(candidate.size) || candidate.size < MIN_COVER_BYTES) {
    return { ok: false, code: "file_too_small" };
  }
  if (candidate.size > MAX_COVER_BYTES) {
    return { ok: false, code: "file_too_large" };
  }

  const extension = fileExtension(candidate.fileName);
  const fromExtension = extension ? COVER_EXTENSION_MIME[extension] : undefined;
  if (!fromExtension) return { ok: false, code: "unsupported_type" };

  const declared = (candidate.mimeType ?? "").trim().toLowerCase();
  if (declared) {
    if (!isCoverMimeType(declared)) return { ok: false, code: "unsupported_type" };
    if (declared !== fromExtension) return { ok: false, code: "unsupported_type" };
  }

  const mimeType = declared ? (declared as CoverMimeType) : fromExtension;
  return { ok: true, mimeType, extension: COVER_MIME_EXTENSIONS[mimeType] };
}

export function isCoverMimeType(value: string | null | undefined): value is CoverMimeType {
  return typeof value === "string" && value in COVER_MIME_EXTENSIONS;
}

/** How many leading bytes {@link sniffCoverType} needs. WebP's tag ends at 12. */
export const COVER_MAGIC_WINDOW = 16;

/**
 * What the bytes actually are.
 *
 * The declared type and the extension are both claims made by a browser; this
 * is the only statement about the file that the client cannot author. It runs
 * server-side on the stored object, after the upload, and it is what decides
 * whether the image becomes a cover or is deleted again.
 *
 * Three signatures, one per accepted format — JPEG's SOI, PNG's eight-byte
 * header, and WebP's `RIFF….WEBP` container tag.
 */
export function sniffCoverType(head: Uint8Array): CoverMimeType | null {
  const at = (index: number) => head[index];

  if (head.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return "image/jpeg";
  }

  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= PNG.length && PNG.every((byte, index) => at(index) === byte)) {
    return "image/png";
  }

  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(head.slice(from, to)));
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }

  return null;
}

function fileExtension(fileName: string): string | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Object paths
// ─────────────────────────────────────────────────────────────────────────────

/** `library/<item id>/`, the only prefix a material's covers ever occupy. */
export function coverPathPrefix(libraryItemId: string): string {
  return `${COVER_PATH_ROOT}/${libraryItemId}/`;
}

/**
 * Where a new cover goes.
 *
 * A FRESH NAME EVERY TIME, which is the whole cache story. Overwriting
 * `cover.jpg` at a stable public URL leaves the CDN and every browser that has
 * seen it serving yesterday's picture, and `?v=2` only moves the problem to
 * whoever copied the URL. A new id means a new URL, so replacing a cover
 * invalidates itself; the previous object is deleted only once the new one is
 * safely recorded.
 *
 * `fileId` is passed in rather than generated here so this stays a pure
 * function — the caller supplies `crypto.randomUUID()`.
 */
export function coverObjectPath(
  libraryItemId: string,
  fileId: string,
  extension: string,
): string {
  return `${coverPathPrefix(libraryItemId)}${fileId}.${extension}`;
}

const COVER_PATH_PATTERN =
  /^library\/([0-9a-fA-F-]{36})\/([0-9a-zA-Z][0-9a-zA-Z-]{0,63})\.(jpg|png|webp)$/;

/**
 * Does this path belong to this material, and is it a path we minted?
 *
 * THE GUARD ON EVERY DESTRUCTIVE STEP. A commit is handed a path by the browser
 * and a removal reads one back out of the database; both go through here first,
 * so the worst a tampered request can do is address an object under the item it
 * already has admin rights over — never `../`, never another material's folder,
 * and never an arbitrary object elsewhere in the bucket.
 */
export function isCoverPathForItem(path: string, libraryItemId: string): boolean {
  const match = COVER_PATH_PATTERN.exec(path);
  return match !== null && match[1].toLowerCase() === libraryItemId.toLowerCase();
}

/**
 * Is this a path this feature could have minted at all?
 *
 * The weaker half of {@link isCoverPathForItem}, for the one caller that has
 * already established the item and only needs to know that a delete is aimed at
 * a managed object rather than at something else in the bucket.
 */
export function isManagedCoverPath(path: string): boolean {
  return COVER_PATH_PATTERN.test(path);
}

/** The extension a managed path was minted with, for checking it against bytes. */
export function coverPathExtension(path: string): string | null {
  const match = COVER_PATH_PATTERN.exec(path);
  return match ? match[3] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public URLs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The public URL an object is stored under.
 *
 * Built here rather than taken from `getPublicUrl()` so that the shape is one
 * thing the tests can pin: `next.config.ts` allows exactly this prefix to
 * `next/image`, and {@link coverStoragePath} has to be able to walk it back.
 */
export function coverPublicUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}${PUBLIC_OBJECT_PREFIX}${MATERIAL_COVER_BUCKET}/${path}`;
}

/**
 * The object behind a stored `cover_url`, or `null` if it is not ours.
 *
 * `cover_url` is a general column. It holds what this feature wrote today, and
 * it may hold a publisher's URL for a book tomorrow — so deletion may never
 * assume the URL addresses something Fluent owns. Anything that is not a URL
 * under OUR project's public prefix for OUR bucket resolves to `null`, and the
 * caller then clears the column without touching Storage at all.
 *
 * `expectedOrigin` is the project's own Supabase URL. Without it a URL that
 * merely imitates the path shape on another host would look managed; with it,
 * origin and bucket both have to match.
 */
export function coverStoragePath(
  coverUrl: string | null | undefined,
  expectedOrigin: string,
): string | null {
  if (!coverUrl) return null;

  let url: URL;
  let origin: URL;
  try {
    url = new URL(coverUrl);
    origin = new URL(expectedOrigin);
  } catch {
    return null;
  }

  if (url.origin !== origin.origin) return null;

  const marker = `${PUBLIC_OBJECT_PREFIX}${MATERIAL_COVER_BUCKET}/`;
  if (!url.pathname.startsWith(marker)) return null;

  const path = decodeURIComponent(url.pathname.slice(marker.length));
  if (!path || path.includes("..")) return null;
  return path;
}
