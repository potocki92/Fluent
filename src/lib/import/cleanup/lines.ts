/**
 * A page of extracted text, as lines that still know where they came from.
 *
 * Every later cleanup step needs two things the raw string has thrown away: is
 * this line at the top or the bottom of its page, and how long is it compared
 * with the rest of the page. Both are the difference between deleting a running
 * head and deleting a sentence, so they are computed once, here, and carried
 * rather than re-derived.
 *
 * Pure and deterministic. The same page text always produces the same lines.
 */

import {
  WRAP_FALLBACK_MEASURE,
  WRAP_MIN_LINES_FOR_MEASURE,
} from "@/lib/import/constants";

/** One line of a page, with the position information cleanup needs. */
export interface SourceLine {
  /** Trimmed. Empty string for a blank line, which is a paragraph separator. */
  text: string;
  /** Leading whitespace in the source — a first-line indent, when a PDF kept it. */
  indent: number;
  /** 1-based page this line was printed on. */
  page: number;
  /** 0-based index among the page's NON-BLANK lines, from the top. */
  fromTop: number;
  /** 0-based index among the page's non-blank lines, from the bottom. */
  fromBottom: number;
}

export interface SourcePage {
  number: number;
  lines: SourceLine[];
  /**
   * The page's typographic measure — its column width, in characters.
   *
   * A line at or near it was ended by the typesetter running out of width; a
   * much shorter one was ended by the author. That comparison is the whole of
   * the line-wrap heuristic, and it has to be per-page because a pocket
   * paperback and an A4 textbook disagree about what "full" means by a factor of
   * two.
   */
  measure: number;
}

/**
 * Split one extracted page into lines.
 *
 * Whitespace inside a line is collapsed (PDF extraction emits runs of spaces
 * where the typesetter used tracking), but the leading indent is measured before
 * that happens: it is the only paragraph signal a PDF has that survives
 * extraction at all, and it is worth the one extra field.
 */
export function toSourceLines(pageNumber: number, text: string): SourcePage {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");

  const lines: SourceLine[] = raw.map((line) => ({
    text: line.trim().replace(/[ \t ]+/g, " "),
    indent: line.length - line.trimStart().length,
    page: pageNumber,
    fromTop: -1,
    fromBottom: -1,
  }));

  const contentIndices = lines
    .map((line, index) => (line.text ? index : -1))
    .filter((index) => index !== -1);

  contentIndices.forEach((index, order) => {
    lines[index].fromTop = order;
    lines[index].fromBottom = contentIndices.length - 1 - order;
  });

  return { number: pageNumber, lines, measure: measureOf(lines) };
}

/**
 * The page's column width: the 90th percentile of its line lengths.
 *
 * NOT THE MEDIAN. Half of a typical page's lines are full and half are not —
 * a heading, the short last line of each paragraph, a line of dialogue — so the
 * median lands well below the column, and every line above it then looks "full".
 * The 90th percentile is the width the longest ordinary lines reach, which is
 * what the column actually is, while still ignoring an outlier.
 *
 * The last line of the page is excluded: it is as long as the text happened to
 * be, and it is the one line whose length says nothing about the column.
 */
function measureOf(lines: readonly SourceLine[]): number {
  const lengths = lines
    .filter((line) => line.text && line.fromBottom !== 0)
    .map((line) => line.text.length)
    .sort((a, b) => a - b);

  if (lengths.length < WRAP_MIN_LINES_FOR_MEASURE) return WRAP_FALLBACK_MEASURE;
  return lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))];
}

/** The median of the pages' measures — the book's measure, for short pages. */
export function bookMeasure(pages: readonly SourcePage[]): number {
  const measures = pages.map((page) => page.measure).sort((a, b) => a - b);
  if (measures.length === 0) return WRAP_FALLBACK_MEASURE;
  return measures[Math.floor(measures.length / 2)];
}
