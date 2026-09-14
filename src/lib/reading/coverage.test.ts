import { describe, expect, it } from "vitest";

import { MIN_COVERAGE_OBSERVATIONS } from "@/lib/reading/constants";
import {
  estimateCoverage,
  preReadingCandidates,
  type ChapterWord,
  type WordKnowledge,
} from "@/lib/reading/coverage";

function chapterWords(count: number, occurrences = 1): ChapterWord[] {
  return Array.from({ length: count }, (_, i) => ({
    wordId: i + 1,
    occurrenceCount: occurrences,
  }));
}

function known(wordId: number): WordKnowledge {
  return { wordId, receptiveScore: 0.9, receptiveConfidence: 0.7 };
}

function unknown(wordId: number): WordKnowledge {
  return { wordId, receptiveScore: 0.2, receptiveConfidence: 0.7 };
}

describe("estimateCoverage", () => {
  it("REFUSES to quote a figure it cannot support", () => {
    // The failure this guards against: knowing 20 of a chapter's 800 words and
    // reporting "you know 91%" because 18 of those 20 were known.
    const result = estimateCoverage(chapterWords(800), [
      ...Array.from({ length: 18 }, (_, i) => known(i + 1)),
      unknown(19),
      unknown(20),
    ]);
    expect(result.status).toBe("insufficient_data");
    if (result.status === "insufficient_data") {
      expect(result.observedWords).toBe(20);
      expect(result.totalWords).toBe(800);
      expect(result.neededWords).toBeGreaterThan(0);
    }
  });

  it("quotes a figure once there is enough evidence", () => {
    const words = chapterWords(60);
    const knowledge = [
      ...Array.from({ length: 30 }, (_, i) => known(i + 1)),
      ...Array.from({ length: 10 }, (_, i) => unknown(i + 31)),
    ];
    const result = estimateCoverage(words, knowledge);
    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      expect(result.ratio).toBeCloseTo(0.75, 4);
      expect(result.observedWords).toBe(40);
      expect(result.knownWords).toBe(30);
    }
  });

  it("weights by how often a word appears in the chapter", () => {
    // Knowing the word that appears forty times matters more to the experience
    // of this chapter than knowing one that appears once.
    const words: ChapterWord[] = [
      { wordId: 1, occurrenceCount: 40 },
      ...chapterWords(40).slice(1).map((word) => ({ ...word, occurrenceCount: 1 })),
    ];
    const knowledge = [
      known(1),
      ...Array.from({ length: 39 }, (_, i) => unknown(i + 2)),
    ];
    const result = estimateCoverage(words, knowledge);
    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      // 40 of 79 occurrence-weights are known, against 1 of 40 distinct words.
      expect(result.ratio).toBeGreaterThan(0.4);
      expect(result.knownWords).toBe(1);
    }
  });

  it("treats a word with no evidence as unmeasured, not as unknown", () => {
    const words = chapterWords(MIN_COVERAGE_OBSERVATIONS * 2);
    const knowledge = [
      ...Array.from({ length: MIN_COVERAGE_OBSERVATIONS }, (_, i) => known(i + 1)),
      { wordId: 99, receptiveScore: null, receptiveConfidence: 0 },
    ];
    const result = estimateCoverage(words, knowledge);
    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      expect(result.ratio).toBe(1);
      expect(result.observedWords).toBe(MIN_COVERAGE_OBSERVATIONS);
    }
  });

  it("has nothing to say about an empty chapter", () => {
    expect(estimateCoverage([], []).status).toBe("insufficient_data");
  });

  it("ignores a high score that has no confidence behind it", () => {
    const words = chapterWords(40);
    const knowledge = Array.from({ length: 40 }, (_, i) => ({
      wordId: i + 1,
      receptiveScore: 0.95,
      receptiveConfidence: 0.05,
    }));
    const result = estimateCoverage(words, knowledge);
    expect(result.status).toBe("estimated");
    if (result.status === "estimated") expect(result.ratio).toBe(0);
  });
});

describe("preReadingCandidates", () => {
  it("picks the most frequent words the learner does not already know", () => {
    const words: ChapterWord[] = [
      { wordId: 1, occurrenceCount: 12 },
      { wordId: 2, occurrenceCount: 9 },
      { wordId: 3, occurrenceCount: 7 },
      { wordId: 4, occurrenceCount: 1 },
    ];
    expect(preReadingCandidates(words, [known(1)], 2)).toEqual([2, 3]);
  });

  it("counts a word with no evidence as worth learning", () => {
    const words: ChapterWord[] = [{ wordId: 7, occurrenceCount: 3 }];
    expect(preReadingCandidates(words, [], 5)).toEqual([7]);
  });
});
