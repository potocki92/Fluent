import { describe, expect, it } from "vitest";

import type { TodayPlanItem } from "@/lib/learning/planner/contracts";
import {
  nextPlanItem,
  planItemHref,
  planProgress,
} from "@/lib/learning/planner/routes";

function item(overrides: Partial<TodayPlanItem> = {}): TodayPlanItem {
  return {
    id: "item-1",
    position: 1,
    type: "review_due",
    status: "pending",
    estimatedMinutes: 3,
    targetCount: 8,
    completedCount: 0,
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

describe("planItemHref", () => {
  it("sends every activity somewhere that exists", () => {
    expect(planItemHref(item({ type: "placement" }))).toBe("/calibration");
    expect(planItemHref(item({ type: "review_due" }))).toBe("/review");
    expect(planItemHref(item({ type: "continue_text", textId: 7 }))).toBe("/learn/7");
    expect(planItemHref(item({ type: "new_text", textId: 9 }))).toBe("/learn/9");
  });

  it("carries the plan item into a drill, so finishing it moves the plan", () => {
    const href = planItemHref(
      item({ id: "abc", type: "weakness_practice", conceptCode: "case_dative" }),
    );
    expect(href).toBe("/practice/case_dative?item=abc");
  });

  it("passes the exact recommended words to the review deck", () => {
    // Completion is measured against THESE ids, so serving a different deck
    // would leave the activity impossible to finish.
    const href = planItemHref(item({ type: "new_vocabulary", wordIds: [3, 1, 4] }));
    expect(href).toBe("/review?words=3,1,4");
  });

  it("degrades to a working screen when a reference is missing", () => {
    expect(planItemHref(item({ type: "continue_text", textId: null }))).toBe("/learn");
    expect(planItemHref(item({ type: "new_vocabulary", wordIds: [] }))).toBe("/review");
  });
});

describe("nextPlanItem", () => {
  it("prefers something already begun over something untouched", () => {
    const next = nextPlanItem([
      item({ id: "a", status: "completed" }),
      item({ id: "b", status: "pending" }),
      item({ id: "c", status: "in_progress" }),
    ]);
    expect(next?.id).toBe("c");
  });

  it("skips finished and skipped activities", () => {
    const next = nextPlanItem([
      item({ id: "a", status: "completed" }),
      item({ id: "b", status: "skipped" }),
      item({ id: "c", status: "pending" }),
    ]);
    expect(next?.id).toBe("c");
  });

  it("is null once there is nothing left", () => {
    expect(
      nextPlanItem([item({ status: "completed" }), item({ status: "skipped" })]),
    ).toBeNull();
  });
});

describe("planProgress", () => {
  it("counts only what was actually completed", () => {
    // A skipped activity is resolved, not achieved — letting it fill the bar
    // would make "skip everything" look like a finished day.
    const progress = planProgress([
      item({ status: "completed" }),
      item({ status: "skipped" }),
      item({ status: "pending" }),
      item({ status: "in_progress" }),
    ]);
    expect(progress).toEqual({ done: 1, total: 4, percent: 25 });
  });

  it("handles an empty plan without dividing by zero", () => {
    expect(planProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe("planItemHref — the story activities", () => {
  const chapter = {
    payload: { slug: "der-prozess", chapterPosition: 4 },
  } as const;

  it("carries the plan item into a preparation, so finishing it moves the plan", () => {
    expect(
      planItemHref(item({ id: "plan-7", type: "chapter_preparation", ...chapter })),
    ).toBe("/library/der-prozess/4/przygotowanie?item=plan-7");
  });

  it("carries it into a Challenge for the same reason", () => {
    expect(
      planItemHref(item({ id: "plan-7", type: "chapter_assessment", ...chapter })),
    ).toBe("/library/der-prozess/4/wyzwanie?item=plan-7");
  });

  it("does NOT carry it into plain reading, which is measured, not attached", () => {
    expect(planItemHref(item({ type: "continue_chapter", ...chapter }))).toBe(
      "/library/der-prozess/4",
    );
  });

  it("falls back to the library rather than a 404 when the snapshot is thin", () => {
    expect(planItemHref(item({ type: "chapter_assessment", payload: {} }))).toBe(
      "/library",
    );
  });
});
