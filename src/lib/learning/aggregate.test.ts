import { describe, expect, it } from "vitest";

import {
  foldEvidence,
  EMPTY_SNAPSHOT,
  type KnowledgeSnapshot,
} from "./aggregate";
import {
  reviewEvidence,
  testAnswerEvidence,
  type LearningEvidence,
} from "./evidence";
import { EMPTY_KNOWLEDGE_STATE } from "./knowledge-model";

const NOW = "2026-01-01T12:00:00.000Z";
const LATER = "2026-01-02T12:00:00.000Z";

function grammarAnswer(
  questionId: number,
  isCorrect: boolean,
  occurredAt = NOW,
): LearningEvidence {
  return testAnswerEvidence({
    sessionId: "s-1",
    questionId,
    textId: 3,
    skillCode: "grammar",
    conceptCodes: ["preposition_case", "case_dative"],
    testedWordId: null,
    isCorrect,
    responseMs: null,
    occurredAt,
  });
}

describe("foldEvidence", () => {
  it("moves each state row once for a whole batch", () => {
    const result = foldEvidence(EMPTY_SNAPSHOT, [
      grammarAnswer(1, false),
      grammarAnswer(2, false),
      grammarAnswer(3, true),
    ]);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].skillCode).toBe("grammar");
    expect(result.skills[0].state.evidenceCount).toBe(3);
    expect(result.payload.skills).toHaveLength(1);
    expect(result.payload.events).toHaveLength(3);
  });

  it("credits every tagged concept, and only tagged concepts", () => {
    const result = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);
    const codes = result.concepts.map((entry) => entry.conceptCode).sort();

    expect(codes).toEqual(["case_dative", "preposition_case"]);
    for (const entry of result.concepts) {
      expect(entry.state.failureCount).toBe(1);
      expect(entry.lastFailureAt).toBe(NOW);
      expect(entry.lastSuccessAt).toBeNull();
    }
  });

  it("invents no weakness when the question carries no concepts", () => {
    const untagged = testAnswerEvidence({
      sessionId: "s-1",
      questionId: 9,
      textId: 3,
      skillCode: "reading_comprehension",
      conceptCodes: [],
      testedWordId: null,
      isCorrect: false,
      responseMs: null,
      occurredAt: NOW,
    });

    const result = foldEvidence(EMPTY_SNAPSHOT, [untagged]);

    expect(result.concepts).toEqual([]);
    expect(result.words).toEqual([]);
    // The answer is still history, it is just attributed to nothing.
    expect(result.payload.events).toHaveLength(1);
    expect(result.skills[0].skillCode).toBe("reading_comprehension");
  });

  it("never lets receptive practice raise active vocabulary", () => {
    const result = foldEvidence(EMPTY_SNAPSHOT, [
      reviewEvidence({
        interactionId: "i-1",
        wordId: 501,
        mode: "flashcard",
        direction: "de_to_pl",
        rating: "easy",
        responseMs: null,
        occurredAt: NOW,
      }),
    ]);

    const word = result.words[0];
    expect(word.receptive.evidenceCount).toBe(1);
    expect(word.receptive.score).not.toBeNull();
    expect(word.active).toEqual(EMPTY_KNOWLEDGE_STATE);
    expect(result.skills.map((s) => s.skillCode)).toEqual(["receptive_vocabulary"]);
  });

  it("tracks the two channels independently once both have evidence", () => {
    const receptive = foldEvidence(EMPTY_SNAPSHOT, [
      reviewEvidence({
        interactionId: "i-1",
        wordId: 501,
        mode: "quiz",
        direction: "de_to_pl",
        rating: "good",
        responseMs: null,
        occurredAt: NOW,
      }),
    ]);

    const snapshot: KnowledgeSnapshot = {
      skills: new Map(),
      concepts: new Map(),
      words: new Map(receptive.words.map((entry) => [entry.wordId, entry])),
    };

    const both = foldEvidence(snapshot, [
      reviewEvidence({
        interactionId: "i-2",
        wordId: 501,
        mode: "typed_recall",
        direction: "pl_to_de",
        rating: "again",
        responseMs: null,
        occurredAt: LATER,
      }),
    ]);

    const word = both.words[0];
    expect(word.receptive.evidenceCount).toBe(1);
    expect(word.receptive.score).toBeGreaterThan(0.5);
    expect(word.active.evidenceCount).toBe(1);
    expect(word.active.score).toBeLessThan(0.5);
    expect(word.exposureCount).toBe(2);
  });

  it("sends the version it READ, so a second observation cannot invent one", () => {
    const first = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);
    expect(first.payload.skills[0].expected_version).toBe(0);

    const snapshot: KnowledgeSnapshot = {
      // A row that has already been written once sits at version 1.
      skills: new Map([["grammar", { ...first.skills[0], version: 1 }]]),
      concepts: new Map(),
      words: new Map(),
    };

    const second = foldEvidence(snapshot, [
      grammarAnswer(2, false, LATER),
      grammarAnswer(3, true, LATER),
    ]);

    expect(second.payload.skills).toHaveLength(1);
    expect(second.payload.skills[0].expected_version).toBe(1);
    expect(second.skills[0].state.evidenceCount).toBe(3);
  });

  it("produces a payload whose keys match the database columns", () => {
    const result = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);

    expect(Object.keys(result.payload.events[0])).toContain("event_key");
    expect(result.payload.events[0].concepts).toEqual([
      "preposition_case",
      "case_dative",
    ]);
    expect(result.payload.skills[0]).toMatchObject({
      skill_code: "grammar",
      expected_version: 0,
      model_version: "knowledge_v1",
    });
    expect(result.payload.concepts[0]).toHaveProperty("last_failure_at", NOW);
  });

  it("round-trips through JSON unchanged — it is the RPC payload", () => {
    const { payload } = foldEvidence(EMPTY_SNAPSHOT, [
      grammarAnswer(1, false),
      reviewEvidence({
        interactionId: "i-1",
        wordId: 501,
        mode: "flashcard",
        direction: "de_to_pl",
        rating: "good",
        responseMs: 900,
        occurredAt: NOW,
      }),
    ]);

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe("idempotency at the domain level", () => {
  it("gives a replayed observation the same event key, so the database can drop it", () => {
    const first = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);
    const replay = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);

    expect(replay.payload.events[0].event_key).toBe(
      first.payload.events[0].event_key,
    );
  });

  it("folds from the snapshot it was given, so a retry recomputes rather than stacks", () => {
    // A retry re-reads state (still version 0, nothing was committed) and
    // recomputes — it must not add the same answer on top of itself.
    const first = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);
    const retry = foldEvidence(EMPTY_SNAPSHOT, [grammarAnswer(1, false)]);

    expect(retry.skills[0].state).toEqual(first.skills[0].state);
    expect(retry.skills[0].state.evidenceCount).toBe(1);
  });
});
