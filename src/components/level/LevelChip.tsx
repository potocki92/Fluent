"use client";

import Link from "next/link";

import { useLevelEstimate } from "@/hooks/useLevelEstimate";
import { cn } from "@/lib/utils";

/**
 * The level, in the smallest honest form: „A1+" in a pill.
 *
 * WHY NOT THE RING. The header used to carry a 52px `LevelRing` — a progress arc
 * whose numbers nobody can read at that size, sitting where the primary
 * navigation should be. A CEFR band is a label, not a dashboard, so the header
 * shows the label and the arc lives where there is room to explain it: the
 * „Twój poziom" card on Today and the ring on /stats.
 *
 * The dot is the only ornament, and it carries the one thing the pill cannot:
 * that the estimate is live. It links to /stats because "A1+" invites exactly
 * one question — "na jakiej podstawie?" — and that page answers it.
 */
export function LevelChip({ className }: { className?: string }) {
  const { cefr, next, percent } = useLevelEstimate();

  const detail = next
    ? `Twój poziom: ${cefr}. Do poziomu ${next}: ${percent}%.`
    : `Twój poziom: ${cefr} — najwyższy poziom.`;

  return (
    <Link
      href="/stats"
      title={detail}
      aria-label={`${detail} Zobacz postęp.`}
      className={cn(
        "relative flex h-9 items-center gap-1.5 rounded-full border border-border/70 px-3",
        "text-sm font-semibold text-gold transition-colors",
        "hover:border-gold/40 hover:bg-gold/10",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {cefr}
      <span className="size-1.5 rounded-full bg-green" aria-hidden />
    </Link>
  );
}
