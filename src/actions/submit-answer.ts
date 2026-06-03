"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface SubmitAnswerInput {
  questionId: number;
  selectedIdx: number;
}

export interface SubmitAnswerResult {
  questionId: number;
  isCorrect: boolean;
  /** The correct option index — only revealed after submitting. */
  correctIdx: number;
}

/**
 * Grade a single answer for immediate feedback. `correct_idx` is never readable
 * from the client — the `grade_question` SECURITY DEFINER function is the only
 * path to it, and it only reveals the key for the one question being answered.
 *
 * Grading no longer touches the learner's Elo — ability is updated once, after
 * the whole test, by the `complete-test` Server Action. This keeps a single
 * good answer from moving the rating before the test is finished.
 */
export async function submitAnswer(
  input: SubmitAnswerInput,
): Promise<SubmitAnswerResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase.rpc("grade_question", {
    p_question_id: input.questionId,
    p_selected_idx: input.selectedIdx,
  });
  const graded = data?.[0];
  if (error || !graded) throw new Error("Question not found");

  return {
    questionId: input.questionId,
    isCorrect: graded.is_correct,
    correctIdx: graded.correct_idx,
  };
}
