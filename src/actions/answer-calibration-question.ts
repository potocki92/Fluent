"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { sanitizeResponseMs } from "@/lib/response-time";

export interface AnswerCalibrationInput {
  sessionId: string;
  questionId: number;
  /** Index into the item's STORED option order, not the displayed one. */
  selectedIdx: number;
  responseMs?: number;
}

export interface AnsweredCalibrationQuestion {
  questionId: number;
  isCorrect: boolean;
  /** Revealed only now that this item's answer is committed to the session. */
  correctIdx: number;
  /** The item's Elo difficulty, used to advance the on-screen estimate. */
  difficulty: number;
  alreadyAnswered: boolean;
}

/**
 * Commit one placement-test answer.
 *
 * Same trust model as `answerTestQuestion`: the key is returned only for an item
 * inside the caller's own in-progress session and only after the answer is
 * recorded, and re-answering an item returns what was stored rather than
 * replacing it. The difficulty comes back so the client can keep its visible
 * estimate moving — but that client-side estimate is presentation only. The
 * rating that reaches the profile is replayed from these stored rows.
 */
export async function answerCalibrationQuestion(
  input: AnswerCalibrationInput,
): Promise<ActionResult<AnsweredCalibrationQuestion>> {
  if (!Number.isInteger(input.questionId) || !Number.isInteger(input.selectedIdx)) {
    return fail("invalid_input", "answerCalibrationQuestion: malformed ids", input);
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "answerCalibrationQuestion: no session");

  const { data, error } = await supabase.rpc("answer_calibration_question", {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_idx: input.selectedIdx,
    p_response_ms: sanitizeResponseMs(input.responseMs),
  });

  const graded = data?.[0];
  if (error || !graded) {
    return failFrom(
      error,
      `answerCalibrationQuestion: ${input.sessionId}/${input.questionId}`,
    );
  }

  return {
    ok: true,
    questionId: input.questionId,
    isCorrect: graded.is_answer_correct,
    correctIdx: graded.answer_key_idx,
    difficulty: graded.item_difficulty,
    alreadyAnswered: graded.already_answered,
  };
}
