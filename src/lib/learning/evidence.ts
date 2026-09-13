/**
 * The evidence map — what each kind of interaction actually proves.
 *
 * This module is the single place in Fluent that answers "a learner just did X;
 * what does that tell us?". It exists because the same decision was otherwise
 * going to be re-made, slightly differently, in the test action, the review
 * action, the placement action and every exercise added later.
 *
 * THE MAP, in one table:
 *
 * | Interaction                              | Skill                 | Channel   |
 * | ---------------------------------------- | --------------------- | --------- |
 * | Reading-test comprehension question       | reading_comprehension | —         |
 * | Grammar item (test or placement)          | grammar               | —         |
 * | Vocabulary multiple choice                | receptive_vocabulary  | receptive |
 * | Flashcard review, DE → PL                 | receptive_vocabulary  | receptive |
 * | Quiz review, DE → PL                      | receptive_vocabulary  | receptive |
 * | Typed review, PL → DE *(not built yet)*   | active_vocabulary     | active    |
 * | Spoken production *(not built yet)*       | speaking              | active    |
 *
 * THE RULE BEHIND THE TABLE. What decides receptive vs active is the *retrieval*
 * the exercise demands, never the button the learner pressed. Choosing "miecz"
 * from four options proves recognition however confidently it was chosen;
 * writing "Schwert" from the Polish prompt proves recall. Pressing "Dobrze" on a
 * flashcard proves recognition too — the learner graded their own recognition,
 * they did not produce anything. Fluent has no active-vocabulary exercise today,
 * so it reports active vocabulary as unknown, which is the truth.
 *
 * EVIDENCE IS NOT ALL WORTH THE SAME, either. A four-option question is right a
 * quarter of the time by accident; a typed answer is not. That is what the
 * weights below encode, and why they belong here rather than in the model: the
 * model asks "how much is this worth?", this module answers.
 */

import type { ConceptCode } from "@/lib/learning/concepts";
import type { SkillCode } from "@/lib/learning/skills";

/** Kinds of interaction the event log accepts. Mirrors the SQL check constraint. */
export type LearningEventType =
  // produced today
  | "test_answer"
  | "calibration_answer"
  | "review"
  // accepted by the model, produced by nothing yet
  | "reading_lookup"
  | "reading_sentence_help"
  | "typed_recall"
  | "listening_answer"
  | "speaking_answer"
  | "writing_answer";

/** How the learner gave the answer. */
export type ResponseMode =
  | "multiple_choice"
  | "self_rated"
  | "typed"
  | "spoken"
  | "passive";

/** What kind of retrieval the exercise demanded. */
export type RetrievalType = "recognition" | "cued_recall" | "free_production";

/** Which half of vocabulary knowledge an observation belongs to. */
export type VocabularyChannel = "receptive" | "active";

/** Where an interaction came from. Broad enough for books and a reader later. */
export type SourceKind =
  | "reading_test"
  | "placement_test"
  | "review"
  | "reader"
  | "book"
  | "import";

/** Provenance of the ROW: native events vs. reconstructed history. */
export type EvidenceOrigin = "native" | "legacy_backfill" | "import";

/** Flashcard recall ratings, in the order the UI shows them. */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** How a review card was presented. */
export type ReviewMode = "flashcard" | "quiz" | "typed_recall" | "listening";

/** Which way round the card was asked. Decides receptive vs active. */
export type ReviewDirection = "de_to_pl" | "pl_to_de";

/**
 * Base evidence weight per response mode, 0–1.
 *
 *  - `multiple_choice` — one in four is right by accident, and the distractors do
 *    half the remembering. Real evidence, discounted.
 *  - `self_rated` — the learner is honest but unverified: they decide whether
 *    they knew it. Slightly weaker than a graded choice.
 *  - `typed` / `spoken` — the learner produced the form with nothing to pick
 *    from. This is the strongest thing Fluent can observe, so it anchors 1.0.
 *  - `passive` — a lookup or an exposure. Barely evidence; kept so that reading
 *    behaviour can be recorded without pretending it was a test.
 */
export const RESPONSE_MODE_WEIGHT: Readonly<Record<ResponseMode, number>> = {
  multiple_choice: 0.6,
  self_rated: 0.5,
  typed: 1,
  spoken: 1,
  passive: 0.2,
};

/**
 * Multiplier for what the learner said about their own recall.
 *
 * "Trudne" is a hedged success — they got there, but slowly and unsurely — so it
 * counts for less than a clean "Dobrze". "Jeszcze raz" is a clear failure and
 * therefore full-weight evidence: a definite miss tells us as much as a hit.
 */
export const REVIEW_RATING_WEIGHT: Readonly<Record<ReviewRating, number>> = {
  again: 1,
  hard: 0.8,
  good: 1,
  easy: 1,
};

/** Which ratings count as a successful retrieval. Mirrors SM-2's quality < 3 lapse. */
export const REVIEW_RATING_CORRECT: Readonly<Record<ReviewRating, boolean>> = {
  again: false,
  hard: true,
  good: true,
  easy: true,
};

/** How each review mode is answered. */
export const REVIEW_MODE_RESPONSE: Readonly<Record<ReviewMode, ResponseMode>> = {
  flashcard: "self_rated",
  quiz: "multiple_choice",
  typed_recall: "typed",
  listening: "multiple_choice",
};

/**
 * One observation, ready to be written as a learning event and folded into state.
 *
 * `vocabularyChannel` is set ONLY when the interaction genuinely tested this
 * word. A word appearing somewhere in a passage the learner read is not evidence
 * that they know it, so comprehension questions leave it null and touch no word
 * knowledge at all.
 */
export interface LearningEvidence {
  /** Deterministic idempotency key — see `learning_events.event_key`. */
  eventKey: string;
  eventType: LearningEventType;
  occurredAt: string;
  skillCode: SkillCode | null;
  responseMode: ResponseMode;
  retrievalType: RetrievalType;
  isCorrect: boolean;
  responseMs: number | null;
  hintsUsed: number;
  sourceKind: SourceKind;
  origin: EvidenceOrigin;
  conceptCodes: readonly ConceptCode[];
  textId: number | null;
  questionId: number | null;
  calibrationQuestionId: number | null;
  wordId: number | null;
  testSessionId: string | null;
  calibrationSessionId: string | null;
  vocabularyChannel: VocabularyChannel | null;
  /** Effective weight for the knowledge model, 0–1. */
  weight: number;
}

/** Receptive means recognition; anything the learner had to produce is active. */
export function vocabularyChannelFor(retrieval: RetrievalType): VocabularyChannel {
  return retrieval === "recognition" ? "receptive" : "active";
}

/** The vocabulary skill matching a retrieval type. */
export function vocabularySkillFor(retrieval: RetrievalType): SkillCode {
  return vocabularyChannelFor(retrieval) === "receptive"
    ? "receptive_vocabulary"
    : "active_vocabulary";
}

/**
 * What a review actually demanded of the learner.
 *
 * Typed modes are recall by construction; so is anything asked PL → DE, because
 * the learner has to come up with the German. Everything else — including a
 * confident "Łatwe" on a flashcard — is recognition.
 */
export function reviewRetrievalType(
  mode: ReviewMode,
  direction: ReviewDirection,
): RetrievalType {
  if (mode === "typed_recall") return "cued_recall";
  return direction === "pl_to_de" ? "cued_recall" : "recognition";
}

/** Effective weight of a review answer: the mode's worth, tempered by the rating. */
export function reviewEvidenceWeight(
  mode: ReviewMode,
  rating: ReviewRating,
): number {
  return round(RESPONSE_MODE_WEIGHT[REVIEW_MODE_RESPONSE[mode]] * REVIEW_RATING_WEIGHT[rating]);
}

const EMPTY_EVIDENCE: Omit<LearningEvidence, "eventKey" | "eventType" | "occurredAt"> = {
  skillCode: null,
  responseMode: "multiple_choice",
  retrievalType: "recognition",
  isCorrect: false,
  responseMs: null,
  hintsUsed: 0,
  sourceKind: "reading_test",
  origin: "native",
  conceptCodes: [],
  textId: null,
  questionId: null,
  calibrationQuestionId: null,
  wordId: null,
  testSessionId: null,
  calibrationSessionId: null,
  vocabularyChannel: null,
  weight: 0,
};

/** One answered question of a reading test. */
export function testAnswerEvidence(input: {
  sessionId: string;
  questionId: number;
  textId: number;
  skillCode: SkillCode;
  conceptCodes: readonly ConceptCode[];
  /** Set only when the question was written to test this specific word. */
  testedWordId: number | null;
  isCorrect: boolean;
  responseMs: number | null;
  occurredAt: string;
}): LearningEvidence {
  const retrievalType: RetrievalType = "recognition";
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `test:${input.sessionId}:${input.questionId}`,
    eventType: "test_answer",
    occurredAt: input.occurredAt,
    skillCode: input.skillCode,
    responseMode: "multiple_choice",
    retrievalType,
    isCorrect: input.isCorrect,
    responseMs: input.responseMs,
    sourceKind: "reading_test",
    conceptCodes: input.conceptCodes,
    textId: input.textId,
    questionId: input.questionId,
    wordId: input.testedWordId,
    testSessionId: input.sessionId,
    // A comprehension question that is not about one word feeds no word
    // knowledge — see the note on `vocabularyChannel` above.
    vocabularyChannel:
      input.testedWordId === null ? null : vocabularyChannelFor(retrievalType),
    weight: RESPONSE_MODE_WEIGHT.multiple_choice,
  };
}

/** One answered item of the adaptive placement test. */
export function calibrationAnswerEvidence(input: {
  sessionId: string;
  questionId: number;
  skillCode: SkillCode | null;
  conceptCodes: readonly ConceptCode[];
  testedWordId: number | null;
  isCorrect: boolean;
  responseMs: number | null;
  occurredAt: string;
}): LearningEvidence {
  const retrievalType: RetrievalType = "recognition";
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `calibration:${input.sessionId}:${input.questionId}`,
    eventType: "calibration_answer",
    occurredAt: input.occurredAt,
    skillCode: input.skillCode,
    responseMode: "multiple_choice",
    retrievalType,
    isCorrect: input.isCorrect,
    responseMs: input.responseMs,
    sourceKind: "placement_test",
    conceptCodes: input.conceptCodes,
    calibrationQuestionId: input.questionId,
    calibrationSessionId: input.sessionId,
    wordId: input.testedWordId,
    vocabularyChannel:
      input.testedWordId === null ? null : vocabularyChannelFor(retrievalType),
    weight: RESPONSE_MODE_WEIGHT.multiple_choice,
  };
}

/** One graded flashcard or quiz card. */
export function reviewEvidence(input: {
  interactionId: string;
  wordId: number;
  mode: ReviewMode;
  direction: ReviewDirection;
  rating: ReviewRating;
  responseMs: number | null;
  occurredAt: string;
}): LearningEvidence {
  const retrievalType = reviewRetrievalType(input.mode, input.direction);
  const channel = vocabularyChannelFor(retrievalType);
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `review:${input.interactionId}`,
    eventType: "review",
    occurredAt: input.occurredAt,
    skillCode: vocabularySkillFor(retrievalType),
    responseMode: REVIEW_MODE_RESPONSE[input.mode],
    retrievalType,
    isCorrect: REVIEW_RATING_CORRECT[input.rating],
    responseMs: input.responseMs,
    sourceKind: "review",
    // The concept a review exercises follows the channel, not the word: a
    // DE → PL card drills recognition, a PL → DE card drills recall.
    conceptCodes: [channel === "receptive" ? "lexical_recognition" : "lexical_recall"],
    wordId: input.wordId,
    vocabularyChannel: channel,
    weight: reviewEvidenceWeight(input.mode, input.rating),
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
