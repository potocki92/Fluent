import type { Metadata } from "next";
import { Suspense } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { BrowseFilters } from "@/components/words/BrowseFilters";
import { WordList } from "@/components/words/WordList";
import { getQueryClient } from "@/lib/query-client";
import { buildWordFilters, fetchWordsOffsetPage } from "@/hooks/useWords";

export const metadata: Metadata = {
  title: "Słownik DTZ — Fluent",
};

// Prefetch the first page per request so the list paints with data instead of a
// client-side loading waterfall; awaiting searchParams already makes this route
// dynamic, but be explicit so prefetch never gets cached at build time.
export const dynamic = "force-dynamic";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    cefr?: string;
    type?: string;
    q?: string;
    topic?: string;
  }>;
}) {
  const { cefr, type, q, topic } = await searchParams;

  // Same filter shape (and therefore same query key) the client `useWords` uses,
  // so the SSR-prefetched first page hydrates straight into the cache.
  const filters = buildWordFilters({ cefr, type, q, topic });
  const queryClient = getQueryClient();
  await queryClient.prefetchInfiniteQuery({
    queryKey: ["words", filters],
    queryFn: ({ pageParam }) => fetchWordsOffsetPage(pageParam as number, filters),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    pages: 1,
  });

  return (
    <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
      <div className="mx-auto max-w-screen-md space-y-5 px-4">
        <header>
          <h1 className="text-2xl font-bold text-foreground">
            Słownik DTZ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            2 588 słów · lista DTZ (Goethe-Institut / telc)
          </p>
        </header>

        <BrowseFilters cefr={cefr} type={type} q={q} topic={topic} />

        <HydrationBoundary state={dehydrate(queryClient)}>
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">
                Ładowanie…
              </p>
            }
          >
            <WordList cefr={cefr} type={type} q={q} topic={topic} />
          </Suspense>
        </HydrationBoundary>
      </div>
    </div>
  );
}
