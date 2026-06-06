import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { TextCompletion } from "@/types";

/**
 * Fetch the learner's per-text results (one row per finished text, latest result
 * wins). Drives the learn page: passed texts move to the "read & passed" section
 * and are dropped from the main list and the adaptive suggestion. RLS scopes the
 * rows to the signed-in user; signed-out users simply get an empty list.
 */
export function useCompletedTexts(): UseQueryResult<TextCompletion[]> {
  return useQuery({
    queryKey: ["completedTexts"],
    queryFn: async (): Promise<TextCompletion[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("text_completions")
        .select("user_id, text_id, passed, correct, total, completed_at")
        .order("completed_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Index completions by `text_id` for quick lookup when rendering text cards. */
export function useCompletionsByTextId(): Map<number, TextCompletion> {
  const { data } = useCompletedTexts();

  return useMemo(() => {
    const map = new Map<number, TextCompletion>();
    for (const c of data ?? []) map.set(c.text_id, c);
    return map;
  }, [data]);
}
