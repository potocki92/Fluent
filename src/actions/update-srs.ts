"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { review, GRADE_QUALITY, DEFAULT_EASE_FACTOR } from "@/lib/sm2";

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

  // A row may not exist yet when the learner grades a brand-new dictionary word
  // straight from the "ucz się dalej" deck — in that case start from a fresh
  // SM-2 state and let the upsert below enrol the word.
  const { data: current } = await supabase
    .from("saved_words")
    .select("interval, repetitions, ease_factor")
    .eq("user_id", user.id)
    .eq("word_id", wordId)
    .maybeSingle();

  const result = review(
    {
      interval: current?.interval ?? 0,
      repetitions: current?.repetitions ?? 0,
      easeFactor: current ? Number(current.ease_factor) : DEFAULT_EASE_FACTOR,
    },
    GRADE_QUALITY[grade],
  );

  // Upsert so a first review enrols the word; `saved_at` is omitted so its
  // default `now()` applies on insert and stays untouched on update.
  const { error: uError } = await supabase.from("saved_words").upsert({
    user_id: user.id,
    word_id: wordId,
    interval: result.interval,
    repetitions: result.repetitions,
    ease_factor: result.easeFactor,
    due_at: result.dueAt,
    is_mastered: result.isMastered,
  });
  if (uError) throw uError;

  // Track daily review count and vocabulary streak. `bump_word_review` derives
  // the user from auth.uid() — the old `p_user_id` variant ran as SECURITY
  // DEFINER while trusting the caller's uuid, so it could advance ANOTHER
  // learner's counters.
  const { data: count } = await supabase.rpc("bump_word_review");

  return {
    dueAt: result.dueAt,
    isMastered: result.isMastered,
    reviewedToday: count ?? 0,
  };
}
