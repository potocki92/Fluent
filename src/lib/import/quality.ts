/**
 * Did extraction actually work?
 *
 * A PDF has two failure modes that look identical to code and completely
 * different to a person: a scan, where there is no text to extract, and a broken
 * embedded encoding, where there is text and it is gibberish. Both produce a
 * file that "imported successfully" and a book nobody can read, so both are
 * measured here before anything is persisted.
 *
 * NO SINGLE PERCENTAGE. "Extraction quality: 72%" tells a learner nothing and
 * invites them to treat an arithmetic mean as a measurement. What is computed
 * instead are the two facts that lead to different screens — "this is a scan"
 * (refuse, and explain) and "this may be garbled" (warn, and show two sentences
 * of it) — plus the samples themselves, because a person reading two lines of
 * their own book is a better judge than any ratio.
 *
 * NOT A SECOND MATCH RATE. Fluent already measures how much of a chapter's
 * vocabulary it can gloss: `dictionary_match_rate`, computed by the content
 * pipeline after processing, shown in the admin inspector and on the chapter.
 * Computing a second, differently-defined one here would give the project two
 * numbers that disagree about the same book.
 *
 * Pure.
 */

import {
  GARBAGE_CHAR_WARNING_RATIO,
  MIN_EXTRACTED_WORDS,
  OCR_MIN_CHARS_PER_PAGE,
  OCR_SCANNED_PAGE_RATIO,
  QUALITY_SAMPLE_CHARS,
  QUALITY_SAMPLE_COUNT,
} from "@/lib/import/constants";
import { countWords } from "@/lib/content/paragraphs";
import type { ExtractedPage, ExtractionQuality } from "@/lib/import/types";

/**
 * Characters that are never German prose.
 *
 * The replacement character and the private-use area are what a PDF with a
 * broken embedded font produces: every glyph maps to a code point that means
 * nothing. Counting them is the difference between "this book is in Cyrillic"
 * and "this book has no usable encoding".
 */
const GARBAGE_CHARS = new RegExp(
  "[" +
    "\ufffd" +                    // the replacement character
    "\ue000-\uf8ff" +           // the private use area
    "\u0000-\u0008\u000e-\u001f" +  // C0 controls
    "]",
  "g",
);

/** Measure how well the text came out. */
export function assessExtraction(pages: readonly ExtractedPage[]): ExtractionQuality {
  const totalPages = pages.length;
  let totalChars = 0;
  let garbage = 0;
  let sparsePages = 0;
  let wordCount = 0;

  for (const page of pages) {
    const text = page.text;
    totalChars += text.length;
    garbage += text.match(GARBAGE_CHARS)?.length ?? 0;
    wordCount += countWords(text);
    if (text.trim().length < OCR_MIN_CHARS_PER_PAGE) sparsePages += 1;
  }

  const garbageRatio = totalChars === 0 ? 1 : garbage / totalChars;

  return {
    totalChars,
    wordCount,
    sparsePages,
    totalPages,
    garbageRatio: Math.round(garbageRatio * 10000) / 10000,
    looksScanned: isScanned(sparsePages, totalPages, wordCount),
    looksGarbled: garbageRatio > GARBAGE_CHAR_WARNING_RATIO && wordCount > 0,
    samples: takeSamples(pages),
  };
}

/**
 * Is this a scan?
 *
 * Two independent ways to be one, because a 400-page scan and a two-page scan
 * fail differently. Almost every page nearly empty is the first; not enough
 * words to be a book at all is the second, and catches the file whose single
 * page of extracted text is the copyright notice baked into the scanner output.
 */
function isScanned(sparsePages: number, totalPages: number, wordCount: number): boolean {
  if (wordCount < MIN_EXTRACTED_WORDS) return true;
  if (totalPages === 0) return true;
  return sparsePages / totalPages >= OCR_SCANNED_PAGE_RATIO;
}

/**
 * A couple of verbatim passages from the middle of the book.
 *
 * From the middle on purpose: page one is a title page in every book ever
 * printed, and a title page extracts cleanly even when the body does not.
 */
function takeSamples(pages: readonly ExtractedPage[]): string[] {
  const substantial = pages.filter(
    (page) => page.text.trim().length >= OCR_MIN_CHARS_PER_PAGE,
  );
  if (substantial.length === 0) return [];

  const samples: string[] = [];
  for (let i = 1; i <= QUALITY_SAMPLE_COUNT; i += 1) {
    const page = substantial[Math.floor((substantial.length * i) / (QUALITY_SAMPLE_COUNT + 1))];
    if (!page) continue;
    const text = page.text.replace(/\s+/g, " ").trim().slice(0, QUALITY_SAMPLE_CHARS);
    if (text && !samples.includes(text)) samples.push(text);
  }

  return samples;
}
