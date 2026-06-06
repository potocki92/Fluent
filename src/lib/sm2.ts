/**
 * SuperMemo SM-2 spaced-repetition algorithm (pure functions).
 *
 * See https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
 */

export interface Sm2State {
  /** Inter-repetition interval in days. */
  interval: number;
  /** Number of consecutive correct recalls. */
  repetitions: number;
  /** Ease factor (>= 1.3). */
  easeFactor: number;
}

/**
 * Recall quality, 0–5:
 *  0–2 = incorrect (resets the card), 3–5 = correct with rising confidence.
 */
export type Sm2Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** Flashcard buttons mapped to SM-2 quality scores. */
export const GRADE_QUALITY: Record<"again" | "hard" | "good" | "easy", Sm2Quality> =
  {
    again: 1,
    hard: 3,
    good: 4,
    easy: 5,
  };

export const MIN_EASE_FACTOR = 1.3;
export const DEFAULT_EASE_FACTOR = 2.5;

export interface Sm2Result extends Sm2State {
  /** When the card is next due, as an ISO timestamp. */
  dueAt: string;
  /** True once the card has graduated to a long, stable interval. */
  isMastered: boolean;
}

/** Interval (days) at which a card is considered mastered. */
export const MASTERY_INTERVAL = 21;

/**
 * Progress (0–1) of a card toward mastery, based on how close its interval is to
 * {@link MASTERY_INTERVAL}. Drives the "do opanowania" progress bars in the UI.
 */
export function masteryProgress(interval: number): number {
  return Math.min(1, Math.max(0, interval / MASTERY_INTERVAL));
}

/**
 * Apply one SM-2 review.
 *
 * @param state current scheduling state
 * @param quality recall quality (0–5)
 * @param now reference time (defaults to current time) — injectable for tests
 */
export function review(
  state: Sm2State,
  quality: Sm2Quality,
  now: Date = new Date(),
): Sm2Result {
  let { interval, repetitions, easeFactor } = state;

  if (quality < 3) {
    // Lapse: restart the repetition cycle, keep ease factor.
    repetitions = 0;
    interval = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * easeFactor);

    easeFactor = Math.max(
      MIN_EASE_FACTOR,
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    );
  }

  const dueAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

  return {
    interval,
    repetitions,
    easeFactor: round(easeFactor),
    dueAt: dueAt.toISOString(),
    isMastered: interval >= MASTERY_INTERVAL,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
