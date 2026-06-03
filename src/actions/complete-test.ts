"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { scoreTest } from "@/lib/elo";
import { abilityToCefr } from "@/lib/cefr";

export interface CompleteTestInput {
  textId: number;
  answers: { questionId: number; selectedIdx: number }[];
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

  // 1. Load the answered questions (with the server-only answer key) and verify
  //    they belong to the claimed text.
  const questionIds = input.answers.map((a) => a.questionId);
  const { data: questions, error: qError } = await supabase
    .from("questions")
    .select("id, text_id, correct_idx, difficulty")
    .in("id", questionIds)
    .eq("text_id", input.textId);
  if (qError || !questions || questions.length === 0)
    throw new Error("Questions not found");

  const byId = new Map(questions.map((q) => [q.id, q]));

  // 2. Re-grade authoritatively on the server.
  const graded = input.answers.flatMap((answer) => {
    const question = byId.get(answer.questionId);
    if (!question) return [];
    return [
      {
        question,
        isCorrect: answer.selectedIdx === question.correct_idx,
      },
    ];
  });

  const total = graded.length;
  if (total === 0) throw new Error("No matching questions to score");
  const correct = graded.filter((g) => g.isCorrect).length;
  const avgDifficulty =
    graded.reduce((sum, g) => sum + g.question.difficulty, 0) / total;

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
      question_id: g.question.id,
      text_id: g.question.text_id,
      is_correct: g.isCorrect,
      ability_before: before.ability,
      ability_after: score.ability,
    })),
  );
  if (aError) throw aError;

  const answered = profile.answered + total;

  await supabase
    .from("profiles")
    .update({
      ability: score.ability,
      rd: score.rd,
      answered,
      cefr_estimate: abilityToCefr(score.ability),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

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
