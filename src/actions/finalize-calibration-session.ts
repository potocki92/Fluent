"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { replayCalibration } from "@/lib/calibration-test";
import { abilityToCefr } from "@/lib/cefr";
import {
  evidenceJson,
  foldEvidence,
  EMPTY_EVIDENCE_PAYLOAD,
} from "@/lib/learning/aggregate";
import { calibrationAnswerEvidence, type LearningEvidence } from "@/lib/learning/evidence";
import { loadCalibrationTags, UNTAGGED } from "@/lib/learning/item-tags";
import { loadKnowledgeSnapshot } from "@/lib/learning/snapshot";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { AbilityState } from "@/types";

/**
 * Finish a placement test and write the learner's level.
 *
 * THE POINT OF THIS ACTION: it takes a session id and nothing else. The old
 * `finishCalibration({ ability, rd, items })` accepted whatever numbers the
 * browser had computed, which meant "set my level to B2" was a single fetch
 * call away. Here the server loads the answers the learner actually committed —
 * item difficulty and correctness, in the order they were given — and REPLAYS
 * them through the same `updateAbility` the on-screen estimate used. Identical
 * arithmetic over identical inputs, so the learner sees the number they
 * watched being built, and a forged one has nowhere to enter.
 *
 * The write itself goes through the service-role `finalize_calibration_session`,
 * which is atomic, idempotent, and unreachable from the browser.
 */
export async function finalizeCalibrationSession(
  sessionId: string,
): Promise<ActionResult<AbilityState>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "finalizeCalibrationSession: no session");

  // Ownership is enforced inside the RPC against auth.uid().
  const { data: answers, error: answersError } = await supabase.rpc(
    "get_calibration_session_answers",
    { p_session_id: sessionId },
  );
  if (answersError || !answers) {
    return failFrom(answersError, `finalizeCalibrationSession: load ${sessionId}`);
  }
  if (answers.length === 0) {
    return fail("session_incomplete", `finalizeCalibrationSession: no answers ${sessionId}`);
  }

  const replayed = replayCalibration(
    answers.map((answer) => ({
      itemDifficulty: answer.item_difficulty,
      isCorrect: answer.is_correct,
    })),
  );
  const cefrEstimate = abilityToCefr(replayed.ability);

  // A placement answer is evidence like any other: a grammar item that went
  // wrong tells us about grammar whether it was asked during a test or during
  // placement. What does NOT change is what the placement test is FOR — it still
  // sets the learner's level exactly as before. This only stops its answers from
  // being thrown away afterwards.
  const evidence = await buildCalibrationEvidence(supabase, sessionId, answers);
  const snapshot = await loadKnowledgeSnapshot(supabase, user.id, evidence).catch(
    (snapshotError) => {
      console.error("[fluent:knowledge] snapshot load failed", snapshotError);
      return null;
    },
  );
  const folded = snapshot ? foldEvidence(snapshot, evidence) : null;

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail(
      "config_error",
      "finalizeCalibrationSession: service role unavailable",
      error,
    );
  }

  const { data, error } = await service.rpc("finalize_calibration_session", {
    p_session_id: sessionId,
    p_user_id: user.id,
    p_ability: replayed.ability,
    p_rd: replayed.rd,
    p_cefr_estimate: cefrEstimate,
    p_evidence: evidenceJson(folded?.payload ?? EMPTY_EVIDENCE_PAYLOAD),
  });

  const result = data?.[0];
  if (error || !result) {
    return failFrom(error, `finalizeCalibrationSession: commit ${sessionId}`);
  }

  return {
    ok: true,
    ability: Number(result.ability_value),
    rd: Number(result.rd_value),
    answered: result.profile_answered,
    cefrEstimate: (result.cefr_value ?? cefrEstimate) as AbilityState["cefrEstimate"],
  };
}

/** One stored placement answer, as `get_calibration_session_answers` returns it. */
interface StoredCalibrationAnswer {
  question_id: number;
  is_correct: boolean;
  response_ms: number | null;
  answered_at: string;
}

/**
 * Turn stored placement answers into learning evidence.
 *
 * An item whose tags cannot be read is attributed to NO skill: unlike a reading
 * question, a placement item could be about vocabulary or grammar, and guessing
 * would put the wrong evidence under the wrong dimension. The answer is still
 * recorded as history — it just teaches the model nothing.
 */
async function buildCalibrationEvidence(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  sessionId: string,
  answers: readonly StoredCalibrationAnswer[],
): Promise<LearningEvidence[]> {
  if (answers.length === 0) return [];

  const tags = await loadCalibrationTags(
    supabase,
    answers.map((answer) => answer.question_id),
  ).catch((error) => {
    console.error("[fluent:knowledge] calibration tags unavailable", error);
    return new Map<number, never>();
  });

  return answers.map((answer) => {
    const itemTags = tags.get(answer.question_id) ?? UNTAGGED;
    return calibrationAnswerEvidence({
      sessionId,
      questionId: answer.question_id,
      skillCode: itemTags.skillCode,
      conceptCodes: itemTags.conceptCodes,
      testedWordId: itemTags.testedWordId,
      isCorrect: answer.is_correct,
      responseMs: answer.response_ms,
      occurredAt: answer.answered_at,
    });
  });
}
