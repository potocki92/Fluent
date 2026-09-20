import { Flame, Sunrise } from "lucide-react";

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
 *
 * THE DECORATION IS DECORATION. The hero carries one icon, one line of type on
 * the right at desktop width, and a wash that is barely a gradient. It is the
 * calmest thing on the screen on purpose: it is the first thing a learner sees
 * every day, and nothing in it is a task. The line on the right is `aria-hidden`
 * — it says nothing a screen reader needs to hear twice.
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
    <header className="app-panel relative overflow-hidden rounded-2xl px-5 py-6 sm:px-7 sm:py-8">
      {/* The warm corner of the mock, expressed in the app's own gold rather
          than a new colour. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-gold/5 blur-2xl"
      />

      <div className="relative flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold sm:flex"
          >
            <Sunrise className="size-6" />
          </span>

          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-bold sm:text-3xl">
              {greeting(hour)}
              {name ? `, ${name}` : ""}!
            </h1>
            <p className="text-sm text-muted2">
              {isComplete
                ? "Dzisiejszy plan ukończony. Małe kroki, wielkie efekty."
                : remainingMinutes > 0
                  ? `Małe kroki, wielkie efekty. Zostało ${renderMinutes(remainingMinutes)} z ${renderMinutes(targetMinutes)} na dziś.`
                  : `Małe kroki, wielkie efekty. ${renderMinutes(targetMinutes)} na dziś.`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {streak > 0 && (
            <span
              className="flex items-center gap-1 text-sm font-medium text-gold"
              title={`${streak} ${streak === 1 ? "dzień" : "dni"} z ukończonym planem`}
            >
              <Flame className="size-4" aria-hidden />
              {streak}
            </span>
          )}
          <p
            aria-hidden
            className="hidden max-w-[11rem] text-right text-sm italic leading-snug text-muted2/70 lg:block"
          >
            Lepsza wersja Ciebie,
            <br />
            każdego dnia.
          </p>
        </div>
      </div>
    </header>
  );
}
