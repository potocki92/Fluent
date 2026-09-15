/**
 * Is this file something Fluent can open?
 *
 * THE FILENAME IS A CLAIM, NOT A FACT. `Roman.pdf` can be a zip, an image, or
 * nothing at all, and the browser's `File.type` is guessed from that same
 * extension on most platforms — including iOS, where a file picked from Files
 * routinely arrives with an empty MIME type. So the extension and the MIME type
 * are used to *order* the checks and the bytes are used to *decide*.
 *
 * Pure, synchronous, no I/O: it is handed the first few hundred bytes and the
 * declared name, and the same function runs in the browser (to stop a pointless
 * 40 MB upload) and on the server (because a browser check is a courtesy).
 */

import {
  MAX_BOOK_IMPORT_BYTES,
  MAX_BOOK_IMPORT_MB,
  MIN_BOOK_IMPORT_BYTES,
} from "@/lib/import/constants";
import type { BookImportFormat, FileIdentity, ImportErrorCode } from "@/lib/import/types";

/** The extensions the picker offers, and the only ones accepted. */
export const ACCEPTED_EXTENSIONS = [".pdf", ".epub", ".txt"] as const;

/** `accept` for the file input. Includes MIME types for desktop browsers. */
export const FILE_INPUT_ACCEPT =
  ".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain";

const EXTENSION_FORMAT: Readonly<Record<string, BookImportFormat>> = {
  pdf: "pdf",
  epub: "epub",
  txt: "txt",
};

const MIME_FORMAT: Readonly<Record<string, BookImportFormat>> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/epub+zip": "epub",
  "text/plain": "txt",
  "text/markdown": "txt",
};

/** How many leading bytes {@link identifyFile} needs. Cheap to read, enough to tell. */
export const MAGIC_BYTE_WINDOW = 64;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

export interface ValidationInput {
  fileName: string;
  /** The browser's declared MIME type. Often empty or wrong; never trusted alone. */
  mimeType: string | null;
  size: number;
  /** At least {@link MAGIC_BYTE_WINDOW} bytes from the start of the file. */
  head: Uint8Array;
}

export type ValidationResult =
  | { ok: true; identity: FileIdentity }
  | { ok: false; code: ImportErrorCode; detail: string };

/** The extension, lowercased, without the dot. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * What the bytes say the file is.
 *
 * PDF and EPUB both have unambiguous signatures. TXT has none by definition, so
 * it is the residual case: no signature, no NUL bytes in the window. The NUL
 * check is what stops a JPEG renamed to `.txt` from being imported as a book of
 * mojibake.
 */
export function sniffFormat(head: Uint8Array): BookImportFormat | null {
  if (startsWith(head, PDF_MAGIC)) return "pdf";
  if (startsWith(head, ZIP_MAGIC)) return "epub";
  // A text file may legitimately start with a BOM; nothing else binary may.
  return head.includes(0) ? null : "txt";
}

/**
 * Decide whether to accept the file, and which extractor it belongs to.
 *
 * The bytes win. The extension and MIME type only contribute `consistent`,
 * which the UI uses to warn ("this looks like a PDF, not an EPUB") without
 * refusing a correctly-formed file someone renamed.
 */
export function validateBookFile(input: ValidationInput): ValidationResult {
  if (input.size < MIN_BOOK_IMPORT_BYTES) {
    return { ok: false, code: "unsupported_format", detail: "file is empty" };
  }
  if (input.size > MAX_BOOK_IMPORT_BYTES) {
    return {
      ok: false,
      code: "file_too_large",
      detail: `${input.size} bytes exceeds ${MAX_BOOK_IMPORT_MB} MB`,
    };
  }

  const byExtension = EXTENSION_FORMAT[fileExtension(input.fileName)] ?? null;
  const byMime = input.mimeType ? (MIME_FORMAT[input.mimeType.toLowerCase()] ?? null) : null;
  const byBytes = sniffFormat(input.head);

  if (!byBytes) {
    return { ok: false, code: "unsupported_format", detail: "binary, not a book" };
  }

  // A zip is an EPUB only if it says so. `mimetype` is stored first and
  // uncompressed by the EPUB spec precisely so it can be read from the head of
  // the file, which is what makes this check possible without unzipping.
  if (byBytes === "epub" && !looksLikeEpubZip(input.head)) {
    return { ok: false, code: "unsupported_format", detail: "zip is not an epub" };
  }

  // A file with no signature is only accepted as text when something else also
  // called it text. Otherwise "no signature" would accept every unknown format.
  if (byBytes === "txt" && byExtension !== "txt" && byMime !== "txt") {
    return { ok: false, code: "unsupported_format", detail: "unrecognised format" };
  }

  return {
    ok: true,
    identity: {
      format: byBytes,
      consistent:
        (byExtension === null || byExtension === byBytes) &&
        (byMime === null || byMime === byBytes),
    },
  };
}

/**
 * Does this zip declare itself an EPUB?
 *
 * EPUB requires the first entry to be an uncompressed file named `mimetype`
 * whose contents are exactly `application/epub+zip`, placed so that it lands at
 * a fixed offset. Reading it here costs nothing and turns "it is a zip" into "it
 * is a book".
 */
function looksLikeEpubZip(head: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(head);
  return text.includes("mimetypeapplication/epub+zip");
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}
