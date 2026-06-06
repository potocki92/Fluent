"use client";

import { motion } from "framer-motion";

import { useWordGoal } from "@/hooks/useWordGoal";

// Matches the geometry of LevelRing so visual sizing stays consistent.
const R = 40;
const STROKE = 8;
const CIRCUMFERENCE = 2 * Math.PI * R; // ~251.3

export function DailyGoalRing() {
  const { data, isLoading } = useWordGoal();

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-[#2d3748] p-3">
        <div className="size-12 animate-pulse rounded-full bg-[#374151]" />
        <div className="space-y-1.5">
          <div className="h-3 w-24 animate-pulse rounded bg-[#374151]" />
          <div className="h-3 w-16 animate-pulse rounded bg-[#374151]" />
        </div>
      </div>
    );
  }

  const { goal, reviewedToday, wordStreak, progressPct } = data;
  const offset = CIRCUMFERENCE * (1 - progressPct / 100);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-[#2d3748] p-3">
      {/* Progress ring */}
      <div className="relative shrink-0" style={{ width: 48, height: 48 }}>
        <svg
          width={48}
          height={48}
          viewBox="0 0 100 100"
          className="-rotate-90"
          aria-hidden
        >
          {/* Track */}
          <circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke="#374151"
            strokeWidth={STROKE}
          />
          {/* Progress */}
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
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#d4a574]">
          {progressPct}%
        </span>
      </div>

      {/* Text info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#e2e8f0]">
          {reviewedToday} / {goal} powtórek
        </p>
        <p className="text-xs text-muted2">
          🔥 Passa słówkowa: {wordStreak} {wordStreak === 1 ? "dzień" : "dni"}
        </p>
      </div>
    </div>
  );
}
