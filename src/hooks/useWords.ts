import { useInfiniteQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { toTopic } from "@/lib/word-topics";
import type { CefrLevel, Word, WordTopic, WordType } from "@/types";

export interface WordFilters {
  search?: string;
  cefr?: Exclude<CefrLevel, "A1+">;
  type?: WordType;
  topic?: WordTopic;
}

/** Number of words fetched per page when scrolling the dictionary. */
const PAGE_SIZE = 30;

/** Only the columns the list/detail UI needs — avoids shipping `source`/`created_at`. */
const WORD_COLUMNS =
  "id, lemma, display, article, word_type, gender, translation_pl, example_de, example_pl, cefr";

const CEFR_VALUES = new Set<Exclude<CefrLevel, "A1+">>(["A1", "A2", "B1", "B2"]);
const TYPE_VALUES = new Set<WordType>(["noun", "verb", "other"]);

/**
 * Normalise raw URL search params into a typed {@link WordFilters}. Shared by the
 * client list and the server prefetch so both produce the *same* TanStack query
 * key — otherwise the SSR-hydrated cache would miss and the client would refetch.
 */
export function buildWordFilters(params: {
  cefr?: string;
  type?: string;
  q?: string;
  topic?: string;
}): WordFilters {
  return {
    search: params.q?.trim() || undefined,
    cefr:
      params.cefr && CEFR_VALUES.has(params.cefr as Exclude<CefrLevel, "A1+">)
        ? (params.cefr as Exclude<CefrLevel, "A1+">)
        : undefined,
    type:
      params.type && TYPE_VALUES.has(params.type as WordType)
        ? (params.type as WordType)
        : undefined,
    topic: toTopic(params.topic),
  };
}

export interface WordsPage {
  words: Word[];
  /** Total number of words matching the current filters. */
  count: number;
  /** Next page index, or null when there are no more results. */
  nextPage: number | null;
}

/**
 * Fetch one offset page of dictionary words. Reads are public, so the browser
 * Supabase client is used both in the client hook and in the Server Component
 * prefetch.
 *
 * Only the first page (`pageParam === 0`) asks Postgres for an exact `count` —
 * deeper pages skip the full COUNT scan and detect the end from the page size.
 * The UI reads the total off page 0, so later pages don't need it.
 */
export async function fetchWordsOffsetPage(
  pageParam: number,
  filters: WordFilters,
): Promise<WordsPage> {
  const supabase = createClientSupabaseClient();
  const from = pageParam * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const wantCount = pageParam === 0;

  let query = supabase
    .from("words")
    .select(WORD_COLUMNS, wantCount ? { count: "exact" } : undefined)
    .order("lemma")
    .range(from, to);

  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(
      `lemma.ilike.${term},display.ilike.${term},translation_pl.ilike.${term}`,
    );
  }
  if (filters.cefr) {
    query = query.eq("cefr", filters.cefr);
  }
  if (filters.type) {
    query = query.eq("word_type", filters.type);
  }
  if (filters.topic) {
    query = query.eq("topic", filters.topic);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const words = (data ?? []) as unknown as Word[];
  // No exact total on deeper pages — fall back to "a full page means more".
  const nextPage = words.length < PAGE_SIZE ? null : pageParam + 1;
  return { words, count: count ?? 0, nextPage };
}

/**
 * Fetch dictionary words page-by-page, optionally filtered by search/CEFR/type.
 * Search matches the German lemma/display or the Polish translation.
 */
export function useWords(filters: WordFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["words", filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchWordsOffsetPage(pageParam, filters),
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}
