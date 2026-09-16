/**
 * What the plan view may honestly say about a plan.
 *
 * ESTIMATES ARE NOT MEASUREMENTS, and the names here keep the two apart. Fluent
 * deliberately does not record actual study time (`today-engine.md` §14): a page
 * left open for four hours is not four hours of learning, per-answer
 * `response_ms` comes from the browser clock and covers only the seconds a
 * question was on screen, and `reading_sessions.active_seconds` — the one
 * honestly measured number in the app — exists for the chapter reader and for
 * nothing else. Summing those would produce a figure that means a different
 * thing per activity, and a learner cannot tell which.
 *
 * So a plan's minutes are only ever the PLANNER's estimate. Anything rendered
 * from this module has to be worded as one.
 */

import type { TodayPlanItem } from "@/actions/today-plan";

/**
 * The planner's estimate for the activities the learner actually finished.
 *
 * Not `plan.estimated_minutes`, which is the whole plan as drafted: a learner
 * who finished two of five tasks did not do the five-task plan, and a skipped
 * task is time nobody spent. Still an estimate — see the module note.
 */
export function completedEstimatedMinutes(items: readonly TodayPlanItem[]): number {
  return items
    .filter((item) => item.status === "completed")
    .reduce((sum, item) => sum + Math.max(0, item.estimatedMinutes), 0);
}
