import { useInfiniteQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { CefrLevel, Word, WordTopic, WordType } from "@/types";

export interface WordFilters {
  search?: string;
  cefr?: Exclude<CefrLevel, "A1+">;
  type?: WordType;
  topic?: WordTopic;
}

/** Number of words fetched per page when scrolling the dictionary. */
const PAGE_SIZE = 30;

export interface WordsPage {
  words: Word[];
  /** Total number of words matching the current filters. */
  count: number;
  /** Next page index, or null when there are no more results. */
  nextPage: number | null;
}

/**
 * Fetch dictionary words page-by-page, optionally filtered by search/CEFR/type.
 * Search matches the German lemma/display or the Polish translation.
 */
export function useWords(filters: WordFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["words", filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<WordsPage> => {
      const supabase = createClientSupabaseClient();
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("words")
        .select("*", { count: "exact" })
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

      const words = data ?? [];
      const total = count ?? 0;
      const nextPage = from + words.length < total ? pageParam + 1 : null;
      return { words, count: total, nextPage };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}
