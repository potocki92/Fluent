import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Question, Text } from "@/types";

/** Fetch the list of reading passages, ordered by difficulty. */
export function useTexts() {
  return useQuery({
    queryKey: ["texts"],
    queryFn: async (): Promise<Text[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("texts")
        .select("*")
        .eq("status", "published")
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
        .eq("status", "published")
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: Number.isFinite(textId),
  });
}

/**
 * Fetch the comprehension questions for a text from the answer-free
 * `questions_public` view. `correct_idx` is not exposed there at all — grading
 * goes through the `submit-answer` / `complete-test` Server Actions.
 */
export function useQuestions(textId: number) {
  return useQuery({
    queryKey: ["questions", textId],
    queryFn: async (): Promise<Question[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("questions_public")
        .select("id, text_id, prompt, options, difficulty")
        .eq("text_id", textId)
        .order("id", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as Question[];
    },
    enabled: Number.isFinite(textId),
  });
}

/**
 * Suggest the reading passage whose difficulty is closest to the learner's
 * current ability. Pure client computation over the cached `useTexts` list —
 * no extra network request.
 */
export function useAdaptiveTextSuggestion(ability: number): Text | null {
  const { data: texts } = useTexts();

  return useMemo(() => {
    if (!texts || texts.length === 0) return null;

    return texts.reduce((best, text) =>
      Math.abs(text.difficulty - ability) < Math.abs(best.difficulty - ability)
        ? text
        : best,
    );
  }, [texts, ability]);
}
