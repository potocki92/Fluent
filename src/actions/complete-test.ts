"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { scoreTest } from "@/lib/elo";
import { abilityToCefr } from "@/lib/cefr";

export interface CompleteTestInput {
  textId: number;
  answers: {
    questionId: number;
    selectedIdx: number;
    /** Time the learner took to answer, in ms. Recorded when available. */
    responseMs?: number;
  }[];
}

export interface CompleteTestResult {
  correct: number;
  total: number;
  abilityBefore: number;
  abilityAfter: number;
  /** New rating deviation after scoring the whole test. */
  rd: number;
  /** Total questions answered after this test (for confidence display). */
  answered: number;
}

/**
 * Score a whole completed test in one shot. Re-grades every answer server-side
 * (the client score is never trusted), then applies a single Elo update: a pass
 * (≥ pass line) adds points, a fail (≤ 2/5) deducts them, weighted by how hard
 * the text was for the learner. Writes the immutable attempt rows, the updated
 * profile, and bumps the daily streak once.
 */
export async function completeTest(
  input: CompleteTestInput,
): Promise<CompleteTestResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (input.answers.length === 0) throw new Error("No answers to score");

  // 1. Re-grade authoritatively on the server. The `grade_test` SECURITY
  //    DEFINER function reads `correct_idx` (never exposed to the client) and
  //    returns only per-question correctness + difficulty, scoped to the text.
  const { data: graded, error: gError } = await supabase.rpc("grade_test", {
    p_text_id: input.textId,
    p_question_ids: input.answers.map((a) => a.questionId),
    p_selected_idxs: input.answers.map((a) => a.selectedIdx),
  });
  if (gError || !graded || graded.length === 0)
    throw new Error("Questions not found");

  const total = graded.length;
  const correct = graded.filter((g) => g.is_correct).length;
  const avgDifficulty =
    graded.reduce((sum, g) => sum + g.difficulty, 0) / total;

  // Per-question response time, keyed by question id, to record on each attempt.
  const responseMsById = new Map(
    input.answers.map((a) => [a.questionId, a.responseMs ?? null]),
  );

  // 3. Load the learner's current ability.
  const { data: profile, error: pError } = await supabase
    .from("profiles")
    .select("ability, rd, answered")
    .eq("id", user.id)
    .single();
  if (pError || !profile) throw new Error("Profile not found");

  const before = { ability: Number(profile.ability), rd: Number(profile.rd) };

  // 4. Score the whole test at once.
  const score = scoreTest(before, avgDifficulty, correct, total, {
    answered: profile.answered,
  });

  // 5. Persist: immutable attempts + updated profile (+ streak once).
  const { error: aError } = await supabase.from("attempts").insert(
    graded.map((g) => ({
      user_id: user.id,
      question_id: g.question_id,
      text_id: input.textId,
      is_correct: g.is_correct,
      ability_before: before.ability,
      ability_after: score.ability,
      response_ms: responseMsById.get(g.question_id) ?? null,
    })),
  );
  if (aError) throw aError;

  const answered = profile.answered + total;

  // `updated_at` is stamped automatically by the profiles_touch_updated_at trigger.
  const { error: uError } = await supabase
    .from("profiles")
    .update({
      ability: score.ability,
      rd: score.rd,
      answered,
      cefr_estimate: abilityToCefr(score.ability),
    })
    .eq("id", user.id);
  if (uError) throw uError;

  await supabase.rpc("update_streak", { p_user_id: user.id });

  return {
    correct,
    total,
    abilityBefore: before.ability,
    abilityAfter: score.ability,
    rd: score.rd,
    answered,
  };
}
