import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Text } from "@/types";

/** A text row for the admin list, with its question count attached. */
export type AdminTextRow = Text & { questionCount: number };

/**
 * Fetch all reading passages for the admin list (drafts included — admin RLS
 * returns them), newest first, with each text's question count via an embedded
 * aggregate. Distinct query key from the learner `["texts"]` cache.
 */
export function useAdminTexts() {
  return useQuery({
    queryKey: ["adminTexts"],
    queryFn: async (): Promise<AdminTextRow[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("texts")
        .select("*, questions(count)")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as (Text & {
        questions: { count: number }[];
      })[];
      return rows.map(({ questions, ...text }) => ({
        ...text,
        questionCount: questions[0]?.count ?? 0,
      }));
    },
  });
}

/** Fetch a single passage by id for the edit form (drafts included). */
export function useAdminText(textId: number) {
  return useQuery({
    queryKey: ["adminText", textId],
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
