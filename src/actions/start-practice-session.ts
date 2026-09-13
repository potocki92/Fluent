"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CONCEPT_CATALOG, isConceptCode } from "@/lib/learning/concepts";
import { MAX_PRACTICE_QUESTIONS } from "@/lib/learning/planner/constants";
import { firstUnansweredIndex, type StoredSessionItem } from "@/lib/test-session";
import { fail, failFrom, type ActionResult } from "@/lib/errors";

/** A drill question as delivered to the client — no `correct_idx`, ever. */
export interface PracticeQuestion {
  questionId: number;
  prompt: string;
  options: string[];
  answered: boolean;
}

export interface StartedPracticeSession {
  sessionId: string;
  conceptCode: string;
  conceptLabel: string;
  questions: PracticeQuestion[];
  /** Where to resume; non-zero when an unfinished drill is reopened. */
  resumeAt: number;
}

/**
 * Open (or resume) a weakness drill.
 *
 * SAME TRUST BOUNDARY AS A TEST. The client sends a concept and gets back a
 * session plus the questions it will be scored on. It never chooses the items,
 * so it cannot pick the easy ones or repeat the one it already knows the answer
 * to — `start_practice_session` snapshots them server-side.
 *
 * WHAT IS DIFFERENT FROM A TEST is what a drill deliberately does NOT do: it
 * does not touch Elo, CEFR, `attempts` or `text_completions`, and it cannot move
 * the learner's displayed level. Practising a weakness is not sitting an exam,
 * and a learner who drills their worst concept should not watch their level fall
 * for doing exactly what they were asked to do.
 *
 * ITEM SELECTION prefers items the learner has not seen, then the ones they have
 * not seen for longest. Five Dativ questions drilled every morning would teach
 * the position of the right button; see `start_practice_session` for the query.
 */
export async function startPracticeSession(input: {
  conceptCode: string;
  /** Set when the drill was opened from today's plan, so finishing it moves the plan. */
  planItemId?: string | null;
  limit?: number;
}): Promise<ActionResult<StartedPracticeSession>> {
  if (!isConceptCode(input.conceptCode)) {
    return fail(
      "invalid_input",
      "startPracticeSession: unknown concept",
      input.conceptCode,
    );
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startPracticeSession: no session");

  const { data: sessionId, error: startError } = await supabase.rpc(
    "start_practice_session",
    {
      p_concept_code: input.conceptCode,
      p_plan_item_id: input.planItemId ?? null,
      p_limit: input.limit ?? MAX_PRACTICE_QUESTIONS,
    },
  );
  if (startError || !sessionId) {
    return failFrom(startError, `startPracticeSession: ${input.conceptCode}`);
  }

  const { data: items, error: itemsError } = await supabase.rpc(
    "get_practice_session",
    { p_session_id: sessionId },
  );
  if (itemsError || !items) {
    return failFrom(itemsError, `startPracticeSession: load ${sessionId}`);
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
    conceptCode: input.conceptCode,
    conceptLabel: CONCEPT_CATALOG[input.conceptCode].labelPl,
    questions: items.map((item) => ({
      questionId: item.question_id,
      prompt: item.prompt,
      options: item.options,
      answered: item.answered_at !== null,
    })),
    resumeAt: firstUnansweredIndex(stored),
  };
}
