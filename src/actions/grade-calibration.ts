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
 * Grade a single calibration item. `correct_idx` is never readable from the
 * client — the `grade_calibration` SECURITY DEFINER function is the only path to
 * it, revealing the key only for the one item being answered.
 */
export async function gradeCalibrationAnswer(
  input: GradeCalibrationInput,
): Promise<GradeCalibrationResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase.rpc("grade_calibration", {
    p_question_id: input.questionId,
    p_selected_idx: input.selectedIdx,
  });
  const graded = data?.[0];
  if (error || !graded) throw new Error("Question not found");

  return {
    questionId: input.questionId,
    isCorrect: graded.is_correct,
    correctIdx: graded.correct_idx,
    difficulty: graded.difficulty,
  };
}
