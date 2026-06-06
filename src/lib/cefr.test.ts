import { describe, expect, it } from "vitest";

import {
  abilityToCefr,
  bandProgress,
  CEFR_DIFFICULTY,
  isTextTooHard,
  LEVEL_HEADROOM,
  progressPct,
} from "./cefr";

describe("abilityToCefr", () => {
  it("maps abilities to the matching band", () => {
    expect(abilityToCefr(1000)).toBe("A1");
    expect(abilityToCefr(1200)).toBe("A1+");
    expect(abilityToCefr(1300)).toBe("A2");
    expect(abilityToCefr(1450)).toBe("B1");
    expect(abilityToCefr(1600)).toBe("B2");
  });
});

describe("progressPct", () => {
  it("returns a whole percentage in [0, 100]", () => {
    for (const ability of [800, 1150, 1275, 1500, 1700, 2000]) {
      const pct = progressPct(ability);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
      expect(Number.isInteger(pct)).toBe(true);
    }
  });

  it("tops out at 100 in the highest band", () => {
    expect(progressPct(2000)).toBe(100);
  });

  it("tracks bandProgress scaled to a percentage", () => {
    expect(progressPct(1375)).toBe(Math.round(bandProgress(1375) * 100));
  });
});

describe("isTextTooHard", () => {
  it("shows texts at or below the learner's level", () => {
    expect(isTextTooHard(1000, 1000)).toBe(false);
    expect(isTextTooHard(800, 1000)).toBe(false);
  });

  it("shows texts within the headroom above the level", () => {
    expect(isTextTooHard(1000 + LEVEL_HEADROOM, 1000)).toBe(false);
  });

  it("hides texts more than a headroom above the level", () => {
    expect(isTextTooHard(1000 + LEVEL_HEADROOM + 1, 1000)).toBe(true);
  });

  it("keeps an A1 text visible for an ability that dropped to 1000", () => {
    // The scenario from the feature request: ability fell to 1000; the A1 text
    // (1100) is still within reach, while B2 (1700) is hidden.
    expect(isTextTooHard(CEFR_DIFFICULTY.A1, 1000)).toBe(false);
    expect(isTextTooHard(CEFR_DIFFICULTY.B2, 1000)).toBe(true);
  });
});
