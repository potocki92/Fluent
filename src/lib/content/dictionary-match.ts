/**
 * Step 5: a token → the dictionary entry it refers to, if any.
 *
 * SEPARATED FROM RENDERING ON PURPOSE. Fluent already had this logic, inside
 * `src/lib/text-compiler.ts`, mixed into the code that emits
 * `<mark data-lemma="…">`. That made the linguistic decision ("is *Bücher* the
 * word *Buch*?") inseparable from a presentation decision ("wrap it in a mark"),
 * so the reader could not reuse one without inheriting the other. The de-
 * inflection rules in `src/lib/german-morphology.ts` are unchanged and still
 * shared; what moved here is the indexing and lookup, which the compiler now
 * imports rather than owns.
 *
 * WHAT A MATCH MEANS — AND WHAT IT DOES NOT. A hit gives the occurrence a
 * `word_id`, which is what lets a lookup be recorded against a real dictionary
 * entry instead of a string. It does NOT claim to have disambiguated a sense:
 * *zog* resolves to *ziehen*, not to "wyciągnąć in this sentence". That is
 * exactly the gap `word_occurrences` exists to make fillable later — the
 * occurrence knows its sentence, so a future sense layer can attach to it
 * without any of this changing shape (see `docs/architecture/reader-story-engine.md`).
 */

import {
  baseFormCandidates,
  foldUmlauts,
  GERMAN_FUNCTION_WORDS,
} from "@/lib/german-morphology";
import { normalizeToken } from "@/lib/content/tokenize";

/** The dictionary rows the matcher needs. A subset of `words`. */
export interface DictionaryEntry {
  id: number;
  lemma: string;
  display: string;
}

/** What a matched token resolves to. */
export interface DictionaryHit {
  wordId: number;
  lemma: string;
}

/** Normalised lookup key → dictionary entry. Built once per processing run. */
export type DictionaryIndex = ReadonlyMap<string, DictionaryHit>;

/** Matches a single word inside a `display` string ("die Autobahn"). */
const DISPLAY_WORD_RE = /\p{L}[\p{L}ß]*(?:-\p{L}[\p{L}ß]*)*/gu;

/**
 * The keys one dictionary entry is reachable by.
 *
 * The lemma itself, plus the LAST word of `display` — `display` carries the
 * article first, so "die Autobahn" has to be reachable as "autobahn". Both are
 * umlaut-folded, because the de-inflection candidates are too.
 */
export function dictionaryKeysFor(lemma: string, display: string): string[] {
  const keys = new Set<string>();
  keys.add(foldUmlauts(lemma.toLowerCase()));

  const displayWords = display.toLowerCase().match(DISPLAY_WORD_RE) ?? [];
  const last = displayWords[displayWords.length - 1];
  if (last) keys.add(foldUmlauts(last));

  return [...keys].filter(Boolean);
}

/**
 * Build the lookup index. Earlier entries win on collision, so the result is
 * deterministic for a given (ordered) dictionary — which is what lets the whole
 * pipeline claim determinism.
 */
export function buildDictionaryIndex(
  entries: readonly DictionaryEntry[],
): DictionaryIndex {
  const index = new Map<string, DictionaryHit>();

  for (const entry of entries) {
    for (const key of dictionaryKeysFor(entry.lemma, entry.display)) {
      if (!index.has(key)) index.set(key, { wordId: entry.id, lemma: entry.lemma });
    }
  }

  return index;
}

/** Closed-class words are never interactive — see `GERMAN_FUNCTION_WORDS`. */
export function isFunctionWord(normalized: string): boolean {
  return GERMAN_FUNCTION_WORDS.has(normalized.toLowerCase());
}

/**
 * Resolve one token against the dictionary.
 *
 * Tries the surface form first and then the de-inflected candidates in rank
 * order, so an exact dictionary form always beats a stem that happens to
 * collide. Function words return null before any lookup: several of them exist
 * as dictionary rows, and marking every *der* in a book is how a page turns into
 * a Christmas tree.
 */
export function matchToken(
  surface: string,
  index: DictionaryIndex,
): DictionaryHit | null {
  const normalized = normalizeToken(surface);
  if (isFunctionWord(normalized)) return null;

  const direct = index.get(foldUmlauts(normalized));
  if (direct) return direct;

  for (const candidate of baseFormCandidates(normalized)) {
    const hit = index.get(foldUmlauts(candidate));
    if (hit) return hit;
  }

  return null;
}

/**
 * Is this token worth reporting as a dictionary GAP when it does not match?
 *
 * Short tokens and function words are noise; proper nouns are unavoidable in
 * fiction. What is left is the useful signal: content words a learner will meet
 * and Fluent cannot gloss. See `chapters.unmatched_sample`.
 */
export function isReportableGap(surface: string): boolean {
  const normalized = normalizeToken(surface);
  return normalized.length >= 3 && !isFunctionWord(normalized);
}
