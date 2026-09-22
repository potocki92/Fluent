"use client";

import { motion } from "framer-motion";
import { Flame } from "lucide-react";

import { useWordGoal } from "@/hooks/useWordGoal";

// The same geometry as `LevelRing`, so every ring in Fluent reads as one family.
const R = 40;
const STROKE = 8;
const CIRCUMFERENCE = 2 * Math.PI * R; // ~251.3

/** The drawn diameter, in CSS pixels (§11: 54–64). */
const RING_PX = 56;

/**
 * The top of the review screen: what this is, how far today has got, and the
 * streak — in one 76px row.
 *
 * WHY THE TITLE LIVES INSIDE THE GOAL BLOCK. On a 393×852 phone with Safari's
 * toolbars up there are about 500 usable pixels between the header and the tab
 * bar, and the four rating buttons, the mastery bar and the card itself have a
 * prior claim on them (§10, §25). A page title, a subtitle and a separate goal
 * card are three stacked blocks that cost about 120px to say three short
 * things; beside a ring that was going to be 56px tall anyway, the same three
 * things cost 76px and read as one iOS-style screen header instead of as a web
 * page's masthead. Nothing was dropped to get there.
 *
 * ALWAYS THREE LINES, so the row's height never changes between states — a
 * header that grows by 16px when the streak arrives would re-lay out the card
 * below it after the data loads, which on this screen means the ratings move
 * under the learner's thumb. Collapsed to `leading-tight`, those three lines
 * measure 56px: exactly the ring beside them, so the block is 76px and not one
 * pixel of it is half-leading nobody asked for.
 */
export function ReviewHeader({
  title,
  note,
}: {
  title: string;
  /** Replaces the streak line when this session needs explaining instead. */
  note?: string;
}) {
  const { data, isLoading } = useWordGoal();

  if (isLoading || !data) {
    return (
      <header className="app-panel flex items-center gap-3 rounded-2xl p-2.5">
        <div
          className="shrink-0 animate-pulse rounded-full bg-secondary"
          style={{ width: RING_PX, height: RING_PX }}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-xl font-bold leading-tight">{title}</h1>
          <div className="h-3 w-28 animate-pulse rounded bg-secondary" />
          <div className="h-2.5 w-20 animate-pulse rounded bg-secondary" />
        </div>
      </header>
    );
  }

  const { goal, reviewedToday, wordStreak, progressPct } = data;
  const offset = CIRCUMFERENCE * (1 - progressPct / 100);

  return (
    <header className="app-panel flex items-center gap-3 rounded-2xl p-2.5">
      <div
        className="relative shrink-0"
        style={{ width: RING_PX, height: RING_PX }}
      >
        <svg
          width={RING_PX}
          height={RING_PX}
          viewBox="0 0 100 100"
          className="-rotate-90"
          aria-hidden
        >
          <circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke="#374151"
            strokeWidth={STROKE}
          />
          <motion.circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke="#d4a574"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            initial={{ strokeDashoffset: CIRCUMFERENCE }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gold">
          {progressPct}%
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold leading-tight">{title}</h1>
        {progressPct >= 100 ? (
          <p className="truncate text-[0.8125rem] font-semibold leading-tight text-green">
            Cel dzienny osiągnięty!
          </p>
        ) : (
          <p className="truncate text-[0.8125rem] font-semibold leading-tight text-main">
            {reviewedToday} / {goal} powtórek
          </p>
        )}
        {note ? (
          <p className="truncate pt-0.5 text-xs leading-tight text-muted2">
            {note}
          </p>
        ) : (
          <p className="flex items-center gap-1 truncate pt-0.5 text-xs leading-tight text-muted2">
            <Flame className="size-3 shrink-0 text-gold" aria-hidden />
            Passa słówkowa: {wordStreak} {wordStreak === 1 ? "dzień" : "dni"}
          </p>
        )}
      </div>
    </header>
  );
}
