/**
 * "Pomiń na dziś", as a flow rather than a fire-and-forget call.
 *
 * Skipping is the only write the Today screen performs, so it is the only place
 * on that screen where a failure can vanish. It used to: the Server Action's
 * result was awaited and discarded, so a refused or failed skip stopped the
 * spinner, left the task exactly where it was and said nothing — which a learner
 * reads as "the button is broken", taps again, and again.
 *
 * Three guarantees, and they are the reason this lives here rather than inside
 * the component: a node test can hold them, a `.tsx` one currently cannot.
 *
 *  1. **Never silent.** Both failure shapes — a returned {@link FluentFailure}
 *     and a rejected action — end as Polish copy from the error taxonomy. The
 *     plan is NOT refreshed, because nothing changed and a refresh would make it
 *     look as though something had.
 *  2. **Always settles.** The pending flag is cleared in a `finally`, so no path
 *     — success, failure, exception — can strand the UI mid-skip.
 *  3. **One at a time.** The gate is a mutable ref, not React state: two taps in
 *     one frame both read state as "idle", and a second skip racing the first
 *     would refresh the plan against a half-applied write.
 */

import { settleAction, type ActionResult } from "@/lib/errors";

/** The Server Action itself — injected so this module stays free of Supabase. */
export type SkipPlanItemAction = (
  itemId: string,
) => Promise<ActionResult<{ status: string }>>;

/** What the failure looks like to the UI: whose task, and what to show. */
export interface SkipPlanItemError {
  itemId: string;
  message: string;
}

export interface SkipPlanItemEffects {
  skip: SkipPlanItemAction;
  /** Which task is in flight, or null once it has settled. */
  setPending: (itemId: string | null) => void;
  /** The failure to render, or null to clear the previous one. */
  setError: (error: SkipPlanItemError | null) => void;
  /** Re-render the server component that owns plan status. Success only. */
  refresh: () => void;
}

/** A one-slot gate. In React this is a `useRef(false)`; in a test, an object. */
export interface SkipGate {
  current: boolean;
}

/**
 * Run one skip. Resolves when the UI has been told what happened; never rejects.
 */
export async function runSkipPlanItem(
  itemId: string,
  gate: SkipGate,
  effects: SkipPlanItemEffects,
): Promise<void> {
  if (gate.current) return;
  gate.current = true;
  effects.setPending(itemId);
  effects.setError(null);

  try {
    const result = await settleAction(
      () => effects.skip(itemId),
      `skipPlanItem ${itemId}`,
    );
    if (!result.ok) {
      // Taxonomy copy, never a Postgres message. The task is untouched, so the
      // retry is the same tap again.
      effects.setError({ itemId, message: result.message });
      return;
    }
    effects.refresh();
  } finally {
    gate.current = false;
    effects.setPending(null);
  }
}
