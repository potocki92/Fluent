import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  isCefrFilter,
  isWordTypeFilter,
  type WordFilters,
} from "@/lib/dictionary/contracts";
import {
  dictionaryKeys,
  fetchWordDetail,
  fetchWordsPage,
} from "@/lib/dictionary/queries";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { toTopic } from "@/lib/word-topics";

export type { WordFilters } from "@/lib/dictionary/contracts";
export { dictionaryKeys, WORDS_PAGE_SIZE } from "@/lib/dictionary/queries";

/**
 * Normalise raw URL search params into a typed {@link WordFilters}.
 *
 * Shared by the client list and the server prefetch so both produce the *same*
 * TanStack query key — otherwise the SSR-hydrated cache misses and the client
 * refetches the page it was just handed.
 */
export function buildWordFilters(params: {
  cefr?: string;
  type?: string;
  q?: string;
  topic?: string;
}): WordFilters {
  return {
    search: params.q?.trim() || undefined,
    cefr: params.cefr && isCefrFilter(params.cefr) ? params.cefr : undefined,
    type: params.type && isWordTypeFilter(params.type) ? params.type : undefined,
    topic: toTopic(params.topic),
  };
}

/**
 * Fetch dictionary words page-by-page, optionally filtered by search/CEFR/type.
 * Search matches the German lemma/display or the Polish translation.
 */
export function useWords(filters: WordFilters = {}) {
  return useInfiniteQuery({
    queryKey: dictionaryKeys.list(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchWordsPage(createClientSupabaseClient(), pageParam, filters),
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}

/**
 * Everything the detail sheet shows for one word, fetched when it opens.
 *
 * The list row deliberately does NOT carry these columns. Before this hook the
 * sheet read them off the list row anyway — through a cast that claimed they
 * were there — and rendered nothing, every time, for every word.
 */
export function useWordDetail(wordId: number | null) {
  return useQuery({
    queryKey: dictionaryKeys.detail(wordId),
    queryFn: () => fetchWordDetail(createClientSupabaseClient(), wordId as number),
    enabled: wordId !== null,
    // The dictionary is admin-curated content, not the learner's own progress:
    // it does not change between two taps on the same word.
    staleTime: 5 * 60 * 1000,
  });
}
