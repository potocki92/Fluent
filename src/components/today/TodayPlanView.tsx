"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { skipPlanItem, type TodayPlan } from "@/actions/today-plan";
import { nextPlanItem, planItemHref, planProgress } from "@/lib/learning/planner/routes";
import {
  runSkipPlanItem,
  type SkipPlanItemError,
} from "@/lib/learning/planner/skip";
import { completedEstimatedMinutes } from "@/lib/learning/planner/summary";
import { PLAN_ITEM_TITLE_PL } from "@/lib/learning/planner/reasons";
import { DailyProgress } from "@/components/today/DailyProgress";
import { PlanItemCard } from "@/components/today/PlanItemCard";
import { TodayComplete } from "@/components/today/TodayComplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Long enough to collapse the focus/visibilitychange pair that one tab switch
 * fires, short enough that a real return from a review still re-reads the plan.
 */
const REFRESH_COOLDOWN_MS = 1_000;

/**
 * The interactive half of Today.
 *
 * It holds no authority over anything. The plan and every item's status arrive
 * from the server, which derived them from what the learner actually did; this
 * component decides which card is highlighted and where the big button points,
 * and that is all. There is no "mark done" here because there is no "mark done"
 * anywhere — see `sync_daily_plan`.
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
  const reduceMotion = useReducedMotion();
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
  const progress = planProgress(plan.items);
  const isComplete = plan.status === "completed";

  return (
    <div className="space-y-4">
      <DailyProgress done={progress.done} total={progress.total} />

      {isComplete ? (
        <TodayComplete
          items={plan.items}
          completedEstimatedMinutes={completedEstimatedMinutes(plan.items)}
          streak={plan.streak}
          improved={improved}
        />
      ) : next ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* ONE primary action. A learner arriving at Today should be able to
              start without comparing seven buttons. */}
          <Button asChild size="lg" className="w-full">
            <Link href={planItemHref(next)}>
              {progress.done > 0 || next.status === "in_progress"
                ? "Kontynuuj naukę"
                : "Zacznij dzisiejszą naukę"}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <p className="mt-1.5 text-center text-xs text-muted2">
            Następne: {PLAN_ITEM_TITLE_PL[next.type]}
          </p>
        </motion.div>
      ) : (
        // Everything was set aside. The plan is not finished — skipping is not
        // learning — but leaving the screen with no next step and no sentence
        // looks like a bug, so the two activities that never depend on a plan
        // stay one tap away.
        <AllSkipped />
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

/**
 * Every task set aside, nothing completed.
 *
 * `sync_daily_plan` leaves such a plan `in_progress` on purpose — a day of
 * skipping is not a day of learning, so it must never render as "ukończony".
 * Planner V1 also does not refill the slots. That leaves a screen with no next
 * activity, and the honest thing to put there is what is still true: the plan
 * comes back tomorrow, and nothing stops the learner studying now.
 */
function AllSkipped() {
  return (
    <Card className="gap-3 p-5">
      <p className="text-sm font-semibold">Wszystkie zadania odłożone na dziś</p>
      <p className="text-sm text-muted2">
        Nowy plan przygotujemy jutro. Jeśli masz chwilę, możesz uczyć się dalej
        bez planu.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/review">Powtórki</Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/learn">Czytaj</Link>
        </Button>
      </div>
    </Card>
  );
}
