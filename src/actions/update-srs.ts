"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  review,
  GRADE_QUALITY,
  DEFAULT_EASE_FACTOR,
  type ReviewGrade,
} from "@/lib/sm2";
import { reviewEvidence, type ReviewDirection, type ReviewMode } from "@/lib/learning/evidence";
import { prepareEvidence } from "@/lib/learning/commit-evidence";
import { sanitizeResponseMs } from "@/lib/response-time";
import { fail, failFrom, type ActionResult } from "@/lib/errors";

/**
 * The grade's SHAPE lives in `@/lib/sm2`, beside the grades it names, so a
 * component can type a button without importing a Server Action module.
 */
export type { ReviewGrade } from "@/lib/sm2";

export interface UpdateSrsInput {
  wordId: number;
  grade: ReviewGrade;
  /**
   * Idempotency token, minted once per card presentation. Two requests carrying
   * the same one settle the same review — see {@link updateSrs}.
   */
  interactionId: string;
  /** How the card was shown. Decides how strong the evidence is. */
  mode: ReviewMode;
  /** Which way round it was asked. Decides receptive vs active. */
  direction: ReviewDirection;
  responseMs?: number;
}

export interface ReviewOutcome {
  dueAt: string;
  isMastered: boolean;
  reviewedToday: number;
  /** True when this interaction had already been settled; nothing changed. */
  alreadyApplied: boolean;
}

/** A stale scheduling or knowledge read is retried before giving up. */
const MAX_ATTEMPTS = 3;

/**
 * Grade one review card.
 *
 * WHAT THIS DOES THAT THE OLD VERSION DID NOT. It used to upsert `saved_words`
 * and bump a counter, in two independent round trips, and keep no record that
 * the review had happened at all — `interval = 21` with no memory of the answer
 * that produced it. Three things changed:
 *
 *  1. **History is kept.** Every grading writes an immutable `review_events`
 *     row with the SM-2 state before and after. That is the data a better memory
 *     model (FSRS, or whatever replaces SM-2) will have to be fitted to; without
 *     it, that decision in a year would be made blind.
 *  2. **It is one transaction.** Review event, schedule, daily counter, learning
 *     event and word/skill knowledge all commit together inside `apply_review`,
 *     or none of them do. There is no longer a state where the interval moved
 *     but nothing recorded why.
 *  3. **It is idempotent.** A double tap on "Dobrze" used to push the interval
 *     out twice. `interactionId` is minted once per card, and a unique
 *     constraint — not a JavaScript guard — makes the second request return the
 *     first one's result.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: promote receptive practice into active
 * knowledge. A DE → PL card, whatever the learner pressed, is recognition; the
 * active channel of `user_word_knowledge` stays untouched. See
 * `src/lib/learning/evidence.ts`.
 */
export async function updateSrs(
  input: UpdateSrsInput,
): Promise<ActionResult<ReviewOutcome>> {
  if (!Number.isInteger(input.wordId)) {
    return fail("invalid_input", "updateSrs: non-integer wordId", input.wordId);
  }
  if (!input.interactionId) {
    return fail("invalid_input", "updateSrs: missing interactionId");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "updateSrs: no session");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "updateSrs: service role unavailable", error);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // A row may not exist yet when the learner grades a brand-new dictionary
    // word straight from the "ucz się dalej" deck — that starts from a fresh
    // SM-2 state and the write below enrols the word.
    const { data: current, error: currentError } = await supabase
      .from("saved_words")
      .select("interval, repetitions, ease_factor")
      .eq("user_id", user.id)
      .eq("word_id", input.wordId)
      .maybeSingle();
    if (currentError) {
      return failFrom(currentError, `updateSrs: load card ${input.wordId}`);
    }

    const before = {
      interval: current?.interval ?? 0,
      repetitions: current?.repetitions ?? 0,
      easeFactor: current ? Number(current.ease_factor) : DEFAULT_EASE_FACTOR,
    };

    const now = new Date();
    const next = review(before, GRADE_QUALITY[input.grade], now);

    const evidence = [
      reviewEvidence({
        interactionId: input.interactionId,
        wordId: input.wordId,
        mode: input.mode,
        direction: input.direction,
        rating: input.grade,
        responseMs: sanitizeResponseMs(input.responseMs),
        occurredAt: now.toISOString(),
      }),
    ];

    // Refusing here loses nothing: `apply_review` is keyed on the interaction
    // id, so the retry that follows settles the SAME review rather than a
    // second one — and it does so with the knowledge update intact.
    const prepared = await prepareEvidence(
      supabase,
      user.id,
      evidence,
      `updateSrs word ${input.wordId}`,
    );
    if (!prepared.ok) return prepared;

    const { data, error } = await service.rpc("apply_review", {
      p_user_id: user.id,
      p_interaction_id: input.interactionId,
      p_word_id: input.wordId,
      p_rating: input.grade,
      p_mode: input.mode,
      p_direction: input.direction,
      p_response_ms: sanitizeResponseMs(input.responseMs),
      p_srs: {
        // `exists` distinguishes "no card yet" from "a card whose schedule
        // happens to be all zeroes", which the stale-read guard must not
        // confuse for one another.
        before: {
          exists: current !== null,
          interval: before.interval,
          repetitions: before.repetitions,
          ease_factor: before.easeFactor,
        },
        after: {
          interval: next.interval,
          repetitions: next.repetitions,
          ease_factor: next.easeFactor,
          due_at: next.dueAt,
          is_mastered: next.isMastered,
        },
      },
      p_evidence: prepared.json,
    });

    const result = data?.[0];
    if (!error && result) {
      return {
        ok: true,
        dueAt: result.due_at,
        isMastered: result.is_mastered,
        reviewedToday: result.reviewed_today,
        alreadyApplied: result.already_applied,
      };
    }

    // The card or the knowledge state moved between the read and the commit
    // (another tab, a queued request). Recompute from fresh data rather than
    // applying a schedule derived from a state that no longer exists.
    if (error?.code === "FL423" && attempt < MAX_ATTEMPTS) continue;

    return failFrom(error, `updateSrs: commit ${input.wordId}`);
  }

  return fail("stale_state", `updateSrs: gave up retrying ${input.wordId}`);
}
