"use client";

import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import {
  WORD_GOAL_KEY,
  WORD_GOAL_COLUMNS,
  toWordGoalData,
  type WordGoalData,
} from "@/lib/word-goal";

// Re-export the shared types/constants so existing `@/hooks/useWordGoal`
// importers keep working; the source of truth now lives in `@/lib/word-goal`
// (a server-safe, non-"use client" module — see that file for why).
export {
  WORD_GOAL_KEY,
  WORD_GOAL_COLUMNS,
  toWordGoalData,
  type WordGoalData,
};

export function useWordGoal(): { data: WordGoalData | undefined; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: WORD_GOAL_KEY,
    queryFn: async (): Promise<WordGoalData> => {
      const supabase = createClientSupabaseClient();
      const { data: profile, error } = await supabase
        .from("profiles")
        .select(WORD_GOAL_COLUMNS)
        .maybeSingle();
      if (error) throw error;

      return toWordGoalData(profile);
    },
    staleTime: 30_000,
  });

  return { data, isLoading };
}
