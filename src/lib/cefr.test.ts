import { describe, expect, it } from "vitest";

import {
  abilityToCefr,
  bandProgress,
  CEFR_DIFFICULTY,
  gatePromotion,
  isTextTooHard,
  LEVEL_HEADROOM,
  progressPct,
  PROMOTION_STREAK,
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

describe("gatePromotion", () => {
  // A1 → A1+ band ceiling is 1150.
  it("lets ability move freely within a band", () => {
    expect(gatePromotion(1080, 1120, true, 1, 0)).toEqual({
      ability: 1120,
      streak: 0,
    });
  });

  it("holds ability just below the next band while the streak builds", () => {
    expect(gatePromotion(1140, 1170, true, 1, 0)).toEqual({
      ability: 1149,
      streak: 1,
    });
    expect(gatePromotion(1149, 1170, true, 1, 1)).toEqual({
      ability: 1149,
      streak: 2,
    });
  });

  it("releases the ceiling after PROMOTION_STREAK strong passes", () => {
    const result = gatePromotion(1149, 1175, true, 1, PROMOTION_STREAK - 1);
    expect(result.ability).toBe(1175);
    expect(result.streak).toBe(0);
  });

  it("does not build the streak on a weak pass", () => {
    expect(gatePromotion(1149, 1170, true, 0.6, 2)).toEqual({
      ability: 1149,
      streak: 0,
    });
  });

  it("resets the streak and lets ability fall on a failed test", () => {
    expect(gatePromotion(1149, 1120, false, 0.25, 2)).toEqual({
      ability: 1120,
      streak: 0,
    });
  });

  it("never gates within the top band", () => {
    expect(gatePromotion(1700, 1800, true, 1, 5)).toEqual({
      ability: 1800,
      streak: 0,
    });
  });

  it("requires PROMOTION_STREAK consecutive passes to cross a band", () => {
    let ability = 1145;
    let streak = 0;
    // Each test would push past 1150 but is held until the streak completes.
    for (let i = 0; i < PROMOTION_STREAK - 1; i++) {
      const r = gatePromotion(ability, 1170, true, 1, streak);
      ability = r.ability;
      streak = r.streak;
      expect(abilityToCefr(ability)).toBe("A1");
    }
    const final = gatePromotion(ability, 1170, true, 1, streak);
    expect(abilityToCefr(final.ability)).toBe("A1+");
  });
});
