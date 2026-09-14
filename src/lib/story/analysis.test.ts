import { describe, expect, it } from "vitest";

import type { CoverageEstimate } from "@/lib/reading/coverage";
import {
  analyseChapter,
  coverageConfidence,
  coveragePercent,
  difficultyLabel,
  levelGapSignal,
  lookupInterval,
  lookupRate,
  personalDifficulty,
  readingHistorySignal,
} from "@/lib/story/analysis";

function estimated(ratio: number, observed: number, total: number): CoverageEstimate {
  return {
    status: "estimated",
    ratio,
    knownWords: Math.round(observed * ratio),
    observedWords: observed,
    totalWords: total,
  };
}

const NO_COVERAGE: CoverageEstimate = {
  status: "insufficient_data",
  observedWords: 4,
  totalWords: 300,
  neededWords: 56,
};

describe("coverageConfidence", () => {
  it("refuses to grade an estimate that does not exist", () => {
    expect(coverageConfidence(NO_COVERAGE)).toBe("none");
  });

  it("is high only when both the share and the count are substantial", () => {
    expect(coverageConfidence(estimated(0.87, 300, 400))).toBe("high");
    // A high share of a tiny sample is not a high-confidence estimate.
    expect(coverageConfidence(estimated(0.87, 40, 50))).toBe("low");
    // …and a decent count of a huge vocabulary is not either.
    expect(coverageConfidence(estimated(0.87, 130, 900))).toBe("low");
  });

  it("grades the middle as medium", () => {
    expect(coverageConfidence(estimated(0.8, 70, 180))).toBe("medium");
  });
});

describe("coveragePercent", () => {
  it("never quotes more precision than the estimate supports", () => {
    expect(coveragePercent(estimated(0.91374, 200, 300))).toBe(91);
  });

  it("is null when there is no honest figure", () => {
    expect(coveragePercent(NO_COVERAGE)).toBeNull();
  });
});

describe("levelGapSignal", () => {
  it("scores zero for a chapter at or below the learner's level", () => {
    expect(levelGapSignal("A2", 1500)).toBe(0);
  });

  it("grows with the gap and saturates", () => {
    const near = levelGapSignal("B1", 1400) ?? 0;
    const far = levelGapSignal("B2", 1100) ?? 0;
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(1);
  });

  it("is absent rather than guessed when either side is unknown", () => {
    expect(levelGapSignal(null, 1400)).toBeNull();
    expect(levelGapSignal("B1", null)).toBeNull();
  });
});

describe("readingHistorySignal", () => {
  it("says nothing from one chapter", () => {
    expect(readingHistorySignal({ chaptersCompleted: 1, lookupRate: 0.1 })).toBeNull();
  });

  it("reads a comfortable lookup rate as easy reading", () => {
    expect(readingHistorySignal({ chaptersCompleted: 4, lookupRate: 0.01 })).toBe(0);
  });

  it("saturates for a learner checking one word in eight", () => {
    expect(readingHistorySignal({ chaptersCompleted: 4, lookupRate: 0.2 })).toBe(1);
  });
});

describe("personalDifficulty", () => {
  const history = { chaptersCompleted: 0, lookupRate: null };

  it("reports no confidence, and a neutral label, with no signals at all", () => {
    const result = personalDifficulty({
      coverage: NO_COVERAGE,
      chapterCefr: null,
      ability: null,
      weaknessPressure: null,
      history,
    });
    expect(result.confidence).toBe("none");
    expect(result.label).toBe("just_right");
    expect(result.signals).toEqual({});
  });

  it("calls a chapter easy for a learner who knows nearly all of its words", () => {
    const result = personalDifficulty({
      coverage: estimated(0.95, 300, 400),
      chapterCefr: "A2",
      ability: 1500,
      weaknessPressure: null,
      history,
    });
    expect(result.label).toBe("easy");
    expect(result.confidence).toBe("high");
  });

  it("calls the same chapter very demanding for a learner who does not", () => {
    const result = personalDifficulty({
      coverage: estimated(0.3, 300, 400),
      chapterCefr: "B2",
      ability: 1150,
      weaknessPressure: 0.8,
      history: { chaptersCompleted: 3, lookupRate: 0.15 },
    });
    expect(result.label).toBe("very_challenging");
    expect(result.signals.readingHistory).toBe(1);
  });

  it("does not penalise a learner for signals we simply do not have", () => {
    const withHistory = personalDifficulty({
      coverage: estimated(0.6, 200, 400),
      chapterCefr: "B1",
      ability: 1400,
      weaknessPressure: null,
      history: { chaptersCompleted: 5, lookupRate: 0.03 },
    });
    const withoutHistory = personalDifficulty({
      coverage: estimated(0.6, 200, 400),
      chapterCefr: "B1",
      ability: 1400,
      weaknessPressure: null,
      history,
    });
    // The missing signal is absent, not zero: dropping it must not drag the
    // score towards either end.
    expect(withoutHistory.signals.readingHistory).toBeUndefined();
    expect(withHistory.signals.readingHistory).toBe(0);
    expect(withoutHistory.score).toBeGreaterThan(withHistory.score);
  });
});

describe("difficultyLabel", () => {
  it("covers the whole range in order", () => {
    expect(difficultyLabel(0.1)).toBe("easy");
    expect(difficultyLabel(0.35)).toBe("just_right");
    expect(difficultyLabel(0.55)).toBe("challenging");
    expect(difficultyLabel(0.9)).toBe("very_challenging");
  });
});

describe("analyseChapter", () => {
  it("never quotes a percentage it refused to estimate", () => {
    const analysis = analyseChapter({
      coverage: NO_COVERAGE,
      chapterCefr: "B1",
      ability: 1300,
      weaknessPressure: null,
      history: { chaptersCompleted: 0, lookupRate: null },
    });
    expect(analysis.coveragePercent).toBeNull();
    expect(analysis.coverageConfidence).toBe("none");
  });
});

describe("lookupRate", () => {
  it("is null before anything was read", () => {
    expect(lookupRate({ lookupCount: 3, wordsRead: 0 })).toBeNull();
  });

  it("reads back as one word in N", () => {
    expect(lookupInterval(lookupRate({ lookupCount: 10, wordsRead: 310 }))).toBe(31);
  });
});
