import { describe, expect, it } from "vitest";

import {
  MAX_PRETEACH_WORDS,
  MIN_PRETEACH_WORDS,
} from "@/lib/story/constants";
import type { WordEvidence } from "@/lib/story/knowledge";
import {
  lexicalImportance,
  preparationMinutes,
  preteachContext,
  preteachTargetCount,
  rankPreteachWords,
  selectPreteachWords,
  type PreteachCandidate,
} from "@/lib/story/preparation";

function candidate(overrides: Partial<PreteachCandidate> = {}): PreteachCandidate {
  return {
    wordId: 1,
    lemma: "ziehen",
    display: "ziehen",
    translationPl: "ciągnąć",
    cefr: "B1",
    occurrenceCount: 1,
    firstParagraphPosition: 0,
    firstSentencePosition: 0,
    ...overrides,
  };
}

function knowledge(entries: readonly WordEvidence[]): Map<number, WordEvidence> {
  return new Map(entries.map((entry) => [entry.wordId, entry]));
}

describe("preteachTargetCount", () => {
  it("scales with chapter length rather than being a hard-coded five", () => {
    const short = preteachTargetCount({
      chapterWordCount: 600,
      difficulty: "just_right",
      dailyMinutes: 30,
    });
    const long = preteachTargetCount({
      chapterWordCount: 4000,
      difficulty: "just_right",
      dailyMinutes: 30,
    });
    expect(long).toBeGreaterThan(short);
  });

  it("stays inside the configured range whatever the inputs", () => {
    const tiny = preteachTargetCount({
      chapterWordCount: 10,
      difficulty: "easy",
      dailyMinutes: 5,
    });
    const huge = preteachTargetCount({
      chapterWordCount: 100000,
      difficulty: "very_challenging",
      dailyMinutes: 60,
    });
    expect(tiny).toBe(MIN_PRETEACH_WORDS);
    expect(huge).toBe(MAX_PRETEACH_WORDS);
  });

  it("asks for more on a hard chapter and less on an easy one", () => {
    const base = {
      chapterWordCount: 3000,
      dailyMinutes: 30,
    } as const;
    expect(
      preteachTargetCount({ ...base, difficulty: "very_challenging" }),
    ).toBeGreaterThan(preteachTargetCount({ ...base, difficulty: "easy" }));
  });

  it("never eats a small daily budget", () => {
    expect(
      preteachTargetCount({
        chapterWordCount: 5000,
        difficulty: "very_challenging",
        dailyMinutes: 5,
      }),
    ).toBeLessThanOrEqual(MIN_PRETEACH_WORDS + 1);
  });
});

describe("preparationMinutes", () => {
  it("never advertises less than a minute", () => {
    expect(preparationMinutes(1)).toBeGreaterThanOrEqual(1);
  });
});

describe("lexicalImportance", () => {
  it("ranks an early recurring word above a late one-off", () => {
    const early = lexicalImportance(
      candidate({ firstParagraphPosition: 1, occurrenceCount: 6 }),
      100,
    );
    const late = lexicalImportance(
      candidate({ firstParagraphPosition: 95, occurrenceCount: 1 }),
      100,
    );
    expect(early).toBeGreaterThan(late);
  });
});

describe("rankPreteachWords", () => {
  it("drops words the learner already knows", () => {
    const ranked = rankPreteachWords({
      candidates: [
        candidate({ wordId: 1, lemma: "Haus" }),
        candidate({ wordId: 2, lemma: "Schwert" }),
      ],
      knowledge: knowledge([{ wordId: 1, score: 0.92, confidence: 0.7 }]),
      chapterParagraphCount: 40,
    });
    expect(ranked.map((word) => word.wordId)).toEqual([2]);
  });

  it("keeps words the model has never observed — that is what preparation is for", () => {
    const ranked = rankPreteachWords({
      candidates: [candidate({ wordId: 7 })],
      knowledge: knowledge([]),
      chapterParagraphCount: 40,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].signals.unknownProbability).toBeGreaterThan(0.5);
  });

  it("ranks a repeated, important unknown word above a rare one", () => {
    const ranked = rankPreteachWords({
      candidates: [
        candidate({ wordId: 1, occurrenceCount: 1, firstParagraphPosition: 38 }),
        candidate({ wordId: 2, occurrenceCount: 9, firstParagraphPosition: 1 }),
      ],
      knowledge: knowledge([]),
      chapterParagraphCount: 40,
    });
    expect(ranked[0].wordId).toBe(2);
  });

  it("refuses a word with nothing to teach", () => {
    const ranked = rankPreteachWords({
      candidates: [candidate({ wordId: 5, translationPl: null })],
      knowledge: knowledge([]),
      chapterParagraphCount: 10,
    });
    expect(ranked).toHaveLength(0);
  });

  it("is deterministic for the same inputs", () => {
    const input = {
      candidates: [
        candidate({ wordId: 3, occurrenceCount: 2 }),
        candidate({ wordId: 4, occurrenceCount: 2 }),
      ],
      knowledge: knowledge([]),
      chapterParagraphCount: 20,
    };
    expect(rankPreteachWords(input).map((w) => w.wordId)).toEqual(
      rankPreteachWords(input).map((w) => w.wordId),
    );
  });

  it("lifts a word sitting on a concept the learner is failing", () => {
    const base = candidate({ wordId: 1, conceptCodes: ["word_gender"] });
    const without = rankPreteachWords({
      candidates: [base],
      knowledge: knowledge([]),
      chapterParagraphCount: 20,
    })[0];
    const with_ = rankPreteachWords({
      candidates: [base],
      knowledge: knowledge([]),
      chapterParagraphCount: 20,
      weakConcepts: new Set(["word_gender"]),
    })[0];
    expect(with_.score).toBeGreaterThan(without.score);
  });
});

describe("selectPreteachWords", () => {
  it("returns no duplicates and respects the count", () => {
    const ranked = rankPreteachWords({
      candidates: [
        candidate({ wordId: 1 }),
        candidate({ wordId: 1 }),
        candidate({ wordId: 2 }),
        candidate({ wordId: 3 }),
      ],
      knowledge: knowledge([]),
      chapterParagraphCount: 20,
    });
    const chosen = selectPreteachWords(ranked, 2);
    expect(chosen).toHaveLength(2);
    expect(new Set(chosen.map((word) => word.wordId)).size).toBe(2);
  });
});

describe("preteachContext", () => {
  it("quotes the chapter only from the part about to be read", () => {
    const opening = preteachContext(
      candidate({
        firstParagraphPosition: 1,
        contextSentence: "Er zog sein Schwert.",
        dictionaryExample: "Sie zieht den Wagen.",
      }),
      100,
    );
    expect(opening).toEqual({
      sentence: "Er zog sein Schwert.",
      source: "chapter_opening",
    });
  });

  it("falls back to a neutral example rather than spoiling the middle", () => {
    const later = preteachContext(
      candidate({
        firstParagraphPosition: 70,
        contextSentence: "Anna erfuhr, dass ihr Bruder noch lebte.",
        dictionaryExample: "Sie zieht den Wagen.",
      }),
      100,
    );
    expect(later.source).toBe("dictionary");
    expect(later.sentence).toBe("Sie zieht den Wagen.");
  });

  it("shows nothing rather than a random line from the chapter", () => {
    const none = preteachContext(
      candidate({
        firstParagraphPosition: 70,
        contextSentence: "Anna erfuhr alles.",
        dictionaryExample: null,
      }),
      100,
    );
    expect(none).toEqual({ sentence: null, source: "none" });
  });
});
