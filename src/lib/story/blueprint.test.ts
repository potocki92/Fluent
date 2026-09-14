import { describe, expect, it } from "vitest";

import {
  buildBlueprint,
  challengeQuestionCount,
  fitBlueprint,
  isChallengeViable,
  NO_PRESSURE,
  type Blueprint,
} from "@/lib/story/blueprint";
import {
  MAX_CHALLENGE_QUESTIONS,
  MIN_CHALLENGE_QUESTIONS,
  MIN_COMPREHENSION_SHARE,
  QUESTION_KINDS,
} from "@/lib/story/constants";

function total(blueprint: Blueprint): number {
  return QUESTION_KINDS.reduce((acc, kind) => acc + blueprint[kind], 0);
}

describe("challengeQuestionCount", () => {
  it("stays inside the bounds", () => {
    expect(challengeQuestionCount(1)).toBe(MIN_CHALLENGE_QUESTIONS);
    expect(challengeQuestionCount(99)).toBe(MAX_CHALLENGE_QUESTIONS);
  });
});

describe("buildBlueprint", () => {
  it("allocates exactly the requested number of questions", () => {
    for (let count = MIN_CHALLENGE_QUESTIONS; count <= MAX_CHALLENGE_QUESTIONS; count += 1) {
      expect(total(buildBlueprint({ questionCount: count, chapterInteractionCount: 3 }))).toBe(
        count,
      );
    }
  });

  it("always keeps comprehension in the mix, whatever the weaknesses", () => {
    const grammarDisaster = buildBlueprint({
      questionCount: 6,
      pressure: { grammar: 1, vocabulary: 1, reading: 0 },
      chapterInteractionCount: 5,
    });
    expect(grammarDisaster.comprehension).toBeGreaterThanOrEqual(
      Math.ceil(6 * MIN_COMPREHENSION_SHARE),
    );
  });

  it("keeps comprehension even in the shortest possible Challenge", () => {
    const tiny = buildBlueprint({
      questionCount: MIN_CHALLENGE_QUESTIONS,
      pressure: { grammar: 1, vocabulary: 1, reading: 0 },
      chapterInteractionCount: 5,
    });
    expect(tiny.comprehension).toBeGreaterThanOrEqual(1);
  });

  it("gives a grammar-weak learner more grammar than a grammar-strong one", () => {
    const weak = buildBlueprint({
      questionCount: 8,
      pressure: { grammar: 1, vocabulary: 0, reading: 0 },
      chapterInteractionCount: 5,
    });
    const strong = buildBlueprint({
      questionCount: 8,
      pressure: NO_PRESSURE,
      chapterInteractionCount: 5,
    });
    expect(weak.grammar).toBeGreaterThan(strong.grammar);
  });

  it("gives a reading-weak learner more story questions", () => {
    const weak = buildBlueprint({
      questionCount: 8,
      pressure: { grammar: 0, vocabulary: 0, reading: 1 },
      chapterInteractionCount: 5,
    });
    const strong = buildBlueprint({
      questionCount: 8,
      pressure: NO_PRESSURE,
      chapterInteractionCount: 5,
    });
    expect(weak.comprehension).toBeGreaterThanOrEqual(strong.comprehension);
  });

  it("asks less contextual vocabulary about a chapter nobody interacted with", () => {
    const untouched = buildBlueprint({
      questionCount: 8,
      chapterInteractionCount: 0,
    });
    const touched = buildBlueprint({ questionCount: 8, chapterInteractionCount: 6 });
    expect(untouched.contextual_vocabulary).toBeLessThan(touched.contextual_vocabulary);
  });
});

describe("fitBlueprint", () => {
  it("reports exactly what the bank can deliver", () => {
    const blueprint = buildBlueprint({ questionCount: 6, chapterInteractionCount: 3 });
    const { fitted, total: fittedTotal } = fitBlueprint(blueprint, {
      comprehension: 10,
      contextual_vocabulary: 10,
      grammar: 10,
      transfer: 10,
    });
    expect(fittedTotal).toBe(6);
    expect(fitted).toEqual(blueprint);
  });

  it("redistributes to comprehension first when a kind is empty", () => {
    const blueprint: Blueprint = {
      comprehension: 2,
      contextual_vocabulary: 2,
      grammar: 1,
      transfer: 1,
    };
    const { fitted, total: fittedTotal } = fitBlueprint(blueprint, {
      comprehension: 6,
      contextual_vocabulary: 0,
      grammar: 0,
      transfer: 0,
    });
    expect(fitted.comprehension).toBe(6);
    expect(fittedTotal).toBe(6);
  });

  it("comes up short rather than inventing questions", () => {
    const blueprint: Blueprint = {
      comprehension: 3,
      contextual_vocabulary: 2,
      grammar: 1,
      transfer: 0,
    };
    const { total: fittedTotal, short } = fitBlueprint(blueprint, {
      comprehension: 1,
      contextual_vocabulary: 1,
      grammar: 0,
      transfer: 0,
    });
    expect(fittedTotal).toBe(2);
    expect(short).toBe(4);
    expect(isChallengeViable(fittedTotal)).toBe(false);
  });
});
