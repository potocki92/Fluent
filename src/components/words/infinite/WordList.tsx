"use client";

import { useIntersection } from "@/hooks/useIntersection";
import { useWordsInfinite } from "@/hooks/useWordsInfinite";
import type { WordFilters } from "@/lib/dictionary/contracts";

import { WordCard } from "./WordCard";

function WordSkeleton() {
  return <div className="h-[72px] animate-pulse rounded-xl bg-card" />;
}

export function WordList({ filter }: { filter: WordFilters }) {
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useWordsInfinite(filter);

  // Load the next page as the sentinel approaches the viewport.
  const sentinelRef = useIntersection(
    () => fetchNextPage(),
    hasNextPage && !isFetchingNextPage,
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <WordSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="rounded-xl bg-card p-4 text-center text-sm text-red">
        Nie udało się załadować słów. Spróbuj ponownie później.
      </p>
    );
  }

  const words = data?.pages.flatMap((page) => page.words) ?? [];

  if (words.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        Brak słów spełniających kryteria.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {words.map((word) => (
        <WordCard key={word.id} word={word} />
      ))}

      {isFetchingNextPage &&
        Array.from({ length: 3 }).map((_, i) => (
          <WordSkeleton key={`loading-${i}`} />
        ))}

      <div ref={sentinelRef} className="h-px" aria-hidden />

      {!hasNextPage && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Wszystkie słowa załadowane ({words.length})
        </p>
      )}
    </div>
  );
}
