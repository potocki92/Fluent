/**
 * Reading the dictionary, once, for both sides of the app.
 *
 * Every function here takes the Supabase client as a PARAMETER. That is the
 * whole design: the dictionary is public, RLS-readable content, so the browser
 * hook hands it `createClientSupabaseClient()` and a Server Component hands it
 * the cookie-bound server client, and both run the same query against the same
 * projection under the same query key. The alternative the codebase used —
 * calling `createClientSupabaseClient()` inside the fetcher and then also
 * calling that fetcher from a Server Component prefetch — works only because
 * the read is public, and stops working silently the moment it is not.
 *
 * It also means the query shape is testable without mocking a module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DICTIONARY_DETAIL_COLUMNS,
  DICTIONARY_LIST_COLUMNS,
  toWordDetail,
  type DictionaryListWord,
  type DictionaryWordDetail,
  type WordFilters,
} from "@/lib/dictionary/contracts";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** Number of words fetched per page when scrolling the dictionary. */
export const WORDS_PAGE_SIZE = 30;

/**
 * The cache keys for everything dictionary-shaped.
 *
 * A factory rather than inline arrays so a filter added to {@link WordFilters}
 * cannot be forgotten in one of the four places that build this key — which is
 * how an SSR prefetch and its client hook end up on different keys, and the
 * prefetched page is silently refetched on mount.
 */
export const dictionaryKeys = {
  all: ["words"] as const,
  list: (filters: WordFilters) => ["words", "list", filters] as const,
  detail: (wordId: number | null) => ["words", "detail", wordId] as const,
};

export interface WordsPage {
  words: DictionaryListWord[];
  /** Total matching the current filters. Only page 0 pays for the COUNT. */
  count: number;
  /** Next page index, or null when there are no more results. */
  nextPage: number | null;
}

/**
 * Apply the filters to a `words` query.
 *
 * One definition of what each filter MEANS, shared by both pagination
 * strategies below. There used to be two: this one, and a second module whose
 * search matched only the German lemma — so the same word was findable on one
 * dictionary screen and not on the other, for no reason anybody had decided.
 */
function applyWordFilters<Q extends {
  or(filter: string): Q;
  eq(column: string, value: string): Q;
}>(query: Q, filters: WordFilters): Q {
  let next = query;
  if (filters.search) {
    const term = `%${filters.search}%`;
    next = next.or(
      `lemma.ilike.${term},display.ilike.${term},translation_pl.ilike.${term}`,
    );
  }
  if (filters.cefr) next = next.eq("cefr", filters.cefr);
  if (filters.type) next = next.eq("word_type", filters.type);
  if (filters.topic) next = next.eq("topic", filters.topic);
  return next;
}

/**
 * Fetch one offset page of dictionary words.
 *
 * Only the first page (`pageParam === 0`) asks Postgres for an exact `count` —
 * deeper pages skip the full COUNT scan and detect the end from the page size.
 */
export async function fetchWordsPage(
  supabase: Client,
  pageParam: number,
  filters: WordFilters,
): Promise<WordsPage> {
  const from = pageParam * WORDS_PAGE_SIZE;
  const to = from + WORDS_PAGE_SIZE - 1;
  const wantCount = pageParam === 0;

  const query = supabase
    .from("words")
    .select(DICTIONARY_LIST_COLUMNS, wantCount ? { count: "exact" } : undefined)
    // `lemma` is not unique (a noun and a verb can share one), so a page
    // boundary that falls between two equal lemmas would otherwise repeat or
    // skip a row depending on how Postgres happened to order them. `id` is the
    // tie-breaker that makes the sequence total.
    .order("lemma")
    .order("id")
    .range(from, to);

  const { data, error, count } = await applyWordFilters(query, filters);
  if (error) throw error;

  const words: DictionaryListWord[] = data ?? [];
  // No exact total on deeper pages — fall back to "a full page means more".
  const nextPage = words.length < WORDS_PAGE_SIZE ? null : pageParam + 1;
  return { words, count: count ?? 0, nextPage };
}

/**
 * Fetch everything the detail sheet shows for one word.
 *
 * Kept off the list query on purpose: `synonyms` is an array and `example_*`
 * are sentences, and a thirty-row page pays for them thirty times over to show
 * them at most once. The sheet is opened by a tap, which is exactly when the
 * extra round trip is free.
 */
export async function fetchWordDetail(
  supabase: Client,
  wordId: number,
): Promise<DictionaryWordDetail | null> {
  const { data, error } = await supabase
    .from("words")
    .select(DICTIONARY_DETAIL_COLUMNS)
    .eq("id", wordId)
    .maybeSingle();
  if (error) throw error;
  return data ? toWordDetail(data) : null;
}

/** One cursor page of words, ordered by id. */
export interface WordsCursorPage {
  words: DictionaryListWord[];
  /** Last id of this page, or null when exhausted. */
  nextCursor: number | null;
}

/**
 * Fetch one cursor-based page, ordered by id ascending.
 *
 * A second pagination strategy for the same table, and a deliberate one: `id`
 * is unique and monotonic, so a cursor page cannot repeat or skip a row when
 * the dictionary grows underneath a reader — which an OFFSET can. The offset
 * variant above survives because `/browse` needs the exact total a cursor
 * cannot give it.
 */
export async function fetchWordsCursorPage(
  supabase: Client,
  cursor: number | null,
  filters: WordFilters = {},
): Promise<WordsCursorPage> {
  let query = supabase
    .from("words")
    .select(DICTIONARY_LIST_COLUMNS)
    .order("id", { ascending: true })
    .limit(WORDS_PAGE_SIZE);

  if (cursor !== null) query = query.gt("id", cursor);

  const { data, error } = await applyWordFilters(query, filters);
  if (error) throw error;

  const words: DictionaryListWord[] = data ?? [];
  const nextCursor =
    words.length < WORDS_PAGE_SIZE ? null : words[words.length - 1].id;
  return { words, nextCursor };
}
