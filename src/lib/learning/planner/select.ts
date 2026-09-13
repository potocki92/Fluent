/**
 * Turning ranked candidates into a day's plan.
 *
 * Ranking says what is worth doing. This decides what actually fits — which is a
 * different question, and the one that makes the difference between a
 * recommendation and a to-do list nobody opens.
 *
 * FOUR RULES, in the order they are applied:
 *
 *  1. **Onboarding is exclusive.** A learner with no level gets the placement
 *     test and nothing else. Padding it with "personalised" work computed from
 *     an ability we do not have would be inventing personalisation.
 *  2. **The budget is real.** Activities are taken in priority order while they
 *     fit inside `targetMinutes` plus a small tolerance. A learner who asked for
 *     10 minutes does not get 28.
 *  3. **Variety, unless there is none.** Caps per type and per category stop a
 *     large review queue from becoming the whole plan — but they are caps, not
 *     quotas: if reviews are all that exists, reviews are the plan.
 *  4. **Never empty-handed.** If the budget rejects everything, the single
 *     highest-priority activity is taken anyway. A learner with real work waiting
 *     must never see an empty home screen because of arithmetic.
 *
 * Pure: no clock, no database, no randomness.
 */

import {
  BUDGET_TOLERANCE,
  FLOW_ORDER,
  MAX_ITEMS_PER_CATEGORY,
  MAX_ITEMS_PER_TYPE,
  MAX_PLAN_ITEMS,
  PLANNER_VERSION,
} from "@/lib/learning/planner/constants";
import type {
  DailyPlanDraft,
  EvidenceLevel,
  PlanCategory,
  PlanDraftItem,
  PlanItemType,
  ScoredCandidate,
} from "@/lib/learning/planner/types";

export interface SelectPlanInput {
  candidates: readonly ScoredCandidate[];
  targetMinutes: number;
  evidenceLevel: EvidenceLevel;
}

/**
 * Choose the activities for one day.
 *
 * Returns them in FLOW order (warm-up → hard work → reading → new material),
 * not in priority order: priority has already done its job by deciding what is
 * in the plan, and a session reads better as a shape than as a ranked list.
 */
export function selectPlan(input: SelectPlanInput): DailyPlanDraft {
  const ranked = [...input.candidates].sort(byPriority);

  // Rule 1 — onboarding short-circuits everything.
  const onboarding = ranked.find((c) => c.type === "placement");
  if (onboarding) {
    return draft([onboarding], input.targetMinutes, input.evidenceLevel);
  }

  const budget = input.targetMinutes * (1 + BUDGET_TOLERANCE);
  const chosen: ScoredCandidate[] = [];
  const perType = new Map<PlanItemType, number>();
  const perCategory = new Map<PlanCategory, number>();
  let minutes = 0;

  for (const candidate of ranked) {
    if (chosen.length >= MAX_PLAN_ITEMS) break;

    const typeCount = perType.get(candidate.type) ?? 0;
    if (typeCount >= (MAX_ITEMS_PER_TYPE[candidate.type] ?? 1)) continue;

    const categoryCount = perCategory.get(candidate.category) ?? 0;
    if (categoryCount >= MAX_ITEMS_PER_CATEGORY) continue;

    // Rule 2 — the activity has to fit. A rejected one does NOT stop the loop:
    // a long reading task that overflows should not block a two-minute drill
    // that would have fitted underneath it.
    if (minutes + candidate.estimatedMinutes > budget) continue;

    chosen.push(candidate);
    perType.set(candidate.type, typeCount + 1);
    perCategory.set(candidate.category, categoryCount + 1);
    minutes += candidate.estimatedMinutes;
  }

  // Rule 4 — a plan with work available is never empty.
  if (chosen.length === 0 && ranked.length > 0) {
    chosen.push(ranked[0]);
  }

  return draft(chosen, input.targetMinutes, input.evidenceLevel);
}

function draft(
  chosen: readonly ScoredCandidate[],
  targetMinutes: number,
  evidenceLevel: EvidenceLevel,
): DailyPlanDraft {
  const items: PlanDraftItem[] = [...chosen]
    .sort(byFlow)
    .map((candidate, index) => ({ ...candidate, position: index + 1 }));

  return {
    targetMinutes,
    estimatedMinutes: items.reduce((sum, item) => sum + item.estimatedMinutes, 0),
    evidenceLevel,
    algorithmVersion: PLANNER_VERSION,
    items,
  };
}

/** Highest priority first; ties broken by the cheaper activity, then by type. */
function byPriority(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (a.estimatedMinutes !== b.estimatedMinutes) {
    return a.estimatedMinutes - b.estimatedMinutes;
  }
  return flowIndex(a.type) - flowIndex(b.type);
}

function byFlow(a: ScoredCandidate, b: ScoredCandidate): number {
  const delta = flowIndex(a.type) - flowIndex(b.type);
  // Two drills in one plan are ordered by how badly each is needed.
  return delta !== 0 ? delta : b.priority - a.priority;
}

function flowIndex(type: PlanItemType): number {
  const index = FLOW_ORDER.indexOf(type);
  return index === -1 ? FLOW_ORDER.length : index;
}
