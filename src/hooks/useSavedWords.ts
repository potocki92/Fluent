import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { SavedWord, Word } from "@/types";
import { savedWordKeys } from "@/lib/query-keys";

export type SavedWordWithWord = SavedWord & { word: Word };

/** TanStack key for the user's saved words — shared so the server can prime it. */
export const SAVED_WORDS_KEY = savedWordKeys.all;

/**
 * Columns the dictionary UI needs from `saved_words`. The list only derives the
 * status dot / mastery progress from the scheduling fields, so the dictionary
 * row itself is *not* joined — that join shipped a full word per saved entry for
 * data the UI never reads.
 */
export const SAVED_WORD_COLUMNS =
  "user_id, word_id, interval, repetitions, ease_factor, due_at, is_mastered, saved_at";

/** Fetch the current user's saved words (scheduling fields only, no join). */
export function useSavedWords() {
  return useQuery({
    queryKey: SAVED_WORDS_KEY,
    queryFn: async (): Promise<SavedWord[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("saved_words")
        .select(SAVED_WORD_COLUMNS)
        .order("due_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as SavedWord[];
    },
  });
}

/** Saved words that are due for review now (filtered server-side by due_at). */
export function useDueWords() {
  const query = useQuery({
    queryKey: savedWordKeys.due(),
    queryFn: async (): Promise<SavedWordWithWord[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("saved_words")
        .select("*, word:words(*)")
        .eq("is_mastered", false)
        .lte("due_at", new Date().toISOString())
        .order("due_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as SavedWordWithWord[];
    },
  });
  return { ...query, due: query.data ?? [] };
}
