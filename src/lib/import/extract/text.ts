/**
 * Plain text in, plain text out — and the one thing that can go wrong.
 *
 * ENCODING. A `.txt` file carries no declaration of what its bytes mean.
 * Decoding a Windows-1252 German file as UTF-8 turns every `ä` into a
 * replacement character, and decoding a UTF-8 file as Windows-1252 turns it into
 * `Ã¤` — both irreversible, both silent, and both destroy exactly the characters
 * Fluent exists to teach. So the decode is attempted STRICTLY as UTF-8 first
 * (`fatal: true`, which throws on an invalid sequence rather than substituting),
 * and only a file that is genuinely not UTF-8 falls back to Windows-1252, the
 * encoding every German text editor wrote before 2010.
 *
 * ONE PAGE. A text file has no pages, so it is one — which makes running-head
 * detection a no-op on it, correctly, since a text file has no running heads.
 */

import type { BookExtractor, ExtractedBook, FileIdentity } from "@/lib/import/types";

export const textExtractor: BookExtractor = {
  format: "txt",

  canHandle(identity: FileIdentity): boolean {
    return identity.format === "txt";
  },

  async extract(bytes: Uint8Array): Promise<ExtractedBook> {
    const text = decode(bytes);
    if (!text.trim()) throw new Error("text file is empty");

    return {
      format: "txt",
      pages: [{ number: 1, text }],
      metadata: { title: null, author: null, language: null },
      pageCount: null,
      declaredChapters: [],
    };
  },
};

/** UTF-8 if it is valid UTF-8, Windows-1252 otherwise. Never lossy-UTF-8. */
function decode(bytes: Uint8Array): string {
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return stripBom(new TextDecoder("windows-1252").decode(bytes));
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
