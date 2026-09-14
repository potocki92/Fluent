/**
 * The weakness engine — ranking what is worth practising.
 *
 * THIS IS A LAYER OVER `weaknessPriority`, NOT A SECOND COPY OF IT. The
 * knowledge model already decides whether a concept may be called a weakness at
 * all (at least three observations, at least two failures, enough confidence)
 * and produces `(1 − score) · confidence` as the base priority. Re-deriving any
 * of that here would give Fluent two answers to "how bad is this?" and guarantee
 * they drift. What this module adds is the two things the aggregate alone cannot
 * express:
 *
 *  - **Recency.** The state remembers failures forever. A Dativ problem from
 *    March that the learner has since fixed must fade out of today's plan on its
 *    own, without anyone marking it resolved.
 *  - **Something sayable.** `severityScore = 0.41` is not a thing to show a
 *    human. A label is.
 *
 * WHY NOT JUST SORT BY SCORE. Because the lowest score is usually the flimsiest
 * one. Consider:
 *
 *   | concept | score | confidence | evidence |
 *   | ------- | ----- | ---------- | -------- |
 *   | A       | 0.20  | 0.03       | 1        |
 *   | B       | 0.45  | 0.90       | 20       |
 *
 * Sorting by score puts A first, on the strength of a single answer that could
 * as easily have been a misclick. B is the real problem — twenty observations
 * agree on it. Confidence is already a multiplier in `weaknessPriority`, which
 * is exactly what makes B win; this module keeps that property and multiplies in
 * recency on top.
 *
 * NOT A CEFR MEASURE. Severity is an internal learning metric for choosing the
 * next exercise. It is not a grade, and it is never shown as a percentage.
 */

import { CONCEPT_CATALOG, type ConceptCategory, type ConceptCode } from "@/lib/learning/concepts";
import {
  MIN_WEAKNESS_RECENCY,
  WEAKNESS_RECENCY_HALF_LIFE_DAYS,
  WEAKNESS_SEVERITY_HIGH,
  WEAKNESS_SEVERITY_MEDIUM,
} from "@/lib/learning/planner/constants";
import { weaknessRecencySignal } from "@/lib/learning/planner/priority";
import type { SkillCode } from "@/lib/learning/skills";

export { MIN_WEAKNESS_RECENCY, WEAKNESS_RECENCY_HALF_LIFE_DAYS };

/** A concept the learner keeps getting wrong, with the evidence behind it. */
export interface ConceptWeakness {
  code: ConceptCode;
  labelPl: string;
  descriptionPl: string;
  category: ConceptCategory;
  skillCode: SkillCode;
  score: number;
  confidence: number;
  evidenceCount: number;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastEvidenceAt: string | null;
  /** 0–1 ranking key from the knowledge model; see `weaknessPriority`. */
  priority: number;
}

/** How much attention a weakness deserves. Internal, never a CEFR statement. */
export type WeaknessSeverity = "low" | "medium" | "high";

export interface RankedWeakness extends ConceptWeakness {
  /** `priority` aged by how long ago the last failure was, 0–1. */
  severityScore: number;
  /** The recency multiplier itself, kept so the ranking can be explained. */
  recency: number;
  severity: WeaknessSeverity;
}

/**
 * What a learner is told about a weakness.
 *
 * Deliberately not numbers. "Wymaga uwagi" is actionable; "confidence 0.812" is
 * a debugging artefact that happens to be on screen.
 */
export const WEAKNESS_SEVERITY_LABEL_PL: Readonly<Record<WeaknessSeverity, string>> = {
  high: "Wymaga uwagi",
  medium: "Ćwicz dalej",
  low: "Prawie stabilne",
};

/** Order weaknesses worst first, aging each by when it last actually failed. */
export function rankWeaknesses(
  weaknesses: readonly ConceptWeakness[],
  now: Date = new Date(),
): RankedWeakness[] {
  return weaknesses
    .map((weakness) => {
      const recency = weaknessRecencySignal(weakness.lastFailureAt, now);
      const severityScore = round(weakness.priority * recency);
      return {
        ...weakness,
        recency,
        severityScore,
        severity: severityFor(severityScore),
      };
    })
    .sort((a, b) => b.severityScore - a.severityScore);
}

export function severityFor(severityScore: number): WeaknessSeverity {
  if (severityScore >= WEAKNESS_SEVERITY_HIGH) return "high";
  if (severityScore >= WEAKNESS_SEVERITY_MEDIUM) return "medium";
  return "low";
}

/**
 * A concept the learner is reliably good at.
 *
 * The weakness engine should not only be able to say what is wrong. The same
 * aggregate that ranks failures can name the things that are working, and a
 * learner who is told only about their problems learns that opening the app
 * feels bad. Same confidence gate as everything else: being right twice is not
 * a strength.
 */
export interface ConceptStrength {
  code: ConceptCode;
  labelPl: string;
  category: ConceptCategory;
  score: number;
  confidence: number;
  evidenceCount: number;
}

/** Score at or above which a well-evidenced concept counts as a strength. */
export const STRENGTH_SCORE = 0.82;
/** …and the confidence it has to carry to be claimed. */
export const STRENGTH_CONFIDENCE = 0.45;

export interface ConceptStateSummary {
  code: ConceptCode;
  score: number | null;
  confidence: number;
  evidenceCount: number;
}

export function conceptStrengths(
  states: readonly ConceptStateSummary[],
  limit = 3,
): ConceptStrength[] {
  return states
    .filter(
      (state) =>
        state.score !== null &&
        state.score >= STRENGTH_SCORE &&
        state.confidence >= STRENGTH_CONFIDENCE,
    )
    .sort((a, b) => (b.score as number) * b.confidence - (a.score as number) * a.confidence)
    .slice(0, limit)
    .map((state) => ({
      code: state.code,
      labelPl: CONCEPT_CATALOG[state.code].labelPl,
      category: CONCEPT_CATALOG[state.code].category,
      score: state.score as number,
      confidence: state.confidence,
      evidenceCount: state.evidenceCount,
    }));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
