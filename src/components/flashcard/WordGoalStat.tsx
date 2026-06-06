"use client";

import { Target } from "lucide-react";

import { useWordGoal } from "@/hooks/useWordGoal";

/** Small stat tile showing today's word-review progress vs daily goal. */
export function WordGoalStat() {
  const { data } = useWordGoal();

  const reviewedToday = data?.reviewedToday ?? 0;
  const goal = data?.goal ?? 20;

  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-[#2d3748] p-4 text-center">
      <Target className="size-5 text-[#4299e1]" />
      <p className="text-2xl font-bold text-[#e2e8f0]">
        {reviewedToday}/{goal}
      </p>
      <p className="text-xs text-muted2">Cel dzienny</p>
    </div>
  );
}
