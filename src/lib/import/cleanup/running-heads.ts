/**
 * Deleting the furniture: running heads, running feet and page numbers.
 *
 * A printed page carries text that is not part of the book — the title at the
 * top of every verso, the author at the top of every recto, the page number at
 * the foot. Extraction cannot tell them from prose, so they arrive in the middle
 * of the text stream and, left alone, end up inside a sentence: "…und ging
 * hinaus. DER PROZESS 147 Am nächsten Morgen…".
 *
 * THE RULE, and the reason this is not just "delete frequent lines":
 *
 *   A line is furniture when it is SHORT, sits at the EDGE of its page, and
 *   repeats across MOST pages of the book.
 *
 * All three conditions matter. Frequency alone would delete a refrain, a
 * repeated line of dialogue, or the one-word paragraph an author uses for
 * emphasis. Position alone would delete the first sentence of every chapter.
 * Length alone would delete every short sentence in the book.
 *
 * PAGE NUMBERS get their own rule, because they are never identical twice.
 * A numeral alone on a line at a page edge is only removed when the numbers
 * across the book AGREE — when `value - pageIndex` is the same constant on
 * several pages, that constant is the book's front-matter offset and the line is
 * a folio. A single stray "1914" alone on a line is left exactly where it is.
 *
 * Pure. Takes pages, returns pages, decides nothing about paragraphs.
 */

import {
  PAGE_EDGE_LINES,
  RUNNING_HEAD_MAX_CHARS,
  RUNNING_HEAD_MIN_PAGES,
  RUNNING_HEAD_PAGE_RATIO,
} from "@/lib/import/constants";
import type { SourceLine, SourcePage } from "@/lib/import/cleanup/lines";

/** Which edge a candidate was found at. Heads and feet are counted separately. */
type Edge = "top" | "bottom";

/**
 * Remove running heads, running feet and folios from every page.
 *
 * Returns new pages; the input is not modified. Positions (`fromTop`,
 * `fromBottom`) are NOT recomputed — nothing downstream re-reads them after this
 * step, and recomputing would invite the mistake of running head detection twice
 * over its own output.
 */
export function stripPageFurniture(pages: readonly SourcePage[]): SourcePage[] {
  const heads = repeatedEdgeLines(pages, "top");
  const feet = repeatedEdgeLines(pages, "bottom");
  const folioOffset = detectFolioOffset(pages);

  return pages.map((page) => ({
    ...page,
    lines: page.lines.filter((line) => {
      if (!line.text) return true;
      if (!atEdge(line)) return true;

      const edge: Edge = line.fromTop < PAGE_EDGE_LINES ? "top" : "bottom";
      const repeated = edge === "top" ? heads : feet;
      if (repeated.has(furnitureKey(line.text))) return false;

      return !isFolio(line, folioOffset);
    }),
  }));
}

/** Within {@link PAGE_EDGE_LINES} of either end of its page. */
function atEdge(line: SourceLine): boolean {
  return line.fromTop < PAGE_EDGE_LINES || line.fromBottom < PAGE_EDGE_LINES;
}

/**
 * The comparison key for "the same running head".
 *
 * Digits are dropped because a running head very often carries the folio
 * (`DER PROZESS    147`), and comparing those literally would find no repeats at
 * all. Case and punctuation go for the same reason: a head set in small caps on
 * one page and full caps on another is one head.
 */
function furnitureKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The short edge lines that repeat across enough of the book to be furniture.
 *
 * A page may contribute a key only ONCE per edge, so a poem that repeats a line
 * four times on one page cannot vote four times for its own deletion.
 */
function repeatedEdgeLines(pages: readonly SourcePage[], edge: Edge): Set<string> {
  if (pages.length < RUNNING_HEAD_MIN_PAGES) return new Set();

  const counts = new Map<string, number>();

  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) {
      if (!line.text || line.text.length > RUNNING_HEAD_MAX_CHARS) continue;

      const distance = edge === "top" ? line.fromTop : line.fromBottom;
      if (distance < 0 || distance >= PAGE_EDGE_LINES) continue;

      const key = furnitureKey(line.text);
      // A key that is nothing but digits is a folio, handled below — counting it
      // here would make every numbered book "repeat" an empty key on every page.
      if (!key) continue;
      seen.add(key);
    }
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const threshold = pages.length * RUNNING_HEAD_PAGE_RATIO;
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([key]) => key),
  );
}

/** A line that is nothing but a page number, in any of the usual dressings. */
const FOLIO_RE = /^[[(\-–—|]*\s*(\d{1,4})\s*[\])\-–—|]*$/;

/** Roman folios: the `vii` of a preface. Lowercase only — `I` is a word. */
const ROMAN_FOLIO_RE = /^[[(\-–—|]*\s*([ivxlcdm]{1,7})\s*[\])\-–—|]*$/;

/**
 * The constant offset between printed folios and page indices, if the book has
 * one.
 *
 * Front matter is usually unnumbered or numbered in Roman, so page 13 of the PDF
 * is page 1 of the novel and every folio is `index - 12`. Finding that constant
 * is what makes folio removal safe: a numeral that does not fit the book's own
 * numbering is left alone, which is the difference between deleting a folio and
 * deleting a year.
 *
 * Returns null when the book has no consistent numbering — in which case no
 * numeral is removed at all.
 */
function detectFolioOffset(pages: readonly SourcePage[]): number | null {
  if (pages.length < RUNNING_HEAD_MIN_PAGES) return null;

  const offsets = new Map<number, number>();

  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.text || !atEdge(line)) continue;
      const match = line.text.match(FOLIO_RE);
      if (!match) continue;
      const offset = Number(match[1]) - page.number;
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
  }

  let best: { offset: number; count: number } | null = null;
  for (const [offset, count] of offsets) {
    if (!best || count > best.count || (count === best.count && offset > best.offset)) {
      best = { offset, count };
    }
  }

  // Three agreeing pages. Two could be a coincidence in a book full of dates.
  return best && best.count >= 3 ? best.offset : null;
}

function isFolio(line: SourceLine, offset: number | null): boolean {
  // Roman folios number front matter, which is short and early; they never
  // collide with prose because a lone lowercase `ix` is not a German word.
  if (ROMAN_FOLIO_RE.test(line.text)) return true;

  if (offset === null) return false;
  const match = line.text.match(FOLIO_RE);
  if (!match) return false;

  return Number(match[1]) - line.page === offset;
}
