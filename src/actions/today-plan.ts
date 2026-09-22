"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { buildDailyPlanDraft, draftItemRows } from "@/lib/learning/planner/build";
import {
  completedDayStreak,
  learningDateFor,
  normalizeTimeZone,
} from "@/lib/learning/planner/learning-day";
import {
  DEFAULT_DAILY_MINUTES,
  MAX_DAILY_MINUTES,
  MIN_DAILY_MINUTES,
} from "@/lib/learning/planner/constants";
import type {
  TodayPlan,
  TodayPlanItem,
} from "@/lib/learning/planner/contracts";
import type { EvidenceLevel, PlanItemType } from "@/lib/learning/planner/types";
import type { PlanReasonCode, PlanReasonData } from "@/lib/learning/planner/reasons";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { ConceptCode } from "@/lib/learning/concepts";
import type { Json } from "@/types/database";

/**
 * The plan's SHAPE lives in `@/lib/learning/planner/contracts` — a module with
 * no `"use server"` on it — so a client component or a pure planner function
 * can describe a plan item without pulling a Server Action into its graph.
 * Re-exported here for the callers that want both the type and the loader.
 */
export type {
  TodayPlan,
  TodayPlanItem,
} from "@/lib/learning/planner/contracts";
import { toJson } from "@/lib/json";

const PLAN_COLUMNS =
  "id, learning_date, timezone, status, target_minutes, estimated_minutes, algorithm_version, evidence_level";

const ITEM_COLUMNS =
  "id, item_position, item_type, status, estimated_minutes, target_count, completed_count, priority_score, reason_code, reason_data, signals, text_id, library_item_id, chapter_id, concept_code, word_ids, payload";

/**
 * Today's plan — created on the first visit of the learner's day, reconciled on
 * every visit after that.
 *
 * THE STABILITY RULE. A plan is generated ONCE per learning day. Opening the app
 * at 08:00 and again at 08:10 must show the same eight tasks; a home screen that
 * reshuffles itself because a card came due in between is not a plan, it is a
 * feed. So this never rebuilds an existing plan — it only reconciles its
 * progress against what the learner has actually done.
 *
 * THE ONE DOCUMENTED EXCEPTION is onboarding. A learner with no level gets a
 * plan containing only the placement test; the moment that test gives them a
 * level, holding them to that stub until midnight would be absurd. So an
 * UNTOUCHED, placement-only plan may be replaced — and nothing else ever can.
 * The condition is enforced in `create_daily_plan`, not here, because a rule
 * that protects history belongs next to the data.
 *
 * IDEMPOTENCY is not this function's doing either. Ten concurrent calls all
 * insert; `unique (user_id, learning_date)` makes nine of them lose and adopt the
 * winner's plan. A JavaScript "does it exist yet?" check cannot do that, because
 * both callers pass it.
 */
export async function getOrCreateTodayPlan(): Promise<ActionResult<TodayPlan>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "getOrCreateTodayPlan: no session");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("ability, level_source, timezone, daily_learning_minutes")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return failFrom(profileError, `getOrCreateTodayPlan: profile ${user.id}`);
  }
  if (!profile) {
    return fail("not_found", `getOrCreateTodayPlan: no profile ${user.id}`);
  }

  const now = new Date();
  const timezone = normalizeTimeZone(profile.timezone);
  const learningDate = learningDateFor(timezone, now);
  const targetMinutes = clampMinutes(profile.daily_learning_minutes);

  const existing = await loadPlan(supabase, user.id, learningDate);
  if (existing.error) {
    return failFrom(existing.error, `getOrCreateTodayPlan: load ${learningDate}`);
  }

  // A stub plan is only replaceable while the learner has since been placed;
  // `create_daily_plan` re-checks that it is untouched before honouring it.
  const replaceOnboarding =
    existing.plan !== null &&
    profile.level_source !== "default" &&
    existing.items.every((item) => item.item_type === "placement");

  if (existing.plan && !replaceOnboarding) {
    return finish(supabase, user.id, existing.plan, existing.items, learningDate);
  }

  const draft = await buildDailyPlanDraft(supabase, {
    userId: user.id,
    now,
    targetMinutes,
    ability: Number(profile.ability),
    levelSource: profile.level_source,
  });

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "getOrCreateTodayPlan: service role unavailable", error);
  }

  const { error: createError } = await service.rpc("create_daily_plan", {
    p_user_id: user.id,
    p_learning_date: learningDate,
    p_timezone: timezone,
    p_target_minutes: targetMinutes,
    p_algorithm_version: draft.algorithmVersion,
    p_evidence_level: draft.evidenceLevel,
    p_items: toJson(draftItemRows(draft)),
    p_replace_onboarding: replaceOnboarding,
  });
  if (createError) {
    return failFrom(createError, `getOrCreateTodayPlan: create ${learningDate}`);
  }

  const created = await loadPlan(supabase, user.id, learningDate);
  if (created.error || !created.plan) {
    return failFrom(created.error, `getOrCreateTodayPlan: reload ${learningDate}`);
  }

  return finish(supabase, user.id, created.plan, created.items, learningDate);
}

/**
 * "Not today."
 *
 * Skipping is not completing, and the distinction is kept all the way down: the
 * item is stored as `skipped`, the plan can still finish without it, and a day
 * where everything was skipped never counts as a day of learning. Planner V1
 * does not put something else in its place — the plan for today was chosen for
 * today, and quietly refilling it would turn "pomiń" into "wylosuj coś
 * łatwiejszego".
 */
export async function skipPlanItem(itemId: string): Promise<ActionResult<{ status: string }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "skipPlanItem: no session");

  const { data, error } = await supabase.rpc("skip_daily_plan_item", {
    p_item_id: itemId,
  });
  if (error) return failFrom(error, `skipPlanItem: ${itemId}`);

  return { ok: true, status: data ?? "skipped" };
}

/** Record that the learner opened a passage — the "continue reading" signal. */
export async function markTextOpened(textId: number): Promise<void> {
  if (!Number.isInteger(textId)) return;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Best effort by design: failing to record that a passage was opened must
  // never stop the learner reading it.
  const { error } = await supabase.rpc("mark_text_opened", { p_text_id: textId });
  if (error) console.error("[fluent:today] mark_text_opened failed", error);
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

type PlanRow = {
  id: string;
  learning_date: string;
  timezone: string;
  status: string;
  target_minutes: number;
  estimated_minutes: number;
  algorithm_version: string;
  evidence_level: string;
};

type ItemRow = {
  id: string;
  item_position: number;
  item_type: string;
  status: string;
  estimated_minutes: number;
  target_count: number;
  completed_count: number;
  priority_score: number;
  reason_code: string;
  reason_data: Json;
  signals: Json;
  text_id: number | null;
  library_item_id: string | null;
  chapter_id: string | null;
  concept_code: string | null;
  word_ids: number[] | null;
  payload: Json;
};

type Supa = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function loadPlan(supabase: Supa, userId: string, learningDate: string) {
  const { data: plan, error } = await supabase
    .from("daily_plans")
    .select(PLAN_COLUMNS)
    .eq("user_id", userId)
    .eq("learning_date", learningDate)
    .maybeSingle();
  if (error || !plan) return { plan: null, items: [] as ItemRow[], error };

  const { data: items, error: itemsError } = await supabase
    .from("daily_plan_items")
    .select(ITEM_COLUMNS)
    .eq("plan_id", plan.id)
    .order("item_position", { ascending: true });

  return {
    plan: plan as PlanRow,
    items: (items ?? []) as ItemRow[],
    error: itemsError,
  };
}

/**
 * Reconcile, then return. Reconciliation runs on every load rather than only
 * after an activity, because the alternative is trusting that every exit path
 * from every session remembered to call it — and the one that forgets is the one
 * that leaves a finished drill showing as pending forever.
 */
async function finish(
  supabase: Supa,
  userId: string,
  plan: PlanRow,
  items: ItemRow[],
  learningDate: string,
): Promise<ActionResult<TodayPlan>> {
  const { error } = await supabase.rpc("sync_daily_plan", { p_plan_id: plan.id });
  if (error) {
    // A reconciliation failure is not worth blocking the home screen for: the
    // plan still renders, just with the progress from the last successful sync.
    console.error("[fluent:today] sync failed", error);
    const streak = await loadStreak(supabase, userId, learningDate);
    return { ok: true, ...toPlan(plan, items, streak) };
  }

  const refreshed = await loadPlan(supabase, userId, learningDate);
  const streak = await loadStreak(supabase, userId, learningDate);
  const finalPlan = refreshed.plan ?? plan;
  const finalItems = refreshed.plan ? refreshed.items : items;
  return { ok: true, ...toPlan(finalPlan, finalItems, streak) };
}

/**
 * The completed-day streak, derived from plan history rather than stored.
 *
 * Fluent already has two streak counters that mean different things
 * (`streak_days` moves on a finished reading test, `word_streak_days` on a day
 * of reviews). A third stored counter with a third definition would make all
 * three untrustworthy, so this one is computed: an active day is a day whose
 * plan was completed, and `daily_plans` already records that.
 */
async function loadStreak(
  supabase: Supa,
  userId: string,
  today: string,
): Promise<number> {
  const { data } = await supabase
    .from("daily_plans")
    .select("learning_date")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("learning_date", { ascending: false })
    .limit(60);

  return completedDayStreak(
    (data ?? []).map((row) => row.learning_date),
    today,
  );
}

function toPlan(plan: PlanRow, items: ItemRow[], streak: number): TodayPlan {
  const mapped = items.map(toItem);
  return {
    id: plan.id,
    learningDate: plan.learning_date,
    timezone: plan.timezone,
    status: plan.status as TodayPlan["status"],
    targetMinutes: plan.target_minutes,
    estimatedMinutes: plan.estimated_minutes,
    remainingMinutes: mapped
      .filter((item) => item.status === "pending" || item.status === "in_progress")
      .reduce((sum, item) => sum + item.estimatedMinutes, 0),
    algorithmVersion: plan.algorithm_version,
    evidenceLevel: plan.evidence_level as EvidenceLevel,
    items: mapped,
    streak,
  };
}

function toItem(row: ItemRow): TodayPlanItem {
  return {
    id: row.id,
    position: row.item_position,
    type: row.item_type as PlanItemType,
    status: row.status as TodayPlanItem["status"],
    estimatedMinutes: row.estimated_minutes,
    targetCount: row.target_count,
    completedCount: row.completed_count,
    reasonCode: row.reason_code as PlanReasonCode,
    reasonData: (row.reason_data ?? {}) as PlanReasonData,
    textId: row.text_id,
    libraryItemId: row.library_item_id,
    chapterId: row.chapter_id,
    conceptCode: row.concept_code as ConceptCode | null,
    wordIds: row.word_ids ?? [],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    signals: (row.signals ?? {}) as Record<string, number>,
    priorityScore: Number(row.priority_score),
  };
}

function clampMinutes(minutes: number | null | undefined): number {
  const value = Number(minutes ?? DEFAULT_DAILY_MINUTES);
  if (!Number.isFinite(value)) return DEFAULT_DAILY_MINUTES;
  return Math.min(MAX_DAILY_MINUTES, Math.max(MIN_DAILY_MINUTES, Math.round(value)));
}
