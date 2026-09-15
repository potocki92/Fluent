/**
 * The cleanup pipeline: extracted text → the paragraphs of a book.
 *
 *     ExtractedPage[]
 *        ↓ sanitise      control characters, duplicated pages
 *        ↓ lines         per-page lines that know their edges and measure
 *        ↓ furniture     running heads, running feet, folios
 *        ↓ wrap          line breaks → paragraphs, hyphens resolved
 *        = CleanBlock[]
 *
 * WHY THIS IS A SEPARATE PIPELINE from `src/lib/content/`. They solve opposite
 * problems. `src/lib/content/` turns clean prose into structure a reader can
 * point at — paragraphs, sentences, occurrences — and assumes its input is text
 * somebody wrote. This turns a printed artefact back into prose somebody wrote,
 * and assumes nothing. Merging them would mean the sentence splitter had to know
 * about page numbers, which is how a tokenizer acquires a second job and stops
 * being testable.
 *
 * The handoff is a string. {@link cleanedText} produces exactly what
 * `processChapterContent` expects — blank-line separated paragraphs — so there
 * is one content pipeline downstream and this one stops at its door.
 *
 * Pure and deterministic: the same extracted pages always produce the same
 * blocks, which is what lets `IMPORT_PIPELINE_VERSION` mean anything.
 */

import { bookMeasure, toSourceLines, type SourcePage } from "@/lib/import/cleanup/lines";
import { stripPageFurniture } from "@/lib/import/cleanup/running-heads";
import { joinWrappedLines, type CleanBlock } from "@/lib/import/cleanup/wrap";
import type { ExtractedPage } from "@/lib/import/types";

export type { CleanBlock } from "@/lib/import/cleanup/wrap";

/**
 * Characters that are never content.
 *
 * C0 and C1 controls (except tab and newline), the Unicode replacement
 * character, and the zero-width/soft-hyphen family. Left in, each of them ends
 * up inside a token and stops an ordinary German word from matching the
 * dictionary — the class of bug `src/lib/content/normalize.ts` exists to
 * prevent downstream, applied here at the source.
 *
 * NOTE the deliberate omission: U+00AD (soft hyphen) is NOT stripped here. It
 * is a line-break instruction and `wrap.ts` reads it as one; removing it first
 * would turn `Kran<U+00AD>\nkenhaus` into an unjoinable pair.
 */
const CONTROL_CHARS = new RegExp(
  "[" +
    "\u0000-\u0008\u000b-\u001f" +  // C0 controls, tab and newline excepted
    "\u007f-\u009f" +                // DEL and the C1 block
    "\ufffd" +                       // the replacement character
    "\u200b-\u200f\u2060\ufeff" +   // zero-width and BOM
    "]",
  "g",
);

export interface CleanedBook {
  blocks: CleanBlock[];
  /** Pages that survived sanitising. Duplicates are dropped, so this can shrink. */
  pageCount: number;
}

/** Run the whole cleanup pipeline. */
export function cleanExtractedPages(pages: readonly ExtractedPage[]): CleanedBook {
  const sanitised = dropDuplicatePages(pages).map((page) =>
    toSourceLines(page.number, page.text.replace(CONTROL_CHARS, "")),
  );

  const withMeasure = applyBookMeasure(sanitised);
  const stripped = stripPageFurniture(withMeasure);

  return { blocks: joinWrappedLines(stripped), pageCount: sanitised.length };
}

/**
 * Give short pages the book's measure rather than their own.
 *
 * The last page of a chapter has four lines on it, and its own median says the
 * measure is 30 characters — which would make every one of those four lines
 * "full" and join a chapter's closing paragraph to whatever follows. Pages
 * shorter than the median of the book borrow the book's number, because the
 * column width is a property of the book and not of the page.
 */
function applyBookMeasure(pages: readonly SourcePage[]): SourcePage[] {
  const measure = bookMeasure(pages);
  return pages.map((page) => ({
    ...page,
    measure: Math.max(page.measure, measure),
  }));
}

/**
 * Drop a page whose text repeats the page before it.
 *
 * Some PDF producers emit a page's text twice — a transparent overlay, an OCR
 * layer sitting on top of a text layer, a print-ready file with a duplicated
 * form XObject. Left in, the book contains every paragraph twice, and a learner
 * reads the same page and thinks Fluent is broken.
 *
 * Only ADJACENT duplicates, and only exact ones after whitespace folding. Two
 * genuinely identical non-adjacent pages are conceivable (a blank-ish plate, a
 * part title); two identical pages in a row are not.
 */
function dropDuplicatePages(pages: readonly ExtractedPage[]): ExtractedPage[] {
  const kept: ExtractedPage[] = [];
  let previousKey: string | null = null;

  for (const page of pages) {
    const key = page.text.replace(/\s+/g, " ").trim();
    if (key && key === previousKey) continue;
    kept.push(page);
    previousKey = key;
  }

  return kept;
}

/**
 * Blocks → the source text a chapter stores.
 *
 * Blank-line separated, which is the one convention
 * `src/lib/content/paragraphs.ts` reads. Nothing else is encoded: no markers, no
 * page numbers, no markup. The chapter's text is the book's text.
 */
export function cleanedText(blocks: readonly CleanBlock[]): string {
  return blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
}
