import { describe, expect, it } from "vitest";

import {
  calibrationMultiplier,
  confidenceLevel,
  expectedScore,
  kFactor,
  RD_MAX,
  RD_MIN,
  scoreTest,
  updateAbility,
} from "./elo";

describe("expectedScore", () => {
  it("is 0.5 when ability equals difficulty", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
  });

  it("is higher when the learner outranks the item", () => {
    expect(expectedScore(1400, 1200)).toBeGreaterThan(0.5);
  });

  it("is lower when the item outranks the learner", () => {
    expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
  });
});

describe("kFactor", () => {
  it("grows with rating deviation", () => {
    expect(kFactor(350)).toBeGreaterThan(kFactor(50));
  });

  it("clamps rd within bounds", () => {
    expect(kFactor(9999)).toBe(kFactor(350));
    expect(kFactor(0)).toBe(kFactor(50));
  });
});

describe("calibrationMultiplier", () => {
  it("boosts only the first few calibration answers", () => {
    expect(calibrationMultiplier(0)).toBe(2);
    expect(calibrationMultiplier(4)).toBeGreaterThan(1);
    expect(calibrationMultiplier(5)).toBe(1);
  });
});

describe("updateAbility", () => {
  it("raises ability on a correct answer", () => {
    const next = updateAbility({ ability: 1200, rd: 350 }, 1200, true);
    expect(next.ability).toBeGreaterThan(1200);
  });

  it("lowers ability on a wrong answer", () => {
    const next = updateAbility({ ability: 1200, rd: 350 }, 1200, false);
    expect(next.ability).toBeLessThan(1200);
  });

  it("moves beginners down quickly during calibration", () => {
    const next = updateAbility({ ability: 1200, rd: 350 }, 1100, false, {
      answered: 0,
    });
    expect(next.ability).toBeLessThan(1150);
  });

  it("shrinks rd over time", () => {
    const next = updateAbility({ ability: 1200, rd: 350 }, 1200, true);
    expect(next.rd).toBeLessThan(350);
    expect(next.rd).toBeGreaterThanOrEqual(50);
  });

  it("does not mutate the input", () => {
    const input = { ability: 1200, rd: 350 };
    updateAbility(input, 1200, true);
    expect(input).toEqual({ ability: 1200, rd: 350 });
  });
});

describe("scoreTest", () => {
  const rating = { ability: 1200, rd: 150 };

  it("deducts Elo at 2/5 regardless of difficulty", () => {
    const easy = scoreTest(rating, 1000, 2, 5);
    const hard = scoreTest(rating, 1700, 2, 5);
    expect(easy.passed).toBe(false);
    expect(hard.passed).toBe(false);
    expect(easy.delta).toBeLessThan(0);
    expect(hard.delta).toBeLessThan(0);
    expect(easy.ability).toBeLessThan(1200);
  });

  it("adds Elo at 3/5 regardless of difficulty", () => {
    const easy = scoreTest(rating, 1000, 3, 5);
    const hard = scoreTest(rating, 1700, 3, 5);
    expect(easy.passed).toBe(true);
    expect(hard.passed).toBe(true);
    expect(easy.delta).toBeGreaterThan(0);
    expect(hard.delta).toBeGreaterThan(0);
    expect(hard.ability).toBeGreaterThan(1200);
  });

  it("rewards passing a harder text more than an easy one", () => {
    const easy = scoreTest(rating, 1000, 3, 5);
    const hard = scoreTest(rating, 1700, 3, 5);
    expect(hard.delta).toBeGreaterThan(easy.delta);
  });

  it("punishes failing an easy text more than a hard one", () => {
    const easy = scoreTest(rating, 1000, 1, 5);
    const hard = scoreTest(rating, 1700, 1, 5);
    expect(Math.abs(easy.delta)).toBeGreaterThan(Math.abs(hard.delta));
  });

  it("moves a perfect score more than a marginal pass", () => {
    const perfect = scoreTest(rating, 1200, 5, 5);
    const marginal = scoreTest(rating, 1200, 3, 5);
    expect(perfect.delta).toBeGreaterThan(marginal.delta);
  });

  it("shrinks rd and keeps it within bounds", () => {
    const next = scoreTest(rating, 1200, 4, 5);
    expect(next.rd).toBeLessThan(rating.rd);
    expect(next.rd).toBeGreaterThanOrEqual(RD_MIN);
    expect(next.rd).toBeLessThanOrEqual(RD_MAX);
  });

  it("does not mutate the input", () => {
    const input = { ability: 1200, rd: 150 };
    scoreTest(input, 1200, 4, 5);
    expect(input).toEqual({ ability: 1200, rd: 150 });
  });
});

describe("confidenceLevel", () => {
  it("is calibrating below 5 answers", () => {
    expect(confidenceLevel(0)).toBe("calibrating");
    expect(confidenceLevel(4)).toBe("calibrating");
  });

  it("steps up through the bands at the boundaries", () => {
    expect(confidenceLevel(5)).toBe("low");
    expect(confidenceLevel(14)).toBe("low");
    expect(confidenceLevel(15)).toBe("medium");
    expect(confidenceLevel(39)).toBe("medium");
    expect(confidenceLevel(40)).toBe("high");
    expect(confidenceLevel(1000)).toBe("high");
  });
});
