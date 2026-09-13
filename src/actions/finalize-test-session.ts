"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { scoreTest } from "@/lib/elo";
import { abilityToCefr, gatePromotion } from "@/lib/cefr";
import { scoreSessionItems, type StoredSessionItem } from "@/lib/test-session";
import { fail, failFrom, type ActionResult } from "@/lib/errors";

export interface FinalizedTestSession {
  sessionId: string;
  correct: number;
  total: number;
  abilityBefore: number;
  abilityAfter: number;
  rd: number;
  /** Total questions answered after this test (drives the confidence label). */
  answered: number;
  /** True when the session was already scored — the stored result is returned. */
  alreadyFinalized: boolean;
}

/** A stale profile read is retried once before giving up. */
const MAX_ATTEMPTS = 2;

/**
 * Turn a fully answered session into the learner's new state.
 *
 * SHAPE OF THIS ACTION: read → compute → commit, where only the commit touches
 * the database and it does so once, atomically.
 *
 *  - READ uses the learner's own cookie-bound client, so RLS still scopes every
 *    row to them. The answers come from `test_session_items` — what the learner
 *    actually committed, question by question — never from a payload.
 *  - COMPUTE runs the unit-tested domain functions (`scoreTest`,
 *    `gatePromotion`, `abilityToCefr`). Keeping the arithmetic in TypeScript is
 *    why it is not duplicated in PL/pgSQL, where it would silently drift.
 *  - COMMIT calls `finalize_test_session` with the SERVICE ROLE. That function
 *    writes attempts, the completion, the profile, the streak and the session
 *    row in one transaction, recounts the score from the stored items, and
 *    returns the stored result unchanged if the session was already finalized.
 *    EXECUTE on it is revoked from `anon`/`authenticated`, so the computed
 *    rating cannot be supplied by a browser.
 *
 * STALE READS: between the read and the commit, another tab could finalize a
 * different test and move the profile. The commit refuses a rating computed
 * from an ability that no longer matches (`stale_state`); this action then
 * re-reads and recomputes once. It is a lost-update guard, not a retry loop —
 * a second failure is reported rather than forced through.
 */
export async function finalizeTestSession(
  sessionId: string,
): Promise<ActionResult<FinalizedTestSession>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "finalizeTestSession: no session");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "finalizeTestSession: service role unavailable", error);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // 1. The session itself. RLS restricts this to the caller's own rows, so a
    //    session id belonging to someone else simply does not resolve.
    const { data: session, error: sessionError } = await supabase
      .from("test_sessions")
      .select("id, status, ability_before, rd_before, ability_after, rd_after, correct, total, passed")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      return failFrom(sessionError, `finalizeTestSession: load ${sessionId}`);
    }
    if (!session) {
      return fail("not_found", `finalizeTestSession: no session ${sessionId}`);
    }

    // 2. The committed answers, which are the only input to the score.
    const { data: rows, error: itemsError } = await supabase
      .from("test_session_items")
      .select("question_id, item_difficulty, is_correct, answered_at")
      .eq("session_id", sessionId);
    if (itemsError) {
      return failFrom(itemsError, `finalizeTestSession: load items ${sessionId}`);
    }

    const items: StoredSessionItem[] = (rows ?? []).map((row) => ({
      questionId: row.question_id,
      itemDifficulty: row.item_difficulty,
      isCorrect: row.is_correct,
      answeredAt: row.answered_at,
    }));
    const score = scoreSessionItems(items);

    if (score.total === 0) {
      return fail("not_found", `finalizeTestSession: empty session ${sessionId}`);
    }
    if (session.status === "in_progress" && score.unanswered > 0) {
      return fail(
        "session_incomplete",
        `finalizeTestSession: ${score.unanswered} unanswered in ${sessionId}`,
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("ability, rd, answered, promotion_streak")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) {
      return failFrom(profileError, `finalizeTestSession: profile ${user.id}`);
    }

    // 3. Score the whole test at once, then gate any CEFR band crossing so a
    //    single strong result never bumps the displayed level on its own.
    const before = { ability: Number(profile.ability), rd: Number(profile.rd) };
    const test = scoreTest(before, score.avgDifficulty, score.correct, score.total, {
      answered: profile.answered,
    });
    const gated = gatePromotion(
      before.ability,
      test.ability,
      test.passed,
      test.ratio,
      profile.promotion_streak,
    );

    // 4. Commit. Everything below this line either all happens or none of it does.
    const { data, error } = await service.rpc("finalize_test_session", {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_ability_before: before.ability,
      p_ability_after: gated.ability,
      p_rd_after: test.rd,
      p_cefr_estimate: abilityToCefr(gated.ability),
      p_promotion_streak: gated.streak,
      p_passed: test.passed,
    });

    const result = data?.[0];
    if (!error && result) {
      return {
        ok: true,
        sessionId,
        correct: result.correct_count,
        total: result.total_count,
        abilityBefore: Number(result.ability_start),
        abilityAfter: Number(result.ability_end),
        rd: Number(result.rd_end),
        answered: result.profile_answered,
        alreadyFinalized: result.already_finalized,
      };
    }

    // Someone else moved the profile mid-computation: recompute from fresh data.
    if (error?.code === "FL423" && attempt < MAX_ATTEMPTS) continue;

    return failFrom(error, `finalizeTestSession: commit ${sessionId}`);
  }

  return fail("stale_state", `finalizeTestSession: gave up retrying ${sessionId}`);
}
