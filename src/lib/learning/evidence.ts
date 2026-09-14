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
 * | Word lookup while reading                 | receptive_vocabulary  | receptive |
 * | Opening / finishing a chapter             | — (history only)      | —         |
 * | Chapter preparation item, DE → PL         | receptive_vocabulary  | receptive |
 * | Chapter Challenge, comprehension          | reading_comprehension | —         |
 * | Chapter Challenge, contextual vocabulary  | receptive/active      | either    |
 * | Chapter Challenge, grammar or transfer    | grammar               | —         |
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
import { LOOKUP_EVIDENCE_DISCOUNT } from "@/lib/reading/constants";
import { PREPARATION_EVIDENCE_DISCOUNT } from "@/lib/story/constants";

/** Kinds of interaction the event log accepts. Mirrors the SQL check constraint. */
export type LearningEventType =
  // produced today
  | "test_answer"
  | "calibration_answer"
  | "review"
  | "practice_answer"
  | "reading_lookup"
  | "reading_chapter_started"
  | "reading_chapter_completed"
  | "chapter_preparation_answer"
  | "chapter_assessment_answer"
  // accepted by the model, produced by nothing yet
  | "reading_sentence_help"
  | "reading_resume"
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
  | "practice"
  | "reader"
  | "book"
  | "story"
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
  /** Reader provenance. All null outside reading. */
  libraryItemId: string | null;
  chapterId: string | null;
  sentenceId: number | null;
  wordOccurrenceId: number | null;
  readingSessionId: string | null;
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
  libraryItemId: null,
  chapterId: null,
  sentenceId: null,
  wordOccurrenceId: null,
  readingSessionId: null,
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

/**
 * One answered item of a weakness drill.
 *
 * WHY THIS IS ITS OWN EVENT TYPE rather than a `test_answer` with a different
 * source. A drill is deliberately biased: its items were chosen *because* the
 * learner keeps failing this concept, so a run of them is not a representative
 * sample of anything. Anything that later refits the model has to be able to
 * tell drill answers apart from test answers, and `source_kind = 'practice'` is
 * how it does that.
 *
 * The evidence itself is weighted exactly like any other multiple-choice answer:
 * the item is the same item, asked the same way. What a drill changes is which
 * questions get asked, not what answering one proves.
 *
 * This is also the step that closes the learning loop — a drill answer updates
 * `user_concept_state`, which is what the weakness ranking reads, which is what
 * chooses tomorrow's drill.
 */
export function practiceAnswerEvidence(input: {
  sessionId: string;
  questionId: number;
  textId: number | null;
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
    eventKey: `practice:${input.sessionId}:${input.questionId}`,
    eventType: "practice_answer",
    occurredAt: input.occurredAt,
    skillCode: input.skillCode,
    responseMode: "multiple_choice",
    retrievalType,
    isCorrect: input.isCorrect,
    responseMs: input.responseMs,
    sourceKind: "practice",
    conceptCodes: input.conceptCodes,
    textId: input.textId,
    questionId: input.questionId,
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

/**
 * One word looked up while reading.
 *
 * A LOOKUP IS NOT A FAILED TEST — this is the single most important judgement in
 * the reader, and getting it wrong would quietly corrupt the knowledge model for
 * every learner who reads a lot.
 *
 * What a tap on *Schwert* actually means is "I was not sure enough to keep
 * going". That is genuine negative evidence about receptive knowledge of that
 * word, and it is much weaker than getting *Schwert* wrong in a graded item:
 * people also tap to confirm a guess, out of curiosity, or by accident. So it is
 * recorded with the `passive` response weight and discounted again
 * ({@link LOOKUP_EVIDENCE_DISCOUNT}), landing at 0.1 — a sixth of a
 * multiple-choice answer. One tap barely moves the estimate; the same word
 * looked up five times across five chapters moves it clearly, which is exactly
 * the signal worth having.
 *
 * NO CONCEPT IS TAGGED. A lookup says the word was unknown; it says nothing
 * about *why*, and attributing it to `lexical_recognition` would be the model
 * inventing a weakness from a gesture. The word channel records it, and that is
 * the whole claim.
 *
 * IDEMPOTENT. `interactionId` is minted per tap, so a retried request settles
 * the same lookup instead of counting the word as unknown twice.
 */
export function readingLookupEvidence(input: {
  interactionId: string;
  wordId: number;
  libraryItemId: string;
  chapterId: string;
  sentenceId: number | null;
  occurrenceId: number | null;
  readingSessionId: string | null;
  occurredAt: string;
}): LearningEvidence {
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `reading-lookup:${input.interactionId}`,
    eventType: "reading_lookup",
    occurredAt: input.occurredAt,
    skillCode: "receptive_vocabulary",
    responseMode: "passive",
    retrievalType: "recognition",
    // "Needed help" is the observation. See the note above on why this is not
    // the same thing as "answered incorrectly".
    isCorrect: false,
    sourceKind: "reader",
    conceptCodes: [],
    wordId: input.wordId,
    libraryItemId: input.libraryItemId,
    chapterId: input.chapterId,
    sentenceId: input.sentenceId,
    wordOccurrenceId: input.occurrenceId,
    readingSessionId: input.readingSessionId,
    vocabularyChannel: "receptive",
    weight: round(RESPONSE_MODE_WEIGHT.passive * LOOKUP_EVIDENCE_DISCOUNT),
  };
}

/**
 * Opening or finishing a chapter.
 *
 * HISTORY, NOT MASTERY. There is no skill, no concept and no word on these
 * events, which means {@link foldEvidence} moves nothing at all when it sees
 * one: they are written to `learning_events` and update no state. That is
 * deliberate and it is the rule from the learning engine applied honestly —
 * having read a chapter is not evidence that its language was understood, and a
 * reading engine that quietly credited comprehension for scrolling would be
 * inventing exactly the kind of knowledge Fluent refuses to claim.
 *
 * They are recorded because the reading HISTORY is worth having: when a chapter
 * was started, when it was finished, how long that took, how the lookup rate
 * changed between chapter one and chapter twenty.
 */
export function chapterReadingEvidence(input: {
  event: "started" | "completed";
  readingSessionId: string;
  libraryItemId: string;
  chapterId: string;
  activeSeconds: number | null;
  occurredAt: string;
}): LearningEvidence {
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `reading-chapter:${input.event}:${input.readingSessionId}`,
    eventType:
      input.event === "started"
        ? "reading_chapter_started"
        : "reading_chapter_completed",
    occurredAt: input.occurredAt,
    skillCode: null,
    responseMode: "passive",
    retrievalType: "recognition",
    isCorrect: true,
    responseMs: input.activeSeconds === null ? null : input.activeSeconds * 1000,
    sourceKind: "reader",
    conceptCodes: [],
    libraryItemId: input.libraryItemId,
    chapterId: input.chapterId,
    readingSessionId: input.readingSessionId,
    vocabularyChannel: null,
    weight: 0,
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * One answered item of a chapter preparation session.
 *
 * SEEING A WORD BEFORE A CHAPTER IS NOT KNOWING IT. A preparation item shows the
 * translation and then asks for it back seconds later, from four options, in the
 * most generous conditions Fluent can construct. Recording that at full
 * multiple-choice weight would let a learner "learn" forty words a week by
 * clicking through warm-ups — and the knowledge model, which has no way to see
 * how easy the retrieval was, would believe every one of them.
 *
 * So the multiple-choice weight is discounted again by
 * {@link PREPARATION_EVIDENCE_DISCOUNT}, landing at 0.24: real evidence, worth
 * less than half a graded item. What makes preparation valuable to the model is
 * not this event; it is the RETENTION check days later, when the same word is
 * asked again with nothing in front of it.
 *
 * Receptive only, and deliberately so. Recognising *ziehen* among four Polish
 * options says nothing about producing it, and letting a recognition exercise
 * feed active vocabulary is the exact transfer the learning engine forbids.
 */
export function chapterPreparationEvidence(input: {
  sessionId: string;
  wordId: number;
  libraryItemId: string;
  chapterId: string;
  sentenceId: number | null;
  isCorrect: boolean;
  responseMs: number | null;
  occurredAt: string;
}): LearningEvidence {
  const retrievalType: RetrievalType = "recognition";
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `chapter-prep:${input.sessionId}:${input.wordId}`,
    eventType: "chapter_preparation_answer",
    occurredAt: input.occurredAt,
    skillCode: "receptive_vocabulary",
    responseMode: "multiple_choice",
    retrievalType,
    isCorrect: input.isCorrect,
    responseMs: input.responseMs,
    sourceKind: "story",
    conceptCodes: ["lexical_recognition"],
    wordId: input.wordId,
    libraryItemId: input.libraryItemId,
    chapterId: input.chapterId,
    sentenceId: input.sentenceId,
    vocabularyChannel: vocabularyChannelFor(retrievalType),
    weight: round(RESPONSE_MODE_WEIGHT.multiple_choice * PREPARATION_EVIDENCE_DISCOUNT),
  };
}

/**
 * One answered question of a Chapter Challenge.
 *
 * THE CHALLENGE FEEDS THE SAME KNOWLEDGE MODEL AS EVERYTHING ELSE. There is no
 * separate "story mastery" score, because a second knowledge model is a second
 * set of numbers that will disagree with the first, and a learner whose Dativ is
 * failing in tests but passing in books is not a learner Fluent can plan for.
 *
 * WHAT MOVES, AND WHAT DOES NOT:
 *
 *  - the SKILL comes from the question's own tag, not from the fact that it was
 *    asked after a chapter. A comprehension question moves
 *    `reading_comprehension`; a grammar one moves `grammar`;
 *  - the CONCEPTS are the ones the item is tagged with and nothing else. A wrong
 *    answer is never attributed to a concept the question does not carry;
 *  - WORD KNOWLEDGE moves only when the question genuinely tests one word —
 *    `wordId` set, which validation guarantees for `contextual_vocabulary` and
 *    forbids nowhere else. A comprehension question about a paragraph that
 *    happens to contain *Schwert* proves nothing about *Schwert*;
 *  - the CHANNEL follows the retrieval the question demanded. A cloze the learner
 *    typed is `cued_recall` and feeds ACTIVE vocabulary; four options are
 *    recognition and feed receptive. That is the one place the Challenge earns
 *    active-vocabulary evidence at all, and it earns it by making them produce
 *    the form.
 */
export function chapterAssessmentEvidence(input: {
  sessionId: string;
  questionId: number;
  libraryItemId: string;
  chapterId: string;
  skillCode: SkillCode | null;
  conceptCodes: readonly ConceptCode[];
  /** Set only when the question was written to test this specific word. */
  testedWordId: number | null;
  /** Typed answers are recall; choosing and ordering are recognition. */
  retrievalType: RetrievalType;
  responseMode: ResponseMode;
  sourceSentenceId: number | null;
  isCorrect: boolean;
  responseMs: number | null;
  occurredAt: string;
}): LearningEvidence {
  return {
    ...EMPTY_EVIDENCE,
    eventKey: `chapter-challenge:${input.sessionId}:${input.questionId}`,
    eventType: "chapter_assessment_answer",
    occurredAt: input.occurredAt,
    skillCode: input.skillCode,
    responseMode: input.responseMode,
    retrievalType: input.retrievalType,
    isCorrect: input.isCorrect,
    responseMs: input.responseMs,
    sourceKind: "story",
    conceptCodes: input.conceptCodes,
    wordId: input.testedWordId,
    libraryItemId: input.libraryItemId,
    chapterId: input.chapterId,
    sentenceId: input.sourceSentenceId,
    vocabularyChannel:
      input.testedWordId === null ? null : vocabularyChannelFor(input.retrievalType),
    weight: RESPONSE_MODE_WEIGHT[input.responseMode],
  };
}

/**
 * What a Challenge question demanded of the learner, from how it is answered.
 *
 * The rule is the evidence map's, not the UI's: what decides recognition from
 * recall is the RETRIEVAL, never the widget. A cloze makes them produce the
 * German with nothing to pick from; every other gradable type puts the answer on
 * the screen somewhere.
 */
export function assessmentRetrieval(questionType: string): {
  retrievalType: RetrievalType;
  responseMode: ResponseMode;
} {
  if (questionType === "cloze" || questionType === "typed_answer") {
    return { retrievalType: "cued_recall", responseMode: "typed" };
  }
  return { retrievalType: "recognition", responseMode: "multiple_choice" };
}
