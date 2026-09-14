import { describe, expect, it } from "vitest";

import {
  calibrationAnswerEvidence,
  chapterReadingEvidence,
  readingLookupEvidence,
  reviewEvidence,
  reviewEvidenceWeight,
  reviewRetrievalType,
  testAnswerEvidence,
  vocabularyChannelFor,
  vocabularySkillFor,
  RESPONSE_MODE_WEIGHT,
} from "./evidence";
import { LOOKUP_EVIDENCE_DISCOUNT } from "@/lib/reading/constants";

const NOW = "2026-01-01T12:00:00.000Z";

describe("receptive vs active", () => {
  it("treats recognition as receptive and anything produced as active", () => {
    expect(vocabularyChannelFor("recognition")).toBe("receptive");
    expect(vocabularyChannelFor("cued_recall")).toBe("active");
    expect(vocabularyChannelFor("free_production")).toBe("active");

    expect(vocabularySkillFor("recognition")).toBe("receptive_vocabulary");
    expect(vocabularySkillFor("cued_recall")).toBe("active_vocabulary");
  });

  it("calls a DE → PL card recognition however confidently it was graded", () => {
    expect(reviewRetrievalType("flashcard", "de_to_pl")).toBe("recognition");
    expect(reviewRetrievalType("quiz", "de_to_pl")).toBe("recognition");
  });

  it("calls a PL → DE card recall, because the learner has to produce German", () => {
    expect(reviewRetrievalType("flashcard", "pl_to_de")).toBe("cued_recall");
    expect(reviewRetrievalType("typed_recall", "de_to_pl")).toBe("cued_recall");
  });
});

describe("reviewEvidence", () => {
  it("produces receptive evidence for the flashcard deck, never active", () => {
    const item = reviewEvidence({
      interactionId: "i-1",
      wordId: 42,
      mode: "flashcard",
      direction: "de_to_pl",
      rating: "easy",
      responseMs: 1200,
      occurredAt: NOW,
    });

    expect(item.skillCode).toBe("receptive_vocabulary");
    expect(item.vocabularyChannel).toBe("receptive");
    expect(item.conceptCodes).toEqual(["lexical_recognition"]);
    expect(item.isCorrect).toBe(true);
  });

  it("produces active evidence only when the learner produced the word", () => {
    const item = reviewEvidence({
      interactionId: "i-2",
      wordId: 42,
      mode: "typed_recall",
      direction: "pl_to_de",
      rating: "good",
      responseMs: null,
      occurredAt: NOW,
    });

    expect(item.skillCode).toBe("active_vocabulary");
    expect(item.vocabularyChannel).toBe("active");
    expect(item.conceptCodes).toEqual(["lexical_recall"]);
    expect(item.responseMode).toBe("typed");
  });

  it("counts 'Jeszcze raz' as a failure and everything else as a success", () => {
    const rating = (r: "again" | "hard" | "good" | "easy") =>
      reviewEvidence({
        interactionId: `i-${r}`,
        wordId: 1,
        mode: "flashcard",
        direction: "de_to_pl",
        rating: r,
        responseMs: null,
        occurredAt: NOW,
      }).isCorrect;

    expect(rating("again")).toBe(false);
    expect(rating("hard")).toBe(true);
    expect(rating("good")).toBe(true);
    expect(rating("easy")).toBe(true);
  });

  it("discounts a hedged success and trusts a produced answer most", () => {
    expect(reviewEvidenceWeight("flashcard", "hard")).toBeLessThan(
      reviewEvidenceWeight("flashcard", "good"),
    );
    expect(reviewEvidenceWeight("typed_recall", "good")).toBeGreaterThan(
      reviewEvidenceWeight("quiz", "good"),
    );
    expect(RESPONSE_MODE_WEIGHT.multiple_choice).toBeLessThan(
      RESPONSE_MODE_WEIGHT.typed,
    );
  });

  it("keys the event on the interaction, so a replay is the same event", () => {
    const once = reviewEvidence({
      interactionId: "same",
      wordId: 7,
      mode: "quiz",
      direction: "de_to_pl",
      rating: "good",
      responseMs: null,
      occurredAt: NOW,
    });
    expect(once.eventKey).toBe("review:same");
  });
});

describe("testAnswerEvidence", () => {
  it("attributes an untagged comprehension question to its skill and nothing else", () => {
    const item = testAnswerEvidence({
      sessionId: "s-1",
      questionId: 11,
      textId: 3,
      skillCode: "reading_comprehension",
      conceptCodes: [],
      testedWordId: null,
      isCorrect: false,
      responseMs: 8000,
      occurredAt: NOW,
    });

    expect(item.skillCode).toBe("reading_comprehension");
    expect(item.conceptCodes).toEqual([]);
    // A word appearing in the passage is NOT evidence that it is known.
    expect(item.wordId).toBeNull();
    expect(item.vocabularyChannel).toBeNull();
  });

  it("feeds word knowledge only when the item was written to test that word", () => {
    const item = testAnswerEvidence({
      sessionId: "s-1",
      questionId: 12,
      textId: 3,
      skillCode: "receptive_vocabulary",
      conceptCodes: ["lexical_recognition"],
      testedWordId: 900,
      isCorrect: true,
      responseMs: null,
      occurredAt: NOW,
    });

    expect(item.wordId).toBe(900);
    expect(item.vocabularyChannel).toBe("receptive");
  });

  it("keys the event on the session and question, so a re-finalize repeats it", () => {
    const item = testAnswerEvidence({
      sessionId: "s-9",
      questionId: 4,
      textId: 1,
      skillCode: "grammar",
      conceptCodes: ["preposition_case"],
      testedWordId: null,
      isCorrect: false,
      responseMs: null,
      occurredAt: NOW,
    });
    expect(item.eventKey).toBe("test:s-9:4");
  });
});

describe("calibrationAnswerEvidence", () => {
  it("carries the placement item's skill without changing what placement is for", () => {
    const item = calibrationAnswerEvidence({
      sessionId: "c-1",
      questionId: 5,
      skillCode: "grammar",
      conceptCodes: [],
      testedWordId: null,
      isCorrect: false,
      responseMs: null,
      occurredAt: NOW,
    });

    expect(item.eventType).toBe("calibration_answer");
    expect(item.sourceKind).toBe("placement_test");
    expect(item.skillCode).toBe("grammar");
    expect(item.eventKey).toBe("calibration:c-1:5");
  });

  it("attributes an untagged placement item to no skill at all", () => {
    const item = calibrationAnswerEvidence({
      sessionId: "c-1",
      questionId: 6,
      skillCode: null,
      conceptCodes: [],
      testedWordId: null,
      isCorrect: true,
      responseMs: null,
      occurredAt: NOW,
    });

    expect(item.skillCode).toBeNull();
    expect(item.conceptCodes).toEqual([]);
  });
});

describe("reading evidence", () => {
  const lookup = readingLookupEvidence({
    interactionId: "int-1",
    wordId: 42,
    libraryItemId: "11111111-1111-1111-1111-111111111111",
    chapterId: "22222222-2222-2222-2222-222222222222",
    sentenceId: 7,
    occurrenceId: 9,
    readingSessionId: "33333333-3333-3333-3333-333333333333",
    occurredAt: NOW,
  });

  it("A LOOKUP IS NOT A FAILED TEST — it is worth a fraction of one", () => {
    expect(lookup.weight).toBeCloseTo(
      RESPONSE_MODE_WEIGHT.passive * LOOKUP_EVIDENCE_DISCOUNT,
      6,
    );
    // A multiple-choice answer is worth several lookups. That ratio is the whole
    // claim: one tap barely moves the estimate, five move it clearly.
    expect(lookup.weight * 5).toBeLessThan(RESPONSE_MODE_WEIGHT.multiple_choice * 2);
    expect(lookup.responseMode).toBe("passive");
  });

  it("attributes a lookup to the word, and to no concept at all", () => {
    // A lookup says the word was unknown. It says nothing about WHY, so
    // inventing a concept weakness from a gesture is exactly what it must not do.
    expect(lookup.conceptCodes).toEqual([]);
    expect(lookup.skillCode).toBe("receptive_vocabulary");
    expect(lookup.vocabularyChannel).toBe("receptive");
    expect(lookup.wordId).toBe(42);
    expect(lookup.isCorrect).toBe(false);
  });

  it("carries the place in the book it happened at", () => {
    expect(lookup.chapterId).toBe("22222222-2222-2222-2222-222222222222");
    expect(lookup.sentenceId).toBe(7);
    expect(lookup.wordOccurrenceId).toBe(9);
    expect(lookup.sourceKind).toBe("reader");
  });

  it("keys on the interaction, so a retry settles the same lookup", () => {
    const retry = readingLookupEvidence({
      interactionId: "int-1",
      wordId: 42,
      libraryItemId: "11111111-1111-1111-1111-111111111111",
      chapterId: "22222222-2222-2222-2222-222222222222",
      sentenceId: 7,
      occurrenceId: 9,
      readingSessionId: "33333333-3333-3333-3333-333333333333",
      occurredAt: "2026-02-02T00:00:00.000Z",
    });
    expect(retry.eventKey).toBe(lookup.eventKey);
  });

  it("records finishing a chapter as history that scores NOTHING", () => {
    const completed = chapterReadingEvidence({
      event: "completed",
      readingSessionId: "33333333-3333-3333-3333-333333333333",
      libraryItemId: "11111111-1111-1111-1111-111111111111",
      chapterId: "22222222-2222-2222-2222-222222222222",
      activeSeconds: 840,
      occurredAt: NOW,
    });

    // Having read a chapter is not evidence that its language was understood.
    expect(completed.weight).toBe(0);
    expect(completed.skillCode).toBeNull();
    expect(completed.conceptCodes).toEqual([]);
    expect(completed.wordId).toBeNull();
    expect(completed.vocabularyChannel).toBeNull();
  });
});
