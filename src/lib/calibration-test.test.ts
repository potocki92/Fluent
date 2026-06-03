import { describe, expect, it } from "vitest";

import {
  FINAL_RD,
  finalizeRating,
  MAX_ITEMS,
  MIN_ITEMS,
  pickNextQuestion,
  shouldStop,
} from "./calibration-test";
import { RD_MIN } from "./elo";
import type { CalibrationQuestion } from "@/types";

function item(id: number, difficulty: number): CalibrationQuestion {
  return {
    id,
    prompt: `q${id}`,
    options: ["a", "b", "c", "d"],
    difficulty,
    cefr: "A2",
    skill: "vocab",
    created_at: "",
  };
}

const pool = [item(1, 1100), item(2, 1300), item(3, 1500), item(4, 1700)];

describe("pickNextQuestion", () => {
  it("picks the item closest to the current ability", () => {
    expect(pickNextQuestion(pool, 1480, new Set())?.id).toBe(3);
    expect(pickNextQuestion(pool, 1050, new Set())?.id).toBe(1);
  });

  it("skips already-asked items", () => {
    expect(pickNextQuestion(pool, 1550, new Set([3]))?.id).toBe(4);
  });

  it("returns null when the pool is exhausted", () => {
    expect(pickNextQuestion(pool, 1500, new Set([1, 2, 3, 4]))).toBeNull();
  });
});

describe("shouldStop", () => {
  it("never stops before the minimum", () => {
    expect(shouldStop(MIN_ITEMS - 1, [1, 1])).toBe(false);
  });

  it("stops at the hard cap regardless of stability", () => {
    expect(shouldStop(MAX_ITEMS, [99, 99])).toBe(true);
  });

  it("stops once the estimate settles after the minimum", () => {
    expect(shouldStop(MIN_ITEMS, [5, -8])).toBe(true);
  });

  it("keeps going while swings are large", () => {
    expect(shouldStop(MIN_ITEMS, [40, -30])).toBe(false);
  });
});

describe("finalizeRating", () => {
  it("grants placement-test confidence by lowering rd", () => {
    expect(finalizeRating({ ability: 1432.7, rd: 300 })).toEqual({
      ability: 1433,
      rd: FINAL_RD,
    });
  });

  it("keeps an already-lower rd and respects the floor", () => {
    expect(finalizeRating({ ability: 1500, rd: 40 }).rd).toBe(RD_MIN);
  });
});
