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
 * Grade a single answer for immediate feedback. This is the ONLY place
 * `correct_idx` is read for a text question, keeping the answer key off the
 * client until the user has committed to an answer.
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

  const { data: question, error: qError } = await supabase
    .from("questions")
    .select("id, correct_idx")
    .eq("id", input.questionId)
    .single();
  if (qError || !question) throw new Error("Question not found");

  return {
    questionId: question.id,
    isCorrect: input.selectedIdx === question.correct_idx,
    correctIdx: question.correct_idx,
  };
}
