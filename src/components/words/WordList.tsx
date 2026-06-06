"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { saveWord, unsaveWord } from "@/actions/save-word";
import { useWords, type WordFilters } from "@/hooks/useWords";
import { useSavedWords } from "@/hooks/useSavedWords";
import { WordDetailSheet } from "@/components/words/WordDetailSheet";
import { WordRow, type WordStatus } from "@/components/words/WordRow";
import { masteryProgress } from "@/lib/sm2";
import { toTopic } from "@/lib/word-topics";
import type { CefrLevel, Word, WordType } from "@/types";

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

/**
 * Compact, scannable list view of the dictionary. Replaces the card grid: each
 * word is a low row (German / Polish / CEFR / save toggle / status dot) and
 * tapping a row opens the detail sheet.
 */
export function WordList({
  cefr,
  type,
  q,
  topic,
}: {
  cefr?: string;
  type?: string;
  q?: string;
  topic?: string;
}) {
  const filters: WordFilters = {
    search: q?.trim() || undefined,
    cefr: toCefr(cefr),
    type: toType(type),
    topic: toTopic(topic),
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

  // Map word id -> its saved scheduling state, used to derive the status dot.
  const savedById = useMemo(
    () => new Map((saved ?? []).map((s) => [s.word_id, s])),
    [saved],
  );
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const isSaved = useCallback(
    (id: number) => overrides[id] ?? savedById.has(id),
    [overrides, savedById],
  );

  // Derive the status dot from the saved word's SM-2 scheduling state. Falls
  // back to "saved" when an optimistic toggle outpaces the saved-words refetch.
  const statusFor = useCallback(
    (id: number): WordStatus => {
      if (!isSaved(id)) return "none";
      const s = savedById.get(id);
      if (!s) return "saved";
      if (s.is_mastered) return "mastered";
      return s.due_at <= new Date().toISOString() ? "review" : "saved";
    },
    [isSaved, savedById],
  );

  // Mastery progress (0–1) for the row bar; undefined when the word isn't saved.
  const progressFor = useCallback(
    (id: number): number | undefined => {
      const s = savedById.get(id);
      return s ? masteryProgress(s.interval) : undefined;
    },
    [savedById],
  );

  const onSave = useCallback(
    async (word: Word) => {
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

  // The word whose detail sheet is open (null when closed).
  const [selected, setSelected] = useState<Word | null>(null);

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
    return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  }

  if (isError) {
    throw new Error("Failed to load dictionary");
  }

  if (words.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="text-3xl">🔍</p>
        <p className="mt-2">Brak wyników dla „{q ?? ""}”</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pokazano {words.length} z {total} słów
      </p>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {words.map((word) => (
          <WordRow
            key={word.id}
            word={word}
            isSaved={isSaved(word.id)}
            status={statusFor(word.id)}
            progress={progressFor(word.id)}
            onSave={() => onSave(word)}
            onOpen={() => setSelected(word)}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-8" />
      {isFetchingNextPage && (
        <p className="text-center text-sm text-muted-foreground">Ładowanie…</p>
      )}

      <WordDetailSheet
        word={selected}
        isSaved={selected ? isSaved(selected.id) : false}
        onSave={() => selected && onSave(selected)}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
