"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useLevelEstimate } from "@/hooks/useLevelEstimate";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * „Twój poziom" — the band, how far through it the learner is, and what comes
 * next.
 *
 * This is the level's real home. The header carries a chip because a header has
 * room for a label; a card has room for the sentence that makes the label mean
 * something ("Do poziomu A2 — 42%"), and it is the one place on Today where a
 * number about the learner rather than about today's tasks belongs.
 *
 * The whole card is one link to /stats, not a card with a button in it: there is
 * exactly one thing to do with it, and a 260px target beats a 24px chevron.
 */
export function LevelCard({ className }: { className?: string }) {
  const { cefr, next, percent } = useLevelEstimate();

  return (
    <Link
      href="/stats"
      aria-label={
        next
          ? `Twój poziom: ${cefr}. Do poziomu ${next} pozostało ${100 - percent}%. Zobacz postęp.`
          : `Twój poziom: ${cefr}, najwyższy poziom. Zobacz postęp.`
      }
      className={cn(
        "app-panel app-panel-link group block rounded-xl p-5",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted2">Twój poziom</p>
        <ChevronRight
          className="size-5 shrink-0 text-muted2 transition-colors group-hover:text-gold"
          aria-hidden
        />
      </div>

      <p className="mt-1 text-4xl font-bold leading-none text-gold">{cefr}</p>

      <Progress value={percent} className="mt-5 h-1.5 bg-secondary" aria-hidden />

      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted2">
          {next ? `Do poziomu ${next}` : "Najwyższy poziom"}
        </span>
        <span className="font-medium text-muted2">{percent}%</span>
      </div>
    </Link>
  );
}
