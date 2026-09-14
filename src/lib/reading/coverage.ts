/**
 * "How much of this chapter's vocabulary do I already know?"
 *
 * THE FAILURE MODE THIS MODULE EXISTS TO PREVENT. Fluent knows something about
 * a few dozen of a learner's words. A chapter has eight hundred distinct ones.
 * Dividing "known" by "total" across that gap produces a number — 4%, or 91% if
 * you only divide by the words you happen to have data for — and both are
 * fiction. A fictional coverage figure is worse than none: it is the kind of
 * number a learner makes a decision with.
 *
 * So the estimate reports its own standing. Below
 * {@link MIN_COVERAGE_OBSERVATIONS} observed words, or below
 * {@link MIN_COVERAGE_SHARE} of the chapter's vocabulary, there is no
 * percentage at all — the UI says the estimate is not available yet, which is
 * the truth and also tells the learner what would change it.
 *
 * Pure: it takes the chapter's vocabulary and the learner's word knowledge and
 * returns a verdict. No Supabase, no assumptions about where either came from.
 */

import {
  KNOWN_WORD_CONFIDENCE,
  KNOWN_WORD_SCORE,
} from "@/lib/learning/planner/constants";
import {
  MIN_COVERAGE_OBSERVATIONS,
  MIN_COVERAGE_SHARE,
} from "@/lib/reading/constants";

/** One distinct dictionary word the chapter uses. */
export interface ChapterWord {
  wordId: number;
  occurrenceCount: number;
}

/** What the knowledge model believes about one word, receptively. */
export interface WordKnowledge {
  wordId: number;
  receptiveScore: number | null;
  receptiveConfidence: number;
}

/**
 * The answer, including the case where there isn't one.
 *
 * `status: 'insufficient_data'` is a first-class result, not an error — see the
 * module comment.
 */
export type CoverageEstimate =
  | {
      status: "estimated";
      /** 0–1, weighted by how often each word appears in the chapter. */
      ratio: number;
      knownWords: number;
      observedWords: number;
      totalWords: number;
    }
  | {
      status: "insufficient_data";
      observedWords: number;
      totalWords: number;
      /** Words we would need evidence about before quoting a figure. */
      neededWords: number;
    };

/**
 * Estimate coverage of a chapter's vocabulary.
 *
 * WEIGHTED BY FREQUENCY, not by distinct word: knowing *Schwert*, which appears
 * forty times, matters more to the experience of reading this chapter than
 * knowing a word that appears once. That is also what makes the number
 * correspond to something a learner feels — the share of the words on the page
 * they will recognise.
 *
 * Words with no evidence are excluded from BOTH sides of the ratio rather than
 * counted as unknown. Counting them as unknown would mean a learner with no
 * history reads "you know 0% of this chapter", which is not a measurement, it is
 * the absence of one.
 */
export function estimateCoverage(
  chapterWords: readonly ChapterWord[],
  knowledge: readonly WordKnowledge[],
): CoverageEstimate {
  const totalWords = chapterWords.length;
  const byWord = new Map(knowledge.map((entry) => [entry.wordId, entry]));

  let observedWords = 0;
  let observedWeight = 0;
  let knownWeight = 0;
  let knownWords = 0;

  for (const word of chapterWords) {
    const known = byWord.get(word.wordId);
    if (!known || known.receptiveScore === null) continue;

    const weight = Math.max(1, word.occurrenceCount);
    observedWords += 1;
    observedWeight += weight;

    if (
      known.receptiveScore >= KNOWN_WORD_SCORE &&
      known.receptiveConfidence >= KNOWN_WORD_CONFIDENCE
    ) {
      knownWeight += weight;
      knownWords += 1;
    }
  }

  const enough =
    observedWords >= MIN_COVERAGE_OBSERVATIONS &&
    totalWords > 0 &&
    observedWords / totalWords >= MIN_COVERAGE_SHARE;

  if (!enough || observedWeight === 0) {
    return {
      status: "insufficient_data",
      observedWords,
      totalWords,
      neededWords: Math.max(
        MIN_COVERAGE_OBSERVATIONS - observedWords,
        Math.ceil(totalWords * MIN_COVERAGE_SHARE) - observedWords,
        1,
      ),
    };
  }

  return {
    status: "estimated",
    ratio: Math.round((knownWeight / observedWeight) * 10000) / 10000,
    knownWords,
    observedWords,
    totalWords,
  };
}

/**
 * Words from this chapter worth learning BEFORE reading it.
 *
 * Phase 4 only produces the data; nothing shows it yet. The selection rule is
 * here rather than in a future component because it is the same judgement the
 * planner makes elsewhere: frequent in this chapter, and not already known.
 * Words with no evidence count as candidates — "we have never seen you meet
 * this" is precisely the case a pre-reading set is for.
 */
export function preReadingCandidates(
  chapterWords: readonly ChapterWord[],
  knowledge: readonly WordKnowledge[],
  limit: number,
): number[] {
  const byWord = new Map(knowledge.map((entry) => [entry.wordId, entry]));

  return chapterWords
    .filter((word) => {
      const known = byWord.get(word.wordId);
      if (!known || known.receptiveScore === null) return true;
      return !(
        known.receptiveScore >= KNOWN_WORD_SCORE &&
        known.receptiveConfidence >= KNOWN_WORD_CONFIDENCE
      );
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.wordId - b.wordId)
    .slice(0, Math.max(0, limit))
    .map((word) => word.wordId);
}
