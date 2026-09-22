/**
 * What a daily plan IS, in a module neither side owns.
 *
 * WHY THIS FILE EXISTS. `TodayPlanItem` and `TodayPlan` were exported from
 * `src/actions/today-plan.ts`, which begins with `"use server"`. Eleven
 * modules imported them — six client components, three pure planner modules and
 * two of their tests — and every one of those imports put a Server Action
 * module in its graph to borrow a type that is nothing but a shape.
 *
 * That is not a theoretical concern. It is what makes "shared UI knows nothing
 * about the product" and "the pure core does not import actions" unenforceable:
 * the rule cannot be stated as a lint constraint while a planner module has to
 * reach into `@/actions` to describe its own argument. `artwork.ts`,
 * `planner/routes.ts` and `planner/summary.ts` are pure functions over a plan
 * item — they should depend on the plan item, not on the action that happens to
 * load one.
 *
 * Types only, and the pure guards over them. Nothing here loads anything.
 */

import type { ConceptCode } from "@/lib/learning/concepts";
import type { PlanReasonCode, PlanReasonData } from "@/lib/learning/planner/reasons";
import type { EvidenceLevel, PlanItemType } from "@/lib/learning/planner/types";

/** Where one activity of the plan is. */
export type PlanItemStatus = "pending" | "in_progress" | "completed" | "skipped";

/** Where the plan as a whole is. */
export type PlanStatus = "pending" | "in_progress" | "completed";

/** One activity of today's plan, as the UI reads it. */
export interface TodayPlanItem {
  id: string;
  position: number;
  type: PlanItemType;
  status: PlanItemStatus;
  estimatedMinutes: number;
  targetCount: number;
  completedCount: number;
  reasonCode: PlanReasonCode;
  reasonData: PlanReasonData;
  textId: number | null;
  libraryItemId: string | null;
  chapterId: string | null;
  conceptCode: ConceptCode | null;
  wordIds: number[];
  /** Snapshotted display detail — titles, labels, previews. */
  payload: Record<string, unknown>;
  /** Developer-facing priority breakdown. Never rendered for a learner. */
  signals: Record<string, number>;
  priorityScore: number;
}

export interface TodayPlan {
  id: string;
  learningDate: string;
  timezone: string;
  status: PlanStatus;
  targetMinutes: number;
  estimatedMinutes: number;
  /** Minutes left across the items that are not finished. */
  remainingMinutes: number;
  algorithmVersion: string;
  evidenceLevel: EvidenceLevel;
  items: TodayPlanItem[];
  /** Consecutive days ending today whose plan was completed. */
  streak: number;
}

/**
 * Is this activity finished, one way or another?
 *
 * "Skipped" counts as settled rather than done: the learner decided about it,
 * so it is no longer waiting for them — but it never becomes `completed`,
 * because completion is derived from the work that was actually recorded and
 * there is no path that asserts it.
 */
export function isPlanItemSettled(item: TodayPlanItem): boolean {
  return item.status === "completed" || item.status === "skipped";
}

/** The next activity the learner has not dealt with, or null when none is. */
export function nextPlanItem(plan: TodayPlan): TodayPlanItem | null {
  return plan.items.find((item) => !isPlanItemSettled(item)) ?? null;
}
