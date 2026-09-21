import Image from "next/image";
import { Flame, Sunrise } from "lucide-react";

import { renderMinutes } from "@/lib/learning/planner/reasons";

import todayHero from "./today-hero.webp";

/**
 * How wide the picture is actually rendered, so `next/image` fetches that size.
 * Today is a dashboard route, so the column is `max-w-5xl` (1024 px) and below
 * that the header runs the full viewport width.
 */
const HERO_SIZES = "(min-width: 1024px) 1024px, 100vw";

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
 * THE DECORATION IS DECORATION. The hero carries one picture, one icon and one
 * line of type on the right at desktop width. It is the calmest thing on the
 * screen on purpose: it is the first thing a learner sees every day, and nothing
 * in it is a task. The line on the right is `aria-hidden` — it says nothing a
 * screen reader needs to hear twice.
 *
 * THE PICTURE IS A BAND, NOT A BACKDROP. Nothing is set over it, which is the
 * whole point: the artwork is a sunrise that runs from near-black on the left to
 * a blown-out sun on the right, and a greeting laid across that either needs a
 * scrim heavy enough to hide the picture or ships a name that drops below 4.5:1
 * somewhere between the two. Instead it occupies the top of the card and melts
 * into the panel (`.today-hero-veil`), so every word below it keeps the card's
 * own contrast and the artwork keeps its own light.
 *
 * IT IS DECORATIVE, SO IT HAS NO ALT TEXT. The greeting under it is the heading;
 * a description of a mountain range would be one more thing read aloud before a
 * learner reaches the plan. The import is static rather than a `/brand/...`
 * string for the reason {@link FluentLogo} gives: a missing file then fails the
 * build, and Next reads the intrinsic dimensions at compile time.
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
    <header className="app-panel relative overflow-hidden rounded-2xl">
      {/* The warm corner of the mock, which used to be a gold blur in this exact
          spot. The picture is that corner now — a second wash under it would be
          invisible. */}
      <div className="relative h-28 w-full sm:h-36">
        <Image
          src={todayHero}
          alt=""
          fill
          priority
          sizes={HERO_SIZES}
          placeholder="blur"
          className="object-cover object-[center_40%]"
        />
        <span aria-hidden className="today-hero-veil absolute inset-0" />
      </div>

      <div className="relative flex items-start justify-between gap-6 px-5 pb-6 pt-1 sm:px-7 sm:pb-8">
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
