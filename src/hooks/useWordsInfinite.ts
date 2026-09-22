import { useInfiniteQuery } from "@tanstack/react-query";

import type { WordFilters } from "@/lib/dictionary/contracts";
import { fetchWordsCursorPage } from "@/lib/dictionary/queries";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Cursor-based infinite list of dictionary words for the `/words` route.
 *
 * The query key is namespaced with `"cursor"` so it never collides with the
 * offset-based `useWords` hook that powers `/browse` — the two have different
 * page shapes and must not share cache. They now share everything else: one
 * projection, one filter meaning, one adapter.
 */
export function useWordsInfinite(filters: WordFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["words", "cursor", filters] as const,
    queryFn: ({ pageParam }) =>
      fetchWordsCursorPage(createClientSupabaseClient(), pageParam, filters),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
