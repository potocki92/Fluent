/**
 * Response time is measured by the browser's own clock, so it is analytics data
 * — never evidence. A learner can trivially report 1 ms or a negative number,
 * and a backgrounded tab can report hours without anyone cheating.
 *
 * The rule for the whole app: keep it when it is plausible, drop it when it is
 * not, and never let it influence grading or the rating. The same clamp is
 * applied again in `answer_test_question`, because the database is the last line
 * that a forged request still has to pass.
 */

/** Anything slower than this is a tab left open, not a considered answer. */
export const MAX_RESPONSE_MS = 3_600_000; // 1 hour

/**
 * Normalise a client-reported response time for storage.
 *
 * @returns the value in ms, clamped to {@link MAX_RESPONSE_MS}, or `null` when
 *   it is missing, negative, or not a finite number.
 */
export function sanitizeResponseMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), MAX_RESPONSE_MS);
}
