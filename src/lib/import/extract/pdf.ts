/**
 * PDF — the format that knows nothing about itself.
 *
 * WHY `unpdf`. The choice was made against the deployment, not from memory:
 *
 *  - It is Mozilla's `pdf.js` — the same engine every browser renders PDFs with,
 *    and the only PDF text extractor in JavaScript with a decade of real-world
 *    font, encoding and CMap handling behind it. German text in an embedded
 *    subset font comes out as `ä`, not as a private-use code point, because
 *    pdf.js knows about ToUnicode maps.
 *  - It ships a build of pdf.js with the browser-only parts removed (no canvas,
 *    no DOM, no worker file to serve), which is what makes it usable in a
 *    serverless Node function at all. `pdfjs-dist` itself needs a worker URL and
 *    a canvas polyfill; `pdf-parse` wraps a 2016 fork of pdf.js.
 *  - It has no dependencies, so adding it adds one package rather than thirty.
 *
 * A PYTHON SERVICE WAS NOT NEEDED. The tempting move with PDFs is to reach for
 * `pdfminer`/`PyMuPDF` and a second deployment; nothing here justifies it. Text
 * extraction from a digital PDF is the one thing pdf.js does extremely well, and
 * a separate service would buy nothing but an operational surface.
 *
 * AI COSTS NOTHING HERE. A digital PDF has a text layer; reading it is
 * arithmetic. Sending a book to a language model so that it can retype the book
 * would be the most expensive possible way to do a free operation, and it would
 * send a learner's private file to a third party for no benefit. It is not done.
 *
 * WHAT COMES OUT. Pages, with their text and their page numbers, and nothing
 * else. Font sizes and glyph positions are available from pdf.js and are
 * deliberately not collected: the only use for them would be heading detection,
 * `cleanup/` already recovers the structural signals that matter (isolation,
 * page position, line length), and a richer model here would mean a second,
 * position-aware code path in the detector that only PDFs could exercise.
 *
 * SERVER ONLY. `unpdf` is a Node-side package and is never imported from a
 * `"use client"` module.
 */

import type {
  BookExtractor,
  ExtractedBook,
  ExtractedPage,
  FileIdentity,
} from "@/lib/import/types";

export const pdfExtractor: BookExtractor = {
  format: "pdf",

  canHandle(identity: FileIdentity): boolean {
    return identity.format === "pdf";
  },

  async extract(bytes: Uint8Array): Promise<ExtractedBook> {
    // Imported lazily so that the PDF engine is only loaded by a request that
    // has a PDF in it — an EPUB import should not pay for it, and neither
    // should the rest of the app's cold start.
    const { extractText, getDocumentProxy } = await import("unpdf");

    const document = await getDocumentProxy(copy(bytes));
    const { text } = await extractText(document, { mergePages: false });

    const pages: ExtractedPage[] = (Array.isArray(text) ? text : [text]).map(
      (pageText, index) => ({ number: index + 1, text: pageText ?? "" }),
    );

    return {
      format: "pdf",
      pages,
      metadata: await readMetadata(document),
      pageCount: document.numPages,
      // A PDF declares no chapters. Whatever structure it has is typographic,
      // and recovering it is `chapters/detect.ts`'s job.
      declaredChapters: [],
    };
  },
};

/**
 * pdf.js takes ownership of the buffer it is given and leaves it detached.
 *
 * The same bytes are needed afterwards — for the hash, and for a retry with a
 * different extractor — so it gets a copy rather than the caller's array.
 */
function copy(bytes: Uint8Array): Uint8Array {
  const clone = new Uint8Array(bytes.length);
  clone.set(bytes);
  return clone;
}

/**
 * Minimal typing of the parts of the pdf.js document proxy used here.
 *
 * `info` is typed as `unknown` rather than as pdf.js's own `Object`: the
 * document information dictionary is whatever the producer wrote into the file,
 * so treating it as a known shape would be a lie the compiler would then help
 * spread. It is narrowed one key at a time by {@link cleanMetadataValue}.
 */
interface PdfDocument {
  numPages: number;
  getMetadata(): Promise<{ info?: unknown }>;
}

/**
 * The document information dictionary — `/Title`, `/Author`.
 *
 * Often wrong, frequently the name of the typesetting program, and sometimes
 * the filename of an InDesign document. It is used as a SUGGESTION in the
 * preview, where the learner corrects it in one field, and never as a fact.
 *
 * A failure here is not a failure of the import: a PDF whose metadata cannot be
 * read is still a PDF whose text was extracted.
 */
async function readMetadata(document: PdfDocument): Promise<ExtractedBook["metadata"]> {
  try {
    const { info } = await document.getMetadata();
    const fields = (info ?? {}) as Record<string, unknown>;
    return {
      title: cleanMetadataValue(fields.Title),
      author: cleanMetadataValue(fields.Author),
      language:
        typeof fields.Language === "string" ? fields.Language.slice(0, 2) : null,
    };
  } catch {
    return { title: null, author: null, language: null };
  }
}

/**
 * Reject the metadata values that are worse than nothing.
 *
 * `Microsoft Word - Roman.doc`, `untitled`, a bare filename with an extension:
 * offering these as the book's title makes a learner delete text before they can
 * type, which is worse than an empty field they can fill.
 */
function cleanMetadataValue(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || trimmed.length > 200) return null;
  if (/^(untitled|unknown|microsoft word|document\d*)$/i.test(trimmed)) return null;
  if (/\.(docx?|indd|pdf|qxd|tex)$/i.test(trimmed)) return null;
  if (/^microsoft word\s*-\s*/i.test(trimmed)) return null;

  return trimmed;
}
