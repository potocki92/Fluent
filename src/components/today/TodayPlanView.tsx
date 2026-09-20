"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { skipPlanItem, type TodayPlan } from "@/actions/today-plan";
import { nextPlanItem } from "@/lib/learning/planner/routes";
import {
  runSkipPlanItem,
  type SkipPlanItemError,
} from "@/lib/learning/planner/skip";
import { completedEstimatedMinutes } from "@/lib/learning/planner/summary";
import { PlanItemCard } from "@/components/today/PlanItemCard";
import { TodayComplete } from "@/components/today/TodayComplete";

/**
 * Long enough to collapse the focus/visibilitychange pair that one tab switch
 * fires, short enough that a real return from a review still re-reads the plan.
 */
const REFRESH_COOLDOWN_MS = 1_000;

/**
 * The interactive half of Today: the plan, with its controls.
 *
 * It holds no authority over anything. The plan and every item's status arrive
 * from the server, which derived them from what the learner actually did; this
 * component decides which card is highlighted, and that is all. There is no
 * "mark done" here because there is no "mark done" anywhere — see
 * `sync_daily_plan`.
 *
 * THE SUMMARY MOVED OUT, THE CONTROLS STAYED. The progress figure is now the
 * ring on „Twój cel na dziś" and the primary action is the „Kontynuuj naukę"
 * card, both above this list and both derived from the same `planProgress` /
 * `nextPlanItem` this file used to call. What is left here is what a glance
 * cannot carry: why each activity was chosen, how long it is estimated to take,
 * and the one write on this screen — skipping.
 *
 * RESUMING. Coming back from a review or a drill is a normal browser navigation,
 * so the surest way to show fresh progress is to re-render the server component
 * that measured it. `router.refresh()` on focus covers every route back to this
 * page — back button, tab switch, reopening the app — without this component
 * having to know which session the learner just left.
 *
 * SKIPPING IS THE ONE WRITE ON THIS SCREEN, and it is therefore the one place a
 * failure can be swallowed. It must not be: a skip that fails silently leaves
 * the task sitting there after the spinner stops, which is indistinguishable
 * from a click that never registered. The flow itself lives in
 * `runSkipPlanItem`, which branches on the result, classifies a rejected action
 * rather than losing it, always clears the pending flag, and lets only one skip
 * be in flight at a time. This component supplies the state and the refresh.
 */
export function TodayPlanView({
  plan,
  improved,
}: {
  plan: TodayPlan;
  improved: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [skipping, setSkipping] = useState<string | null>(null);
  const [skipError, setSkipError] = useState<SkipPlanItemError | null>(null);
  // The gate for `runSkipPlanItem`. A ref rather than the pending flag, because
  // two taps inside one frame would both read state as "idle".
  const inFlight = useRef(false);

  // Returning to the tab fires BOTH listeners, so an unguarded handler costs two
  // RSC round trips on the most-opened screen in the app for one identical
  // answer. Whichever arrives first wins; the other is a no-op.
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAt.current < REFRESH_COOLDOWN_MS) return;
      lastRefreshAt.current = now;
      router.refresh();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  const handleSkip = useCallback(
    (itemId: string) => {
      startTransition(() =>
        runSkipPlanItem(itemId, inFlight, {
          skip: skipPlanItem,
          setPending: setSkipping,
          setError: setSkipError,
          refresh: () => router.refresh(),
        }),
      );
    },
    [router],
  );

  const next = nextPlanItem(plan.items);
  const isComplete = plan.status === "completed";

  return (
    <div className="space-y-4">
      {/* The reward screen for a finished day. The "everything was set aside"
          case is NOT handled here any more: `ContinueCard` already says it, at
          the top of the screen where the next step would otherwise be, and two
          cards saying "nothing left to do" is one more than a learner needs. */}
      {isComplete && (
        <TodayComplete
          items={plan.items}
          completedEstimatedMinutes={completedEstimatedMinutes(plan.items)}
          streak={plan.streak}
          improved={improved}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Dzisiejszy plan
        </h2>
        <ol className="space-y-2">
          {plan.items.map((item) => (
            <li key={item.id}>
              <PlanItemCard
                item={item}
                isNext={!isComplete && item.id === next?.id}
                onSkip={handleSkip}
                skipping={pending && skipping === item.id}
                skipDisabled={pending}
                skipError={skipError?.itemId === item.id ? skipError.message : null}
              />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
