import { describe, expect, it } from "vitest";

import type { TodayPlanItem } from "@/actions/today-plan";
import { completedEstimatedMinutes } from "@/lib/learning/planner/summary";
import { renderEstimatedTime, renderSkippedTasks } from "@/lib/learning/planner/reasons";

function item(overrides: Partial<TodayPlanItem> = {}): TodayPlanItem {
  return {
    id: "item-1",
    position: 1,
    type: "review_due",
    status: "completed",
    estimatedMinutes: 4,
    targetCount: 8,
    completedCount: 8,
    reasonCode: "overdue_reviews",
    reasonData: { count: 8 },
    textId: null,
    libraryItemId: null,
    chapterId: null,
    conceptCode: null,
    wordIds: [],
    payload: {},
    signals: {},
    priorityScore: 0.9,
    ...overrides,
  };
}

describe("completedEstimatedMinutes", () => {
  it("is the whole plan when the whole plan was done", () => {
    const minutes = completedEstimatedMinutes([
      item({ id: "a", estimatedMinutes: 4 }),
      item({ id: "b", estimatedMinutes: 3 }),
      item({ id: "c", estimatedMinutes: 6 }),
    ]);
    expect(minutes).toBe(13);
  });

  it("counts only what was finished", () => {
    const minutes = completedEstimatedMinutes([
      item({ id: "a", estimatedMinutes: 4 }),
      item({ id: "b", estimatedMinutes: 3, status: "pending", completedCount: 0 }),
      item({ id: "c", estimatedMinutes: 6, status: "in_progress", completedCount: 2 }),
    ]);
    // Half-finished is not finished: partial progress is shown as "2 / 8" on the
    // task itself, never as minutes the learner is credited with.
    expect(minutes).toBe(4);
  });

  it("never credits a skipped task", () => {
    // The whole point of the figure: skipping four tasks must not look like a
    // longer day than doing one.
    const minutes = completedEstimatedMinutes([
      item({ id: "a", estimatedMinutes: 2 }),
      item({ id: "b", estimatedMinutes: 9, status: "skipped", completedCount: 0 }),
      item({ id: "c", estimatedMinutes: 9, status: "skipped", completedCount: 0 }),
    ]);
    expect(minutes).toBe(2);
  });

  it("is zero when nothing was completed", () => {
    expect(
      completedEstimatedMinutes([
        item({ id: "a", status: "skipped", completedCount: 0 }),
        item({ id: "b", status: "pending", completedCount: 0 }),
      ]),
    ).toBe(0);
    expect(completedEstimatedMinutes([])).toBe(0);
  });
});

describe("how minutes are worded", () => {
  it("labels the figure as an estimate and never as time spent learning", () => {
    // Fluent does not measure study time (today-engine.md §14). The moment this
    // reads "30 min nauki", a 12-minute day is being reported as a 30-minute one.
    const copy = renderEstimatedTime(30);
    expect(copy).toBe("Szacowany czas: ok. 30 min");
    expect(copy).not.toMatch(/nauki/);
  });

  it("keeps the estimate readable when a task is under a minute", () => {
    expect(renderEstimatedTime(0.4)).toBe("Szacowany czas: ok. 1 min");
  });
});

describe("renderSkippedTasks", () => {
  it("agrees in Polish across all three plural forms", () => {
    expect(renderSkippedTasks(1)).toBe("1 zadanie pominięte");
    expect(renderSkippedTasks(2)).toBe("2 zadania pominięte");
    expect(renderSkippedTasks(5)).toBe("5 zadań pominiętych");
  });
});
