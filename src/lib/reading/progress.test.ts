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
    position = advanceProgress(position, { paragraphPosition: 4, paragraphCount: 10 });
    expect(position.resumeParagraph).toBe(4);
    expect(position.furthestParagraph).toBe(4);
    expect(position.ratio).toBeCloseTo(0.5, 4);
  });

  it("NEVER lets progress fall when the learner scrolls back", () => {
    // This is the regression the two columns exist for: re-reading the opening
    // of a chapter must move the bookmark and leave the progress bar alone.
    let position = advanceProgress(INITIAL_POSITION, {
      paragraphPosition: 79,
      paragraphCount: 100,
    });
    expect(position.ratio).toBeCloseTo(0.8, 4);

    position = advanceProgress(position, { paragraphPosition: 3, paragraphCount: 100 });
    expect(position.resumeParagraph).toBe(3);
    expect(position.furthestParagraph).toBe(79);
    expect(position.ratio).toBeCloseTo(0.8, 4);
  });

  it("reaches exactly 1 on the last paragraph", () => {
    const position = advanceProgress(INITIAL_POSITION, {
      paragraphPosition: 9,
      paragraphCount: 10,
    });
    expect(position.ratio).toBe(1);
    expect(canCompleteChapter(position)).toBe(true);
  });

  it("clamps a position outside the chapter", () => {
    const position = advanceProgress(INITIAL_POSITION, {
      paragraphPosition: 999,
      paragraphCount: 10,
    });
    expect(position.furthestParagraph).toBe(9);

    const negative = advanceProgress(INITIAL_POSITION, {
      paragraphPosition: -5,
      paragraphCount: 10,
    });
    expect(negative.furthestParagraph).toBe(0);
  });

  it("refuses completion short of the threshold", () => {
    const position = advanceProgress(INITIAL_POSITION, {
      paragraphPosition: 8,
      paragraphCount: 100,
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
    // 3/10 chapters read is not 30% when chapter 1 is 500 words and chapter 2
    // is 20 000.
    const ratio = itemProgressRatio([
      { wordCount: 500, ratio: 1 },
      { wordCount: 20_000, ratio: 0 },
    ]);
    expect(ratio).toBeCloseTo(0.0244, 3);
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
