"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import type { Word } from "@/types";

export interface QuizCard {
  word: Word;
  wordId: number;
  /** Four options (Polish translations), shuffled. */
  options: string[];
  /** Index of the correct answer in `options`. */
  answerIdx: number;
}

/** Deterministic pseudo-shuffle seeded on a word id. Avoids hydration mismatch. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    // Simple LCG-based position derived from seed + i
    const j = Math.abs((seed * 1664525 + i * 22695477 + 1013904223) | 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickDistractors(
  answer: string,
  pool: string[],
  seed: number,
): string[] {
  const candidates = pool.filter((t) => t !== answer);
  const shuffled = seededShuffle(candidates, seed);
  return shuffled.slice(0, 3);
}

/**
 * Builds a quiz deck from a list of flashcards: for each card, fetches
 * distractor translations and assembles 4-option questions.
 */
export function useQuizDeck(cards: SavedWordWithWord[]): {
  questions: QuizCard[];
  isLoading: boolean;
} {
  const ids = useMemo(() => cards.map((c) => c.word_id), [cards]);

  // Fetch a pool of translations from words sharing the same CEFR levels as the
  // deck. We limit to ~200 to keep the query cheap; each card needs only 3.
  const cefrs = useMemo(
    () => [...new Set(cards.map((c) => c.word.cefr).filter(Boolean))],
    [cards],
  );

  const { data: pool = [], isLoading } = useQuery({
    queryKey: ["quiz-distractors", cefrs],
    enabled: ids.length > 0,
    queryFn: async (): Promise<string[]> => {
      const supabase = createClientSupabaseClient();
      let query = supabase
        .from("words")
        .select("translation_pl")
        .not("translation_pl", "is", null)
        .limit(200);

      if (cefrs.length > 0) {
        query = query.in("cefr", cefrs);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? [])
        .map((r) => r.translation_pl as string)
        .filter(Boolean);
    },
    staleTime: 5 * 60 * 1000,
  });

  const questions = useMemo((): QuizCard[] => {
    if (isLoading || pool.length === 0) return [];

    return cards.map((card) => {
      const answer = card.word.translation_pl ?? "";
      let distractors = pickDistractors(answer, pool, card.word_id);

      // Fallback: if the same-CEFR pool is too small, widen to all passed items.
      if (distractors.length < 3) {
        const wider = pool.filter((t) => t !== answer);
        distractors = seededShuffle(wider, card.word_id).slice(0, 3);
      }

      // Build options array and track where the answer lands after shuffling.
      const raw = [answer, ...distractors.slice(0, 3)];
      const shuffled = seededShuffle(raw, card.word_id + 1);
      const answerIdx = shuffled.indexOf(answer);

      return {
        word: card.word,
        wordId: card.word_id,
        options: shuffled,
        answerIdx,
      };
    });
  }, [cards, pool, isLoading]);

  return { questions, isLoading };
}
