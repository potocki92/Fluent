import { describe, expect, it } from "vitest";

import { review, DEFAULT_EASE_FACTOR, MIN_EASE_FACTOR } from "./sm2";

const fresh = { interval: 0, repetitions: 0, easeFactor: DEFAULT_EASE_FACTOR };
const NOW = new Date("2026-01-01T00:00:00.000Z");

function daysBetween(a: string, b: Date): number {
  return Math.round((new Date(a).getTime() - b.getTime()) / 86_400_000);
}

describe("review", () => {
  it("schedules the first correct review one day out", () => {
    const r = review(fresh, 4, NOW);
    expect(r.repetitions).toBe(1);
    expect(r.interval).toBe(1);
    expect(daysBetween(r.dueAt, NOW)).toBe(1);
  });

  it("uses a 6-day interval on the second correct review", () => {
    const r1 = review(fresh, 4, NOW);
    const r2 = review(r1, 4, NOW);
    expect(r2.repetitions).toBe(2);
    expect(r2.interval).toBe(6);
  });

  it("grows the interval by the ease factor afterwards", () => {
    let state = review(fresh, 5, NOW);
    state = review(state, 5, NOW);
    const third = review(state, 5, NOW);
    expect(third.interval).toBeGreaterThan(6);
  });

  it("resets repetitions on a lapse", () => {
    const learned = review(review(fresh, 4, NOW), 4, NOW);
    const lapsed = review(learned, 1, NOW);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.interval).toBe(1);
  });

  it("never drops the ease factor below the minimum", () => {
    let state = fresh;
    for (let i = 0; i < 10; i++) state = review(state, 3, NOW);
    expect(state.easeFactor).toBeGreaterThanOrEqual(MIN_EASE_FACTOR);
  });

  it("marks long intervals as mastered", () => {
    let state = review(fresh, 5, NOW);
    for (let i = 0; i < 5; i++) state = review(state, 5, NOW);
    expect(state.isMastered).toBe(true);
  });
});
