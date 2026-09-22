"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { scoreTest } from "@/lib/elo";
import { abilityToCefr, gatePromotion } from "@/lib/cefr";
import { scoreSessionItems, type StoredSessionItem } from "@/lib/test-session";
import {
  loadTagsForEvidence,
  prepareEvidence,
} from "@/lib/learning/commit-evidence";
import { testAnswerEvidence, type LearningEvidence } from "@/lib/learning/evidence";
import { DEFAULT_TEST_TAGS, loadQuestionTags } from "@/lib/learning/item-tags";
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

/**
 * A stale read is retried before giving up. Two things can now move under us —
 * the profile and the learner's knowledge state — so the loop gets one more
 * attempt than it needed when only the rating was at stake. It is still a
 * lost-update guard, not a retry loop: the last failure is reported.
 */
const MAX_ATTEMPTS = 3;

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
      .select(
        "id, text_id, status, ability_before, rd_before, ability_after, rd_after, correct, total, passed",
      )
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
      .select("question_id, item_difficulty, is_correct, answered_at, response_ms")
      .eq("session_id", sessionId);
    if (itemsError) {
      return failFrom(itemsError, `finalizeTestSession: load items ${sessionId}`);
    }

    const answers = rows ?? [];
    const items: StoredSessionItem[] = answers.map((row) => ({
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

    // 4. Learning evidence. One observation per answered question, attributed to
    //    what the item is tagged as exercising — and to nothing else. Folded
    //    against the state just read, so the whole test moves each state row
    //    once instead of five times.
    const built = await buildTestEvidence(supabase, sessionId, session.text_id, answers);
    // Refuse rather than seal the test with a payload that moves nothing: the
    // session stays `in_progress` and the whole finalization can be re-run.
    if (!built.ok) return built;

    const prepared = await prepareEvidence(
      supabase,
      user.id,
      built.evidence,
      `finalizeTestSession ${sessionId}`,
    );
    if (!prepared.ok) return prepared;

    // 5. Commit. Everything below this line either all happens or none of it does.
    const { data, error } = await service.rpc("finalize_test_session", {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_ability_before: before.ability,
      p_ability_after: gated.ability,
      p_rd_after: test.rd,
      p_cefr_estimate: abilityToCefr(gated.ability),
      p_promotion_streak: gated.streak,
      p_passed: test.passed,
      p_evidence: prepared.json,
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

/** One answered session item, as read back for evidence. */
interface AnsweredItem {
  question_id: number;
  is_correct: boolean | null;
  answered_at: string | null;
  response_ms: number | null;
}

/**
 * Turn a session's committed answers into learning evidence.
 *
 * Unanswered items produce nothing — an item with no answer is not an
 * observation. Neither is an item whose tags could not be read: those fall back
 * to the skill the column itself defaults to and carry no concepts, so a failed
 * tag lookup costs precision, never correctness.
 */
async function buildTestEvidence(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  sessionId: string,
  textId: number,
  answers: readonly AnsweredItem[],
): Promise<ActionResult<{ evidence: LearningEvidence[] }>> {
  const answered = answers.filter(
    (row) => row.answered_at !== null && row.is_correct !== null,
  );
  if (answered.length === 0) return { ok: true, evidence: [] };

  // A failed tag read is not "no tags" — see `@/lib/learning/commit-evidence`.
  const loaded = await loadTagsForEvidence(
    () =>
      loadQuestionTags(
        supabase,
        answered.map((row) => row.question_id),
      ),
    `finalizeTestSession ${sessionId}`,
  );
  if (!loaded.ok) return loaded;
  const tags = loaded.tags;

  const evidence = answered.map((row) => {
    const itemTags = tags.get(row.question_id) ?? DEFAULT_TEST_TAGS;
    return testAnswerEvidence({
      sessionId,
      questionId: row.question_id,
      textId,
      skillCode: itemTags.skillCode ?? "reading_comprehension",
      conceptCodes: itemTags.conceptCodes,
      testedWordId: itemTags.testedWordId,
      isCorrect: row.is_correct === true,
      responseMs: row.response_ms,
      occurredAt: row.answered_at as string,
    });
  });

  return { ok: true, evidence };
}
