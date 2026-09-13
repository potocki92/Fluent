import { describe, expect, it } from "vitest";

import {
  firstUnansweredIndex,
  scoreSessionItems,
  type StoredSessionItem,
} from "@/lib/test-session";

function item(overrides: Partial<StoredSessionItem> = {}): StoredSessionItem {
  return {
    questionId: 1,
    itemDifficulty: 1200,
    isCorrect: null,
    answeredAt: null,
    ...overrides,
  };
}

const answered = (isCorrect: boolean, itemDifficulty = 1200) =>
  item({ isCorrect, itemDifficulty, answeredAt: "2026-01-01T00:00:00Z" });

describe("scoreSessionItems", () => {
  it("counts correct answers and averages the snapshotted difficulty", () => {
    const score = scoreSessionItems([
      answered(true, 1100),
      answered(false, 1300),
      answered(true, 1200),
    ]);

    expect(score).toEqual({
      total: 3,
      correct: 2,
      unanswered: 0,
      avgDifficulty: 1200,
    });
  });

  it("reports unanswered questions instead of scoring them as wrong", () => {
    const score = scoreSessionItems([answered(true), item(), item()]);

    expect(score.total).toBe(3);
    expect(score.correct).toBe(1);
    expect(score.unanswered).toBe(2);
  });

  it("never counts an unanswered item as correct, whatever is_correct holds", () => {
    // Defensive: `is_correct` is null until answered, but a stray value must not
    // be able to inflate a score.
    const score = scoreSessionItems([item({ isCorrect: true })]);

    expect(score.correct).toBe(0);
    expect(score.unanswered).toBe(1);
  });

  it("handles an empty session without dividing by zero", () => {
    expect(scoreSessionItems([])).toEqual({
      total: 0,
      correct: 0,
      unanswered: 0,
      avgDifficulty: 0,
    });
  });
});

describe("firstUnansweredIndex", () => {
  it("points at the first gap so a resumed test continues where it stopped", () => {
    expect(
      firstUnansweredIndex([answered(true), answered(false), item(), item()]),
    ).toBe(2);
  });

  it("returns 0 for a session nobody has started answering", () => {
    expect(firstUnansweredIndex([item(), item()])).toBe(0);
  });

  it("returns the length when every question is answered", () => {
    // The runner reads this as "nothing left to ask — finalize instead".
    expect(firstUnansweredIndex([answered(true), answered(true)])).toBe(2);
  });

  it("stops at the first gap even when later questions are answered", () => {
    expect(firstUnansweredIndex([answered(true), item(), answered(true)])).toBe(1);
  });
});
