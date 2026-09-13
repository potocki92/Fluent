import { describe, expect, it } from "vitest";

import {
  FINAL_RD,
  finalizeRating,
  INITIAL_RATING,
  MAX_ITEMS,
  MIN_ITEMS,
  pickNextQuestion,
  replayCalibration,
  shouldStop,
  type CalibrationAnswer,
} from "./calibration-test";
import { RD_MIN, updateAbility } from "./elo";
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

describe("replayCalibration", () => {
  const answers: CalibrationAnswer[] = [
    { itemDifficulty: 1100, isCorrect: true },
    { itemDifficulty: 1300, isCorrect: true },
    { itemDifficulty: 1500, isCorrect: false },
    { itemDifficulty: 1400, isCorrect: true },
  ];

  it("reproduces exactly what the client computed step by step", () => {
    // This is the property that lets the server stop trusting the browser's
    // reported ability: replaying the stored answers must land on the same
    // rating the learner watched being built, so the security fix is invisible
    // to them. Mirrors CalibrationRunner: `answered` is the count BEFORE the
    // answer being folded in.
    let expected = INITIAL_RATING;
    answers.forEach((answer, index) => {
      expected = updateAbility(expected, answer.itemDifficulty, answer.isCorrect, {
        answered: index,
      });
    });

    expect(replayCalibration(answers)).toEqual(finalizeRating(expected));
  });

  it("is deterministic — the same answers always give the same level", () => {
    expect(replayCalibration(answers)).toEqual(replayCalibration([...answers]));
  });

  it("depends on the order answers were given, not just the tally", () => {
    // Early answers move the estimate further (rd is still high), so a replay
    // has to preserve `item_position` rather than aggregate.
    const reversed = [...answers].reverse();
    expect(replayCalibration(reversed)).not.toEqual(replayCalibration(answers));
  });

  it("rewards a harder correct answer more than an easy one", () => {
    const hard = replayCalibration([{ itemDifficulty: 1700, isCorrect: true }]);
    const easy = replayCalibration([{ itemDifficulty: 1000, isCorrect: true }]);
    expect(hard.ability).toBeGreaterThan(easy.ability);
  });

  it("falls back to the neutral starting estimate with no answers", () => {
    expect(replayCalibration([])).toEqual(finalizeRating(INITIAL_RATING));
  });
});
