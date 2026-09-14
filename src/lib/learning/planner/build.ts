/**
 * Assembling one day's plan.
 *
 *     learning data → candidate generators → priority engine → planner → draft
 *
 * This module is the wiring of that pipeline and nothing else: it runs the
 * generators, hands what they produce to the scoring, and hands THAT to the
 * budget. It contains no rules of its own, on purpose — a rule that lives in the
 * orchestration is a rule nobody can unit-test.
 *
 * The draft it returns has not been persisted and is not yet a plan. Writing it
 * is `create_daily_plan`'s job, and that is where the "one plan per learning
 * day" guarantee lives; here there is no uniqueness and no idempotency, only
 * arithmetic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  chapterCandidates,
  evidenceLevelFor,
  placementCandidates,
  readingCandidates,
  storyCandidates,
  reviewCandidates,
  vocabularyCandidates,
  weaknessCandidates,
  type PlannerContext,
} from "@/lib/learning/planner/candidates";
import { scoreCandidates } from "@/lib/learning/planner/priority";
import { selectPlan } from "@/lib/learning/planner/select";
import type { DailyPlanDraft, PlanCandidate } from "@/lib/learning/planner/types";
import { getTopWeaknesses } from "@/lib/learning/queries";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** How many weaknesses to consider; the budget will not fit more than two. */
const WEAKNESS_CANDIDATES = 3;

export interface BuildPlanInput {
  userId: string;
  now: Date;
  targetMinutes: number;
  ability: number;
  levelSource: "default" | "manual" | "placement" | "test";
}

/**
 * Build (but do not save) today's plan.
 *
 * ONBOARDING SHORT-CIRCUITS. A learner with no level gets one query and one
 * candidate. Running the other generators would cost five round trips to produce
 * recommendations measured against an ability that is a placeholder — and
 * `selectPlan` would discard every one of them anyway.
 */
export async function buildDailyPlanDraft(
  supabase: Client,
  input: BuildPlanInput,
): Promise<DailyPlanDraft> {
  const ctx: PlannerContext = { supabase, ...input };

  const onboarding = placementCandidates(ctx);
  if (onboarding.length > 0) {
    return selectPlan({
      candidates: scoreCandidates(onboarding),
      targetMinutes: input.targetMinutes,
      evidenceLevel: "none",
    });
  }

  // Every generator is independent, so they run together. The Today page is the
  // most-opened screen in the app; five sequential round trips would be felt.
  const weaknesses = await getTopWeaknesses(WEAKNESS_CANDIDATES, input.now);

  const [
    reviews,
    weaknessDrills,
    reading,
    chapters,
    story,
    vocabulary,
    observations,
  ] =
    await Promise.all([
      reviewCandidates(ctx),
      weaknessCandidates(ctx, weaknesses),
      readingCandidates(ctx),
      chapterCandidates(ctx),
      storyCandidates(ctx),
      vocabularyCandidates(ctx),
      countObservations(ctx),
    ]);

  const candidates: PlanCandidate[] = [
    ...reviews,
    ...weaknessDrills,
    ...reading,
    ...chapters,
    ...story,
    ...vocabulary,
  ];

  return selectPlan({
    candidates: scoreCandidates(candidates),
    targetMinutes: input.targetMinutes,
    evidenceLevel: evidenceLevelFor(observations),
  });
}

/**
 * How many observations the learner's knowledge model rests on.
 *
 * Eight rows at most — the skill catalog is fixed — so this is a constant-cost
 * read however long the learner has been using Fluent. It exists so a plan can
 * record whether it was built from 5 answers or 500, which is the difference
 * between a default and a recommendation.
 */
async function countObservations(ctx: PlannerContext): Promise<number> {
  const { data } = await ctx.supabase
    .from("user_skill_state")
    .select("evidence_count")
    .eq("user_id", ctx.userId);

  return (data ?? []).reduce((sum, row) => sum + (row.evidence_count ?? 0), 0);
}

/** The jsonb rows `create_daily_plan` expects, in plan order. */
export function draftItemRows(draft: DailyPlanDraft): Record<string, unknown>[] {
  return draft.items.map((item) => ({
    item_position: item.position,
    item_type: item.type,
    estimated_minutes: item.estimatedMinutes,
    priority_score: item.priority,
    reason_code: item.reason.code,
    reason_data: item.reason.data,
    signals: item.signals,
    target_count: item.targetCount,
    text_id: item.textId ?? null,
    library_item_id: item.libraryItemId ?? null,
    chapter_id: item.chapterId ?? null,
    target_seconds: item.targetSeconds ?? null,
    concept_code: item.conceptCode ?? null,
    word_ids: item.wordIds ?? [],
    payload: item.payload ?? {},
  }));
}
