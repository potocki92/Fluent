import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { CefrLevel, Word, WordType } from "@/types";

export interface WordFilters {
  search?: string;
  cefr?: Exclude<CefrLevel, "A1+">;
  type?: WordType;
}

/** Fetch dictionary words, optionally filtered by search/CEFR/type. */
export function useWords(filters: WordFilters = {}) {
  return useQuery({
    queryKey: ["words", filters],
    queryFn: async (): Promise<Word[]> => {
      const supabase = createClientSupabaseClient();
      let query = supabase.from("words").select("*").order("lemma").limit(100);

      if (filters.search) {
        query = query.ilike("lemma", `%${filters.search}%`);
      }
      if (filters.cefr) {
        query = query.eq("cefr", filters.cefr);
      }
      if (filters.type) {
        query = query.eq("word_type", filters.type);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}
