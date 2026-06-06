"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { review, GRADE_QUALITY } from "@/lib/sm2";

export type ReviewGrade = keyof typeof GRADE_QUALITY;

/**
 * Apply an SM-2 review to a saved word and persist the new schedule.
 * Called from the flashcard review screen.
 */
export async function updateSrs(
  wordId: number,
  grade: ReviewGrade,
): Promise<{ dueAt: string; isMastered: boolean; reviewedToday: number }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: current, error: cError } = await supabase
    .from("saved_words")
    .select("interval, repetitions, ease_factor")
    .eq("user_id", user.id)
    .eq("word_id", wordId)
    .single();
  if (cError || !current) throw new Error("Saved word not found");

  const result = review(
    {
      interval: current.interval,
      repetitions: current.repetitions,
      easeFactor: Number(current.ease_factor),
    },
    GRADE_QUALITY[grade],
  );

  const { error: uError } = await supabase
    .from("saved_words")
    .update({
      interval: result.interval,
      repetitions: result.repetitions,
      ease_factor: result.easeFactor,
      due_at: result.dueAt,
      is_mastered: result.isMastered,
    })
    .eq("user_id", user.id)
    .eq("word_id", wordId);
  if (uError) throw uError;

  // Track daily review count and vocabulary streak.
  const { data: count } = await supabase.rpc("bump_word_review", {
    p_user_id: user.id,
  });

  return {
    dueAt: result.dueAt,
    isMastered: result.isMastered,
    reviewedToday: count ?? 0,
  };
}
