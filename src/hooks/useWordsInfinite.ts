import { useInfiniteQuery } from "@tanstack/react-query";

import { fetchWordsPage, type WordsFilter } from "@/lib/queries/words";

/**
 * Cursor-based infinite list of dictionary words for the `/words` route.
 *
 * The query key is namespaced with `"cursor"` so it never collides with the
 * existing offset-based `useWords` hook (key `["words", filters]`) that powers
 * `/browse` — the two have different page shapes and must not share cache.
 */
export function useWordsInfinite(filter: WordsFilter = {}) {
  return useInfiniteQuery({
    queryKey: ["words", "cursor", filter],
    queryFn: ({ pageParam }) => fetchWordsPage(pageParam, filter),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
