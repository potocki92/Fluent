"use client";

import { useLevelEstimate, type LevelSeed } from "@/hooks/useLevelEstimate";
import { LevelRing } from "@/components/level/LevelRing";
import { confidenceLevel, type ConfidenceLevel } from "@/lib/elo";
import { cn } from "@/lib/utils";

/** Polish labels for the estimate-confidence levels. */
const CONFIDENCE_PL: Record<ConfidenceLevel, string> = {
  calibrating: "kalibracja",
  low: "niska",
  medium: "średnia",
  high: "wysoka",
};

/**
 * The full level badge: ring + the Polish poziom/Elo/odpowiedzi panel.
 *
 * It reads from {@link useLevelEstimate}, which is where the hydrate-seed-fall
 * back dance now lives — the header chip and the Today card read the same hook,
 * so every surface shows the same number and they all move together when the
 * ability changes.
 *
 * `initial` is an optional server snapshot. The stats page renders on the
 * server, so it passes the freshly-read profile to paint the correct value
 * immediately (no flash of the A1/1000 defaults) and seed the store on mount.
 */
export function LevelSummary({
  size = "lg",
  initial,
  className,
}: {
  size?: "sm" | "header" | "lg";
  initial?: LevelSeed;
  className?: string;
}) {
  const { ability, answered, cefr } = useLevelEstimate(initial);

  if (size !== "lg") {
    return (
      <LevelRing
        size={size}
        ability={ability}
        answered={answered}
        className={className}
      />
    );
  }

  const confidence = CONFIDENCE_PL[confidenceLevel(answered)];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <LevelRing size="lg" ability={ability} answered={answered} />
      <div className="space-y-1">
        <p className="text-lg font-bold">
          Twój poziom: <span className="text-gold">{cefr}</span>
        </p>
        <p className="text-sm text-muted2">
          Elo: {Math.round(ability)} · Pewność: {confidence}
        </p>
        <p className="text-xs text-muted2">Na podstawie {answered} odpowiedzi</p>
      </div>
    </div>
  );
}
