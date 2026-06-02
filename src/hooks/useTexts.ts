import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Text } from "@/types";

/** Fetch the list of reading passages, ordered by difficulty. */
export function useTexts() {
  return useQuery({
    queryKey: ["texts"],
    queryFn: async (): Promise<Text[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("texts")
        .select("*")
        .order("difficulty", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Fetch a single reading passage by id. */
export function useText(textId: number) {
  return useQuery({
    queryKey: ["texts", textId],
    queryFn: async (): Promise<Text | null> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("texts")
        .select("*")
        .eq("id", textId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: Number.isFinite(textId),
  });
}
