import { Flame, Sunrise } from "lucide-react";

import { renderMinutes } from "@/lib/learning/planner/reasons";

import { ParallaxLandscape } from "./ParallaxLandscape";

/** Greeting bands, in the learner's own timezone (see `localHour`). */
function greeting(hour: number): string {
  if (hour < 5) return "Dobrej nocy";
  if (hour < 12) return "Dzień dobry";
  if (hour < 18) return "Cześć";
  return "Dobry wieczór";
}

/**
 * The top of Today: who, how long, and how the week is going — standing in
 * front of a sunrise that moves.
 *
 * THE HOUR COMES FROM THE SERVER, computed in the learner's timezone. Asking
 * the browser would be simpler and would also mean the greeting flips on
 * hydration, which looks like a bug even though the second value is the more
 * accurate one.
 *
 * THIS FILE IS THE WORDS; `ParallaxLandscape` IS THE WINDOW. Everything here is
 * server-rendered and stays that way: it is handed to the scene as children, so
 * the client component that owns the frame loop never re-renders any of it. The
 * greeting, the icon and the streak are nailed down while the landscape behind
 * them breathes (§23) — the whole point of the effect is that only the scenery
 * has depth.
 *
 * THE PICTURE IS BEHIND THE TEXT NOW, WHICH IS WHY THERE IS A SCRIM. The
 * artwork runs from near-black on the left to a blown-out sun on the right, so
 * `.today-hero-scrim` holds the left in shadow for the type and opens up across
 * the right for the landscape (§19). The decorative line that used to sit top
 * right is gone: that corner is the sun's now, and a second flourish competing
 * with it was one flourish too many. The streak moved into the protected column
 * with everything else — it is information, so it does not get to sit somewhere
 * a bright sky could swallow it.
 *
 * THE SCENE IS DECORATIVE, SO IT HAS NO ALT TEXT. The greeting under it is the
 * heading; a description of a mountain range would be one more thing read aloud
 * before a learner reaches the plan.
 */
export function GreetingHero({
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
    // A greeting, not a banner (§18): tall enough to hold a landscape, short
    // enough that the plan is still the first thing below the fold.
    <ParallaxLandscape className="app-panel min-h-[148px] rounded-2xl sm:min-h-[196px] lg:min-h-[212px]">
      <div className="flex min-w-0 items-center gap-4 px-5 py-4 sm:px-7 sm:py-5">
        <span
          aria-hidden
          className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold sm:flex"
        >
          <Sunrise className="size-6" />
        </span>

        {/* Capped short of the full width so the words stay in the half of the
            scrim that is built to carry them — the right of the hero is the
            landscape's, at every breakpoint. */}
        <div className="min-w-0 max-w-[19rem] space-y-1 sm:max-w-md lg:max-w-lg">
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
          {streak > 0 && (
            <p
              className="flex items-center gap-1 pt-0.5 text-sm font-medium text-gold"
              title={`${streak} ${streak === 1 ? "dzień" : "dni"} z ukończonym planem`}
            >
              <Flame className="size-4" aria-hidden />
              {streak}
            </p>
          )}
        </div>
      </div>
    </ParallaxLandscape>
  );
}
