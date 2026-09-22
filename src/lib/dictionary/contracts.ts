/**
 * What a dictionary word IS, at each of the two sizes the app reads it in.
 *
 * WHAT WENT WRONG WITHOUT THIS FILE. The list query selected eleven columns and
 * then said `(data ?? []) as unknown as Word[]`, where `Word` is the full
 * `words` row. Seven columns the row promises — `ipa`, `plural`, `aux`,
 * `synonyms`, `topic`, `source`, `created_at` — were never fetched, so at
 * runtime they were `undefined` while TypeScript insisted they were there.
 *
 * `WordDetailSheet` believed the type. Every `{word.ipa && …}`, every
 * `{word.plural && …}`, the whole synonyms block and the topic label were dead
 * code on a falsy value: the sheet could not render a detail it was written to
 * render, and no test and no compiler could see it, because the double cast had
 * told the compiler the opposite of the truth. A learner who added *ziehen*
 * with its plural, its auxiliary and three synonyms saw none of them.
 *
 * So there are two shapes, each with the column list that produces it kept
 * beside it, and neither is reachable by casting the other.
 */

import type { Database } from "@/types/database";

type WordRow = Database["public"]["Tables"]["words"]["Row"];

/**
 * A word as a LIST row shows it: enough to scan, sort and tap. Nothing here is
 * optional-at-runtime — every field is genuinely selected.
 */
export type DictionaryListWord = Pick<
  WordRow,
  | "id"
  | "lemma"
  | "display"
  | "article"
  | "word_type"
  | "gender"
  | "translation_pl"
  | "cefr"
>;

/**
 * A word as the DETAIL sheet shows it: the list row plus everything the sheet
 * actually reads. Extends the list shape so a detail is always usable wherever
 * a list row is — the direction that is sound, unlike the cast it replaces.
 */
export interface DictionaryWordDetail extends DictionaryListWord {
  example_de: WordRow["example_de"];
  example_pl: WordRow["example_pl"];
  mnemonic: WordRow["mnemonic"];
  ipa: WordRow["ipa"];
  plural: WordRow["plural"];
  aux: WordRow["aux"];
  synonyms: WordRow["synonyms"];
  topic: WordRow["topic"];
}

/**
 * The column lists, next to the types they produce.
 *
 * Keeping them adjacent is the point: adding a field to
 * {@link DictionaryWordDetail} without adding its column here is the exact
 * mistake this module exists to make hard, and the mapper below turns it into a
 * compile error rather than an `undefined`.
 */
export const DICTIONARY_LIST_COLUMNS =
  "id, lemma, display, article, word_type, gender, translation_pl, cefr";

export const DICTIONARY_DETAIL_COLUMNS =
  `${DICTIONARY_LIST_COLUMNS}, example_de, example_pl, mnemonic, ipa, plural, aux, synonyms, topic` as const;

/** How the dictionary list is narrowed. Pure data — the URL parses into this. */
export interface WordFilters {
  search?: string;
  cefr?: NonNullable<WordRow["cefr"]>;
  type?: WordRow["word_type"];
  topic?: string;
}

const CEFR_VALUES = new Set<NonNullable<WordRow["cefr"]>>(["A1", "A2", "B1", "B2"]);
const TYPE_VALUES = new Set<WordRow["word_type"]>(["noun", "verb", "other"]);

export function isCefrFilter(value: string): value is NonNullable<WordRow["cefr"]> {
  return CEFR_VALUES.has(value as NonNullable<WordRow["cefr"]>);
}

export function isWordTypeFilter(value: string): value is WordRow["word_type"] {
  return TYPE_VALUES.has(value as WordRow["word_type"]);
}

/**
 * Map a selected row onto {@link DictionaryWordDetail}.
 *
 * Explicit field by field rather than spread-and-cast, so a column dropped from
 * {@link DICTIONARY_DETAIL_COLUMNS} fails to compile here instead of arriving
 * as `undefined` at a `{word.plural && …}` three components away.
 */
export function toWordDetail(row: DictionaryWordDetail): DictionaryWordDetail {
  return {
    id: row.id,
    lemma: row.lemma,
    display: row.display,
    article: row.article,
    word_type: row.word_type,
    gender: row.gender,
    translation_pl: row.translation_pl,
    cefr: row.cefr,
    example_de: row.example_de,
    example_pl: row.example_pl,
    mnemonic: row.mnemonic,
    ipa: row.ipa,
    plural: row.plural,
    aux: row.aux,
    synonyms: row.synonyms,
    topic: row.topic,
  };
}
