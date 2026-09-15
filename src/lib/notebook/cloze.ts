/**
 * Building a cloze from a sentence and a span.
 *
 * WHY THIS IS NOT `text.replace(surface, '______')`. That is wrong, silently,
 * and only for some sentences — which is the worst way for it to be wrong. In
 *
 *     Er sah sie an, und sie sah ihn an.
 *
 * replacing "sah" blanks the FIRST one, which may not be the one the learner
 * saved; in "Wir sollten umkehren, sollten wir nicht?" it blanks the wrong
 * *sollten* half the time. The occurrence model exists precisely so that a span
 * is a place rather than a string, and this module only ever cuts at offsets.
 *
 * OFFSETS ARE SNAPSHOTTED WITH THE CARD, not looked up when it is shown. A
 * chapter that has been reprocessed, or a private book that has been deleted,
 * must not turn an existing card into a wrong one — so a card carries the
 * sentence text and the offsets into THAT text, and this function validates them
 * against each other before trusting either.
 */

import { CLOZE_BLANK, CLOZE_CONTEXT_CHARS } from "@/lib/notebook/constants";

/** A sentence with one span cut out of it. */
export interface Cloze {
  /** Text before the blank, possibly elided at the start. */
  before: string;
  /** What was removed — the answer. */
  answer: string;
  /** Text after the blank, possibly elided at the end. */
  after: string;
  /** True when either side was shortened, so the UI can say so. */
  elided: boolean;
}

/**
 * Cut a span out of a sentence.
 *
 * Returns `null` — never a guess — when the offsets do not describe a span of
 * this text. A card whose cloze cannot be built is shown as an ordinary card
 * with the whole sentence, which is a weaker exercise and an honest one.
 */
export function buildCloze(
  sentenceText: string,
  charStart: number | null,
  charEnd: number | null,
  contextChars: number = CLOZE_CONTEXT_CHARS,
): Cloze | null {
  if (
    charStart === null ||
    charEnd === null ||
    !Number.isInteger(charStart) ||
    !Number.isInteger(charEnd) ||
    charStart < 0 ||
    charEnd <= charStart ||
    charEnd > sentenceText.length
  ) {
    return null;
  }

  const answer = sentenceText.slice(charStart, charEnd);
  if (answer.trim().length === 0) return null;

  const beforeFull = sentenceText.slice(0, charStart);
  const afterFull = sentenceText.slice(charEnd);

  // Trim to a readable window, on WORD boundaries: cutting mid-word would both
  // look broken and occasionally hand the learner the answer's neighbours as a
  // fragment they have to decode first.
  const before = trimStart(beforeFull, contextChars);
  const after = trimEnd(afterFull, contextChars);

  return {
    before: before.text,
    answer,
    after: after.text,
    elided: before.elided || after.elided,
  };
}

/** The cloze as one string, for a card front. */
export function renderCloze(cloze: Cloze, blank: string = CLOZE_BLANK): string {
  return `${cloze.before}${blank}${cloze.after}`;
}

function trimStart(text: string, limit: number): { text: string; elided: boolean } {
  if (text.length <= limit) return { text, elided: false };
  const cut = text.slice(text.length - limit);
  const space = cut.indexOf(" ");
  return { text: `… ${space >= 0 ? cut.slice(space + 1) : cut}`, elided: true };
}

function trimEnd(text: string, limit: number): { text: string; elided: boolean } {
  if (text.length <= limit) return { text, elided: false };
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return { text: `${space >= 0 ? cut.slice(0, space) : cut} …`, elided: true };
}
