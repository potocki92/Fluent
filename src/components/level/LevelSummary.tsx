"use client";

import { useEffect, useRef } from "react";

import { useAbility } from "@/hooks/useAbility";
import { useProfile } from "@/hooks/useProfile";
import { LevelRing } from "@/components/level/LevelRing";
import { abilityToCefr } from "@/lib/cefr";
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
 * The single, self-sourcing level badge: ring + (for `lg`) the Polish
 * poziom/Elo/odpowiedzi panel. It reads ability/answered from the live
 * `useAbility` store (hydrated here via {@link useProfile}) rather than from
 * page props, so every place that renders it — header, learn, stats — shows the
 * same source of truth and stays in sync as the ability changes.
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
  initial?: { ability: number; rd: number; answered: number };
  className?: string;
}) {
  useProfile();
  const storeAbility = useAbility((s) => s.ability);
  const storeAnswered = useAbility((s) => s.answered);
  const cefrEstimate = useAbility((s) => s.cefrEstimate);
  const setAbility = useAbility((s) => s.setAbility);

  // Seed the store once from the server snapshot so every consumer converges
  // immediately on the server-rendered stats page.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!initial || seededRef.current) return;
    setAbility(initial);
    seededRef.current = true;
  }, [initial, setAbility]);

  // `cefrEstimate` is null only at the store defaults; any hydration (useProfile,
  // the seed above, or a finished test) sets it. Until the store carries real
  // data, fall back to the server `initial` so the server HTML and first client
  // paint agree — no hydration mismatch and no flash of the A1/1000 defaults.
  const hydrated = cefrEstimate !== null;
  const ability = hydrated ? storeAbility : initial?.ability ?? storeAbility;
  const answered = hydrated ? storeAnswered : initial?.answered ?? storeAnswered;

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

  const cefr = abilityToCefr(ability);
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
