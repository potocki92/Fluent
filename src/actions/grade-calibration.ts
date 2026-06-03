"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface GradeCalibrationInput {
  questionId: number;
  selectedIdx: number;
}

export interface GradeCalibrationResult {
  questionId: number;
  isCorrect: boolean;
  /** The correct option index — only revealed after submitting. */
  correctIdx: number;
  /** The item's Elo difficulty, used to fold the answer into the estimate. */
  difficulty: number;
}

/**
 * Grade a single calibration item. The ONLY place a calibration item's
 * `correct_idx` is read, keeping the answer key off the client.
 */
export async function gradeCalibrationAnswer(
  input: GradeCalibrationInput,
): Promise<GradeCalibrationResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: question, error } = await supabase
    .from("calibration_questions")
    .select("id, correct_idx, difficulty")
    .eq("id", input.questionId)
    .single();
  if (error || !question) throw new Error("Question not found");

  return {
    questionId: question.id,
    isCorrect: input.selectedIdx === question.correct_idx,
    correctIdx: question.correct_idx,
    difficulty: question.difficulty,
  };
}
