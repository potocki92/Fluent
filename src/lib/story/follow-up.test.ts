import { describe, expect, it } from "vitest";

import { MAX_FOLLOW_UP_WORDS } from "@/lib/story/constants";
import {
  buildFollowUp,
  challengeFeedback,
  rankFollowUpConcepts,
  rankFollowUpWords,
  type WordChapterOutcome,
} from "@/lib/story/follow-up";

function outcome(overrides: Partial<WordChapterOutcome> = {}): WordChapterOutcome {
  return {
    wordId: 1,
    lemma: "ziehen",
    lookupCount: 0,
    wasPreTaught: false,
    assessmentCorrect: null,
    alreadySaved: false,
    ...overrides,
  };
}

describe("rankFollowUpWords", () => {
  it("ignores a single incidental lookup", () => {
    expect(rankFollowUpWords({ outcomes: [outcome({ lookupCount: 1 })] })).toHaveLength(0);
  });

  it("picks up a word looked up repeatedly", () => {
    const ranked = rankFollowUpWords({ outcomes: [outcome({ lookupCount: 3 })] });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].signals.repeatedLookup).toBeGreaterThan(0);
  });

  it("ranks a missed Challenge word above a repeatedly looked-up one", () => {
    const ranked = rankFollowUpWords({
      outcomes: [
        outcome({ wordId: 1, lookupCount: 4 }),
        outcome({ wordId: 2, assessmentCorrect: false }),
      ],
    });
    expect(ranked[0].wordId).toBe(2);
  });

  it("flags a pre-taught word that did not stick", () => {
    const ranked = rankFollowUpWords({
      outcomes: [outcome({ wasPreTaught: true, assessmentCorrect: false })],
    });
    expect(ranked[0].signals.preteachNotRetained).toBe(1);
  });

  it("leaves alone a word the learner already saved", () => {
    expect(
      rankFollowUpWords({
        outcomes: [outcome({ lookupCount: 5, alreadySaved: true })],
      }),
    ).toHaveLength(0);
  });

  it("does not turn eighteen lookups into eighteen targets", () => {
    const outcomes = Array.from({ length: 18 }, (_, index) =>
      outcome({ wordId: index + 1, lookupCount: 3 }),
    );
    expect(buildFollowUp({ outcomes }).words.length).toBeLessThanOrEqual(
      MAX_FOLLOW_UP_WORDS,
    );
  });
});

describe("rankFollowUpConcepts", () => {
  it("keeps only concepts that actually failed", () => {
    const ranked = rankFollowUpConcepts([
      { conceptCode: "case_dative", failureCount: 2, askedCount: 2 },
      { conceptCode: "word_order", failureCount: 0, askedCount: 3 },
    ]);
    expect(ranked.map((c) => c.conceptCode)).toEqual(["case_dative"]);
  });
});

describe("buildFollowUp", () => {
  it("is empty for a learner who had no trouble", () => {
    expect(
      buildFollowUp({
        outcomes: [outcome({ assessmentCorrect: true })],
        conceptOutcomes: [{ conceptCode: "detail", failureCount: 0, askedCount: 2 }],
      }),
    ).toEqual({ words: [], concepts: [] });
  });
});

describe("challengeFeedback", () => {
  it("says what the data shows", () => {
    const feedback = challengeFeedback({
      comprehensionCorrect: 4,
      comprehensionTotal: 4,
      vocabularyCorrect: 1,
      vocabularyTotal: 3,
      followUp: { words: [], concepts: [] },
    });
    expect(feedback.headlinePl).toBe("Rozdział zaliczony");
    expect(feedback.detailPl).toContain("słownictwo");
  });

  it("refuses to invent a pattern from one answer", () => {
    const feedback = challengeFeedback({
      comprehensionCorrect: 1,
      comprehensionTotal: 1,
      vocabularyCorrect: 1,
      vocabularyTotal: 1,
      followUp: { words: [], concepts: [] },
    });
    expect(feedback.detailPl).toBe("Za mało danych, żeby wskazać wyraźny wzorzec.");
  });
});
