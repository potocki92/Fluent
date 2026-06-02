"use client";

import { motion } from "framer-motion";

import { abilityToCefr, progressPct, CEFR_HEX } from "@/lib/cefr";
import { confidenceLevel } from "@/lib/elo";
import { cn } from "@/lib/utils";

const R = 40;
const STROKE = 8;
const CIRCUMFERENCE = 251.2; // 2 * Math.PI * 40, rounded as per spec
const VIEWBOX = 100; // 2 * (R + STROKE/2) leaves a little padding

const SIZE_PX: Record<"sm" | "lg", number> = { sm: 48, lg: 120 };

/**
 * Circular progress ring showing the learner's CEFR level and progress towards
 * the next band. The arc is coloured by the current CEFR estimate and animates
 * whenever the ability changes.
 */
export function LevelRing({
  ability,
  answered,
  size = "lg",
  className,
}: {
  ability: number;
  answered: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const level = abilityToCefr(ability);
  const pct = progressPct(ability);
  const offset = CIRCUMFERENCE - (pct * CIRCUMFERENCE) / 100;
  const px = SIZE_PX[size];

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div className="relative" style={{ width: px, height: px }}>
        <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="size-full -rotate-90">
          <circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={R}
            fill="none"
            stroke="#374151"
            strokeWidth={STROKE}
          />
          <motion.circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={R}
            fill="none"
            stroke={CEFR_HEX[level]}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            initial={{ strokeDashoffset: CIRCUMFERENCE }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {size === "lg" ? (
            <>
              <span className="text-2xl font-bold text-gold">{level}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted2">
                poziom
              </span>
            </>
          ) : (
            <span className="text-xs font-bold text-gold">{level}</span>
          )}
        </div>
      </div>

      {size === "lg" && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-muted2">Elo: {Math.round(ability)}</span>
          <ConfidenceBadge answered={answered} />
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ answered }: { answered: number }) {
  const level = confidenceLevel(answered);

  if (level === "calibrating") {
    return (
      <span className="rounded-full bg-yellow-900/40 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
        ⟳ Kalibracja
      </span>
    );
  }

  // Stronger background as confidence rises.
  const tone = {
    low: "bg-green-900/30 text-green-300",
    medium: "bg-green-900/50 text-green-300",
    high: "bg-green-900/70 text-green-200",
  }[level];

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      ● {answered} odpowiedzi
    </span>
  );
}
