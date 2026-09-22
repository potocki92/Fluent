"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { saveWord, unsaveWord } from "@/actions/save-word";
import { useWords, type WordFilters } from "@/hooks/useWords";
import { useSavedWords } from "@/hooks/useSavedWords";
import { WordCard } from "@/components/words/WordCard";
import type { DictionaryListWord } from "@/lib/dictionary/contracts";
import type { CefrLevel, WordType } from "@/types";

const CEFR_VALUES = new Set<Exclude<CefrLevel, "A1+">>(["A1", "A2", "B1", "B2"]);
const TYPE_VALUES = new Set<WordType>(["noun", "verb", "other"]);

function toCefr(value?: string): WordFilters["cefr"] {
  return value && CEFR_VALUES.has(value as Exclude<CefrLevel, "A1+">)
    ? (value as Exclude<CefrLevel, "A1+">)
    : undefined;
}

function toType(value?: string): WordType | undefined {
  return value && TYPE_VALUES.has(value as WordType)
    ? (value as WordType)
    : undefined;
}

export function WordGrid({
  cefr,
  type,
  q,
}: {
  cefr?: string;
  type?: string;
  q?: string;
}) {
  const filters: WordFilters = {
    search: q?.trim() || undefined,
    cefr: toCefr(cefr),
    type: toType(type),
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useWords(filters);
  const { data: saved } = useSavedWords();
  const queryClient = useQueryClient();

  const savedIds = useMemo(
    () => new Set((saved ?? []).map((s) => s.word_id)),
    [saved],
  );
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const isSaved = useCallback(
    (id: number) => overrides[id] ?? savedIds.has(id),
    [overrides, savedIds],
  );

  const onSave = useCallback(
    async (word: DictionaryListWord) => {
      const next = !isSaved(word.id);
      setOverrides((o) => ({ ...o, [word.id]: next }));
      try {
        if (next) await saveWord(word.id);
        else await unsaveWord(word.id);
        await queryClient.invalidateQueries({ queryKey: ["saved_words"] });
      } catch {
        // Revert the optimistic toggle on failure.
        setOverrides((o) => ({ ...o, [word.id]: !next }));
      }
    },
    [isSaved, queryClient],
  );

  const words = useMemo(
    () => data?.pages.flatMap((p) => p.words) ?? [],
    [data],
  );
  const total = data?.pages[0]?.count ?? 0;

  // Infinite scroll: load the next page when the sentinel enters the viewport.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return <p className="text-sm text-[#a0aec0]">Ładowanie…</p>;
  }

  if (isError) {
    throw new Error("Failed to load dictionary");
  }

  if (words.length === 0) {
    return (
      <div className="py-16 text-center text-[#a0aec0]">
        <p className="text-3xl">🔍</p>
        <p className="mt-2">Brak wyników dla „{q ?? ""}”</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#a0aec0]">
        Pokazano {words.length} z {total} słów
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {words.map((word) => (
          <WordCard
            key={word.id}
            word={word}
            isSaved={isSaved(word.id)}
            onSave={() => onSave(word)}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && (
        <p className="text-center text-sm text-[#a0aec0]">Ładowanie…</p>
      )}
    </div>
  );
}
