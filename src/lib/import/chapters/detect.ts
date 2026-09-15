/**
 * Where does one chapter end and the next begin?
 *
 * This is the hardest question the importer asks, and it has no certain answer:
 * a printed book marks its chapters typographically, and typography is what
 * extraction destroys. So the detector does not look for one signal, it ADDS UP
 * several weak ones — and then tells the learner how sure it is, because the
 * learner is looking at their own book and can settle in one tap what no
 * heuristic can settle at all.
 *
 * THE SIGNALS (weights in `constants.ts`, not here):
 *
 *   explicit    "Kapitel 7", "Chapter IV", "Prolog" — self-announcing.
 *   structural  the shape this book uses for its own chapters. See
 *               `structural.ts`; this is what finds BRAN / CATELYN / JON.
 *   isolated    a single short line standing alone between paragraphs.
 *   pageStart   the line opens a page, as chapter headings nearly always do.
 *   case        ALL CAPS, or Title Case with no sentence punctuation.
 *   contents    the line is also an entry in the book's own table of contents.
 *   bareNumber  a numeral alone on a line.
 *
 * WHEN THE FILE ALREADY KNOWS. An EPUB with a spine and a table of contents has
 * told us where its chapters are, and guessing over the top of that would be
 * strictly worse. {@link detectChapters} takes declared boundaries and uses
 * them; the heuristics never run.
 *
 * NOTHING IS EVER DROPPED. A section the detector thinks is front matter is
 * marked, not deleted — the preview offers it switched off, and the learner
 * decides. Every character of the cleaned book is inside exactly one detected
 * chapter.
 *
 * Pure and deterministic.
 */

import type { CleanBlock } from "@/lib/import/cleanup";
import {
  CHAPTER_DETECTOR_VERSION,
  CHAPTER_MIN_WORDS,
  FRONT_MATTER_MAX_WORDS,
  HEADING_MAX_CHARS,
  HEADING_MAX_WORDS,
  HEADING_SCORE_FLOOR,
  HEADING_SCORE_HIGH,
  HEADING_SCORE_MEDIUM,
  HEADING_WEIGHTS,
  MAX_IMPORT_CHAPTERS,
  TOC_MAX_PAGE,
  TOC_MIN_ENTRIES,
} from "@/lib/import/constants";
import {
  headingKey,
  headingText,
  isFrontMatterHeading,
  matchBareNumber,
  matchExplicitHeading,
  matchTocEntry,
} from "@/lib/import/chapters/patterns";
import { dominantShape, matchesShape } from "@/lib/import/chapters/structural";
import { countWords } from "@/lib/content/paragraphs";
import type {
  ChapterConfidence,
  ChapterDetection,
  DeclaredChapter,
  DetectedChapter,
} from "@/lib/import/types";

/** One scored candidate heading. */
interface Break {
  /** Index into the block list. The heading block itself. */
  index: number;
  title: string;
  score: number;
  signals: string[];
  isFrontMatter: boolean;
}

export interface DetectOptions {
  /** Boundaries the file declared (EPUB spine/TOC). When present, they win. */
  declared?: readonly DeclaredChapter[];
  /** Fallback title for a book that turns out to be a single chapter. */
  fallbackTitle?: string | null;
}

/**
 * Cut a cleaned book into chapters.
 *
 * Always returns at least one chapter when there is any text at all — a file
 * with no detectable structure is a one-chapter book, which is a perfectly good
 * thing to read.
 */
export function detectChapters(
  blocks: readonly CleanBlock[],
  options: DetectOptions = {},
): ChapterDetection {
  if (blocks.length === 0) {
    return { chapters: [], structuralPattern: null, detectorVersion: CHAPTER_DETECTOR_VERSION };
  }

  if (options.declared && options.declared.length > 0) {
    return {
      chapters: fromDeclared(blocks, options.declared),
      structuralPattern: null,
      detectorVersion: CHAPTER_DETECTOR_VERSION,
    };
  }

  const tocTitles = tableOfContentsTitles(blocks);
  const candidates = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => isCandidate(block));

  const pattern = dominantShape(candidates.map(({ block }) => block.text));

  const breaks: Break[] = [];
  for (const { block, index } of candidates) {
    const scored = score(block, pattern, tocTitles);
    if (scored.score >= HEADING_SCORE_FLOOR) {
      breaks.push({ index, ...scored });
    }
  }

  return {
    chapters: assemble(
      blocks,
      capBreaks(collapseAdjacent(breaks)),
      options.fallbackTitle ?? null,
    ),
    structuralPattern: pattern,
    detectorVersion: CHAPTER_DETECTOR_VERSION,
  };
}

/**
 * Two headings in a row are one boundary.
 *
 * It happens constantly: a dedication above chapter one, a part title above the
 * chapter it opens, a heading the typesetter split across two lines. Left alone,
 * the first of them becomes a chapter with no body — and a chapter with no body
 * is DISCARDED, which would silently delete a line of somebody's book.
 *
 * So a run of adjacent breaks keeps only its last, and the earlier headings stay
 * where they are, as ordinary text in the section before. Nothing is lost, and
 * the boundary lands on the heading that actually has a chapter under it.
 */
function collapseAdjacent(breaks: readonly Break[]): Break[] {
  return breaks.filter(
    (current, order) => breaks[order + 1]?.index !== current.index + 1,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// candidates and scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Could this block be a heading at all?
 *
 * One line, short, few words. Everything else in the book is body text, and
 * excluding it here rather than scoring it to zero keeps the structural pattern
 * detector from counting paragraphs as shapes.
 */
function isCandidate(block: CleanBlock): boolean {
  if (block.lineCount !== 1) return false;
  const text = headingText(block.text);
  if (!text || text.length > HEADING_MAX_CHARS) return false;
  return countWords(text) <= HEADING_MAX_WORDS;
}

function score(
  block: CleanBlock,
  pattern: string | null,
  tocTitles: ReadonlySet<string>,
): Omit<Break, "index"> {
  const text = headingText(block.text);
  const signals: string[] = [];
  let total = 0;

  const add = (weight: number, signal: string) => {
    total += weight;
    signals.push(signal);
  };

  const explicit = matchExplicitHeading(text);
  if (explicit) {
    add(
      explicit.kind === "named_section"
        ? HEADING_WEIGHTS.namedSection
        : HEADING_WEIGHTS.explicitChapterWord,
      explicit.kind,
    );
  } else if (matchBareNumber(text)) {
    add(HEADING_WEIGHTS.bareNumber, "bare_number");
  }

  if (matchesShape(text, pattern)) add(HEADING_WEIGHTS.structuralPattern, "structural");
  if (block.isolated) add(HEADING_WEIGHTS.isolated, "isolated");
  if (block.isPageStart) add(HEADING_WEIGHTS.pageStart, "page_start");
  if (isHeadingCase(text)) add(HEADING_WEIGHTS.headingCase, "heading_case");
  if (tocTitles.has(headingKey(text))) add(HEADING_WEIGHTS.tableOfContents, "contents");

  return {
    title: text,
    score: total,
    signals,
    isFrontMatter: isFrontMatterHeading(text),
  };
}

/** ALL CAPS, or every word capitalised and no sentence punctuation. */
function isHeadingCase(text: string): boolean {
  if (/[.!?;,]$/.test(text)) return false;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  if (letters === letters.toUpperCase()) return true;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      const first = word.match(/\p{L}/u)?.[0];
      return first === undefined || first === first.toUpperCase();
    });
}

/**
 * Keep the book inside {@link MAX_IMPORT_CHAPTERS}.
 *
 * A detector that finds 900 chapters has failed, and importing its answer would
 * turn one book into 900 unreadable fragments. Rather than refuse the import —
 * which leaves the learner with nothing — the weakest breaks are dropped until
 * the count is sane. They are dropped by SCORE and then restored to reading
 * order, so what survives is the book's strongest structure.
 */
function capBreaks(breaks: readonly Break[]): Break[] {
  if (breaks.length <= MAX_IMPORT_CHAPTERS) return [...breaks];

  return [...breaks]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_IMPORT_CHAPTERS)
    .sort((a, b) => a.index - b.index);
}

// ─────────────────────────────────────────────────────────────────────────────
// table of contents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The titles listed on the book's own contents page.
 *
 * Two jobs. It is a strong confirming signal for a heading later in the book,
 * and it is how the contents page itself gets recognised — so it can be offered
 * off rather than imported as a chapter of dotted leader lines.
 *
 * Only looked for near the front of the book. An index at the back has the same
 * shape and is not a table of contents.
 */
function tableOfContentsTitles(blocks: readonly CleanBlock[]): Set<string> {
  const perPage = new Map<number, string[]>();

  for (const block of blocks) {
    if (block.page > TOC_MAX_PAGE) break;
    const entry = matchTocEntry(block.text);
    if (!entry) continue;
    const list = perPage.get(block.page) ?? [];
    list.push(headingKey(entry.title));
    perPage.set(block.page, list);
  }

  const titles = new Set<string>();
  for (const entries of perPage.values()) {
    if (entries.length < TOC_MIN_ENTRIES) continue;
    for (const title of entries) if (title) titles.add(title);
  }

  return titles;
}

// ─────────────────────────────────────────────────────────────────────────────
// assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn breaks into chapters.
 *
 * The heading block becomes the chapter's TITLE and is not repeated in its body
 * — the reader renders the title itself, and a chapter whose first paragraph is
 * its own name reads like a bug. Everything else between one break and the next
 * is the chapter's text, in order, with nothing skipped.
 */
function assemble(
  blocks: readonly CleanBlock[],
  breaks: readonly Break[],
  fallbackTitle: string | null,
): DetectedChapter[] {
  if (breaks.length === 0) {
    const chapter = build(blocks, 1, fallbackTitle, "high", ["single_chapter"], false);
    return chapter ? [chapter] : [];
  }

  const chapters: DetectedChapter[] = [];

  // Anything before the first heading is front matter: a title page, a
  // dedication, a contents page. Kept, flagged, and offered switched off when it
  // is short enough to be exactly that and nothing else.
  const preamble = blocks.slice(0, breaks[0].index);
  if (preamble.length > 0) {
    const words = preamble.reduce((sum, block) => sum + countWords(block.text), 0);
    const chapter = build(
      preamble,
      chapters.length + 1,
      headingText(preamble[0].text).slice(0, HEADING_MAX_CHARS) || null,
      "low",
      ["preamble"],
      words <= FRONT_MATTER_MAX_WORDS,
    );
    if (chapter) chapters.push(chapter);
  }

  for (const [order, current] of breaks.entries()) {
    const next = breaks[order + 1];
    const body = blocks.slice(current.index + 1, next?.index ?? blocks.length);
    const chapter = build(
      body,
      chapters.length + 1,
      current.title,
      confidenceOf(current, body),
      current.signals,
      current.isFrontMatter,
    );
    // A heading with nothing under it is a heading the detector found twice (a
    // part title immediately followed by a chapter title). Folding it into the
    // next chapter's title would be a guess; dropping the empty shell is not.
    if (chapter) chapters.push(chapter);
    else if (next) next.signals.push("after_empty_heading");
  }

  return chapters.map((chapter, index) => ({ ...chapter, position: index + 1 }));
}

function build(
  body: readonly CleanBlock[],
  position: number,
  title: string | null,
  confidence: ChapterConfidence,
  signals: readonly string[],
  isFrontMatter: boolean,
  sourceHref: string | null = null,
): DetectedChapter | null {
  const text = body
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;

  return {
    position,
    title: title && title.trim() ? title.trim() : null,
    startPage: body[0].page,
    endPage: body[body.length - 1].page,
    sourceHref,
    text,
    wordCount: countWords(text),
    confidence,
    signals: [...signals],
    isFrontMatter,
  };
}

/**
 * How sure the detector is about one break.
 *
 * The score decides, with one override: a chapter of eleven words is suspicious
 * however the heading scored, because the usual cause is a heading split across
 * two lines and detected twice. Flagging it puts a "check this" badge next to
 * exactly the boundary a learner should look at, which is the whole point of
 * having confidence at all.
 */
function confidenceOf(scored: Break, body: readonly CleanBlock[]): ChapterConfidence {
  const words = body.reduce((sum, block) => sum + countWords(block.text), 0);
  if (words > 0 && words < CHAPTER_MIN_WORDS) return "low";
  if (scored.score >= HEADING_SCORE_HIGH) return "high";
  if (scored.score >= HEADING_SCORE_MEDIUM) return "medium";
  return "low";
}

/**
 * Chapters the file declared for itself.
 *
 * EPUB: the spine says which documents make up the book and in what order, and
 * the navigation document names them. Both are authored metadata, so they beat
 * any heuristic — an EPUB whose chapters are images of headings still splits
 * correctly, and one whose headings are `<h2>` does not depend on our reading
 * the `<h2>` back out of the text.
 */
function fromDeclared(
  blocks: readonly CleanBlock[],
  declared: readonly DeclaredChapter[],
): DetectedChapter[] {
  const ordered = [...declared].sort((a, b) => a.startPage - b.startPage);
  const chapters: DetectedChapter[] = [];

  for (const [index, entry] of ordered.entries()) {
    const nextStart = ordered[index + 1]?.startPage ?? Number.POSITIVE_INFINITY;
    const body = blocks.filter(
      (block) => block.page >= entry.startPage && block.page < nextStart,
    );

    const chapter = build(
      body,
      chapters.length + 1,
      entry.title,
      "high",
      ["declared"],
      entry.title ? isFrontMatterHeading(entry.title) : false,
      entry.href ?? null,
    );
    if (chapter) chapters.push(chapter);
  }

  return chapters.map((chapter, index) => ({ ...chapter, position: index + 1 }));
}
