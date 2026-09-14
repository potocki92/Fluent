/**
 * The planner's vocabulary.
 *
 * The whole pipeline is deliberately shaped as
 *
 *     learning data → candidate generators → priority engine → planner → plan
 *
 * and these types are the seams between those stages. Nothing downstream of a
 * generator knows which table a candidate came from: a candidate carries its own
 * time estimate, its own signals and its own reason, so adding
 * `continue_book_chapter` later means writing one generator, not reopening the
 * ranking or the budget.
 */

import type { ConceptCode } from "@/lib/learning/concepts";
import type { SignalName } from "@/lib/learning/planner/constants";
import type { PlanReason } from "@/lib/learning/planner/reasons";

/**
 * What a plan activity IS.
 *
 * Every one of these has a screen behind it today. A type with no way to do it
 * would be a dead task on the learner's home page, which is worse than an
 * emptier plan — so there is no `listening` here waiting for a feature to exist.
 */
export type PlanItemType =
  | "placement"
  | "review_due"
  | "weakness_practice"
  | "continue_text"
  | "new_text"
  | "new_vocabulary"
  // Reading real content — a chapter of a book or a story, as opposed to a
  // graded passage with a test behind it.
  | "continue_chapter"
  | "new_chapter"
  // The Story Engine's two activities: clearing a few obstacles before a
  // chapter, and checking what stuck after one. Both are proposed ONLY when the
  // activity genuinely exists — a chapter with nothing worth pre-teaching
  // produces no preparation task, and one with no validated question bank
  // produces no Challenge.
  | "chapter_preparation"
  | "chapter_assessment";

/**
 * The coarse kind of work an activity is, used only for balance.
 *
 * Without it a learner with a large review queue would get a plan made of
 * nothing but review batches, which is exactly the "katalog funkcji with extra
 * steps" this phase exists to replace.
 */
export type PlanCategory =
  | "onboarding"
  | "memory"
  | "weakness"
  | "comprehension"
  | "vocabulary";

export const CATEGORY_OF: Readonly<Record<PlanItemType, PlanCategory>> = {
  placement: "onboarding",
  review_due: "memory",
  weakness_practice: "weakness",
  continue_text: "comprehension",
  new_text: "comprehension",
  continue_chapter: "comprehension",
  new_chapter: "comprehension",
  // Preparation is vocabulary work in service of reading; the Challenge is a
  // comprehension measurement. Categorising them by what they ARE rather than by
  // where they sit in the chapter lifecycle is what keeps the plan's balance
  // rule meaningful.
  chapter_preparation: "vocabulary",
  chapter_assessment: "comprehension",
  new_vocabulary: "vocabulary",
};

/**
 * The individual reasons a candidate scored what it scored.
 *
 * Kept as a record rather than folded into one number at the source, because
 * "why did the planner pick this?" has to be answerable six months from now —
 * and a single `priority: 0.87` cannot answer it. Stored on the plan item as
 * `signals`, shown to developers, never to a learner.
 */
export type PrioritySignals = Partial<Record<SignalName, number>>;

/** One thing the learner could usefully do, before anything has been ranked. */
export interface PlanCandidate {
  type: PlanItemType;
  /** How long doing it should take, in whole minutes. */
  estimatedMinutes: number;
  /** How much of it counts as done — cards, questions, words, or 1. */
  targetCount: number;
  signals: PrioritySignals;
  reason: PlanReason;
  textId?: number | null;
  libraryItemId?: string | null;
  chapterId?: string | null;
  /**
   * Active reading seconds that satisfy this activity.
   *
   * Reading tasks are the one kind whose completion is not a count of things
   * done — "czytaj przez około 8 minut" is satisfied by eight minutes, not by
   * finishing a chapter that happens to be three times that long. The planner
   * computes it from `src/lib/reading/constants.ts` and `sync_daily_plan` only
   * compares against it.
   */
  targetSeconds?: number | null;
  conceptCode?: ConceptCode | null;
  /** Snapshot of the exact words recommended, for `new_vocabulary`. */
  wordIds?: readonly number[];
  /** Display detail snapshotted onto the item so history renders without joins. */
  payload?: Record<string, unknown>;
}

/** A candidate with its priority computed. */
export interface ScoredCandidate extends PlanCandidate {
  priority: number;
  category: PlanCategory;
}

/** One activity of a plan, ready to be persisted. */
export interface PlanDraftItem extends ScoredCandidate {
  position: number;
}

/**
 * How much evidence the planner had. See `daily_plans.evidence_level`.
 *
 * `none` is not a synonym for "new user" — it is the honest statement that this
 * plan is a sensible default rather than a recommendation.
 */
export type EvidenceLevel = "none" | "low" | "medium" | "high";

/** A plan, computed but not yet written. */
export interface DailyPlanDraft {
  targetMinutes: number;
  estimatedMinutes: number;
  evidenceLevel: EvidenceLevel;
  algorithmVersion: string;
  items: readonly PlanDraftItem[];
}
