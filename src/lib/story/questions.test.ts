import { describe, expect, it } from "vitest";

import {
  foldTypedAnswer,
  matchesSequence,
  matchesTypedAnswer,
  questionFingerprint,
  validateQuestion,
  type GroundingContext,
  type QuestionCandidate,
  type ValidationErrorCode,
} from "@/lib/story/questions";

const GROUNDING: GroundingContext = {
  sentenceIds: new Set([10, 11, 12]),
  wordIds: new Set([100, 200]),
};

function mcq(overrides: Partial<QuestionCandidate> = {}): QuestionCandidate {
  return {
    kind: "comprehension",
    type: "multiple_choice",
    scope: "local",
    prompt: "Dlaczego Anna wróciła do domu?",
    options: ["Bo padał deszcz", "Bo zgubiła klucze", "Bo zapomniała listu"],
    correctIdx: 0,
    skillCode: "reading_comprehension",
    conceptCodes: ["detail"],
    sourceSentenceIds: [10],
    ...overrides,
  };
}

function codes(result: ReturnType<typeof validateQuestion>): ValidationErrorCode[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("validateQuestion — structure", () => {
  it("accepts a well-formed grounded question", () => {
    const result = validateQuestion(mcq(), GROUNDING);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.question.fingerprint).toHaveLength(8);
      expect(result.question.sourceSentenceIds).toEqual([10]);
    }
  });

  it("rejects a question with no prompt", () => {
    expect(codes(validateQuestion(mcq({ prompt: "   " }), GROUNDING))).toContain(
      "prompt_missing",
    );
  });

  it("rejects duplicate options — the two-correct-answers failure", () => {
    const result = validateQuestion(
      mcq({ options: ["Bo padał deszcz", "bo padał  deszcz", "Bo zgubiła klucze"] }),
      GROUNDING,
    );
    expect(codes(result)).toContain("duplicate_options");
  });

  it("rejects an answer key pointing outside the options", () => {
    expect(codes(validateQuestion(mcq({ correctIdx: 7 }), GROUNDING))).toContain(
      "correct_index_out_of_range",
    );
    expect(codes(validateQuestion(mcq({ correctIdx: null }), GROUNDING))).toContain(
      "correct_index_out_of_range",
    );
  });

  it("rejects too few options", () => {
    expect(
      codes(validateQuestion(mcq({ options: ["Tak"], correctIdx: 0 }), GROUNDING)),
    ).toContain("options_count");
  });

  it("rejects a question type it cannot grade", () => {
    expect(
      codes(validateQuestion(mcq({ type: "multi_select" }), GROUNDING)),
    ).toContain("ungradable_type");
  });

  it("rejects a cloze with no blank or no answer", () => {
    const noBlank = validateQuestion(
      mcq({
        type: "cloze",
        prompt: "Sie nahm die Jacke aus dem Schrank.",
        acceptedAnswers: ["zog"],
        options: null,
        correctIdx: null,
        kind: "transfer",
        skillCode: "grammar",
        conceptCodes: [],
        wordId: 100,
      }),
      GROUNDING,
    );
    expect(codes(noBlank)).toContain("cloze_no_blank");

    const noAnswer = validateQuestion(
      mcq({
        type: "cloze",
        prompt: "Sie ___ die Jacke aus dem Schrank.",
        acceptedAnswers: [],
        options: null,
        correctIdx: null,
        kind: "transfer",
        skillCode: "grammar",
        conceptCodes: [],
        wordId: 100,
      }),
      GROUNDING,
    );
    expect(codes(noAnswer)).toContain("cloze_no_answer");
  });

  it("rejects a sequence whose elements have no unique ordering", () => {
    const result = validateQuestion(
      mcq({
        type: "sequence",
        kind: "comprehension",
        skillCode: "reading_comprehension",
        conceptCodes: ["sequence"],
        options: null,
        correctIdx: null,
        sequenceItems: ["Anna wyszła", "Anna wyszła", "Anna wróciła"],
      }),
      GROUNDING,
    );
    expect(codes(result)).toContain("duplicate_sequence_items");
  });
});

describe("validateQuestion — grounding", () => {
  it("rejects a question citing a sentence from another chapter", () => {
    expect(
      codes(validateQuestion(mcq({ sourceSentenceIds: [10, 999] }), GROUNDING)),
    ).toContain("foreign_grounding");
  });

  it("rejects a comprehension question that cites nothing", () => {
    expect(
      codes(validateQuestion(mcq({ sourceSentenceIds: [] }), GROUNDING)),
    ).toContain("missing_grounding");
  });

  it("rejects a vocabulary question naming no word", () => {
    const result = validateQuestion(
      mcq({
        kind: "contextual_vocabulary",
        skillCode: "receptive_vocabulary",
        conceptCodes: ["lexical_recognition"],
        wordId: null,
      }),
      GROUNDING,
    );
    expect(codes(result)).toContain("vocabulary_word_missing");
  });

  it("rejects a question about a word the chapter does not contain", () => {
    const result = validateQuestion(
      mcq({
        kind: "contextual_vocabulary",
        skillCode: "receptive_vocabulary",
        conceptCodes: ["lexical_recognition"],
        wordId: 999,
      }),
      GROUNDING,
    );
    expect(codes(result)).toContain("foreign_word");
  });

  it("lets a transfer question stand on its word rather than a sentence", () => {
    const result = validateQuestion(
      mcq({
        kind: "transfer",
        type: "cloze",
        prompt: "Sie ___ die Jacke aus dem Schrank.",
        acceptedAnswers: ["zog", "zieht"],
        options: null,
        correctIdx: null,
        skillCode: "grammar",
        conceptCodes: ["past_tense"],
        wordId: 100,
        sourceSentenceIds: [],
      }),
      GROUNDING,
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateQuestion — evidence discipline", () => {
  it("refuses a comprehension question tagged as grammar", () => {
    expect(codes(validateQuestion(mcq({ skillCode: "grammar" }), GROUNDING))).toContain(
      "skill_kind_mismatch",
    );
  });

  it("refuses an unknown concept rather than storing it", () => {
    expect(
      codes(validateQuestion(mcq({ conceptCodes: ["vibes"] }), GROUNDING)),
    ).toContain("unknown_concept");
  });

  it("refuses an unknown skill", () => {
    expect(codes(validateQuestion(mcq({ skillCode: "telepathy" }), GROUNDING))).toContain(
      "unknown_skill",
    );
  });
});

describe("questionFingerprint", () => {
  it("is identical for the same question worded identically", () => {
    const a = validateQuestion(mcq(), GROUNDING);
    const b = validateQuestion(mcq({ sourceSentenceIds: [11] }), GROUNDING);
    expect(a.ok && b.ok && a.question.fingerprint === b.question.fingerprint).toBe(true);
  });

  it("differs when the answer differs", () => {
    const a = validateQuestion(mcq(), GROUNDING);
    const b = validateQuestion(mcq({ correctIdx: 1 }), GROUNDING);
    expect(a.ok && b.ok && a.question.fingerprint !== b.question.fingerprint).toBe(true);
  });

  it("ignores the order of accepted cloze answers", () => {
    const base = {
      kind: "transfer",
      type: "cloze",
      prompt: "Sie ___ die Jacke.",
      options: null,
      correctIdx: null,
      sequenceItems: null,
    } as const;
    expect(
      questionFingerprint({ ...base, acceptedAnswers: ["zog", "zieht"] }),
    ).toBe(questionFingerprint({ ...base, acceptedAnswers: ["zieht", "zog"] }));
  });
});

describe("matchesTypedAnswer", () => {
  it("forgives case, spacing and a leading article", () => {
    expect(matchesTypedAnswer("  das Schwert ", ["Schwert"])).toBe(true);
    expect(matchesTypedAnswer("schwert", ["das Schwert"])).toBe(true);
  });

  it("does not forgive a missing umlaut — that is a different word", () => {
    expect(matchesTypedAnswer("schon", ["schön"])).toBe(false);
  });

  it("refuses an empty answer", () => {
    expect(matchesTypedAnswer("   ", ["Schwert"])).toBe(false);
  });

  it("folds trailing punctuation", () => {
    expect(foldTypedAnswer("Schwert.")).toBe("schwert");
  });
});

describe("matchesSequence", () => {
  it("accepts only the stored order", () => {
    expect(matchesSequence([0, 1, 2], 3)).toBe(true);
    expect(matchesSequence([0, 2, 1], 3)).toBe(false);
    expect(matchesSequence([0, 1], 3)).toBe(false);
  });
});
