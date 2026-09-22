/**
 * Every timing the question sessions share.
 *
 * It was the literal `1500` in two runners, under a comment in one of them
 * saying "Matches the reading test" — which is the shape a constant takes just
 * before the two stop matching.
 */

/**
 * How long a graded answer stays on screen before the session moves on.
 *
 * Long enough to read the verdict and see which option was right; short enough
 * that a five-question test does not spend eight seconds waiting.
 */
export const REVEAL_MS = 1500;
