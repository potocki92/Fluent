/**
 * Turning lines back into paragraphs.
 *
 * A PDF has no paragraphs. It has lines, because a typesetter broke them to fit
 * a column, and the information about which breaks were the author's and which
 * were the typesetter's is exactly what the format threw away. Getting it back
 * is the single highest-value thing this whole import pipeline does: joined
 * wrongly, every sentence in the book ends where a line ended, and the sentence
 * splitter downstream produces one "sentence" per line.
 *
 * THE SIGNALS, in the order they are trusted:
 *
 *  1. A line ending in a hyphen is a word broken across the break. Always joined.
 *  2. A deeper indent than the line above opens a paragraph, when the extractor
 *     preserved indents at all. Self-gating: a document with no indents never
 *     triggers it.
 *  3. A line of speech opening after a finished sentence is a new paragraph.
 *  4. A line that ENDS A SENTENCE WITH ROOM TO SPARE is where the author stopped.
 *     This is the load-bearing rule in a justified book, and it is why the
 *     measure is computed per page: "room to spare" only means anything against
 *     the column this page was set in.
 *  5. A line that FILLS THE MEASURE was ended by the column, not the author.
 *  6. A line starting in lower case continues a sentence — German capitalises
 *     sentence openings and every noun, so a lower-case start is never a new
 *     paragraph.
 *  7. Anything else: the author ended the line, so the paragraph ends.
 *
 * WHAT IT REFUSES TO DO. It does not "fix" typography. Dialogue markers — „…“,
 * »…«, the em-dash opening of a line of speech — are paragraph openers and are
 * otherwise left exactly as written, because the reader shows this text verbatim
 * and a normalised quotation mark is a changed book.
 *
 * Pure and deterministic.
 */

import {
  WRAP_MEASURE_SLACK_MIN,
  WRAP_MEASURE_SLACK_RATIO,
  WRAP_SENTENCE_END_SLACK,
} from "@/lib/import/constants";
import type { SourceLine, SourcePage } from "@/lib/import/cleanup/lines";

/**
 * One paragraph of the cleaned book, still knowing which page it began on.
 *
 * The page is not decoration: chapter detection scores a heading higher when it
 * opens a page, and the preview records a chapter's page range so a learner can
 * check a suspicious split against the original file.
 */
export interface CleanBlock {
  text: string;
  /** 1-based source page the block starts on. */
  page: number;
  /** The block is the first content on its page. */
  isPageStart: boolean;
  /**
   * The block is one line long.
   *
   * After wrapping, that IS "isolated": every continuation line has already been
   * folded into its paragraph, so a paragraph left one line long is a line that
   * stood alone in the printed book. A blank-line test would be useless — PDF
   * extraction emits no blank lines at all.
   */
  isolated: boolean;
  /** Source lines the block was assembled from. */
  lineCount: number;
}

/** A flattened line, with the blank-line context that survived the page split. */
interface FlatLine extends SourceLine {
  blankBefore: boolean;
  isPageStart: boolean;
  measure: number;
}

/** Characters that open a line of speech. A paragraph, never a continuation. */
const DIALOGUE_OPENER = /^([„“”«»"']|[-–—]\s)/u;

/** Sentence-final punctuation, allowing for a closing quote after it. */
const SENTENCE_END = /[.!?…]["'“”»«)\]]*$/u;

/** A line broken mid-word. Only a real hyphen — an em-dash is punctuation. */
const TRAILING_HYPHEN = /(\p{L})[-\u2010\u00ad]$/u;

/**
 * Assemble cleaned pages into paragraphs.
 *
 * Pages are processed as one continuous stream, so a paragraph that runs across
 * a page break comes out whole — which is the case a per-page implementation
 * always gets wrong and nobody notices until every chapter's last sentence is
 * truncated.
 */
export function joinWrappedLines(pages: readonly SourcePage[]): CleanBlock[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  const blocks: CleanBlock[] = [];
  let current: FlatLine[] = [flat[0]];

  for (let i = 1; i < flat.length; i += 1) {
    const previous = flat[i - 1];
    const line = flat[i];

    if (line.blankBefore || !continuesParagraph(previous, line)) {
      blocks.push(toBlock(current));
      current = [line];
      continue;
    }
    current.push(line);
  }
  blocks.push(toBlock(current));

  return blocks.filter((block) => block.text.length > 0);
}

/** Drop blank lines, remembering that they were there. */
function flatten(pages: readonly SourcePage[]): FlatLine[] {
  const flat: FlatLine[] = [];
  let blankPending = false;

  for (const page of pages) {
    let firstOnPage = true;
    for (const line of page.lines) {
      if (!line.text) {
        blankPending = true;
        continue;
      }
      flat.push({
        ...line,
        blankBefore: blankPending || flat.length === 0,
        isPageStart: firstOnPage,
        measure: page.measure,
      });
      blankPending = false;
      firstOnPage = false;
    }
  }

  return flat;
}

/** Does `line` continue the paragraph `previous` belongs to? */
function continuesParagraph(previous: FlatLine, line: FlatLine): boolean {
  if (TRAILING_HYPHEN.test(previous.text)) return true;

  // An indent deeper than the line above opens a paragraph even after a full
  // line — the one case where the measure is not the last word. Documents whose
  // extractor dropped indentation never reach this branch, because every indent
  // is 0 and the comparison is false.
  if (line.indent > previous.indent + 1) return false;

  // A line of speech is a paragraph of its own, checked before anything about
  // length so that »sagte er« openings are never swallowed by the line above.
  if (DIALOGUE_OPENER.test(line.text) && SENTENCE_END.test(previous.text)) return false;

  // The paragraph-break rule. A sentence that ends in the middle of the column
  // ended the paragraph; one that ends exactly at the margin merely ran out of
  // line, and the paragraph continues.
  if (SENTENCE_END.test(previous.text)) {
    return previous.text.length >= previous.measure - WRAP_SENTENCE_END_SLACK;
  }

  if (fillsMeasure(previous)) return true;

  return startsLowerCase(line.text);
}

/** Close enough to the column that the next word could not have fitted. */
function fillsMeasure(line: FlatLine): boolean {
  const slack = Math.max(
    WRAP_MEASURE_SLACK_MIN,
    line.measure * WRAP_MEASURE_SLACK_RATIO,
  );
  return line.text.length >= line.measure - slack;
}

function startsLowerCase(text: string): boolean {
  const first = text.match(/\p{L}/u);
  if (!first) return false;
  // Only meaningful if the letter is the first character: `»Und` starts with a
  // quote and is a new paragraph, not a continuation.
  return text[0] === first[0] && first[0].toLowerCase() === first[0];
}

/** Join a paragraph's lines, resolving the hyphens between them. */
function toBlock(lines: readonly FlatLine[]): CleanBlock {
  let text = "";

  for (const [index, line] of lines.entries()) {
    if (index === 0) {
      text = line.text;
      continue;
    }
    text = joinLine(text, line.text);
  }

  return {
    text: text.trim(),
    page: lines[0]?.page ?? 1,
    isPageStart: lines[0]?.isPageStart ?? false,
    isolated: lines.length === 1,
    lineCount: lines.length,
  };
}

/**
 * Append one wrapped line to the paragraph so far.
 *
 * THE HYPHEN DECISION, which is the only genuinely ambiguous call in the whole
 * cleanup pipeline:
 *
 *     Kran-          →  Krankenhaus      the hyphen was the typesetter's
 *     kenhaus
 *
 *     Nord-          →  Nord-Amerika     the hyphen is the author's
 *     Amerika
 *
 * German capitalises nouns, so a continuation that starts in lower case is a
 * word half, and one that starts in upper case is the second element of a real
 * compound. That is not a proof — `Nord-\nosten` exists — but it is right far
 * more often than either blanket rule, and the failure is a misspelled word
 * rather than a lost distinction.
 *
 * A hyphen in the MIDDLE of a line is never touched, which is what guarantees
 * `deutsch-polnisch` survives the pipeline intact.
 */
function joinLine(accumulated: string, next: string): string {
  const hyphenated = accumulated.match(TRAILING_HYPHEN);
  if (!hyphenated) return `${accumulated} ${next}`;

  const stem = accumulated.slice(0, -1);
  const continuation = next.match(/^\p{L}/u)?.[0];

  // A soft hyphen is a typesetting artefact and never survives, whatever
  // follows it.
  const wasSoft = accumulated.endsWith("\u00ad");
  const merge =
    wasSoft ||
    (continuation !== undefined && continuation.toLowerCase() === continuation);

  return merge ? `${stem}${next}` : `${accumulated}${next}`;
}
