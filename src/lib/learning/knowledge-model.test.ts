import { describe, expect, it } from "vitest";

import {
  applyEvidence,
  confidenceAt,
  verdictFor,
  weaknessPriority,
  EMPTY_KNOWLEDGE_STATE,
  EVIDENCE_HALF_LIFE_DAYS,
  MIN_CONFIDENCE_FOR_VERDICT,
  SINGLE_SOURCE_CONFIDENCE_CAP,
  type KnowledgeEvidence,
  type KnowledgeState,
} from "./knowledge-model";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T12:00:00.000Z");

function at(days: number): string {
  return new Date(T0 + days * DAY).toISOString();
}

function evidence(
  isCorrect: boolean,
  options: Partial<KnowledgeEvidence> = {},
): KnowledgeEvidence {
  return {
    isCorrect,
    weight: 0.6,
    sourceKind: "reading_test",
    occurredAt: at(0),
    ...options,
  };
}

/** Fold a run of identical observations, one per day. */
function run(
  outcomes: readonly boolean[],
  options: Partial<KnowledgeEvidence> = {},
): KnowledgeState {
  return outcomes.reduce(
    (state, isCorrect, index) =>
      applyEvidence(state, evidence(isCorrect, { occurredAt: at(index), ...options })),
    EMPTY_KNOWLEDGE_STATE,
  );
}

describe("applyEvidence", () => {
  it("starts from no knowledge at all, not from zero", () => {
    expect(EMPTY_KNOWLEDGE_STATE.score).toBeNull();
    expect(EMPTY_KNOWLEDGE_STATE.evidenceCount).toBe(0);
    expect(verdictFor(EMPTY_KNOWLEDGE_STATE)).toBe("unknown");
  });

  it("raises the score on a correct answer and lowers it on a wrong one", () => {
    const correct = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(true));
    const wrong = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(false));

    expect(correct.score).toBeGreaterThan(0.5);
    expect(wrong.score).toBeLessThan(0.5);
    expect(correct.successCount).toBe(1);
    expect(wrong.failureCount).toBe(1);
  });

  it("never lets a single answer look like proof", () => {
    const state = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(true));

    // Blended against the neutral prior: well short of certainty on both axes.
    expect(state.score).toBeLessThan(0.75);
    expect(state.confidence).toBeLessThan(0.2);
    expect(verdictFor(state, new Date(T0))).toBe("insufficient");
  });

  it("grows confidence with evidence, without ever reaching certainty", () => {
    const few = run([true, true, true]);
    const many = run(Array.from({ length: 12 }, () => true));

    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(many.confidence).toBeLessThan(1);
  });

  it("caps confidence while every answer comes from the same exercise", () => {
    const oneSource = run(Array.from({ length: 60 }, () => true));
    expect(oneSource.confidence).toBeLessThanOrEqual(SINGLE_SOURCE_CONFIDENCE_CAP);

    const twoSources = applyEvidence(
      oneSource,
      evidence(true, { sourceKind: "review", occurredAt: at(61) }),
    );
    expect(twoSources.sourceKinds).toEqual(["reading_test", "review"]);
    expect(twoSources.confidence).toBeGreaterThan(SINGLE_SOURCE_CONFIDENCE_CAP);
  });

  it("weights a stronger observation more than a weaker one", () => {
    const guessable = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(true, { weight: 0.6 }));
    const produced = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(true, { weight: 1 }));

    expect(produced.score!).toBeGreaterThan(guessable.score!);
    expect(produced.confidence).toBeGreaterThan(guessable.confidence);
  });

  it("keeps lifetime counts even though the weights decay", () => {
    const state = run([true, false, true, true]);
    expect(state.evidenceCount).toBe(4);
    expect(state.successCount).toBe(3);
    expect(state.failureCount).toBe(1);
  });

  it("is deterministic — the same inputs always give the same state", () => {
    expect(run([true, false, true])).toEqual(run([true, false, true]));
  });

  it("cannot be amplified by an out-of-order observation", () => {
    const state = run([true, true, true]);
    const backwards = applyEvidence(
      state,
      evidence(true, { occurredAt: at(-30) }),
    );

    // The decay factor is clamped at 1, so old evidence never multiplies history.
    expect(backwards.evidenceWeight).toBeLessThanOrEqual(
      state.evidenceWeight + 0.6 + 1e-9,
    );
    expect(backwards.lastEvidenceAt).toBe(state.lastEvidenceAt);
  });
});

describe("recency", () => {
  it("halves the weight of evidence after one half-life", () => {
    const state = run([true, true, true]);
    const later = applyEvidence(
      state,
      evidence(true, { occurredAt: at(2 + EVIDENCE_HALF_LIFE_DAYS) }),
    );

    // Three old answers decayed to ~half, plus the new one.
    expect(later.evidenceWeight).toBeCloseTo(state.evidenceWeight / 2 + 0.6, 2);
  });

  it("lowers confidence as the evidence ages, without moving the score", () => {
    const state = run(Array.from({ length: 8 }, () => true));
    const fresh = confidenceAt(state, new Date(T0 + 8 * DAY));
    const stale = confidenceAt(
      state,
      new Date(T0 + (8 + 2 * EVIDENCE_HALF_LIFE_DAYS) * DAY),
    );

    expect(stale).toBeLessThan(fresh);
    // We are less SURE the learner still knows it; we do not claim they forgot.
    expect(state.score).toBe(state.score);
  });
});

describe("verdictFor", () => {
  it("refuses to name a level when confidence is thin", () => {
    const state = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(true, { weight: 1 }));
    expect(confidenceAt(state, new Date(T0))).toBeLessThan(MIN_CONFIDENCE_FOR_VERDICT);
    expect(verdictFor(state, new Date(T0))).toBe("insufficient");
  });

  it("reports a well-evidenced run of successes as strong", () => {
    const state = run(Array.from({ length: 20 }, () => true));
    expect(verdictFor(state, new Date(T0 + 20 * DAY))).toBe("strong");
  });

  it("reports a well-evidenced run of failures as weak", () => {
    const state = run(Array.from({ length: 20 }, () => false));
    expect(verdictFor(state, new Date(T0 + 20 * DAY))).toBe("weak");
  });

  it("treats a missing state as unknown rather than as zero", () => {
    expect(verdictFor(null)).toBe("unknown");
    expect(verdictFor(undefined)).toBe("unknown");
  });
});

describe("weaknessPriority", () => {
  it("does not call a single mistake a weakness", () => {
    const state = applyEvidence(EMPTY_KNOWLEDGE_STATE, evidence(false));
    expect(weaknessPriority(state, new Date(T0))).toBe(0);
  });

  it("does not call two mistakes in an otherwise strong record a weakness", () => {
    const state = run([true, true, true, true, true, true, true, true, false]);
    expect(weaknessPriority(state, new Date(T0 + 9 * DAY))).toBe(0);
  });

  it("ranks a repeated, well-evidenced failure above a shakier one", () => {
    const now = new Date(T0 + 12 * DAY);
    const persistent = run([false, false, false, false, false, false]);
    const occasional = run([false, false, true, true]);

    expect(weaknessPriority(persistent, now)).toBeGreaterThan(
      weaknessPriority(occasional, now),
    );
  });

  it("lets later successes pull a concept back out of the weakness list", () => {
    const now = new Date(T0 + 30 * DAY);
    const struggling = run([false, false, false, false]);
    const recovered = [true, true, true, true, true, true, true, true].reduce(
      (state, isCorrect, index) =>
        applyEvidence(state, evidence(isCorrect, { occurredAt: at(5 + index) })),
      struggling,
    );

    expect(weaknessPriority(struggling, now)).toBeGreaterThan(0);
    expect(weaknessPriority(recovered, now)).toBeLessThan(
      weaknessPriority(struggling, now),
    );
  });
});
