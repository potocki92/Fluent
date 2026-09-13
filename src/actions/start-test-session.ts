"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { firstUnansweredIndex, type StoredSessionItem } from "@/lib/test-session";

/** A question as delivered to the client — no `correct_idx`, ever. */
export interface TestSessionQuestion {
  questionId: number;
  prompt: string;
  options: string[];
  /** True once this question has a committed answer in the session. */
  answered: boolean;
}

export interface StartedTestSession {
  sessionId: string;
  questions: TestSessionQuestion[];
  /**
   * Index of the question to show first. Non-zero when an unfinished session is
   * being resumed.
   */
  resumeAt: number;
}

/**
 * Open (or resume) the authoritative session for a text's comprehension test.
 *
 * THE TRUST BOUNDARY: the client sends a text id and gets back a session plus
 * the questions that session will be scored on. It never chooses the question
 * list, so it cannot drop the hard ones, repeat an easy one, or mix in items
 * from another text — `start_test_session` snapshots them server-side.
 *
 * Re-entering a test the learner left half-finished returns the SAME session
 * with `resumeAt` pointing at the first unanswered question; already-committed
 * answers stay committed.
 */
export async function startTestSession(
  textId: number,
): Promise<ActionResult<StartedTestSession>> {
  if (!Number.isInteger(textId)) {
    return fail("invalid_input", "startTestSession: non-integer textId", textId);
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startTestSession: no session");

  const { data: sessionId, error: startError } = await supabase.rpc(
    "start_test_session",
    { p_text_id: textId },
  );
  if (startError || !sessionId) {
    return failFrom(startError, `startTestSession: text ${textId}`);
  }

  const { data: items, error: itemsError } = await supabase.rpc("get_test_session", {
    p_session_id: sessionId,
  });
  if (itemsError || !items) {
    return failFrom(itemsError, `startTestSession: load items ${sessionId}`);
  }

  const stored: StoredSessionItem[] = items.map((item) => ({
    questionId: item.question_id,
    itemDifficulty: item.item_difficulty,
    isCorrect: item.is_correct,
    answeredAt: item.answered_at,
  }));

  return {
    ok: true,
    sessionId,
    questions: items.map((item) => ({
      questionId: item.question_id,
      prompt: item.prompt,
      options: item.options,
      answered: item.answered_at !== null,
    })),
    resumeAt: firstUnansweredIndex(stored),
  };
}
