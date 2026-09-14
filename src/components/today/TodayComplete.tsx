import Link from "next/link";
import { PartyPopper, TrendingUp } from "lucide-react";

import type { TodayPlanItem } from "@/actions/today-plan";
import { PLAN_ITEM_TITLE_PL, renderMinutes } from "@/lib/learning/planner/reasons";
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
 * So the reward is the truth: what you did, how long it took, and the one thing
 * that measurably improved.
 */
export function TodayComplete({
  items,
  minutes,
  streak,
  improved,
}: {
  items: readonly TodayPlanItem[];
  minutes: number;
  streak: number;
  /** Polish label of the concept the day's practice pushed hardest, if any. */
  improved: string | null;
}) {
  const completed = items.filter((item) => item.status === "completed");
  const skipped = items.filter((item) => item.status === "skipped").length;

  return (
    <Card className="items-center gap-3 p-5 text-center">
      <PartyPopper className="size-8 text-gold" aria-hidden />
      <div className="space-y-1">
        <p className="text-lg font-bold">Dzisiejszy plan ukończony</p>
        <p className="text-sm text-muted2">
          {renderMinutes(minutes)} nauki
          {streak > 1 ? ` · ${streak} dni z rzędu` : ""}
        </p>
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
          {skipped === 1 ? "1 zadanie pominięte" : `${skipped} zadania pominięte`} —
          wrócą w kolejnych planach.
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
