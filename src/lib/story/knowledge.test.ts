import { describe, expect, it } from "vitest";

import { UNSEEN_WORD_UNKNOWN_PROBABILITY } from "@/lib/story/constants";
import {
  isAlreadyKnown,
  unknownProbability,
  wordVerdict,
} from "@/lib/story/knowledge";

describe("wordVerdict", () => {
  it("distinguishes 'never measured' from 'measured and unknown'", () => {
    expect(wordVerdict(undefined)).toBe("no_evidence");
    expect(wordVerdict({ wordId: 1, score: null, confidence: 0 })).toBe("no_evidence");
    expect(wordVerdict({ wordId: 1, score: 0.2, confidence: 0.7 })).toBe(
      "likely_unknown",
    );
  });

  it("will not call a word known on one lucky answer", () => {
    expect(wordVerdict({ wordId: 1, score: 0.95, confidence: 0.1 })).toBe("uncertain");
  });

  it("downgrades a good score with thin evidence to likely known", () => {
    expect(wordVerdict({ wordId: 1, score: 0.9, confidence: 0.25 })).toBe(
      "likely_known",
    );
  });

  it("calls a well-evidenced high score known", () => {
    expect(wordVerdict({ wordId: 1, score: 0.85, confidence: 0.6 })).toBe("known");
  });

  it("refuses to commit in the middle band", () => {
    expect(wordVerdict({ wordId: 1, score: 0.5, confidence: 0.6 })).toBe("uncertain");
  });
});

describe("isAlreadyKnown", () => {
  it("covers only the two settled verdicts", () => {
    expect(isAlreadyKnown("known")).toBe(true);
    expect(isAlreadyKnown("likely_known")).toBe(true);
    expect(isAlreadyKnown("uncertain")).toBe(false);
    expect(isAlreadyKnown("no_evidence")).toBe(false);
  });
});

describe("unknownProbability", () => {
  it("never treats an unobserved word as certainly unknown", () => {
    expect(unknownProbability(null)).toBe(UNSEEN_WORD_UNKNOWN_PROBABILITY);
    expect(unknownProbability(null)).toBeLessThan(1);
  });

  it("ranks a measured failure above an unobserved word", () => {
    expect(unknownProbability({ wordId: 1, score: 0.1, confidence: 0.8 })).toBeGreaterThan(
      UNSEEN_WORD_UNKNOWN_PROBABILITY,
    );
  });

  it("ranks a measured success below an unobserved word", () => {
    expect(unknownProbability({ wordId: 1, score: 0.9, confidence: 0.8 })).toBeLessThan(
      UNSEEN_WORD_UNKNOWN_PROBABILITY,
    );
  });

  it("pulls thin evidence back towards the prior rather than trusting it", () => {
    const thin = unknownProbability({ wordId: 1, score: 0.05, confidence: 0.05 });
    const solid = unknownProbability({ wordId: 1, score: 0.05, confidence: 0.8 });
    expect(thin).toBeLessThan(solid);
    expect(Math.abs(thin - UNSEEN_WORD_UNKNOWN_PROBABILITY)).toBeLessThan(0.2);
  });
});
