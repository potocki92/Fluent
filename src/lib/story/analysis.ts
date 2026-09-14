/**
 * Personal chapter analysis — "what is this chapter, for this learner?"
 *
 * A chapter has exactly one global difficulty and as many personal difficulties
 * as it has readers. `chapters.cefr_estimate` says what the language in it is;
 * this module says what the gap is between that language and what one learner
 * has shown they know. THE TWO ARE NEVER MERGED. A globally-B1 chapter can be
 * "bardzo wymagający" for a reader whose vocabulary has not met it and "łatwy"
 * for one whose has, and a product that reported only the band would be telling
 * both of them the same useless thing.
 *
 * ONE DEFINITION OF COVERAGE. The percentage comes from `estimateCoverage` in
 * `src/lib/reading/coverage.ts` — the same function the book page and the
 * reader already use — because coverage computed three slightly different ways
 * in three screens is three numbers the learner will eventually see disagree.
 * What this module adds on top is the CONFIDENCE BAND: an estimate resting on 30
 * observed words out of 400 is a real estimate and a shaky one, and the UI is
 * entitled to know which it is holding.
 *
 * SIGNALS WITH NO DATA ARE ABSENT, NOT GUESSED. Every input to the difficulty
 * score is optional, the weights of the present ones are renormalised, and an
 * analysis built from nothing reports `confidence: 'none'` rather than a
 * confident 0.5. That is the same rule the planner and the knowledge model
 * already follow, applied to the one number a learner would use to decide
 * whether to start a chapter.
 *
 * Pure. No Supabase, no clock beyond what it is handed.
 */

import { CEFR_DIFFICULTY } from "@/lib/cefr";
import type { CoverageEstimate } from "@/lib/reading/coverage";
import {
  COMFORTABLE_LOOKUP_RATE,
  COVERAGE_HIGH_OBSERVATIONS,
  COVERAGE_HIGH_SHARE,
  COVERAGE_MEDIUM_OBSERVATIONS,
  COVERAGE_MEDIUM_SHARE,
  DIFFICULTY_CHALLENGING_MAX,
  DIFFICULTY_COMFORTABLE_MAX,
  DIFFICULTY_JUST_RIGHT_MAX,
  DIFFICULTY_WEIGHTS,
  CEFR_BAND_ELO_WIDTH,
  LEVEL_GAP_SATURATION_BANDS,
  MIN_HISTORY_CHAPTERS,
  STRUGGLING_LOOKUP_RATE,
  type DifficultySignalName,
} from "@/lib/story/constants";
import type { StoredCefrLevel } from "@/types";

/** How much an estimate can be leaned on. `none` means there is no estimate. */
export type EstimateConfidence = "none" | "low" | "medium" | "high";

/** Polish copy for the confidence band, for the one line under a percentage. */
export const CONFIDENCE_LABEL_PL: Readonly<Record<EstimateConfidence, string>> = {
  none: "za mało danych",
  low: "pewność: niska",
  medium: "pewność: średnia",
  high: "pewność: wysoka",
};

/**
 * How hard this chapter is for this learner — an internal 0–1 score and the
 * label the learner actually sees.
 *
 * NOT A CEFR STATEMENT, and the label deliberately says nothing about the
 * learner's level: "Wymagający" is a property of the pairing, not a grade.
 */
export type DifficultyLabel =
  | "easy"
  | "just_right"
  | "challenging"
  | "very_challenging";

export const DIFFICULTY_LABEL_PL: Readonly<Record<DifficultyLabel, string>> = {
  easy: "Łatwy",
  just_right: "W sam raz",
  challenging: "Wymagający",
  very_challenging: "Bardzo wymagający",
};

/** The signals that fed the difficulty score, kept so it can be explained. */
export type DifficultySignals = Partial<Record<DifficultySignalName, number>>;

export interface PersonalDifficulty {
  /** 0 (trivial) → 1 (out of reach). Internal; never shown as a number. */
  score: number;
  label: DifficultyLabel;
  confidence: EstimateConfidence;
  signals: DifficultySignals;
}

/** How this learner has fared in this book so far. */
export interface ReadingHistorySummary {
  chaptersCompleted: number;
  /** Lookups per meaningful word read. See `COMFORTABLE_LOOKUP_RATE`. */
  lookupRate: number | null;
}

export interface ChapterAnalysisInput {
  coverage: CoverageEstimate;
  /** The chapter's own band, when the content has one. */
  chapterCefr: StoredCefrLevel | null;
  /** The learner's Elo ability, or null when they have never been placed. */
  ability: number | null;
  /**
   * 0–1 pressure from the concepts this chapter's questions are tagged with.
   * Absent when the chapter has no tagged questions — which is most chapters
   * until a bank exists, and is exactly when guessing would be wrong.
   */
  weaknessPressure: number | null;
  history: ReadingHistorySummary;
}

export interface ChapterAnalysis {
  coverage: CoverageEstimate;
  coverageConfidence: EstimateConfidence;
  /** Whole percent, or null when there is no honest figure to show. */
  coveragePercent: number | null;
  difficulty: PersonalDifficulty;
}

/**
 * How much to trust a coverage figure.
 *
 * `estimateCoverage` has already refused outright below its evidence floor; this
 * grades what is left. Both the SHARE of the chapter's vocabulary observed and
 * the ABSOLUTE number of observed words have to clear a band, because they fail
 * in opposite directions: 40 observed words out of 60 is a high share of a tiny
 * sample, and 80 out of 900 is a decent sample of almost nothing.
 */
export function coverageConfidence(coverage: CoverageEstimate): EstimateConfidence {
  if (coverage.status !== "estimated") return "none";

  const share =
    coverage.totalWords === 0 ? 0 : coverage.observedWords / coverage.totalWords;

  if (share >= COVERAGE_HIGH_SHARE && coverage.observedWords >= COVERAGE_HIGH_OBSERVATIONS) {
    return "high";
  }
  if (
    share >= COVERAGE_MEDIUM_SHARE &&
    coverage.observedWords >= COVERAGE_MEDIUM_OBSERVATIONS
  ) {
    return "medium";
  }
  return "low";
}

/**
 * The coverage figure as the UI may show it: whole percent, or nothing.
 *
 * Rounding is not cosmetic. `91.374%` is an estimate impersonating a
 * measurement, and a learner reading three decimal places will believe all
 * three.
 */
export function coveragePercent(coverage: CoverageEstimate): number | null {
  if (coverage.status !== "estimated") return null;
  return Math.round(coverage.ratio * 100);
}

/**
 * How far above the learner's own band a chapter sits, 0–1.
 *
 * Coarse by construction: both sides are CEFR bands, and pretending to finer
 * resolution than the input has is inventing a signal. A chapter at or below the
 * learner's band scores 0 — easy reading is not difficulty, whatever else it is.
 */
export function levelGapSignal(
  chapterCefr: StoredCefrLevel | null,
  ability: number | null,
): number | null {
  if (!chapterCefr || ability === null) return null;

  // Compared on the Elo scale rather than by band INDEX, so that a learner
  // sitting at the top of A2 is not counted a full band below a B1 chapter they
  // are nearly ready for. `CEFR_DIFFICULTY` is the same mapping the passage
  // engine already uses, so the two agree about what "a band" is worth.
  const gap = (CEFR_DIFFICULTY[chapterCefr] - ability) / CEFR_BAND_ELO_WIDTH;
  if (gap <= 0) return 0;
  return round(Math.min(1, gap / LEVEL_GAP_SATURATION_BANDS));
}

/**
 * How hard the learner has been finding this book, 0–1, from their lookup rate.
 *
 * The only MEASURED difficulty signal Fluent has, which is why it outweighs the
 * CEFR guess. It needs a couple of finished chapters behind it: one chapter's
 * lookup rate is as much about that chapter as about the reader.
 */
export function readingHistorySignal(history: ReadingHistorySummary): number | null {
  if (history.chaptersCompleted < MIN_HISTORY_CHAPTERS) return null;
  if (history.lookupRate === null) return null;

  const span = STRUGGLING_LOOKUP_RATE - COMFORTABLE_LOOKUP_RATE;
  if (span <= 0) return null;

  return round(
    clamp01((history.lookupRate - COMFORTABLE_LOOKUP_RATE) / span),
  );
}

/**
 * Combine whatever signals exist into one score.
 *
 * RENORMALISED OVER PRESENT SIGNALS, which is the whole honesty of the thing: a
 * learner with no reading history is not penalised for the absence, and a
 * chapter with no CEFR band does not drag every reader's score towards zero. An
 * analysis with no signals at all returns `confidence: 'none'` and the neutral
 * `just_right` label, because "we do not know" must not render as "easy".
 */
export function personalDifficulty(input: ChapterAnalysisInput): PersonalDifficulty {
  const signals: DifficultySignals = {};

  if (input.coverage.status === "estimated") {
    signals.vocabularyGap = round(clamp01(1 - input.coverage.ratio));
  }

  const levelGap = levelGapSignal(input.chapterCefr, input.ability);
  if (levelGap !== null) signals.levelGap = levelGap;

  if (input.weaknessPressure !== null) {
    signals.weaknessPressure = round(clamp01(input.weaknessPressure));
  }

  const history = readingHistorySignal(input.history);
  if (history !== null) signals.readingHistory = history;

  let weighted = 0;
  let totalWeight = 0;
  for (const [name, value] of Object.entries(signals) as [
    DifficultySignalName,
    number,
  ][]) {
    const weight = DIFFICULTY_WEIGHTS[name];
    weighted += value * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { score: 0.5, label: "just_right", confidence: "none", signals };
  }

  const score = round(weighted / totalWeight);
  return {
    score,
    label: difficultyLabel(score),
    confidence: difficultyConfidence(input, signals),
    signals,
  };
}

export function difficultyLabel(score: number): DifficultyLabel {
  if (score <= DIFFICULTY_COMFORTABLE_MAX) return "easy";
  if (score <= DIFFICULTY_JUST_RIGHT_MAX) return "just_right";
  if (score <= DIFFICULTY_CHALLENGING_MAX) return "challenging";
  return "very_challenging";
}

/**
 * How much the difficulty verdict can be leaned on.
 *
 * The vocabulary gap is the signal that matters, so the difficulty is never more
 * trustworthy than the coverage behind it — and a difficulty derived from CEFR
 * bands alone is `low`, however many bands agreed.
 */
function difficultyConfidence(
  input: ChapterAnalysisInput,
  signals: DifficultySignals,
): EstimateConfidence {
  const coverage = coverageConfidence(input.coverage);
  if (coverage === "none") {
    return Object.keys(signals).length > 0 ? "low" : "none";
  }
  // A measured lookup rate is direct evidence about this learner in this book,
  // so it lifts a merely-adequate coverage estimate to a trustworthy verdict.
  if (coverage === "medium" && signals.readingHistory !== undefined) return "high";
  return coverage;
}

/** The whole analysis, in the order the UI reads it. */
export function analyseChapter(input: ChapterAnalysisInput): ChapterAnalysis {
  return {
    coverage: input.coverage,
    coverageConfidence: coverageConfidence(input.coverage),
    coveragePercent: coveragePercent(input.coverage),
    difficulty: personalDifficulty(input),
  };
}

/**
 * Lookups per meaningful word, the reader's headline learning metric.
 *
 * "W pierwszym rozdziale sprawdzałeś jedno słowo na dziewięć. Teraz jedno na
 * trzydzieści jeden." Both halves are already recorded — `lookup_count` against
 * the words actually reached — and the only thing that makes the sentence
 * dishonest is dividing by words the learner never got to, which is why the
 * denominator is progress-weighted rather than the chapter's full length.
 */
export function lookupRate(input: {
  lookupCount: number;
  wordsRead: number;
}): number | null {
  if (input.wordsRead <= 0) return null;
  return round(input.lookupCount / input.wordsRead);
}

/** "Jedno słowo na 31" — the reciprocal, which is how people read this number. */
export function lookupInterval(rate: number | null): number | null {
  if (rate === null || rate <= 0) return null;
  return Math.round(1 / rate);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
