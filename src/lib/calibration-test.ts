/**
 * Pure helpers driving the adaptive calibration (placement) test. The test picks
 * items near the learner's running ability estimate, folds each answer into the
 * estimate with the shared Elo update, and stops once the estimate has settled.
 *
 * The Elo maths itself lives in `elo.ts` — this module only handles item
 * selection and the stop/finalise policy, so the rating logic is never
 * duplicated.
 */

import { RD_MIN, updateAbility } from "@/lib/elo";
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

/** One stored answer of a placement session, as recorded server-side. */
export interface CalibrationAnswer {
  itemDifficulty: number;
  isCorrect: boolean;
}

/**
 * Recompute a placement result from the answers the learner actually gave.
 *
 * This is what makes the adaptive test trustworthy. The browser still drives
 * item *selection* (which is not security-sensitive — picking an easy item only
 * makes the estimate worse for the learner), but the resulting rating is never
 * taken from the browser: the server replays every stored answer through the
 * same {@link updateAbility} the client used, in the order they were given, and
 * writes the result of that replay.
 *
 * Because both sides run identical arithmetic over identical inputs, the replay
 * reproduces the estimate the learner watched being built — while a forged
 * "my ability is 2000" has nowhere to enter.
 *
 * @param answers stored answers, ordered by `item_position`
 */
export function replayCalibration(
  answers: readonly CalibrationAnswer[],
): AbilityRating {
  let rating = INITIAL_RATING;
  answers.forEach((answer, index) => {
    // `answered` is the count BEFORE this answer, matching how the running
    // estimate was built item by item.
    rating = updateAbility(rating, answer.itemDifficulty, answer.isCorrect, {
      answered: index,
    });
  });
  return finalizeRating(rating);
}
