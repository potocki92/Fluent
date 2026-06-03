/**
 * Pure helpers driving the adaptive calibration (placement) test. The test picks
 * items near the learner's running ability estimate, folds each answer into the
 * estimate with the shared Elo update, and stops once the estimate has settled.
 *
 * The Elo maths itself lives in `elo.ts` — this module only handles item
 * selection and the stop/finalise policy, so the rating logic is never
 * duplicated.
 */

import { RD_MIN } from "@/lib/elo";
import type { AbilityRating } from "@/lib/elo";
import type { CalibrationQuestion } from "@/types";

/** Neutral starting estimate for someone with no history (≈ A1/A2 border). */
export const START_ABILITY = 1200;
/** Maximum uncertainty at the start of the test. */
export const START_RD = 350;
/** Never finish before this many items — enough signal to trust the estimate. */
export const MIN_ITEMS = 6;
/** Hard cap on test length so it never drags on. */
export const MAX_ITEMS = 12;
/** Once recent ability swings drop below this, the estimate is considered settled. */
export const STABLE_DELTA = 20;
/** Confidence (rd) granted by completing a real placement test. */
export const FINAL_RD = 150;

/** The fresh starting rating for a calibration session. */
export const INITIAL_RATING: AbilityRating = {
  ability: START_ABILITY,
  rd: START_RD,
};

/**
 * Pick the not-yet-asked item whose difficulty is closest to the current ability
 * estimate (targets ≈50% correct, which is the most informative). Returns `null`
 * when the pool is exhausted.
 */
export function pickNextQuestion(
  pool: CalibrationQuestion[],
  ability: number,
  asked: ReadonlySet<number>,
): CalibrationQuestion | null {
  let best: CalibrationQuestion | null = null;
  let bestDistance = Infinity;
  for (const question of pool) {
    if (asked.has(question.id)) continue;
    const distance = Math.abs(question.difficulty - ability);
    if (distance < bestDistance) {
      best = question;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Decide whether the adaptive test should stop. Stops at the hard cap, or once
 * the minimum is met and the last two ability swings are both small (settled).
 */
export function shouldStop(
  answeredCount: number,
  recentDeltas: readonly number[],
): boolean {
  if (answeredCount >= MAX_ITEMS) return true;
  if (answeredCount < MIN_ITEMS) return false;
  const lastTwo = recentDeltas.slice(-2);
  return (
    lastTwo.length === 2 && lastTwo.every((d) => Math.abs(d) < STABLE_DELTA)
  );
}

/**
 * Turn the running estimate into the rating persisted to the profile. A
 * completed placement test earns real confidence, so `rd` drops to {@link
 * FINAL_RD} (well below the 350 of a self-declared level).
 */
export function finalizeRating(rating: AbilityRating): AbilityRating {
  return {
    ability: Math.round(rating.ability),
    rd: Math.max(RD_MIN, Math.min(rating.rd, FINAL_RD)),
  };
}
