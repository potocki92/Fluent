"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { sanitizeResponseMs } from "@/lib/response-time";

export interface AnswerPracticeQuestionInput {
  sessionId: string;
  questionId: number;
  /** Index into the question's STORED option order, not the displayed one. */
  selectedIdx: number;
  /** Client-measured time to answer, in ms. Analytics only — never trusted. */
  responseMs?: number;
}

export interface AnsweredPracticeQuestion {
  questionId: number;
  isCorrect: boolean;
  /** Revealed only now that the answer is committed. */
  correctIdx: number;
  /** True when the item already had an answer; the STORED result is returned. */
  alreadyAnswered: boolean;
}

/**
 * Commit one answer to a weakness drill.
 *
 * Identical trust model to `answerTestQuestion`, and for the same reason: the
 * answer key is revealed only for an item inside the caller's own in-progress
 * session, and only once their single answer to it is written. A drill is not a
 * softer context in which the bank can leak.
 *
 * The first answer wins, so a double tap or a retried request re-reads the
 * stored one instead of changing the score.
 */
export async function answerPracticeQuestion(
  input: AnswerPracticeQuestionInput,
): Promise<ActionResult<AnsweredPracticeQuestion>> {
  if (!Number.isInteger(input.questionId) || !Number.isInteger(input.selectedIdx)) {
    return fail("invalid_input", "answerPracticeQuestion: malformed ids", input);
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "answerPracticeQuestion: no session");

  const { data, error } = await supabase.rpc("answer_practice_question", {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_idx: input.selectedIdx,
    p_response_ms: sanitizeResponseMs(input.responseMs),
  });

  const graded = data?.[0];
  if (error || !graded) {
    return failFrom(
      error,
      `answerPracticeQuestion: ${input.sessionId}/${input.questionId}`,
    );
  }

  return {
    ok: true,
    questionId: input.questionId,
    isCorrect: graded.is_answer_correct,
    correctIdx: graded.answer_key_idx,
    alreadyAnswered: graded.already_answered,
  };
}
