/**
 * Chapters that are not called "Kapitel".
 *
 * A Song of Ice and Fire names its chapters after whoever is telling them:
 *
 *     BRAN
 *     CATELYN
 *     DAENERYS
 *     EDDARD
 *     JON
 *
 * There is no keyword to match, and the names are different in every book, so
 * the only honest way to find them is to stop looking for chapter headings and
 * look for THE SHAPE THIS BOOK USES. A single isolated all-caps word means
 * nothing. The same shape, repeated eleven times, between long runs of prose, is
 * a convention — and conventions are detectable without knowing a single name.
 *
 * NOTHING IS HARDCODED. There is no list of first names here and there must
 * never be one: it would work for one novel, fail for every other, and hide the
 * fact that the detector had learned nothing.
 *
 * WHAT A SHAPE IS. A fingerprint of a candidate line's typography — how many
 * words, what case, whether it is a numeral — and nothing about which words. Two
 * lines share a shape when a typesetter would have set them the same way.
 *
 * Pure.
 */

import { STRUCTURAL_PATTERN_MIN_OCCURRENCES } from "@/lib/import/constants";
import { headingText } from "@/lib/import/chapters/patterns";

/**
 * The shapes that can be a book's chapter convention.
 *
 * Only these participate. `mixed` — a short line that is neither consistently
 * capitalised nor a numeral — is excluded on purpose: it is the shape of an
 * ordinary short sentence, and letting it become a book's "pattern" is how a
 * novel full of one-line dialogue gets cut into four hundred chapters.
 */
const PATTERNED = new Set(["caps", "title", "arabic", "roman"]);

/** The typographic fingerprint of a line, or null when it has none worth using. */
export function headingShape(line: string): string | null {
  const text = headingText(line);
  if (!text) return null;

  // Numerals first: `7.` is a heading shape, and the punctuation rule below
  // would otherwise throw it away for ending in a full stop.
  if (/^[\s\d.\-–—[\]()]+$/.test(text)) return "arabic";
  if (/^[IVXLCDM]{1,7}\.?$/.test(text)) return "roman";

  // Terminal sentence punctuation disqualifies everything else, however it is
  // capitalised. Headings do not end in full stops.
  if (/[.!?;,:]$/.test(text)) return null;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return null;

  if (letters === letters.toUpperCase() && letters.length > 1) {
    return `caps:${words.length}`;
  }
  if (words.every((word) => isCapitalised(word))) {
    return `title:${words.length}`;
  }

  return null;
}

function isCapitalised(word: string): boolean {
  const first = word.match(/\p{L}/u)?.[0];
  return first !== undefined && first === first.toUpperCase();
}

/**
 * The shape this book uses for its chapters, if it uses one.
 *
 * Counts shapes across the candidate lines and returns the most frequent one
 * that (a) repeats at least {@link STRUCTURAL_PATTERN_MIN_OCCURRENCES} times and
 * (b) is one of the patterned shapes. Returns null for a book that simply says
 * "Kapitel 1" — which is correct, because such a book does not need this.
 *
 * ONE SHAPE, NOT SEVERAL. A book has one convention. Accepting the top three
 * would mean accepting `title:1` (every one-word noun paragraph) alongside
 * `caps:1`, and the second would drown the first.
 */
export function dominantShape(candidateLines: readonly string[]): string | null {
  const counts = new Map<string, number>();

  for (const line of candidateLines) {
    const shape = headingShape(line);
    if (!shape) continue;
    if (!PATTERNED.has(shape.split(":")[0])) continue;
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }

  let best: { shape: string; count: number } | null = null;
  for (const [shape, count] of counts) {
    if (!best || count > best.count || (count === best.count && shape < best.shape)) {
      best = { shape, count };
    }
  }

  return best && best.count >= STRUCTURAL_PATTERN_MIN_OCCURRENCES ? best.shape : null;
}

/** Does this line match the book's own convention? */
export function matchesShape(line: string, shape: string | null): boolean {
  if (!shape) return false;
  return headingShape(line) === shape;
}
