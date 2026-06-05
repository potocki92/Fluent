import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Word, WordSuggestion } from "@/types";

/** A pending suggestion with the word it targets, for the admin review queue. */
export type AdminSuggestionRow = WordSuggestion & {
  word: Pick<Word, "id" | "display" | "translation_pl"> | null;
};

/**
 * Fetch pending learner suggestions for admin review, oldest first, each joined
 * with its target word. Admin RLS returns every row; learners only ever see
 * their own (and never visit this queue).
 */
export function useAdminSuggestions() {
  return useQuery({
    queryKey: ["adminSuggestions"],
    queryFn: async (): Promise<AdminSuggestionRow[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("word_suggestions")
        .select("*, word:words(id, display, translation_pl)")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as AdminSuggestionRow[];
    },
  });
}
