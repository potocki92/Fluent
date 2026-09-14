import { describe, expect, it } from "vitest";

import { BUDGET_TOLERANCE, MAX_ITEMS_PER_TYPE } from "@/lib/learning/planner/constants";
import { scoreCandidates } from "@/lib/learning/planner/priority";
import { reason } from "@/lib/learning/planner/reasons";
import { selectPlan } from "@/lib/learning/planner/select";
import type { PlanCandidate, PlanItemType } from "@/lib/learning/planner/types";

function candidate(
  type: PlanItemType,
  minutes: number,
  signals: PlanCandidate["signals"] = {},
  extra: Partial<PlanCandidate> = {},
): PlanCandidate {
  return {
    type,
    estimatedMinutes: minutes,
    targetCount: 1,
    signals,
    reason: reason("level_match"),
    ...extra,
  };
}

function plan(candidates: PlanCandidate[], targetMinutes: number) {
  return selectPlan({
    candidates: scoreCandidates(candidates),
    targetMinutes,
    evidenceLevel: "medium",
  });
}

describe("selectPlan — budget", () => {
  it("keeps a 10-minute plan near 10 minutes", () => {
    const result = plan(
      [
        candidate("review_due", 4, { dueUrgency: 0.9 }),
        candidate("weakness_practice", 3, { weaknessSeverity: 0.7 }),
        candidate("new_text", 6, { difficultyMatch: 0.8 }),
        candidate("new_vocabulary", 3, { vocabularyFit: 0.6 }),
      ],
      10,
    );

    expect(result.estimatedMinutes).toBeLessThanOrEqual(10 * (1 + BUDGET_TOLERANCE));
    expect(result.estimatedMinutes).toBeGreaterThan(0);
  });

  it("does not turn a 5-minute target into a 20-minute plan", () => {
    const result = plan(
      [
        candidate("review_due", 4, { dueUrgency: 0.9 }),
        candidate("weakness_practice", 4, { weaknessSeverity: 0.8 }),
        candidate("new_text", 8, { difficultyMatch: 0.9 }),
        candidate("new_vocabulary", 3, { vocabularyFit: 0.8 }),
      ],
      5,
    );

    expect(result.estimatedMinutes).toBeLessThanOrEqual(6);
  });

  it("still produces a usable session at the smallest budget", () => {
    const result = plan(
      [
        candidate("review_due", 2, { dueUrgency: 0.9 }),
        candidate("weakness_practice", 3, { weaknessSeverity: 0.7 }),
      ],
      5,
    );

    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it("takes the top activity anyway rather than returning an empty plan", () => {
    // Everything overflows the budget; a learner with real work waiting must
    // never be shown an empty home screen because of arithmetic.
    const result = plan([candidate("new_text", 40, { difficultyMatch: 1 })], 5);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("new_text");
  });

  it("does not let one oversized activity block a smaller one behind it", () => {
    const result = plan(
      [
        candidate("new_text", 30, { difficultyMatch: 1 }),
        candidate("review_due", 3, { dueUrgency: 0.5 }),
      ],
      10,
    );

    expect(result.items.map((item) => item.type)).toContain("review_due");
  });
});

describe("selectPlan — shape", () => {
  it("gives an unplaced learner the placement test and nothing else", () => {
    const result = plan(
      [
        candidate("placement", 5, { onboarding: 1 }),
        candidate("review_due", 3, { dueUrgency: 1 }),
        candidate("new_text", 5, { difficultyMatch: 1 }),
      ],
      20,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("placement");
    expect(result.evidenceLevel).toBe("medium");
  });

  it("never stacks more review batches than the per-type cap", () => {
    const result = plan(
      [
        candidate("review_due", 3, { dueUrgency: 1 }),
        candidate("review_due", 3, { dueUrgency: 0.9 }),
        candidate("review_due", 3, { dueUrgency: 0.8 }),
        candidate("new_vocabulary", 2, { vocabularyFit: 0.3 }),
      ],
      20,
    );

    const reviews = result.items.filter((item) => item.type === "review_due");
    expect(reviews).toHaveLength(MAX_ITEMS_PER_TYPE.review_due);
  });

  it("allows two drills, because two weaknesses are two different problems", () => {
    const result = plan(
      [
        candidate("weakness_practice", 3, { weaknessSeverity: 0.9 }, {
          conceptCode: "case_dative",
        }),
        candidate("weakness_practice", 3, { weaknessSeverity: 0.8 }, {
          conceptCode: "preposition_case",
        }),
        candidate("weakness_practice", 3, { weaknessSeverity: 0.7 }, {
          conceptCode: "word_order",
        }),
      ],
      30,
    );

    expect(
      result.items.filter((item) => item.type === "weakness_practice"),
    ).toHaveLength(MAX_ITEMS_PER_TYPE.weakness_practice);
  });

  it("mixes categories rather than filling the day with one kind of work", () => {
    const result = plan(
      [
        candidate("review_due", 3, { dueUrgency: 1 }),
        candidate("weakness_practice", 3, { weaknessSeverity: 0.8 }),
        candidate("new_text", 5, { difficultyMatch: 0.7 }),
      ],
      15,
    );

    const categories = new Set(result.items.map((item) => item.category));
    expect(categories.size).toBeGreaterThan(1);
  });

  it("orders the session as a shape, not as a ranked list", () => {
    // Reading scores highest here, but a session still reads better warm-up
    // first: priority decided WHAT is in the plan, flow decides the order.
    const result = plan(
      [
        candidate("new_text", 4, { difficultyMatch: 1 }),
        candidate("review_due", 3, { dueUrgency: 0.5 }),
      ],
      15,
    );

    expect(result.items.map((item) => item.type)).toEqual(["review_due", "new_text"]);
    expect(result.items.map((item) => item.position)).toEqual([1, 2]);
  });

  it("stamps the planner version on every plan", () => {
    const result = plan([candidate("review_due", 3, { dueUrgency: 1 })], 10);
    expect(result.algorithmVersion).toBe("planner_v1");
  });

  it("produces nothing when there is nothing to do", () => {
    const result = plan([], 10);
    expect(result.items).toHaveLength(0);
    expect(result.estimatedMinutes).toBe(0);
  });
});
