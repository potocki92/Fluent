import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { SavedWord, Word } from "@/types";

export type SavedWordWithWord = SavedWord & { word: Word };

/** Fetch the current user's saved words joined with the dictionary entry. */
export function useSavedWords() {
  return useQuery({
    queryKey: ["saved_words"],
    queryFn: async (): Promise<SavedWordWithWord[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("saved_words")
        .select("*, word:words(*)")
        .order("due_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as SavedWordWithWord[];
    },
  });
}

/** Saved words that are due for review now (filtered server-side by due_at). */
export function useDueWords() {
  const query = useQuery({
    queryKey: ["saved_words", "due"],
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
