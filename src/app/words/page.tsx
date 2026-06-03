import type { Metadata } from "next";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { WordList } from "@/components/words/infinite/WordList";
import { getQueryClient } from "@/lib/query-client";
import { fetchWordsPage, type WordsFilter } from "@/lib/queries/words";

export const metadata: Metadata = {
  title: "Słowa — Fluent",
};

// Prefetch happens per request (SSR), so render dynamically rather than baking
// the first page in at build time.
export const dynamic = "force-dynamic";

export default async function WordsPage() {
  const filter: WordsFilter = {};
  const queryClient = getQueryClient();

  // Prefetch only the first page so the initial 20 words render instantly with
  // no client loading state. `pages: 1` keeps the SSR payload to one page.
  await queryClient.prefetchInfiniteQuery({
    queryKey: ["words", "cursor", filter],
    queryFn: ({ pageParam }) => fetchWordsPage(pageParam, filter),
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    pages: 1,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Słowa</h1>
          <p className="text-sm text-muted-foreground">
            Przeglądaj słownictwo — przewijaj w dół, aby załadować więcej.
          </p>
        </header>

        <WordList filter={filter} />
      </div>
    </HydrationBoundary>
  );
}
