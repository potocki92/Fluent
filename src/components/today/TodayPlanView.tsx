"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import { skipPlanItem, type TodayPlan } from "@/actions/today-plan";
import { nextPlanItem, planItemHref, planProgress } from "@/lib/learning/planner/routes";
import { PLAN_ITEM_TITLE_PL } from "@/lib/learning/planner/reasons";
import { DailyProgress } from "@/components/today/DailyProgress";
import { PlanItemCard } from "@/components/today/PlanItemCard";
import { TodayComplete } from "@/components/today/TodayComplete";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") router.refresh();
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
      setSkipping(itemId);
      startTransition(async () => {
        await skipPlanItem(itemId);
        router.refresh();
        setSkipping(null);
      });
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
          minutes={plan.estimatedMinutes}
          streak={plan.streak}
          improved={improved}
        />
      ) : (
        next && (
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
        )
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
              />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
