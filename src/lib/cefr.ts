import type { CefrLevel } from "@/types";

/**
 * Mapping between a learner's Elo ability (theta, centred on 1200) and a CEFR
 * band. Bands are inclusive of their lower bound and exclusive of the next.
 */
export const CEFR_BANDS: { level: CefrLevel; min: number }[] = [
  { level: "B2", min: 1600 },
  { level: "B1", min: 1450 },
  { level: "A2", min: 1300 },
  { level: "A1+", min: 1150 },
  { level: "A1", min: -Infinity },
];

/** All CEFR levels in ascending order. */
export const CEFR_ORDER: CefrLevel[] = ["A1", "A1+", "A2", "B1", "B2"];

/** Approximate Elo difficulty assigned to texts/questions of each stored level. */
export const CEFR_DIFFICULTY: Record<"A1" | "A2" | "B1" | "B2", number> = {
  A1: 1100,
  A2: 1300,
  B1: 1500,
  B2: 1700,
};

/** Convert an Elo ability score into the matching CEFR level. */
export function abilityToCefr(ability: number): CefrLevel {
  for (const band of CEFR_BANDS) {
    if (ability >= band.min) return band.level;
  }
  return "A1";
}

/**
 * Progress (0–1) of an ability within its current CEFR band — useful for
 * rendering level rings/progress bars.
 */
export function bandProgress(ability: number): number {
  const idx = CEFR_BANDS.findIndex((b) => ability >= b.min);
  const current = CEFR_BANDS[idx];
  const upper = CEFR_BANDS[idx - 1];
  if (!upper) return 1; // top band
  const lower = current.min === -Infinity ? 1000 : current.min;
  return Math.min(1, Math.max(0, (ability - lower) / (upper.min - lower)));
}
