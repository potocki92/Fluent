/**
 * Step 3: a paragraph → its sentences.
 *
 * WHY NOT `text.split(".")`. German prose breaks that in four ways that all
 * occur in the first page of any real book:
 *
 *   - abbreviations — "z. B.", "Dr. Müller", "usw.", "Nr. 4"
 *   - ordinals and numbers — "am 3. Mai 1988", "ca. 2.500 Euro"
 *   - dialogue — »Er zog sein Schwert«, sagte sie. / „Warum?“ fragte er.
 *   - the closing punctuation itself — `!`, `?`, `…`, and runs like `?!`
 *
 * Each of those produces a fragment that is not a sentence, and a fragment that
 * is not a sentence becomes a stored `sentences` row, a set of occurrences
 * hanging off it, and eventually a contextual translation of half a clause.
 *
 * WHY NOT AN NLP STACK. A statistical segmenter would be better, and it would
 * also be a multi-megabyte dependency, a model download and a source of
 * non-determinism across versions — against a rule set that handles graded
 * German well and is 60 lines. {@link CONTENT_PROCESSOR_VERSION} is what makes
 * replacing it later a decision rather than a migration hazard.
 *
 * DETERMINISM is the property that matters most here: the same paragraph must
 * always yield the same sentences at the same positions, because those positions
 * are stored and pointed at.
 */

export interface SentenceBlock {
  /** 0-based within the paragraph. */
  position: number;
  text: string;
  /** Offset of `text` within the paragraph, so occurrences can be anchored. */
  charStart: number;
  charEnd: number;
}

/**
 * Abbreviations whose trailing dot is never a sentence end.
 *
 * Lowercased and compared without the dot. Kept to the ones that actually occur
 * in German prose and graded readers — a longer list is not more correct, it is
 * just more places for a real sentence ending in "Nr" to be swallowed.
 */
const ABBREVIATIONS = new Set<string>([
  // titles & names
  "dr", "prof", "hr", "fr", "frl", "st", "hl",
  // common written abbreviations
  "z", "b", "d", "h", "u", "a", "s", "o", "ca", "bzw", "usw", "usf",
  "evtl", "ggf", "inkl", "exkl", "max", "min", "vgl", "abb", "bspw",
  "nr", "abs", "art", "kap", "s", "f", "ff", "jh", "jhd",
  // units & measures written with a dot
  "mio", "mrd", "tsd", "zzgl", "etc", "sog", "u.a", "i", "e",
  // months and weekdays are frequently abbreviated in dates
  "jan", "febr", "feb", "mrz", "apr", "jun", "jul", "aug", "sept", "sep",
  "okt", "nov", "dez", "mo", "di", "mi", "do", "fr", "sa", "so",
]);

/** Terminators that can end a sentence. */
const TERMINATORS = new Set([".", "!", "?", "…"]);

/** Closing marks that belong to the sentence they follow. */
const CLOSERS = new Set(['"', "'", "»", "«", "”", "“", "’", "‘", ")", "]", "}", "›", "‹"]);

/**
 * Split a paragraph into sentences.
 *
 * The scan walks the string once, and a candidate boundary is accepted only
 * when the text after it looks like the start of something new: whitespace, then
 * an opening quote, a dash, a digit or an uppercase letter. That single rule
 * disposes of most abbreviation cases on its own ("z. B. der Hund" continues
 * lowercase), and {@link ABBREVIATIONS} handles the rest ("Dr. Müller").
 */
export function splitSentences(paragraph: string): SentenceBlock[] {
  const text = paragraph.trim();
  if (!text) return [];

  const blocks: SentenceBlock[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (!TERMINATORS.has(text[i])) continue;

    // Swallow a run of terminators and any closing quote/bracket: "?!" and
    // »…sagte sie.« both end where the last of those characters does.
    let end = i;
    while (end + 1 < text.length && TERMINATORS.has(text[end + 1])) end += 1;
    while (end + 1 < text.length && CLOSERS.has(text[end + 1])) end += 1;

    if (end + 1 >= text.length) break;
    if (!/\s/.test(text[end + 1])) continue;
    if (!startsNewSentence(text, end + 1)) continue;
    if (text[i] === "." && isAbbreviationDot(text, i)) continue;

    const slice = text.slice(start, end + 1).trim();
    if (slice) {
      blocks.push(block(blocks.length, slice, text, start, end + 1));
    }
    start = end + 1;
  }

  const tail = text.slice(start).trim();
  if (tail) blocks.push(block(blocks.length, tail, text, start, text.length));

  // A paragraph that produced nothing (punctuation only) is still one sentence:
  // never lose text, whatever the rules decided.
  return blocks.length > 0
    ? blocks
    : [{ position: 0, text, charStart: 0, charEnd: text.length }];
}

function block(
  position: number,
  slice: string,
  source: string,
  from: number,
  to: number,
): SentenceBlock {
  const raw = source.slice(from, to);
  const leading = raw.length - raw.trimStart().length;
  return {
    position,
    text: slice,
    charStart: from + leading,
    charEnd: from + leading + slice.length,
  };
}

/** Does real sentence-looking content start at or after `index`? */
function startsNewSentence(text: string, index: number): boolean {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return false;

  const ch = text[i];
  if (/[\p{Lu}]/u.test(ch)) return true;
  // Dialogue and typographic openers begin sentences as often as capitals do.
  if ('"„“»«‚‘\'(['.includes(ch)) return true;
  if (ch === "–" || ch === "—" || ch === "-") return true;
  // A digit only starts a sentence when it is not the tail of a date or a
  // decimal that happened to straddle the dot ("3. Mai" is handled below).
  return /\d/.test(ch);
}

/**
 * Is the dot at `index` part of an abbreviation, an initial or an ordinal?
 *
 * Ordinals are the German-specific case: "am 3. Mai" has a capital right after
 * the dot and would otherwise pass every other test.
 */
function isAbbreviationDot(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /[\p{L}\p{M}\d]/u.test(text[i])) i -= 1;
  const token = text.slice(i + 1, index);
  if (!token) return false;

  // "3." — an ordinal or an enumerator, never a sentence end.
  if (/^\d+$/.test(token)) return true;
  // "A." — a single-letter initial, as in "A. Müller" or "z. B.".
  if (token.length === 1 && /\p{L}/u.test(token)) return true;
  return ABBREVIATIONS.has(token.toLowerCase());
}
