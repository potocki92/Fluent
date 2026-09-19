import { describe, expect, it } from "vitest";

import { CHAPTER_COMPLETION_RATIO, MAX_ACTIVE_SECONDS_PER_REPORT } from "@/lib/reading/constants";
import {
  accumulateActiveSeconds,
  advanceProgress,
  canCompleteChapter,
  estimatedChapterMinutes,
  INITIAL_POSITION,
  itemProgressRatio,
  wordsRead,
} from "@/lib/reading/progress";

describe("advanceProgress", () => {
  it("moves resume and furthest together while reading forward", () => {
    let position = INITIAL_POSITION;
    position = advanceProgress(position, {
      resumeWordOffset: 500,
      furthestWordOffset: 500,
      totalWords: 1000,
    });
    expect(position.resumeWordOffset).toBe(500);
    expect(position.furthestWordOffset).toBe(500);
    expect(position.ratio).toBeCloseTo(0.5, 4);
  });

  it("NEVER lets progress fall when the learner scrolls back", () => {
    // This is the regression the two columns exist for: re-reading the opening
    // of a chapter must move the bookmark and leave the progress bar alone.
    let position = advanceProgress(INITIAL_POSITION, {
      resumeWordOffset: 800,
      furthestWordOffset: 800,
      totalWords: 1000,
    });
    expect(position.ratio).toBeCloseTo(0.8, 4);

    position = advanceProgress(position, {
      resumeWordOffset: 30,
      furthestWordOffset: 30,
      totalWords: 1000,
    });
    expect(position.resumeWordOffset).toBe(30);
    expect(position.furthestWordOffset).toBe(800);
    expect(position.ratio).toBeCloseTo(0.8, 4);
  });

  it("separates where the learner IS from what they have read", () => {
    // A fling: the reader reports the end as the resume anchor (that genuinely
    // is where they are) and the opening as the furthest confirmed one.
    const position = advanceProgress(INITIAL_POSITION, {
      resumeWordOffset: 900,
      furthestWordOffset: 200,
      totalWords: 1000,
    });
    expect(position.resumeWordOffset).toBe(900);
    expect(position.ratio).toBeCloseTo(0.2, 4);
  });

  it("reaches exactly 1 at the last word", () => {
    const position = advanceProgress(INITIAL_POSITION, {
      resumeWordOffset: 1000,
      furthestWordOffset: 1000,
      totalWords: 1000,
    });
    expect(position.ratio).toBe(1);
    expect(canCompleteChapter(position)).toBe(true);
  });

  it("clamps an offset outside the chapter", () => {
    const beyond = advanceProgress(INITIAL_POSITION, {
      resumeWordOffset: 99_999,
      furthestWordOffset: 99_999,
      totalWords: 1000,
    });
    expect(beyond.furthestWordOffset).toBe(1000);

    const negative = advanceProgress(INITIAL_POSITION, {
      resumeWordOffset: -5,
      furthestWordOffset: -5,
      totalWords: 1000,
    });
    expect(negative.furthestWordOffset).toBe(0);
  });

  it("keeps the last known ratio for a chapter with no word scale", () => {
    // A chapter stored before the word scale existed and never reprocessed. The
    // report must not divide by zero and must not wipe the stored progress.
    const position = advanceProgress(
      { ...INITIAL_POSITION, ratio: 0.4 },
      { resumeWordOffset: 0, furthestWordOffset: 0, totalWords: 0 },
    );
    expect(position.ratio).toBeCloseTo(0.4, 4);
  });

  it("refuses completion short of the threshold", () => {
    const position = advanceProgress(INITIAL_POSITION, {
      resumeWordOffset: 90,
      furthestWordOffset: 90,
      totalWords: 1000,
    });
    expect(position.ratio).toBeLessThan(CHAPTER_COMPLETION_RATIO);
    expect(canCompleteChapter(position)).toBe(false);
  });
});

describe("accumulateActiveSeconds", () => {
  it("adds real increments", () => {
    expect(accumulateActiveSeconds(30, 12)).toBe(42);
  });

  it("caps one report, so a slept machine cannot buy reading time", () => {
    expect(accumulateActiveSeconds(0, 86_400)).toBe(MAX_ACTIVE_SECONDS_PER_REPORT);
  });

  it("ignores nonsense rather than corrupting the total", () => {
    expect(accumulateActiveSeconds(10, -5)).toBe(10);
    expect(accumulateActiveSeconds(10, Number.NaN)).toBe(10);
  });
});

describe("itemProgressRatio", () => {
  it("weights chapters by length, not by count", () => {
    // TEST I. 3/10 chapters read is not 30% when chapter 1 is 500 words and
    // chapter 2 is 20 000.
    const ratio = itemProgressRatio([
      { wordCount: 500, ratio: 1 },
      { wordCount: 20_000, ratio: 0 },
    ]);
    expect(ratio).toBeCloseTo(0.0244, 3);
  });

  it("counts a part-read chapter in proportion to BOTH its length and its ratio", () => {
    // Half of a 20 000-word chapter is worth forty times all of a 500-word one.
    const ratio = itemProgressRatio([
      { wordCount: 500, ratio: 1 },
      { wordCount: 20_000, ratio: 0.5 },
    ]);
    expect(ratio).toBeCloseTo((500 + 10_000) / 20_500, 4);
  });

  it("falls back to equal weight when word counts are missing", () => {
    expect(itemProgressRatio([{ wordCount: null, ratio: 1 }, { wordCount: null, ratio: 0 }]))
      .toBeCloseTo(0.5, 4);
  });

  it("is 0 for an empty item", () => {
    expect(itemProgressRatio([])).toBe(0);
  });
});

describe("estimates", () => {
  it("never advertises a chapter as taking no time", () => {
    expect(estimatedChapterMinutes(0)).toBe(1);
    expect(estimatedChapterMinutes(null)).toBe(1);
  });

  it("scales with length", () => {
    expect(estimatedChapterMinutes(2700)).toBe(30);
  });

  it("derives words read from the furthest position", () => {
    expect(wordsRead(0.5, 2000)).toBe(1000);
    expect(wordsRead(2, 2000)).toBe(2000);
    expect(wordsRead(0.5, null)).toBe(0);
  });
});
