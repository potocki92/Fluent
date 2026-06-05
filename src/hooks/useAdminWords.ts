import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Word, WordTopic } from "@/types";

/** Filter expression matching entries with any missing translation/example. */
const MISSING_OR = "translation_pl.is.null,example_de.is.null,example_pl.is.null";

/** Cap the admin list so the dictionary's ~2.6k rows aren't fetched at once. */
const ADMIN_PAGE_SIZE = 60;

export interface AdminWordFilters {
  search?: string;
  topic?: WordTopic;
  /** When true, only entries missing a translation or example are returned. */
  missingOnly?: boolean;
}

export interface AdminWordsResult {
  words: Word[];
  /** Total entries matching the filters (may exceed the returned page). */
  count: number;
}

/**
 * Fetch dictionary entries for the admin editor, ordered by lemma. Distinct
 * query key from the learner `["words"]` cache. Supports search, topic and a
 * "missing fields" filter (used by the "Do uzupełnienia" queue).
 */
export function useAdminWords(filters: AdminWordFilters = {}) {
  return useQuery({
    queryKey: ["adminWords", filters],
    queryFn: async (): Promise<AdminWordsResult> => {
      const supabase = createClientSupabaseClient();
      let query = supabase
        .from("words")
        .select("*", { count: "exact" })
        .order("lemma")
        .limit(ADMIN_PAGE_SIZE);

      if (filters.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `lemma.ilike.${term},display.ilike.${term},translation_pl.ilike.${term}`,
        );
      }
      if (filters.topic) {
        query = query.eq("topic", filters.topic);
      }
      if (filters.missingOnly) {
        query = query.or(MISSING_OR);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      return { words: data ?? [], count: count ?? 0 };
    },
  });
}

/**
 * Count of dictionary entries with a missing translation or example, shown on
 * the "Do uzupełnienia" chip regardless of the active filter.
 */
export function useMissingWordsCount() {
  return useQuery({
    queryKey: ["adminWords", "missingCount"],
    queryFn: async (): Promise<number> => {
      const supabase = createClientSupabaseClient();
      const { count, error } = await supabase
        .from("words")
        .select("id", { count: "exact", head: true })
        .or(MISSING_OR);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
