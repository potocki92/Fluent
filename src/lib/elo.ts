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

/**
 * Fraction of correct answers at/above which a whole test *adds* Elo; below it
 * the test *deducts* Elo. With 5 questions this means 2/5 (0.4) always loses and
 * 3/5 (0.6) always gains.
 */
export const TEST_PASS_LINE = 0.5;

/** Scales a whole completed test into roughly one strong Elo step. */
export const TEST_K_SCALE = 4;

/** The outcome of scoring a whole completed test. */
export interface TestScore {
  ability: number;
  rd: number;
  /** Signed Elo change applied by the test. */
  delta: number;
  /** Fraction correct (0–1). */
  ratio: number;
  /** Whether the score met the pass line. */
  passed: boolean;
}

/**
 * Score a whole completed test in one shot. Unlike a per-question update, Elo is
 * only moved once every question has been answered.
 *
 * The *sign* of the change is decided purely by the pass line — at or above
 * {@link TEST_PASS_LINE} adds Elo, below it deducts (so 2/5 always loses, 3/5
 * always gains). The *magnitude* is weighted by difficulty: beating a text that
 * is hard for the learner is worth more, and failing an easy one hurts more.
 *
 * @returns a new rating object (inputs are never mutated).
 */
export function scoreTest(
  rating: AbilityRating,
  avgDifficulty: number,
  correct: number,
  total: number,
  options: { answered?: number } = {},
): TestScore {
  const ratio = total > 0 ? correct / total : 0;
  const expected = expectedScore(rating.ability, avgDifficulty);
  const passed = ratio >= TEST_PASS_LINE;

  // Distance from the pass line, normalised to 0–1: a perfect score moves more
  // than a marginal pass, a wipeout more than a near miss.
  const distance = Math.abs(ratio - TEST_PASS_LINE) / (1 - TEST_PASS_LINE);
  // A low `expected` means the text was hard for this learner, so a pass is
  // rewarded more; a high `expected` means it was easy, so a fail is punished more.
  const difficultyFactor = passed ? 1.5 - expected : 0.5 + expected;

  const multiplier =
    options.answered === undefined ? 1 : calibrationMultiplier(options.answered);
  const k = kFactor(rating.rd) * multiplier;

  const delta = (passed ? 1 : -1) * k * TEST_K_SCALE * distance * difficultyFactor;
  const ability = round(rating.ability + delta);
  // Shrink uncertainty once for the whole test, proportional to its length.
  const rd = clamp(rating.rd * Math.pow(0.97, total), RD_MIN, RD_MAX);

  return { ability, rd, delta: round(delta), ratio, passed };
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

/** Constrain a value to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
