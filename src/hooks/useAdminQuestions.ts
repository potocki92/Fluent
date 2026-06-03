import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { QuestionWithAnswer } from "@/types";

/**
 * Fetch the questions for a text in the admin panel. Unlike the learner
 * `useQuestions` (which omits `correct_idx`), admins are allowed the full row
 * including the answer key so they can verify and edit it.
 */
export function useAdminQuestions(textId: number) {
  return useQuery({
    queryKey: ["adminQuestions", textId],
    queryFn: async (): Promise<QuestionWithAnswer[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("questions")
        .select("*")
        .eq("text_id", textId)
        .order("id", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as QuestionWithAnswer[];
    },
    enabled: Number.isFinite(textId),
  });
}
