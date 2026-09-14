import { Flame } from "lucide-react";

import { renderMinutes } from "@/lib/learning/planner/reasons";

/** Greeting bands, in the learner's own timezone (see `localHour`). */
function greeting(hour: number): string {
  if (hour < 5) return "Dobrej nocy";
  if (hour < 12) return "Dzień dobry";
  if (hour < 18) return "Cześć";
  return "Dobry wieczór";
}

/**
 * The top of Today: who, how long, and how the week is going.
 *
 * The hour comes from the SERVER, computed in the learner's timezone. Asking the
 * browser would be simpler and would also mean the greeting flips on hydration,
 * which looks like a bug even though the second value is the more accurate one.
 */
export function TodayHeader({
  displayName,
  hour,
  remainingMinutes,
  targetMinutes,
  streak,
  isComplete,
}: {
  displayName: string | null;
  hour: number;
  remainingMinutes: number;
  targetMinutes: number;
  streak: number;
  isComplete: boolean;
}) {
  const name = displayName?.trim().split(/\s+/)[0];

  return (
    <header className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">
          {greeting(hour)}
          {name ? `, ${name}` : ""}
        </h1>
        {streak > 0 && (
          <span
            className="flex items-center gap-1 text-sm font-medium text-gold"
            title={`${streak} ${streak === 1 ? "dzień" : "dni"} z ukończonym planem`}
          >
            <Flame className="size-4" aria-hidden />
            {streak}
          </span>
        )}
      </div>
      <p className="text-sm text-muted2">
        {isComplete
          ? "Dzisiejszy plan ukończony."
          : remainingMinutes > 0
            ? `Zostało ${renderMinutes(remainingMinutes)} z ${renderMinutes(targetMinutes)} na dziś`
            : `${renderMinutes(targetMinutes)} na dziś`}
      </p>
    </header>
  );
}
