import type { Metadata } from "next";
import { Suspense } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { BrowseFilters } from "@/components/words/BrowseFilters";
import { WordList } from "@/components/words/WordList";
import { getQueryClient } from "@/lib/query-client";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildWordFilters, fetchWordsOffsetPage } from "@/hooks/useWords";
import { SAVED_WORDS_KEY, SAVED_WORD_COLUMNS } from "@/hooks/useSavedWords";
import type { SavedWord } from "@/types";

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
  const supabase = await createServerSupabaseClient();

  // Best-effort prefetch: failures degrade to the client hooks fetching on
  // mount, so a prefetch error never crashes the Server Component render.
  await Promise.allSettled([
    queryClient.prefetchInfiniteQuery({
      queryKey: ["words", filters],
      queryFn: ({ pageParam }) =>
        fetchWordsOffsetPage(pageParam as number, filters),
      initialPageParam: 0,
      getNextPageParam: (lastPage) => lastPage.nextPage,
      pages: 1,
    }),
    // Prime the saved-words cache so the "w nauce" count and status dots render
    // on first paint instead of after a second client round-trip.
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("saved_words")
        .select(SAVED_WORD_COLUMNS)
        .order("due_at", { ascending: true });
      queryClient.setQueryData(SAVED_WORDS_KEY, (data ?? []) as SavedWord[]);
    })(),
  ]);

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

        <HydrationBoundary state={dehydrate(queryClient)}>
          <BrowseFilters cefr={cefr} type={type} q={q} topic={topic} />

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
