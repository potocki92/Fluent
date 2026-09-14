import { describe, expect, it } from "vitest";

import type { Blueprint } from "@/lib/story/blueprint";
import {
  availableByKind,
  difficultyFitSignal,
  selectChallengeQuestions,
  stalenessSignal,
  weaknessSignal,
  type SelectableQuestion,
} from "@/lib/story/selection";

const NOW = new Date("2026-06-01T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function question(overrides: Partial<SelectableQuestion> = {}): SelectableQuestion {
  return {
    id: 1,
    kind: "comprehension",
    difficulty: 1200,
    conceptCodes: [],
    wordId: null,
    lastAnsweredAt: null,
    ...overrides,
  };
}

const BLUEPRINT: Blueprint = {
  comprehension: 2,
  contextual_vocabulary: 1,
  grammar: 1,
  transfer: 0,
};

describe("stalenessSignal", () => {
  it("treats an unseen question as fully fresh", () => {
    expect(stalenessSignal(null, NOW)).toBe(1);
  });

  it("recovers as the answer ages", () => {
    expect(stalenessSignal(daysAgo(1), NOW)).toBeLessThan(stalenessSignal(daysAgo(30), NOW));
    expect(stalenessSignal(daysAgo(90), NOW)).toBe(1);
  });
});

describe("weaknessSignal", () => {
  it("takes the worst concept, not the average", () => {
    const weak = new Map([
      ["case_dative", 0.9],
      ["word_order", 0.1],
    ]);
    expect(weaknessSignal(["case_dative", "word_order"], weak)).toBe(0.9);
  });

  it("is zero when nothing is known to be weak", () => {
    expect(weaknessSignal(["case_dative"], undefined)).toBe(0);
  });
});

describe("difficultyFitSignal", () => {
  it("refuses to compare against an ability that does not exist", () => {
    expect(difficultyFitSignal(1400, null)).toBe(0);
  });

  it("peaks just above the learner's ability", () => {
    expect(difficultyFitSignal(1250, 1200)).toBe(1);
    expect(difficultyFitSignal(1900, 1200)).toBe(0);
  });
});

describe("selectChallengeQuestions", () => {
  it("prefers questions the learner has never seen", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, lastAnsweredAt: daysAgo(40) }),
        question({ id: 2, lastAnsweredAt: null }),
        question({ id: 3, lastAnsweredAt: daysAgo(60) }),
      ],
      blueprint: { comprehension: 1, contextual_vocabulary: 0, grammar: 0, transfer: 0 },
      ability: null,
      now: NOW,
    });
    expect(result.questions.map((q) => q.id)).toEqual([2]);
    expect(result.reusedRecent).toBe(false);
  });

  it("holds back a question answered days ago", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, lastAnsweredAt: daysAgo(1) }),
        question({ id: 2, lastAnsweredAt: daysAgo(40) }),
      ],
      blueprint: { comprehension: 1, contextual_vocabulary: 0, grammar: 0, transfer: 0 },
      ability: null,
      now: NOW,
    });
    expect(result.questions.map((q) => q.id)).toEqual([2]);
  });

  it("reuses the LEAST recent rather than failing when the bank is exhausted", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, lastAnsweredAt: daysAgo(1) }),
        question({ id: 2, lastAnsweredAt: daysAgo(5) }),
      ],
      blueprint: { comprehension: 2, contextual_vocabulary: 0, grammar: 0, transfer: 0 },
      ability: null,
      now: NOW,
    });
    expect(result.questions).toHaveLength(2);
    expect(result.reusedRecent).toBe(true);
    expect(result.questions[0].id).toBe(2);
  });

  it("prefers questions about words the learner actually met in the chapter", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, kind: "contextual_vocabulary", wordId: 100 }),
        question({ id: 2, kind: "contextual_vocabulary", wordId: 200 }),
      ],
      blueprint: { comprehension: 0, contextual_vocabulary: 1, grammar: 0, transfer: 0 },
      ability: null,
      interactedWordIds: new Set([200]),
      now: NOW,
    });
    expect(result.questions.map((q) => q.id)).toEqual([2]);
  });

  it("prefers a question on a concept the learner is failing", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, kind: "grammar", conceptCodes: ["word_order"] }),
        question({ id: 2, kind: "grammar", conceptCodes: ["case_dative"] }),
      ],
      blueprint: { comprehension: 0, contextual_vocabulary: 0, grammar: 1, transfer: 0 },
      ability: null,
      weakConcepts: new Map([["case_dative", 0.9]]),
      now: NOW,
    });
    expect(result.questions.map((q) => q.id)).toEqual([2]);
  });

  it("fills each kind independently and reports what it managed", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, kind: "comprehension" }),
        question({ id: 2, kind: "comprehension" }),
        question({ id: 3, kind: "contextual_vocabulary", wordId: 100 }),
      ],
      blueprint: BLUEPRINT,
      ability: null,
      now: NOW,
    });
    expect(result.filled).toEqual({
      comprehension: 2,
      contextual_vocabulary: 1,
      grammar: 0,
      transfer: 0,
    });
  });

  it("asks the story first", () => {
    const result = selectChallengeQuestions({
      questions: [
        question({ id: 1, kind: "grammar" }),
        question({ id: 2, kind: "comprehension" }),
        question({ id: 3, kind: "transfer" }),
      ],
      blueprint: { comprehension: 1, contextual_vocabulary: 0, grammar: 1, transfer: 1 },
      ability: null,
      now: NOW,
    });
    expect(result.questions.map((q) => q.kind)).toEqual([
      "comprehension",
      "grammar",
      "transfer",
    ]);
  });

  it("is stable across runs on an unchanged bank", () => {
    const input = {
      questions: [
        question({ id: 5, kind: "comprehension" }),
        question({ id: 6, kind: "comprehension" }),
      ],
      blueprint: { comprehension: 1, contextual_vocabulary: 0, grammar: 0, transfer: 0 },
      ability: null,
      now: NOW,
    };
    expect(selectChallengeQuestions(input).questions.map((q) => q.id)).toEqual(
      selectChallengeQuestions(input).questions.map((q) => q.id),
    );
  });
});

describe("availableByKind", () => {
  it("counts every kind, including the empty ones", () => {
    expect(
      availableByKind([
        question({ id: 1, kind: "comprehension" }),
        question({ id: 2, kind: "comprehension" }),
      ]),
    ).toEqual({
      comprehension: 2,
      contextual_vocabulary: 0,
      grammar: 0,
      transfer: 0,
    });
  });
});
