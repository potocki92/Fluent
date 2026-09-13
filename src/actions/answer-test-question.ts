"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { sanitizeResponseMs } from "@/lib/response-time";

export interface AnswerTestQuestionInput {
  sessionId: string;
  questionId: number;
  /** Index into the question's STORED option order, not the displayed one. */
  selectedIdx: number;
  /** Client-measured time to answer, in ms. Analytics only — never trusted. */
  responseMs?: number;
}

export interface AnsweredTestQuestion {
  questionId: number;
  isCorrect: boolean;
  /**
   * The correct option index, revealed only now that the answer is committed.
   * See the note on the answer oracle below.
   */
  correctIdx: number;
  /**
   * True when this question already had an answer — a double tap, a retried
   * request, or a resumed session. The returned result is the STORED one.
   */
  alreadyAnswered: boolean;
}

/**
 * Commit one answer to a test session and return the feedback for it.
 *
 * WHY THE ANSWER KEY COMES BACK. The product shows the learner which option was
 * right immediately after they choose. The old design granted that by exposing
 * `grade_question(questionId, selectedIdx)`, which answered "what is the key for
 * item N" for any item, to anyone signed in, forever. The key is now bound to a
 * commitment: it is only returned for a question inside the caller's own
 * in-progress session, and only after that session's single answer for it has
 * been written. Learning the key therefore costs the attempt it belongs to.
 *
 * IDEMPOTENCY. The database keeps the first answer (one row per
 * session+question, only updatable while `answered_at is null`), so a double
 * tap, an offline retry or a replayed Server Action re-reads what was stored
 * instead of overwriting it. That is why `alreadyAnswered` exists rather than an
 * error: to the learner, a retried tap should just show the same feedback again.
 */
export async function answerTestQuestion(
  input: AnswerTestQuestionInput,
): Promise<ActionResult<AnsweredTestQuestion>> {
  if (!Number.isInteger(input.questionId) || !Number.isInteger(input.selectedIdx)) {
    return fail("invalid_input", "answerTestQuestion: malformed ids", input);
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "answerTestQuestion: no session");

  // Ownership, session status and question membership are all re-checked inside
  // `answer_test_question` against auth.uid(); this action cannot widen them.
  const { data, error } = await supabase.rpc("answer_test_question", {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_idx: input.selectedIdx,
    p_response_ms: sanitizeResponseMs(input.responseMs),
  });

  const graded = data?.[0];
  if (error || !graded) {
    return failFrom(error, `answerTestQuestion: ${input.sessionId}/${input.questionId}`);
  }

  return {
    ok: true,
    questionId: input.questionId,
    isCorrect: graded.is_answer_correct,
    correctIdx: graded.answer_key_idx,
    alreadyAnswered: graded.already_answered,
  };
}
