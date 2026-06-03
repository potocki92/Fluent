/**
 * Pure Elo / Glicko-lite functions for estimating learner ability.
 *
 * A learner has an `ability` (≈1000 start) and a rating deviation `rd`
 * (≈350 start) that shrinks as they answer more questions, making later
 * updates smaller and more stable.
 */

export interface AbilityRating {
  ability: number;
  rd: number;
}

/** Logistic scale constant (standard Elo uses 400). */
export const ELO_SCALE = 400;

/** Bounds keeping `rd` in a sensible range. */
export const RD_MIN = 50;
export const RD_MAX = 350;

/**
 * Probability that a learner of `ability` answers an item of `itemDifficulty`
 * correctly.
 */
export function expectedScore(ability: number, itemDifficulty: number): number {
  return 1 / (1 + Math.pow(10, (itemDifficulty - ability) / ELO_SCALE));
}

/**
 * K-factor derived from the current rating deviation: a higher `rd` (more
 * uncertainty) produces larger rating swings.
 */
export function kFactor(rd: number): number {
  return clamp(rd, RD_MIN, RD_MAX) / 8;
}

/**
 * Temporary multiplier for the first few answers, when the estimate is still
 * being calibrated and should move faster than a settled level.
 */
export function calibrationMultiplier(answered: number): number {
  if (answered <= 0) return 2;
  if (answered >= 5) return 1;
  return round(1 + (5 - answered) / 5);
}

/**
 * Update a learner's ability after answering one item.
 *
 * @returns a new rating object (inputs are never mutated).
 */
export function updateAbility(
  rating: AbilityRating,
  itemDifficulty: number,
  isCorrect: boolean,
  options: { answered?: number } = {},
): AbilityRating {
  const expected = expectedScore(rating.ability, itemDifficulty);
  const actual = isCorrect ? 1 : 0;
  const multiplier =
    options.answered === undefined ? 1 : calibrationMultiplier(options.answered);
  const k = kFactor(rating.rd) * multiplier;

  const ability = rating.ability + k * (actual - expected);
  // Shrink uncertainty: the more surprising the result, the less it shrinks.
  const surprise = Math.abs(actual - expected);
  const rd = clamp(rating.rd * (0.97 + 0.02 * surprise), RD_MIN, RD_MAX);

  return { ability: round(ability), rd: round(rd) };
}

/** How trustworthy the ability estimate is, derived from answer volume. */
export type ConfidenceLevel = "calibrating" | "low" | "medium" | "high";

/**
 * Classify how confident we are in a learner's ability estimate based on how
 * many questions they have answered. Used to label the level ring.
 */
export function confidenceLevel(answered: number): ConfidenceLevel {
  if (answered < 5) return "calibrating";
  if (answered < 15) return "low";
  if (answered < 40) return "medium";
  return "high";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
