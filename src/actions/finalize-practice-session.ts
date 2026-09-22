"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  loadTagsForEvidence,
  prepareEvidence,
} from "@/lib/learning/commit-evidence";
import { practiceAnswerEvidence, type LearningEvidence } from "@/lib/learning/evidence";
import { loadQuestionTags } from "@/lib/learning/item-tags";
import { isConceptCode, type ConceptCode } from "@/lib/learning/concepts";
import { fail, failFrom, type ActionResult } from "@/lib/errors";

export interface FinalizedPracticeSession {
  sessionId: string;
  conceptCode: string;
  correct: number;
  total: number;
  /** True when the drill was already sealed — the stored result is returned. */
  alreadyFinalized: boolean;
}

/** A stale knowledge read is recomputed rather than forced through. */
const MAX_ATTEMPTS = 3;

/**
 * Seal a weakness drill and record what it proved.
 *
 * THIS IS WHERE THE LOOP CLOSES. The whole point of Phase 3 is the cycle
 *
 *     mistakes → evidence → weakness ranking → today's drill → new evidence
 *
 * and this function is the arrow from "the learner did the drill" back into the
 * knowledge model. Its answers update `user_concept_state` through exactly the
 * same `apply_learning_evidence` path a test uses, so tomorrow's ranking already
 * reflects them — a concept that is now being answered correctly starts sliding
 * down the list on its own, with nobody marking it resolved.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: Elo ability, CEFR, the promotion gate,
 * `attempts`, `text_completions`, the reading streak. A drill is practice, not an
 * exam, and its items were chosen *because* the learner keeps failing them —
 * scoring a level from that biased sample would punish them for practising.
 *
 * SHAPE: read → compute → commit, with only the commit touching the database,
 * once, atomically. `finalize_practice_session` seals the session, applies the
 * evidence and moves the plan item in one transaction, so there is no state where
 * the drill is finished and today's plan still shows it as pending.
 */
export async function finalizePracticeSession(
  sessionId: string,
): Promise<ActionResult<FinalizedPracticeSession>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "finalizePracticeSession: no session");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail(
      "config_error",
      "finalizePracticeSession: service role unavailable",
      error,
    );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // RLS scopes this to the caller, so someone else's session id resolves to
    // nothing rather than to a permission error.
    const { data: session, error: sessionError } = await supabase
      .from("practice_sessions")
      .select("id, concept_code, status, correct, total")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      return failFrom(sessionError, `finalizePracticeSession: load ${sessionId}`);
    }
    if (!session) {
      return fail("not_found", `finalizePracticeSession: no session ${sessionId}`);
    }

    const { data: rows, error: itemsError } = await supabase
      .from("practice_session_items")
      .select("question_id, is_correct, answered_at, response_ms")
      .eq("session_id", sessionId);
    if (itemsError) {
      return failFrom(itemsError, `finalizePracticeSession: items ${sessionId}`);
    }

    const answered = (rows ?? []).filter(
      (row) => row.answered_at !== null && row.is_correct !== null,
    );
    if (answered.length === 0) {
      return fail("session_incomplete", `finalizePracticeSession: empty ${sessionId}`);
    }
    if (session.status === "in_progress" && answered.length < (rows?.length ?? 0)) {
      return fail(
        "session_incomplete",
        `finalizePracticeSession: unanswered items in ${sessionId}`,
      );
    }

    const built = await buildPracticeEvidence(
      supabase,
      sessionId,
      session.concept_code,
      answered,
    );
    // Nothing below this point runs on a half-read knowledge state: the drill
    // stays `in_progress` and the same finalization can be retried in full.
    if (!built.ok) return built;

    const prepared = await prepareEvidence(
      supabase,
      user.id,
      built.evidence,
      `finalizePracticeSession ${sessionId}`,
    );
    if (!prepared.ok) return prepared;

    const { data, error } = await service.rpc("finalize_practice_session", {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_evidence: prepared.json,
    });

    const result = data?.[0];
    if (!error && result) {
      return {
        ok: true,
        sessionId,
        conceptCode: session.concept_code,
        correct: result.correct_count,
        total: result.total_count,
        alreadyFinalized: result.already_finalized,
      };
    }

    // The knowledge state moved between the read and the commit (another tab, a
    // queued review). Recompute from fresh data rather than overwriting it.
    if (error?.code === "FL423" && attempt < MAX_ATTEMPTS) continue;

    return failFrom(error, `finalizePracticeSession: commit ${sessionId}`);
  }

  return fail("stale_state", `finalizePracticeSession: gave up on ${sessionId}`);
}

interface AnsweredItem {
  question_id: number;
  is_correct: boolean | null;
  answered_at: string | null;
  response_ms: number | null;
}

/**
 * Turn a drill's committed answers into learning evidence.
 *
 * The concept the drill was ABOUT is always attributed, because the drill drew
 * its items from that concept's tag in the first place — that is not an
 * inference, it is the selection criterion. Any other concepts the item carries
 * are attributed too, and nothing else is: an item that also tests
 * `case_dative` says something about `case_dative`, and an item tagged with
 * neither says nothing about either.
 */
async function buildPracticeEvidence(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  sessionId: string,
  conceptCode: string,
  answered: readonly AnsweredItem[],
): Promise<ActionResult<{ evidence: LearningEvidence[] }>> {
  // A failed tag read is NOT "no tags". Untagged evidence moves no state, so
  // swallowing this sealed the drill and recorded nothing — see
  // `src/lib/learning/commit-evidence.ts`.
  const loaded = await loadTagsForEvidence(
    () =>
      loadQuestionTags(
        supabase,
        answered.map((row) => row.question_id),
      ),
    `finalizePracticeSession ${sessionId}`,
  );
  if (!loaded.ok) return loaded;
  const tags = loaded.tags;

  const drilled: ConceptCode[] = isConceptCode(conceptCode) ? [conceptCode] : [];

  const evidence = answered.map((row) => {
    const itemTags = tags.get(row.question_id);
    const conceptCodes = new Set<ConceptCode>([
      ...drilled,
      ...(itemTags?.conceptCodes ?? []),
    ]);

    return practiceAnswerEvidence({
      sessionId,
      questionId: row.question_id,
      textId: itemTags?.textId ?? null,
      skillCode: itemTags?.skillCode ?? null,
      conceptCodes: [...conceptCodes],
      testedWordId: itemTags?.testedWordId ?? null,
      isCorrect: row.is_correct === true,
      responseMs: row.response_ms,
      occurredAt: row.answered_at as string,
    });
  });

  return { ok: true, evidence };
}
