import { describe, expect, it } from "vitest";

import { applyEvidence, EMPTY_KNOWLEDGE_STATE, weaknessPriority } from "@/lib/learning/knowledge-model";
import {
  conceptStrengths,
  rankWeaknesses,
  severityFor,
  type ConceptWeakness,
} from "@/lib/learning/weakness";
import {
  WEAKNESS_SEVERITY_HIGH,
  WEAKNESS_SEVERITY_MEDIUM,
} from "@/lib/learning/planner/constants";

const NOW = new Date("2026-09-14T09:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function weakness(overrides: Partial<ConceptWeakness> = {}): ConceptWeakness {
  return {
    code: "case_dative",
    labelPl: "Celownik (Dativ)",
    descriptionPl: "",
    category: "grammar",
    skillCode: "grammar",
    score: 0.4,
    confidence: 0.8,
    evidenceCount: 10,
    failureCount: 6,
    successCount: 4,
    lastFailureAt: daysAgo(1),
    lastSuccessAt: daysAgo(2),
    lastEvidenceAt: daysAgo(1),
    priority: 0.48,
    ...overrides,
  };
}

describe("rankWeaknesses", () => {
  it("ranks a well-evidenced problem above a flimsier, lower-scoring one", () => {
    // Sorting by score alone would put the one-answer concept first. Twenty
    // observations agreeing is the stronger claim, and confidence is already a
    // multiplier inside `weaknessPriority`.
    const flimsy = weakness({
      code: "word_order",
      score: 0.2,
      confidence: 0.05,
      evidenceCount: 1,
      failureCount: 1,
      priority: 0.04,
    });
    const solid = weakness({
      code: "case_dative",
      score: 0.45,
      confidence: 0.9,
      evidenceCount: 20,
      failureCount: 11,
      priority: 0.495,
    });

    const ranked = rankWeaknesses([flimsy, solid], NOW);
    expect(ranked[0].code).toBe("case_dative");
  });

  it("pushes an old weakness below a current one of the same strength", () => {
    const stale = weakness({ code: "word_order", lastFailureAt: daysAgo(200) });
    const current = weakness({ code: "case_dative", lastFailureAt: daysAgo(1) });

    const ranked = rankWeaknesses([stale, current], NOW);
    expect(ranked[0].code).toBe("case_dative");
    expect(ranked[1].severityScore).toBeLessThan(ranked[0].severityScore);
  });

  it("keeps an old weakness in the list rather than erasing it", () => {
    const ranked = rankWeaknesses([weakness({ lastFailureAt: daysAgo(3650) })], NOW);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].severityScore).toBeGreaterThan(0);
  });

  it("exposes the recency multiplier so the ranking can be explained", () => {
    const ranked = rankWeaknesses([weakness({ lastFailureAt: daysAgo(0) })], NOW);
    expect(ranked[0].recency).toBe(1);
    expect(ranked[0].severityScore).toBeCloseTo(ranked[0].priority, 4);
  });
});

describe("severityFor", () => {
  it("labels the bands", () => {
    expect(severityFor(WEAKNESS_SEVERITY_HIGH)).toBe("high");
    expect(severityFor(WEAKNESS_SEVERITY_MEDIUM)).toBe("medium");
    expect(severityFor(0)).toBe("low");
  });
});

describe("the pattern rule, end to end", () => {
  /** Fold a run of answers through the real knowledge model. */
  function stateFrom(outcomes: boolean[], start = 0) {
    return outcomes.reduce(
      (state, isCorrect, index) =>
        applyEvidence(state, {
          isCorrect,
          weight: 0.6,
          sourceKind: "reading_test",
          occurredAt: daysAgo(start + outcomes.length - index),
        }),
      EMPTY_KNOWLEDGE_STATE,
    );
  }

  it("does not call a single mistake a weakness", () => {
    expect(weaknessPriority(stateFrom([false]), NOW)).toBe(0);
  });

  it("does not call two mistakes among plenty of successes a weakness", () => {
    const mostlyRight = stateFrom([true, true, true, true, true, true, true, true]);
    expect(weaknessPriority(mostlyRight, NOW)).toBe(0);
  });

  it("raises severity as failures repeat", () => {
    const few = stateFrom([false, false, true]);
    const many = stateFrom([false, false, false, false, false, true]);
    expect(weaknessPriority(many, NOW)).toBeGreaterThan(weaknessPriority(few, NOW));
  });

  it("lowers severity once the learner starts getting it right", () => {
    const struggling = stateFrom([false, false, false, false]);
    const recovering = stateFrom([
      false, false, false, false, true, true, true, true, true, true,
    ]);
    expect(weaknessPriority(recovering, NOW)).toBeLessThan(
      weaknessPriority(struggling, NOW),
    );
  });
});

describe("conceptStrengths", () => {
  it("names what is working, with the same confidence gate as everything else", () => {
    const strengths = conceptStrengths([
      { code: "article_gender", score: 0.91, confidence: 0.8, evidenceCount: 20 },
      // Right twice is not a strength.
      { code: "case_dative", score: 0.95, confidence: 0.1, evidenceCount: 2 },
      { code: "word_order", score: 0.5, confidence: 0.9, evidenceCount: 30 },
    ]);

    expect(strengths.map((entry) => entry.code)).toEqual(["article_gender"]);
    expect(strengths[0].labelPl).toBe("Rodzajnik określony");
  });

  it("returns nothing when nothing has been proven", () => {
    expect(conceptStrengths([{ code: "detail", score: null, confidence: 0, evidenceCount: 0 }])).toEqual([]);
  });
});
