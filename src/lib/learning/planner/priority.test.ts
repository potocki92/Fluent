import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_SWEET_SPOT,
  MIN_WEAKNESS_RECENCY,
  SIGNAL_WEIGHTS,
  STUDY_AHEAD_URGENCY,
  WEAKNESS_RECENCY_HALF_LIFE_DAYS,
} from "@/lib/learning/planner/constants";
import {
  continuationSignal,
  difficultyMatchSignal,
  dueUrgencySignal,
  scoreCandidate,
  studyAheadSignal,
  vocabularyFitSignal,
  weaknessRecencySignal,
} from "@/lib/learning/planner/priority";
import { reason } from "@/lib/learning/planner/reasons";
import type { PlanCandidate } from "@/lib/learning/planner/types";

const NOW = new Date("2026-09-14T09:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("dueUrgencySignal", () => {
  it("is zero with an empty queue", () => {
    expect(dueUrgencySignal({ dueCount: 0, oldestDueAt: null, now: NOW })).toBe(0);
  });

  it("rises with how late the oldest card is", () => {
    const fresh = dueUrgencySignal({ dueCount: 1, oldestDueAt: daysAgo(0.1), now: NOW });
    const late = dueUrgencySignal({ dueCount: 1, oldestDueAt: daysAgo(4), now: NOW });
    expect(late).toBeGreaterThan(fresh);
  });

  it("rises with how many cards are waiting, even when none is late", () => {
    const few = dueUrgencySignal({ dueCount: 2, oldestDueAt: null, now: NOW });
    const many = dueUrgencySignal({ dueCount: 18, oldestDueAt: null, now: NOW });
    expect(many).toBeGreaterThan(few);
  });

  it("saturates, so a year away cannot drown out every other activity", () => {
    const week = dueUrgencySignal({ dueCount: 20, oldestDueAt: daysAgo(7), now: NOW });
    const year = dueUrgencySignal({ dueCount: 900, oldestDueAt: daysAgo(365), now: NOW });
    expect(week).toBe(1);
    expect(year).toBe(1);
  });

  it("ranks a real backlog above study-ahead", () => {
    const overdue = dueUrgencySignal({ dueCount: 6, oldestDueAt: daysAgo(3), now: NOW });
    expect(overdue).toBeGreaterThan(studyAheadSignal(20));
    expect(studyAheadSignal(20)).toBe(STUDY_AHEAD_URGENCY);
    expect(studyAheadSignal(0)).toBe(0);
  });
});

describe("weaknessRecencySignal", () => {
  it("is full strength for a failure that just happened", () => {
    expect(weaknessRecencySignal(daysAgo(0), NOW)).toBe(1);
  });

  it("halves over the half-life", () => {
    const decayed = weaknessRecencySignal(daysAgo(WEAKNESS_RECENCY_HALF_LIFE_DAYS), NOW);
    expect(decayed).toBeGreaterThan(0.45);
    expect(decayed).toBeLessThan(0.55);
  });

  it("never decays a weakness out of existence", () => {
    expect(weaknessRecencySignal(daysAgo(3650), NOW)).toBe(MIN_WEAKNESS_RECENCY);
  });

  it("treats an unknown last failure as old, not as fresh", () => {
    expect(weaknessRecencySignal(null, NOW)).toBe(MIN_WEAKNESS_RECENCY);
  });
});

describe("difficultyMatchSignal", () => {
  it("peaks slightly above the learner's ability", () => {
    const ability = 1300;
    const atSweetSpot = difficultyMatchSignal(ability + DIFFICULTY_SWEET_SPOT, ability);
    const atAbility = difficultyMatchSignal(ability, ability);
    expect(atSweetSpot).toBe(1);
    expect(atAbility).toBeLessThan(atSweetSpot);
  });

  it("gives an A1 learner nothing for a B2 text", () => {
    expect(difficultyMatchSignal(1700, 1050)).toBe(0);
  });

  it("discounts a passage well below the learner's level", () => {
    expect(difficultyMatchSignal(1100, 1500)).toBe(0);
  });
});

describe("continuationSignal", () => {
  it("maxes out for a test left half-finished", () => {
    expect(
      continuationSignal({ hasOpenTestSession: true, lastOpenedAt: null, now: NOW }),
    ).toBe(1);
  });

  it("fades as the passage goes untouched", () => {
    const today = continuationSignal({
      hasOpenTestSession: false,
      lastOpenedAt: daysAgo(0),
      now: NOW,
    });
    const lastWeek = continuationSignal({
      hasOpenTestSession: false,
      lastOpenedAt: daysAgo(6),
      now: NOW,
    });
    expect(today).toBeGreaterThan(lastWeek);
    expect(lastWeek).toBeGreaterThanOrEqual(0);
  });

  it("is nothing for a passage never opened", () => {
    expect(
      continuationSignal({ hasOpenTestSession: false, lastOpenedAt: null, now: NOW }),
    ).toBe(0);
  });
});

describe("vocabularyFitSignal", () => {
  it("rewards a full batch of correctly-levelled words", () => {
    expect(vocabularyFitSignal({ wordCount: 6, targetCount: 6, atLevelCount: 6 })).toBe(1);
  });

  it("discounts a batch of the wrong level", () => {
    const onLevel = vocabularyFitSignal({ wordCount: 6, targetCount: 6, atLevelCount: 6 });
    const offLevel = vocabularyFitSignal({ wordCount: 6, targetCount: 6, atLevelCount: 0 });
    expect(offLevel).toBeLessThan(onLevel);
  });

  it("is nothing when there are no words to teach", () => {
    expect(vocabularyFitSignal({ wordCount: 0, targetCount: 6, atLevelCount: 0 })).toBe(0);
  });
});

describe("scoreCandidate", () => {
  function candidate(overrides: Partial<PlanCandidate>): PlanCandidate {
    return {
      type: "review_due",
      estimatedMinutes: 3,
      targetCount: 8,
      signals: {},
      reason: reason("overdue_reviews", { count: 8 }),
      ...overrides,
    };
  }

  it("is the weighted sum of the signals present", () => {
    const scored = scoreCandidate(
      candidate({ type: "new_vocabulary", signals: { vocabularyFit: 1 } }),
    );
    // new_vocabulary's tiebreak is zero, so the weight is the whole score.
    expect(scored.priority).toBeCloseTo(SIGNAL_WEIGHTS.vocabularyFit, 5);
  });

  it("ignores signals a candidate does not carry", () => {
    const scored = scoreCandidate(candidate({ type: "new_vocabulary", signals: {} }));
    expect(scored.priority).toBe(0);
  });

  it("puts onboarding above everything else", () => {
    const placement = scoreCandidate(
      candidate({ type: "placement", signals: { onboarding: 1 } }),
    );
    const maxedOutOrdinary = scoreCandidate(
      candidate({
        type: "review_due",
        signals: { dueUrgency: 1, weaknessSeverity: 1, continuation: 1 },
      }),
    );
    expect(placement.priority).toBeGreaterThan(maxedOutOrdinary.priority);
  });

  it("labels each candidate with its balance category", () => {
    expect(scoreCandidate(candidate({ type: "review_due" })).category).toBe("memory");
    expect(scoreCandidate(candidate({ type: "new_text" })).category).toBe(
      "comprehension",
    );
  });
});
