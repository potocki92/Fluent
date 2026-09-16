import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLUENT_ERROR_MESSAGES, type ActionResult } from "@/lib/errors";
import { runSkipPlanItem, type SkipPlanItemError } from "@/lib/learning/planner/skip";

/** The UI, reduced to what it actually does: pending, error, refresh. */
function ui(skip: (itemId: string) => Promise<ActionResult<{ status: string }>>) {
  const pending: (string | null)[] = [];
  const errors: (SkipPlanItemError | null)[] = [];
  let refreshes = 0;

  return {
    gate: { current: false },
    effects: {
      skip,
      setPending: (itemId: string | null) => pending.push(itemId),
      setError: (error: SkipPlanItemError | null) => errors.push(error),
      refresh: () => {
        refreshes += 1;
      },
    },
    get pending() {
      return pending;
    },
    /** What is on screen now — the last thing the flow set. */
    get error() {
      return errors.at(-1) ?? null;
    },
    get refreshes() {
      return refreshes;
    },
  };
}

beforeEach(() => {
  // `fail()` logs the technical detail; the test asserts on what the LEARNER
  // gets, not on the server log.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSkipPlanItem", () => {
  it("refreshes the plan when the skip succeeds", async () => {
    const view = ui(async () => ({ ok: true, status: "skipped" }));

    await runSkipPlanItem("item-1", view.gate, view.effects);

    expect(view.refreshes).toBe(1);
    expect(view.error).toBeNull();
    expect(view.pending).toEqual(["item-1", null]);
  });

  it("shows the failure and does NOT refresh", async () => {
    const view = ui(async () => ({
      ok: false,
      code: "forbidden",
      message: FLUENT_ERROR_MESSAGES.forbidden,
    }));

    await runSkipPlanItem("item-1", view.gate, view.effects);

    // Refreshing here would redraw an unchanged plan and read as "nothing
    // happened" — which is exactly the silent failure this flow exists to stop.
    expect(view.refreshes).toBe(0);
    expect(view.error).toEqual({
      itemId: "item-1",
      message: FLUENT_ERROR_MESSAGES.forbidden,
    });
    expect(view.pending.at(-1)).toBeNull();
  });

  it("turns a rejected action into Polish copy, never a raw error", async () => {
    const view = ui(async () => {
      throw new Error('relation "daily_plan_items" does not exist');
    });

    await runSkipPlanItem("item-1", view.gate, view.effects);

    expect(view.error?.message).toBe(FLUENT_ERROR_MESSAGES.database_error);
    expect(view.error?.message).not.toMatch(/daily_plan_items/);
    expect(view.refreshes).toBe(0);
  });

  it("always clears pending, so the learner can try again", async () => {
    const view = ui(async () => {
      throw new Error("network");
    });

    await runSkipPlanItem("item-1", view.gate, view.effects);

    expect(view.pending).toEqual(["item-1", null]);
    expect(view.gate.current).toBe(false);

    // And the retry genuinely runs rather than being blocked by a stuck gate.
    const retried = ui(async () => ({ ok: true, status: "skipped" }));
    retried.gate = view.gate;
    await runSkipPlanItem("item-1", retried.gate, retried.effects);
    expect(retried.refreshes).toBe(1);
  });

  it("lets only one skip run at a time", async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = ui(async () => {
      calls += 1;
      await blocked;
      return { ok: true, status: "skipped" };
    });

    // Two taps in the same frame, plus a tap on a different task while the first
    // is still in flight. Only the first may reach the server.
    const first = runSkipPlanItem("item-1", view.gate, view.effects);
    await runSkipPlanItem("item-1", view.gate, view.effects);
    await runSkipPlanItem("item-2", view.gate, view.effects);
    expect(calls).toBe(1);

    release?.();
    await first;

    expect(calls).toBe(1);
    expect(view.refreshes).toBe(1);
    expect(view.pending).toEqual(["item-1", null]);
  });
});
