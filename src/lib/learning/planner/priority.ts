/**
 * The priority engine — planner V1.
 *
 * WHAT IT IS: a deterministic weighted sum over named, normalised signals. Same
 * inputs, same plan; no clock of its own beyond the `now` it is handed, no
 * database, no randomness. That is what makes it testable, and what makes "why
 * did you pick this?" answerable by reading numbers rather than guessing.
 *
 * WHAT IT IS NOT: a model. Nothing here has been fitted to anything, because
 * Fluent has no data to fit it to yet. Every weight is a stated belief about
 * what matters, living in `constants.ts` where it can be argued with. When there
 * IS data, `signals` on every plan item is the record of what the old planner
 * thought, which is exactly what a successor needs.
 *
 *     priority = Σ  weight(signal) · signal      +  small per-type tiebreak
 *
 * Each signal generator below turns a raw fact — "six cards, four days late" —
 * into a 0–1 number. Keeping normalisation in the generators and weighting in
 * one table is what stops the two from being tangled together, which is the
 * usual way a scoring function becomes impossible to change.
 */

import {
  DIFFICULTY_SWEET_SPOT,
  DIFFICULTY_TOLERANCE,
  DUE_COUNT_SATURATION,
  DUE_URGENCY_SATURATION_DAYS,
  MIN_WEAKNESS_RECENCY,
  SIGNAL_WEIGHTS,
  STUDY_AHEAD_URGENCY,
  TYPE_TIEBREAK,
  WEAKNESS_RECENCY_HALF_LIFE_DAYS,
} from "@/lib/learning/planner/constants";
import {
  CATEGORY_OF,
  type PlanCandidate,
  type PrioritySignals,
  type ScoredCandidate,
} from "@/lib/learning/planner/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Combine a candidate's signals into its final priority.
 *
 * Unlisted signals contribute nothing — a reading task has no `dueUrgency`, and
 * that is an absence rather than a zero it has to be assigned.
 */
export function scoreCandidate(candidate: PlanCandidate): ScoredCandidate {
  let priority = TYPE_TIEBREAK[candidate.type] ?? 0;

  for (const [name, value] of Object.entries(candidate.signals)) {
    const weight = SIGNAL_WEIGHTS[name as keyof typeof SIGNAL_WEIGHTS];
    if (weight === undefined || value === undefined) continue;
    priority += weight * clamp01(value);
  }

  return {
    ...candidate,
    category: CATEGORY_OF[candidate.type],
    priority: round(priority),
  };
}

export function scoreCandidates(
  candidates: readonly PlanCandidate[],
): ScoredCandidate[] {
  return candidates.map(scoreCandidate);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How urgently the review queue needs attention, 0–1.
 *
 * Two things make a queue urgent and they are combined rather than added: HOW
 * LATE the oldest card is, and HOW MANY are waiting. One card four days late and
 * forty cards due today are both real, and neither on its own is the whole
 * story — so the signal is the larger of the two, each saturating on its own
 * scale.
 *
 * Saturation matters more than the exact curve. Without it, a learner who has
 * been away for a year would have a review urgency so large that no weakness and
 * no reading could ever be chosen again — the plan would be a review queue
 * forever, which is precisely the failure §69 describes.
 */
export function dueUrgencySignal(input: {
  dueCount: number;
  /** Due date of the most overdue card, or null when nothing is overdue. */
  oldestDueAt: string | null;
  now: Date;
}): number {
  if (input.dueCount <= 0) return 0;

  const countPart = Math.min(1, input.dueCount / DUE_COUNT_SATURATION);

  let latenessPart = 0;
  if (input.oldestDueAt) {
    const lateDays = (input.now.getTime() - Date.parse(input.oldestDueAt)) / MS_PER_DAY;
    if (lateDays > 0) {
      latenessPart = Math.min(1, lateDays / DUE_URGENCY_SATURATION_DAYS);
    }
  }

  return round(Math.max(countPart, latenessPart));
}

/**
 * Urgency of "study ahead" work — cards that exist but are not late yet.
 *
 * Deliberately a flat, low constant. It exists so a learner with an empty
 * overdue queue still gets vocabulary practice, and it is low so that an overdue
 * queue always wins when both are available. Replacing the scheduler is not this
 * phase's job.
 */
export function studyAheadSignal(availableCards: number): number {
  return availableCards > 0 ? STUDY_AHEAD_URGENCY : 0;
}

/**
 * How recent a weakness is, 0–1, as a multiplier on its severity.
 *
 * A mistake from March and a mistake from yesterday are not the same claim about
 * a learner. Without this, the first concept someone ever struggled with would
 * outrank everything forever, since the aggregate remembers the failures long
 * after they stopped happening.
 *
 * Floored rather than decayed to zero: an old weakness stops dominating the
 * plan, it does not stop existing.
 */
export function weaknessRecencySignal(
  lastFailureAt: string | null,
  now: Date,
): number {
  if (!lastFailureAt) return MIN_WEAKNESS_RECENCY;
  const elapsedDays = (now.getTime() - Date.parse(lastFailureAt)) / MS_PER_DAY;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return 1;
  const decayed = Math.pow(0.5, elapsedDays / WEAKNESS_RECENCY_HALF_LIFE_DAYS);
  return round(Math.max(MIN_WEAKNESS_RECENCY, decayed));
}

/**
 * How well a passage's difficulty fits the learner, 0–1.
 *
 * Peaks slightly ABOVE current ability — comfortably readable is not learning —
 * and falls off symmetrically, reaching zero once the passage is far enough away
 * in either direction. An A1 learner is never handed a B2 text "to stretch
 * them", and a B1 learner is not sent back to A1 filler.
 */
export function difficultyMatchSignal(
  textDifficulty: number,
  ability: number,
): number {
  const distance = Math.abs(textDifficulty - (ability + DIFFICULTY_SWEET_SPOT));
  return round(Math.max(0, 1 - distance / DIFFICULTY_TOLERANCE));
}

/**
 * How much a passage deserves to be finished rather than started, 0–1.
 *
 * A text the learner opened today is a stronger continuation claim than one they
 * opened a week ago, and a test they began and left is stronger still: they were
 * one screen from a result.
 */
export function continuationSignal(input: {
  hasOpenTestSession: boolean;
  lastOpenedAt: string | null;
  now: Date;
}): number {
  if (input.hasOpenTestSession) return 1;
  if (!input.lastOpenedAt) return 0;
  const elapsedDays = (input.now.getTime() - Date.parse(input.lastOpenedAt)) / MS_PER_DAY;
  if (!Number.isFinite(elapsedDays)) return 0;
  // Full strength the same day, fading over roughly a week, never negative.
  return round(clamp01(1 - Math.max(0, elapsedDays) / 7) * 0.8);
}

/**
 * How worthwhile a batch of new vocabulary is, 0–1.
 *
 * `ORDER BY cefr ASC` is not a strategy; it is the alphabet with extra steps.
 * What this rewards instead is a batch that is the right size and made of words
 * the learner has genuinely not met — a "new word" the learner already
 * recognises teaches nothing and costs their trust in the recommendation.
 */
export function vocabularyFitSignal(input: {
  wordCount: number;
  targetCount: number;
  /** Of those words, how many are at or below the learner's level. */
  atLevelCount: number;
}): number {
  if (input.wordCount <= 0 || input.targetCount <= 0) return 0;
  const sufficiency = clamp01(input.wordCount / input.targetCount);
  const levelFit = clamp01(input.atLevelCount / input.wordCount);
  // Both matter: a full batch of wrongly-levelled words is no better than a
  // half-empty one of good ones.
  return round(sufficiency * (0.4 + 0.6 * levelFit));
}

/** Convenience for the generators, which all build one of these. */
export function signals(entries: PrioritySignals): PrioritySignals {
  const out: PrioritySignals = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && Number.isFinite(value)) {
      out[key as keyof PrioritySignals] = round(clamp01(value));
    }
  }
  return out;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
