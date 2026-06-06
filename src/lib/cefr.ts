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

/** Tailwind class pairs used to colour the CEFR badge per stored level. */
export const CEFR_COLORS: Record<"A1" | "A2" | "B1" | "B2", string> = {
  A1: "bg-green-900/40 text-green-300",
  A2: "bg-blue-900/40 text-blue-300",
  B1: "bg-yellow-900/40 text-yellow-300",
  B2: "bg-red-900/40 text-red-300",
};

/**
 * Hex stroke colour per CEFR level — used where a raw colour is needed (e.g. the
 * SVG progress arc in the level ring) rather than Tailwind classes. Covers the
 * derived `A1+` band too.
 */
export const CEFR_HEX: Record<CefrLevel, string> = {
  A1: "#48bb78",
  "A1+": "#48bb78",
  A2: "#4299e1",
  B1: "#d4a574",
  B2: "#f56565",
};

/**
 * How far above a learner's ability a text may sit and still be offered on the
 * learn page. Texts harder than `ability + LEVEL_HEADROOM` are hidden so the
 * list stays at-or-below the learner's level; easier texts always remain
 * visible. Roughly half a CEFR band, so e.g. an A1 text (1100) stays available
 * down to an ability of ~950.
 */
export const LEVEL_HEADROOM = 150;

/**
 * Whether a text of `difficulty` is too hard to show a learner of `ability` —
 * i.e. it sits more than {@link LEVEL_HEADROOM} above their current level.
 */
export function isTextTooHard(difficulty: number, ability: number): boolean {
  return difficulty > ability + LEVEL_HEADROOM;
}

/** Convert an Elo ability score into the matching CEFR level. */
export function abilityToCefr(ability: number): CefrLevel {
  for (const band of CEFR_BANDS) {
    if (ability >= band.min) return band.level;
  }
  return "A1";
}

/** Consecutive strong passes required to actually cross into a higher band. */
export const PROMOTION_STREAK = 3;
/** Fraction correct at/above which a passing test counts toward a promotion. */
export const PROMOTION_RATIO = 0.75;

/**
 * The minimum Elo of the band just above the one `ability` currently sits in,
 * or `Infinity` when the learner is already in the top band.
 */
function nextBandMin(ability: number): number {
  const current = abilityToCefr(ability);
  const next = CEFR_ORDER[CEFR_ORDER.indexOf(current) + 1];
  if (!next) return Infinity;
  const band = CEFR_BANDS.find((b) => b.level === next);
  return band ? band.min : Infinity;
}

/**
 * ReadTheory-style promotion gate. Ability moves freely *within* its current
 * CEFR band, but crossing into a higher band requires {@link PROMOTION_STREAK}
 * consecutive strong passes (≥ {@link PROMOTION_RATIO}). Until the streak is
 * earned the ability is held just below the band ceiling, so a single lucky test
 * never bumps the displayed level — the learner keeps practising at their level
 * (texts are picked from `ability`) until they prove sustained mastery.
 *
 * @param beforeAbility ability before the test (decides the current band)
 * @param proposedAbility ability the test would produce
 * @param passed whether the test met the pass line
 * @param ratio fraction correct (0–1)
 * @param streak the learner's current promotion streak
 * @returns the gated ability and the updated streak to persist
 */
export function gatePromotion(
  beforeAbility: number,
  proposedAbility: number,
  passed: boolean,
  ratio: number,
  streak: number,
): { ability: number; streak: number } {
  const ceiling = nextBandMin(beforeAbility);
  // Not crossing the band: let it move freely and clear any pending streak.
  if (proposedAbility < ceiling) return { ability: proposedAbility, streak: 0 };

  const qualifies = passed && ratio >= PROMOTION_RATIO;
  const nextStreak = qualifies ? streak + 1 : 0;
  // Streak earned: release the ceiling and let the band crossing stick.
  if (nextStreak >= PROMOTION_STREAK) return { ability: proposedAbility, streak: 0 };
  // Otherwise hold just below the next band while the streak builds.
  return { ability: Math.min(proposedAbility, ceiling - 1), streak: nextStreak };
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

/**
 * Progress within the current CEFR band as a whole percentage (0–100) — a thin
 * wrapper over {@link bandProgress} for rendering the level-ring arc.
 */
export function progressPct(ability: number): number {
  return Math.round(bandProgress(ability) * 100);
}
