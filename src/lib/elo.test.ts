import { describe, expect, it } from "vitest";

import { confidenceLevel, expectedScore, kFactor, updateAbility } from "./elo";

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

describe("updateAbility", () => {
  it("raises ability on a correct answer", () => {
    const next = updateAbility({ ability: 1200, rd: 350 }, 1200, true);
    expect(next.ability).toBeGreaterThan(1200);
  });

  it("lowers ability on a wrong answer", () => {
    const next = updateAbility({ ability: 1200, rd: 350 }, 1200, false);
    expect(next.ability).toBeLessThan(1200);
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
