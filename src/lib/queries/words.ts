import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type WordRow = Database["public"]["Tables"]["words"]["Row"];

/**
 * A dictionary word as fetched by the paginated list. Only the columns needed
 * for the list/card are selected (examples included for the detail use case),
 * derived from the canonical row type so it stays in sync with the schema.
 */
export type Word = Pick<
  WordRow,
  | "id"
  | "lemma"
  | "display"
  | "article"
  | "word_type"
  | "gender"
  | "translation_pl"
  | "example_de"
  | "example_pl"
  | "cefr"
>;

export interface WordsFilter {
  cefr?: WordRow["cefr"];
  word_type?: WordRow["word_type"];
  search?: string;
}

/** Number of words fetched per page. The first page is SSR-prefetched. */
export const WORDS_PAGE_SIZE = 20;

const COLUMNS =
  "id, lemma, display, article, word_type, gender, translation_pl, example_de, example_pl, cefr";

export interface WordsPage {
  data: Word[];
  /** Cursor (last id of this page) for the next fetch, or null when exhausted. */
  nextCursor: number | null;
}

/**
 * Fetch one cursor-based page of words ordered by id ascending. Pass `null` as
 * the cursor for the first page; subsequent pages pass the previous page's
 * `nextCursor`. Reads are public, so the browser Supabase client is used in
 * both the client hook and the Server Component prefetch.
 */
export async function fetchWordsPage(
  cursor: number | null,
  filter: WordsFilter = {},
): Promise<WordsPage> {
  const supabase = createClientSupabaseClient();

  let query = supabase
    .from("words")
    .select(COLUMNS)
    .order("id", { ascending: true })
    .limit(WORDS_PAGE_SIZE);

  if (cursor !== null) query = query.gt("id", cursor);
  if (filter.cefr) query = query.eq("cefr", filter.cefr);
  if (filter.word_type) query = query.eq("word_type", filter.word_type);
  if (filter.search) query = query.ilike("lemma", `%${filter.search}%`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Word[];
  const nextCursor =
    rows.length < WORDS_PAGE_SIZE ? null : rows[rows.length - 1].id;

  return { data: rows, nextCursor };
}
