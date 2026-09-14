/**
 * What a finished chapter leaves behind for the days after it.
 *
 * THE CHAPTER IS NOT DONE TEACHING WHEN THE CHALLENGE ENDS. The most valuable
 * signal Fluent can collect is not "did they know *plötzlich* on Tuesday" but
 * "did they still know it on Friday", and that measurement only exists if the
 * chapter hands a small, ranked set of targets to the thing that already
 * schedules work — the Today planner and SM-2. Nothing here schedules anything.
 * This module decides WHAT is worth coming back to; `daily_plans` and
 * `saved_words` decide when.
 *
 * WHY IT IS SMALL. A learner who looked up eighteen words does not get eighteen
 * new flashcards. Most lookups are incidental — a guess being confirmed, a name,
 * a word they will never meet again — and a review deck that inflates by
 * eighteen cards per chapter punishes reading, which is the opposite of what the
 * whole phase is for. So a chapter contributes at most
 * {@link MAX_FOLLOW_UP_WORDS} words and {@link MAX_FOLLOW_UP_CONCEPTS} concepts,
 * chosen because there is real evidence behind them.
 *
 * AND IT DOES NOT SAVE CARDS BY ITSELF. A `saved_words` row is something the
 * learner chose; these targets are a recommendation the planner may act on. The
 * distinction matters — a deck the app silently fills is a deck nobody trusts.
 *
 * Pure.
 */

import {
  FOLLOW_UP_WEIGHTS,
  MAX_FOLLOW_UP_CONCEPTS,
  MAX_FOLLOW_UP_WORDS,
  REPEATED_LOOKUP_THRESHOLD,
  type FollowUpSignalName,
} from "@/lib/story/constants";
import { wordVerdict, type WordEvidence } from "@/lib/story/knowledge";

/** Everything one chapter observed about one word. */
export interface WordChapterOutcome {
  wordId: number;
  lemma: string;
  /** Times the learner tapped it while reading this chapter. */
  lookupCount: number;
  /** Was it on the preparation list? */
  wasPreTaught: boolean;
  /** Did a Challenge question about it go wrong? `null` = not asked. */
  assessmentCorrect: boolean | null;
  /** Did the learner already save it themselves? Then it needs no recommending. */
  alreadySaved: boolean;
}

export type FollowUpSignals = Partial<Record<FollowUpSignalName, number>>;

export interface FollowUpWord extends WordChapterOutcome {
  score: number;
  signals: FollowUpSignals;
}

/** A concept the chapter showed to be shaky, with the evidence behind it. */
export interface FollowUpConcept {
  conceptCode: string;
  /** Challenge questions tagged with it that went wrong. */
  failureCount: number;
  /** …out of how many that were asked. */
  askedCount: number;
}

export interface ChapterFollowUp {
  words: FollowUpWord[];
  concepts: FollowUpConcept[];
}

export interface FollowUpInput {
  outcomes: readonly WordChapterOutcome[];
  /** Concept outcomes from the Challenge, keyed by concept code. */
  conceptOutcomes?: readonly FollowUpConcept[];
  knowledge?: ReadonlyMap<number, WordEvidence>;
}

/**
 * Rank the chapter's words by how much a later check would be worth.
 *
 * The signals are ordered by how directly they were MEASURED. Getting a
 * Challenge question about a word wrong is the strongest thing here, because it
 * is a graded observation minutes old. Being pre-taught and then still failing
 * or still being looked up is nearly as strong, and more interesting: it says
 * the preparation did not take, which is the one outcome preparation cannot see
 * for itself. A single lookup scores nothing at all — see
 * {@link REPEATED_LOOKUP_THRESHOLD}.
 */
export function rankFollowUpWords(input: FollowUpInput): FollowUpWord[] {
  return input.outcomes
    .filter((outcome) => !outcome.alreadySaved)
    .map((outcome) => {
      const repeated = outcome.lookupCount >= REPEATED_LOOKUP_THRESHOLD;
      const missed = outcome.assessmentCorrect === false;

      const signals: FollowUpSignals = {
        assessmentFailure: missed ? 1 : 0,
        repeatedLookup: repeated
          ? Math.min(1, outcome.lookupCount / (REPEATED_LOOKUP_THRESHOLD * 2))
          : 0,
        // Preparation that did not stick: shown before the chapter and then
        // either missed in the Challenge or looked up anyway while reading.
        preteachNotRetained:
          outcome.wasPreTaught && (missed || outcome.lookupCount > 0) ? 1 : 0,
        uncertainKnowledge:
          wordVerdict(input.knowledge?.get(outcome.wordId)) === "uncertain" ? 1 : 0,
      };

      let score = 0;
      for (const [name, value] of Object.entries(signals) as [
        FollowUpSignalName,
        number,
      ][]) {
        score += value * FOLLOW_UP_WEIGHTS[name];
      }

      return { ...outcome, signals, score: round(score) };
    })
    // A word with no evidence behind it is not a target. Recommending one would
    // be padding the list to reach three, which is how a "review package"
    // becomes noise the learner learns to dismiss.
    .filter((word) => word.score > 0)
    .sort((a, b) => b.score - a.score || a.wordId - b.wordId);
}

/** The concepts the Challenge actually showed to be failing. */
export function rankFollowUpConcepts(
  outcomes: readonly FollowUpConcept[],
): FollowUpConcept[] {
  return outcomes
    .filter((concept) => concept.failureCount > 0)
    .sort(
      (a, b) =>
        b.failureCount / Math.max(1, b.askedCount) -
          a.failureCount / Math.max(1, a.askedCount) ||
        b.failureCount - a.failureCount ||
        a.conceptCode.localeCompare(b.conceptCode),
    )
    .slice(0, MAX_FOLLOW_UP_CONCEPTS);
}

/**
 * The chapter's review package: a few words and a concept or two.
 *
 * Deliberately possible to be EMPTY. A learner who read a chapter comfortably
 * and answered the Challenge cleanly has nothing to follow up, and inventing
 * something for them to revise would be the app filling silence rather than
 * teaching.
 */
export function buildFollowUp(input: FollowUpInput): ChapterFollowUp {
  return {
    words: rankFollowUpWords(input).slice(0, MAX_FOLLOW_UP_WORDS),
    concepts: rankFollowUpConcepts(input.conceptOutcomes ?? []),
  };
}

/**
 * What the learner is TOLD after a Challenge.
 *
 * "Świetna robota!" on its own is not feedback. But neither is a fabricated
 * pattern: with two answered questions there is no pattern to see, and saying
 * "najwięcej problemu sprawił Ci Dativ" on the strength of one wrong answer is
 * the app inventing an analysis. So the summary either names what the data shows
 * or says plainly that there is not enough of it.
 */
export interface ChallengeFeedback {
  /** Polish headline, always present. */
  headlinePl: string;
  /** Polish detail, or null when the evidence does not support one. */
  detailPl: string | null;
}

/** Minimum answers of one kind before its score is described in words. */
export const MIN_ANSWERS_FOR_PATTERN = 2;

export function challengeFeedback(input: {
  comprehensionCorrect: number;
  comprehensionTotal: number;
  vocabularyCorrect: number;
  vocabularyTotal: number;
  followUp: ChapterFollowUp;
}): ChallengeFeedback {
  const overall =
    input.comprehensionTotal + input.vocabularyTotal === 0
      ? 0
      : (input.comprehensionCorrect + input.vocabularyCorrect) /
        (input.comprehensionTotal + input.vocabularyTotal);

  const headlinePl =
    overall >= 0.8
      ? "Rozdział opanowany"
      : overall >= 0.5
        ? "Rozdział zaliczony"
        : "Rozdział wymaga powtórki";

  const strongComprehension =
    input.comprehensionTotal >= MIN_ANSWERS_FOR_PATTERN &&
    input.comprehensionCorrect / input.comprehensionTotal >= 0.8;
  const weakVocabulary =
    input.vocabularyTotal >= MIN_ANSWERS_FOR_PATTERN &&
    input.vocabularyCorrect / input.vocabularyTotal < 0.6;

  if (strongComprehension && weakVocabulary) {
    return {
      headlinePl,
      detailPl: "Fabułę rozumiesz dobrze — najwięcej problemu sprawiło słownictwo.",
    };
  }
  if (strongComprehension) {
    return { headlinePl, detailPl: "Fabułę tego rozdziału rozumiesz dobrze." };
  }
  if (
    input.comprehensionTotal >= MIN_ANSWERS_FOR_PATTERN &&
    input.comprehensionCorrect / input.comprehensionTotal < 0.5
  ) {
    return {
      headlinePl,
      detailPl: "Część wydarzeń w tym rozdziale umknęła — warto go przejrzeć.",
    };
  }

  // Not enough of anything to name a pattern. Saying so is better coaching than
  // a sentence we cannot support.
  return {
    headlinePl,
    detailPl:
      input.followUp.words.length + input.followUp.concepts.length > 0
        ? null
        : "Za mało danych, żeby wskazać wyraźny wzorzec.",
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
