import { describe, expect, it } from "vitest";

import {
  CHAPTER_LEVEL_FAR,
  CHAPTER_LEVEL_MATCH,
  CHAPTER_LEVEL_NEAR,
  DEFAULT_READING_MINUTES,
  EVIDENCE_LEVEL_THRESHOLDS,
  MAX_CHAPTER_SEGMENT_MINUTES,
  MIN_CHAPTER_SEGMENT_MINUTES,
  MAX_READING_MINUTES,
  MAX_REVIEW_BATCH,
  MIN_READING_MINUTES,
  MIN_REVIEW_BATCH,
} from "@/lib/learning/planner/constants";
import {
  chapterLevelSignal,
  chapterSegmentMinutes,
  chapterTargetSeconds,
  evidenceLevelFor,
  readingMinutes,
  reviewBatchSize,
  reviewMinutes,
  vocabularyLevelsFor,
} from "@/lib/learning/planner/candidates";
import { placementCandidates } from "@/lib/learning/planner/candidates";
import type { PlannerContext } from "@/lib/learning/planner/candidates";

/** The generators that need no database are testable directly. */
function ctx(overrides: Partial<PlannerContext> = {}): PlannerContext {
  return {
    // Only the pure generators are exercised here, so the client is never used.
    supabase: null as unknown as PlannerContext["supabase"],
    userId: "00000000-0000-0000-0000-000000000001",
    now: new Date("2026-09-14T09:00:00Z"),
    targetMinutes: 12,
    ability: 1300,
    levelSource: "test",
    ...overrides,
  };
}

describe("reviewBatchSize", () => {
  it("never shows a 300-card backlog as a 300-card task", () => {
    expect(reviewBatchSize(300, 15)).toBeLessThanOrEqual(MAX_REVIEW_BATCH);
  });

  it("scales with the time the learner asked for", () => {
    expect(reviewBatchSize(100, 5)).toBeLessThan(reviewBatchSize(100, 30));
  });

  it("never proposes more cards than are actually due", () => {
    expect(reviewBatchSize(3, 30)).toBe(3);
  });

  it("keeps a batch worth opening at the smallest budget", () => {
    expect(reviewBatchSize(50, 5)).toBeGreaterThanOrEqual(MIN_REVIEW_BATCH);
  });

  it("is zero when nothing is due", () => {
    expect(reviewBatchSize(0, 15)).toBe(0);
  });
});

describe("time estimates", () => {
  it("turns a card count into whole minutes", () => {
    expect(reviewMinutes(8)).toBeGreaterThan(0);
    expect(reviewMinutes(12)).toBeGreaterThan(reviewMinutes(4));
  });

  it("bounds a passage's estimate whatever its length", () => {
    expect(readingMinutes(20)).toBe(MIN_READING_MINUTES);
    expect(readingMinutes(100_000)).toBe(MAX_READING_MINUTES);
  });

  it("falls back rather than guessing at an unknown length", () => {
    expect(readingMinutes(null)).toBe(DEFAULT_READING_MINUTES);
    expect(readingMinutes(0)).toBe(DEFAULT_READING_MINUTES);
  });
});

describe("evidenceLevelFor", () => {
  it("calls a plan built from nothing what it is", () => {
    expect(evidenceLevelFor(0)).toBe("none");
  });

  it("grows with the evidence behind it", () => {
    expect(evidenceLevelFor(EVIDENCE_LEVEL_THRESHOLDS.low)).toBe("low");
    expect(evidenceLevelFor(EVIDENCE_LEVEL_THRESHOLDS.medium)).toBe("medium");
    expect(evidenceLevelFor(EVIDENCE_LEVEL_THRESHOLDS.high)).toBe("high");
  });
});

describe("vocabularyLevelsFor", () => {
  it("teaches at the learner's level and the one below it", () => {
    expect(vocabularyLevelsFor(1500)).toEqual(["A2", "B1"]);
    expect(vocabularyLevelsFor(1700)).toEqual(["B1", "B2"]);
  });

  it("does not send a beginner below A1", () => {
    expect(vocabularyLevelsFor(900)).toEqual(["A1"]);
  });
});

describe("placementCandidates", () => {
  it("is the only thing an unplaced learner is offered", () => {
    const candidates = placementCandidates(ctx({ levelSource: "default" }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe("placement");
    expect(candidates[0].reason.code).toBe("no_level_yet");
    expect(candidates[0].signals.onboarding).toBe(1);
  });

  it("disappears the moment the learner has a level, however they got it", () => {
    expect(placementCandidates(ctx({ levelSource: "placement" }))).toHaveLength(0);
    expect(placementCandidates(ctx({ levelSource: "manual" }))).toHaveLength(0);
    expect(placementCandidates(ctx({ levelSource: "test" }))).toHaveLength(0);
  });
});

describe("reading a chapter", () => {
  it("asks for a SEGMENT, never for a whole 15 000-word chapter", () => {
    // "Przeczytaj rozdział 12" in a twelve-minute plan is a task the learner
    // cannot finish, which teaches them the plan does not mean anything.
    expect(chapterSegmentMinutes(90, 12)).toBeLessThanOrEqual(
      MAX_CHAPTER_SEGMENT_MINUTES,
    );
    expect(chapterSegmentMinutes(90, 12)).toBeGreaterThanOrEqual(
      MIN_CHAPTER_SEGMENT_MINUTES,
    );
  });

  it("never asks for more time than the chapter itself holds", () => {
    // A five-minute chapter is a five-minute task, not a four-minute floor and
    // not an eight-minute one the learner could never satisfy.
    expect(chapterSegmentMinutes(5, 60)).toBe(5);
    expect(chapterSegmentMinutes(2, 12)).toBe(2);
  });

  it("scales the slice with the learner's daily budget", () => {
    expect(chapterSegmentMinutes(60, 30)).toBeGreaterThan(
      chapterSegmentMinutes(60, 10),
    );
  });

  it("turns a slice into the seconds that satisfy it", () => {
    const minutes = chapterSegmentMinutes(60, 20);
    const seconds = chapterTargetSeconds(minutes);
    // Less than the full estimate — finishing the plan's reading task is about
    // doing the reading, not about outlasting the estimate.
    expect(seconds).toBeLessThan(minutes * 60);
    expect(seconds).toBeGreaterThan(0);
  });

  it("matches a chapter's band against the learner's, coarsely and honestly", () => {
    expect(chapterLevelSignal("A2", 1350)).toBe(CHAPTER_LEVEL_MATCH);
    expect(chapterLevelSignal("B1", 1350)).toBe(CHAPTER_LEVEL_NEAR);
    expect(chapterLevelSignal("B2", 1100)).toBe(CHAPTER_LEVEL_FAR);
    // No estimate is not the same as a bad one.
    expect(chapterLevelSignal(null, 1350)).toBe(CHAPTER_LEVEL_NEAR);
  });
});
