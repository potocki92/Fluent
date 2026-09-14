/**
 * "Does this learner know this word?" — and the four honest ways to not answer.
 *
 * THE MISTAKE THIS MODULE EXISTS TO PREVENT. `user_word_knowledge` has no row
 * for most of the words in any chapter, and the tempting reading of a missing
 * row is "unknown". It is not. It means Fluent has never watched this learner
 * meet the word — which is a statement about Fluent, not about them. Treating
 * the two as the same thing makes a preparation list that teaches *ich* to a B1
 * reader, and a coverage figure that tells every new learner they know nothing.
 *
 * So a verdict is one of five values, and only two of them are claims:
 *
 *   known             measured, high score, enough evidence
 *   likely_known      measured, good score, thinner evidence
 *   uncertain         measured, and the measurement does not say
 *   likely_unknown    measured, low score
 *   no_evidence       never measured — NOT a synonym for unknown
 *
 * Everything downstream — coverage, preparation, follow-up — consumes verdicts
 * rather than raw scores, which is what keeps one definition of "known" in the
 * codebase instead of four slightly different comparisons.
 */

import {
  UNSEEN_WORD_UNKNOWN_PROBABILITY,
  WORD_KNOWN_SCORE,
  WORD_LIKELY_KNOWN_SCORE,
  WORD_LIKELY_UNKNOWN_SCORE,
  WORD_VERDICT_CONFIDENCE,
  WORD_WEAK_CONFIDENCE,
} from "@/lib/story/constants";

/** What Fluent is prepared to say about one word, receptively. */
export type WordVerdict =
  | "known"
  | "likely_known"
  | "uncertain"
  | "likely_unknown"
  | "no_evidence";

/** What the knowledge model holds for one word in one channel. */
export interface WordEvidence {
  wordId: number;
  /** `null` means no evidence at all — see the module comment. */
  score: number | null;
  confidence: number;
}

/** Verdicts that let a word be skipped when choosing what to pre-teach. */
const ALREADY_KNOWN: ReadonlySet<WordVerdict> = new Set<WordVerdict>([
  "known",
  "likely_known",
]);

/**
 * Classify one word.
 *
 * The score decides WHICH band; the confidence decides whether the band is
 * stated or downgraded to `uncertain`. That ordering matters: a 0.9 score from a
 * single lucky multiple-choice answer is not "known", it is "we saw one thing".
 */
export function wordVerdict(evidence: WordEvidence | undefined | null): WordVerdict {
  if (!evidence || evidence.score === null) return "no_evidence";
  if (evidence.confidence < WORD_WEAK_CONFIDENCE) return "uncertain";

  const confident = evidence.confidence >= WORD_VERDICT_CONFIDENCE;

  if (evidence.score >= WORD_KNOWN_SCORE) {
    return confident ? "known" : "likely_known";
  }
  if (evidence.score >= WORD_LIKELY_KNOWN_SCORE) return "likely_known";
  if (evidence.score < WORD_LIKELY_UNKNOWN_SCORE) {
    return confident ? "likely_unknown" : "uncertain";
  }
  return "uncertain";
}

/** True when a word is settled enough that pre-teaching it would waste the slot. */
export function isAlreadyKnown(verdict: WordVerdict): boolean {
  return ALREADY_KNOWN.has(verdict);
}

/**
 * How likely it is that this word will stop the learner, 0–1.
 *
 * The continuous counterpart of {@link wordVerdict}, used for ranking where a
 * five-way label would throw away the ordering inside a band. Two properties
 * matter more than the arithmetic:
 *
 *  - a word with NO evidence scores {@link UNSEEN_WORD_UNKNOWN_PROBABILITY},
 *    never 1. Fluent has not measured it; the estimate says so by sitting below
 *    every word it has actually watched the learner fail;
 *  - thin evidence is pulled back TOWARDS that same prior rather than trusted,
 *    so one unlucky answer cannot make a known word look unknown.
 */
export function unknownProbability(evidence: WordEvidence | undefined | null): number {
  if (!evidence || evidence.score === null) return UNSEEN_WORD_UNKNOWN_PROBABILITY;

  const measured = clamp01(1 - evidence.score);
  const trust = clamp01(evidence.confidence / WORD_VERDICT_CONFIDENCE);

  return round(
    measured * trust + UNSEEN_WORD_UNKNOWN_PROBABILITY * (1 - trust),
  );
}

/** Index a knowledge list by word id, for the joins every consumer does. */
export function byWordId(
  evidence: readonly WordEvidence[],
): ReadonlyMap<number, WordEvidence> {
  return new Map(evidence.map((entry) => [entry.wordId, entry]));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
