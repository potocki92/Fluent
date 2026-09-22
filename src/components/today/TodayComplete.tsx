import Link from "next/link";
import { PartyPopper, TrendingUp } from "lucide-react";

import type { TodayPlanItem } from "@/lib/learning/planner/contracts";
import {
  PLAN_ITEM_TITLE_PL,
  renderEstimatedTime,
  renderSkippedTasks,
} from "@/lib/learning/planner/reasons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The end of a finished day.
 *
 * WHAT THIS DELIBERATELY IS NOT: an economy. No coins, no gems, no energy, no
 * league. Fluent's retention argument is that the learning is good and the
 * progress is legible — bolting a currency onto that would add a second, louder
 * reason to come back, and it would be a worse one.
 *
 * So the reward is the truth: what you did, roughly how long it was planned to
 * take, and the one thing that measurably improved.
 *
 * AND THE TRUTH INCLUDES WHAT FLUENT DOES NOT KNOW. It does not measure how long
 * anyone studied (`today-engine.md` §14), so this screen never says "X min
 * nauki" — that would dress the planner's estimate up as a statistic, and it
 * would be wrong in both directions: overstated for the learner who raced
 * through the plan, understated for the one who laboured over it. The estimate
 * is shown as an estimate, and it counts COMPLETED activities only, so skipping
 * three tasks cannot inflate it.
 */
export function TodayComplete({
  items,
  completedEstimatedMinutes,
  streak,
  improved,
}: {
  items: readonly TodayPlanItem[];
  /** Planner estimate for the finished activities — never a measured duration. */
  completedEstimatedMinutes: number;
  streak: number;
  /** Polish label of the concept the day's practice pushed hardest, if any. */
  improved: string | null;
}) {
  const completed = items.filter((item) => item.status === "completed");
  const skipped = items.filter((item) => item.status === "skipped").length;
  const estimate =
    completedEstimatedMinutes > 0
      ? renderEstimatedTime(completedEstimatedMinutes)
      : null;
  const streakLine = streak > 1 ? `${streak} dni z rzędu` : null;
  const subtitle = [estimate, streakLine].filter(Boolean).join(" · ");

  return (
    <Card className="items-center gap-3 p-5 text-center">
      <PartyPopper className="size-8 text-gold" aria-hidden />
      <div className="space-y-1">
        <p className="text-lg font-bold">Dzisiejszy plan ukończony</p>
        {subtitle && <p className="text-sm text-muted2">{subtitle}</p>}
      </div>

      <ul className="w-full space-y-1 text-left text-sm">
        {completed.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 text-muted2">
            <span>{PLAN_ITEM_TITLE_PL[item.type]}</span>
            <span className="shrink-0">
              {item.completedCount > 1 ? item.completedCount : ""}
            </span>
          </li>
        ))}
      </ul>

      {improved && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-green">
          <TrendingUp className="size-4" aria-hidden />
          Największy progres: {improved}
        </p>
      )}

      {skipped > 0 && (
        <p className="text-xs text-muted2">
          {renderSkippedTasks(skipped)} — wrócą w kolejnych planach.
        </p>
      )}

      {/* Today is a recommendation, never a cage: there is always a way to keep
          going by choice rather than by plan. */}
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button asChild variant="secondary" size="sm">
          <Link href="/review">Dodatkowe powtórki</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/learn">Przeczytaj coś jeszcze</Link>
        </Button>
      </div>
    </Card>
  );
}
