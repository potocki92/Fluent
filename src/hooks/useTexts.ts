import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { isTextTooHard } from "@/lib/cefr";
import type { Text } from "@/types";
import { textKeys } from "@/lib/query-keys";

/** Fetch the list of reading passages, ordered by difficulty. */
export function useTexts() {
  return useQuery({
    queryKey: textKeys.all,
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
    queryKey: textKeys.detail(textId),
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
 * Suggest the reading passage whose difficulty is closest to the learner's
 * current ability. Pure client computation over the cached `useTexts` list —
 * no extra network request. Texts the learner has already passed (in
 * `passedTextIds`) and texts that are too hard for their level are excluded, so
 * the suggestion is always something new and reachable.
 */
export function useAdaptiveTextSuggestion(
  ability: number,
  passedTextIds?: Set<number>,
): Text | null {
  const { data: texts } = useTexts();

  return useMemo(() => {
    const candidates = (texts ?? []).filter(
      (t) =>
        !passedTextIds?.has(t.id) && !isTextTooHard(t.difficulty, ability),
    );
    if (candidates.length === 0) return null;

    return candidates.reduce((best, text) =>
      Math.abs(text.difficulty - ability) < Math.abs(best.difficulty - ability)
        ? text
        : best,
    );
  }, [texts, ability, passedTextIds]);
}
