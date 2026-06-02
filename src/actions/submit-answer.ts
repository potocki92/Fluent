"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateAbility } from "@/lib/elo";
import { abilityToCefr } from "@/lib/cefr";
import type { TestResult } from "@/types";

export interface SubmitAnswerInput {
  questionId: number;
  selectedIdx: number;
}

export interface SubmitAnswerResult extends TestResult {
  /** The correct option index — only revealed after submitting. */
  correctIdx: number;
}

/**
 * Grade a single answer. This is the ONLY place `correct_idx` is read, keeping
 * the answer key off the client until the user has committed to an answer.
 * Updates the learner's Elo ability, writes an immutable attempt row, and bumps
 * the daily streak.
 */
export async function submitAnswer(
  input: SubmitAnswerInput,
): Promise<SubmitAnswerResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // 1. Load the question including the (server-only) answer key.
  const { data: question, error: qError } = await supabase
    .from("questions")
    .select("id, text_id, correct_idx, difficulty")
    .eq("id", input.questionId)
    .single();
  if (qError || !question) throw new Error("Question not found");

  const isCorrect = input.selectedIdx === question.correct_idx;

  // 2. Load the learner's current ability.
  const { data: profile, error: pError } = await supabase
    .from("profiles")
    .select("ability, rd, answered")
    .eq("id", user.id)
    .single();
  if (pError || !profile) throw new Error("Profile not found");

  const before = { ability: Number(profile.ability), rd: Number(profile.rd) };

  // 3. Compute the new Elo ability.
  const after = updateAbility(before, question.difficulty, isCorrect);

  // 4. Persist: immutable attempt + updated profile (+ streak).
  const { error: aError } = await supabase.from("attempts").insert({
    user_id: user.id,
    question_id: question.id,
    text_id: question.text_id,
    is_correct: isCorrect,
    ability_before: before.ability,
    ability_after: after.ability,
  });
  if (aError) throw aError;

  await supabase
    .from("profiles")
    .update({
      ability: after.ability,
      rd: after.rd,
      answered: profile.answered + 1,
      cefr_estimate: abilityToCefr(after.ability),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  await supabase.rpc("update_streak", { p_user_id: user.id });

  return {
    questionId: question.id,
    isCorrect,
    abilityBefore: before.ability,
    abilityAfter: after.ability,
    correctIdx: question.correct_idx,
  };
}
