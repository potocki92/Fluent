"use client";

import { motion } from "framer-motion";

import { CEFR_BANDS, CEFR_HEX, CEFR_ORDER, abilityToCefr } from "@/lib/cefr";
import { cn } from "@/lib/utils";

/** CEFR bands sorted ascending so they align with {@link CEFR_ORDER}. */
const ASC = [...CEFR_BANDS].sort((a, b) => a.min - b.min);

/** Human-readable Elo range for a band, e.g. "1300–1450" or "1600+". */
function rangeLabel(min: number, nextMin: number | undefined): string {
  if (min === -Infinity) return `< ${nextMin}`;
  if (nextMin === undefined) return `${min}+`;
  return `${min}–${nextMin}`;
}

/**
 * Horizontal A1 → A1+ → A2 → B1 → B2 milestone track. The dot for the learner's
 * current band is coloured and gently scaled up.
 */
export function CefrMilestones({ ability }: { ability: number }) {
  const current = abilityToCefr(ability);

  return (
    <div className="relative flex items-start justify-between">
      <div className="absolute inset-x-0 top-2 h-0.5 bg-[#374151]" />
      {CEFR_ORDER.map((level, i) => {
        const isCurrent = level === current;
        return (
          <div
            key={level}
            className="relative z-10 flex flex-1 flex-col items-center gap-1.5"
          >
            <motion.span
              className="size-4 rounded-full"
              style={{
                backgroundColor: isCurrent ? CEFR_HEX[level] : "#374151",
              }}
              initial={false}
              animate={{ scale: isCurrent ? 1.3 : 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 18 }}
            />
            <span
              className={cn(
                "text-xs font-semibold",
                isCurrent ? "text-gold" : "text-muted2",
              )}
            >
              {level}
            </span>
            <span className="text-[10px] text-muted2">
              {rangeLabel(ASC[i].min, ASC[i + 1]?.min)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
