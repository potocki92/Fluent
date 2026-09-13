"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { replayCalibration } from "@/lib/calibration-test";
import { abilityToCefr } from "@/lib/cefr";
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
