/**
 * What the Story engine tells a screen — in a module neither side owns.
 *
 * These shapes were exported from `"use server"` modules, so a chapter card and
 * a result card each dragged a Server Action into their graph to borrow a type.
 * A shape is not an action: `ChapterStoryState` describes a chapter as this
 * learner meets it, and `ChallengeResult` describes how a Challenge went, and
 * neither needs Supabase to be true.
 *
 * Types only. Nothing here loads anything.
 */

import type { DifficultyLabel, EstimateConfidence } from "@/lib/story/analysis";

/** The preparation offer, when there is one worth making. */
export interface PreparationOffer {
  /** How many words would be pre-taught. */
  wordCount: number;
  estimatedMinutes: number;
  /** The words themselves, for the preparation screen. */
  words: PreparationWord[];
}

export interface PreparationWord {
  wordId: number;
  lemma: string;
  display: string;
  translation: string;
  contextSentence: string | null;
  contextSource: "chapter_opening" | "dictionary" | "none";
  firstSentencePosition: number;
}

export interface ChapterStoryState {
  chapterId: string;
  libraryItemId: string;
  slug: string;
  position: number;
  title: string | null;
  itemTitle: string;
  wordCount: number;
  estimatedMinutes: number;

  /** Whole percent, or null when there is no honest figure to show. */
  coveragePercent: number | null;
  coverageConfidence: EstimateConfidence;
  /** Polish, ready to render: "pewność: wysoka" or "za mało danych". */
  coverageConfidenceLabel: string;

  difficultyLabel: DifficultyLabel;
  /** Polish: "Wymagający". NOT a statement about the learner's level. */
  difficultyLabelPl: string;
  difficultyConfidence: EstimateConfidence;

  preparation: PreparationOffer | null;
  /** True when a validated bank can fill a Challenge for this chapter. */
  hasChallenge: boolean;
  /** Where the learner is in the chapter's LEARNING lifecycle. */
  lifecycle:
    | "not_started"
    | "prepared"
    | "reading"
    | "read"
    | "assessment_pending"
    | "completed";
}

export interface ChallengeResult {
  correct: number;
  total: number;
  comprehension: { correct: number; total: number };
  vocabulary: { correct: number; total: number };
  grammar: { correct: number; total: number };
  headlinePl: string;
  /** One sentence of coaching, or null when the data does not support one. */
  detailPl: string | null;
  /** The few things most worth revisiting. May be empty — that is a real result. */
  reviewTargets: { label: string; kind: "word" | "concept" }[];
  alreadyFinalized: boolean;
}
