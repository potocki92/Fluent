import { describe, expect, it } from "vitest";

import { chapterOutline, chunkSentences } from "@/lib/story/generation/chunking";
import {
  bankCoverage,
  isBankPublishable,
  runPipeline,
} from "@/lib/story/generation/pipeline";
import {
  checkProvider,
  type StoryQuestionProvider,
} from "@/lib/story/generation/provider";
import type { GroundingContext, QuestionCandidate } from "@/lib/story/questions";

const GROUNDING: GroundingContext = {
  sentenceIds: new Set([1, 2, 3, 4]),
  wordIds: new Set([10, 20]),
};

function candidate(overrides: Partial<QuestionCandidate> = {}): QuestionCandidate {
  return {
    kind: "comprehension",
    type: "multiple_choice",
    scope: "local",
    prompt: "Co zrobiła Anna?",
    options: ["Wyszła", "Została", "Zasnęła"],
    correctIdx: 0,
    skillCode: "reading_comprehension",
    conceptCodes: ["detail"],
    sourceSentenceIds: [1],
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("keeps the valid and reports the rest with reasons", () => {
    const result = runPipeline({
      candidates: [
        candidate(),
        candidate({ prompt: "Kto?", sourceSentenceIds: [99] }),
        candidate({ prompt: "Gdzie?", correctIdx: 9 }),
      ],
      grounding: GROUNDING,
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0].errors[0].code).toBe("foreign_grounding");
    expect(result.rejected[1].errors[0].code).toBe("correct_index_out_of_range");
  });

  it("does not store chapter text in a rejection", () => {
    const long = "x".repeat(500);
    const result = runPipeline({
      candidates: [candidate({ prompt: long })],
      grounding: GROUNDING,
    });
    expect(result.rejected[0].prompt.length).toBeLessThanOrEqual(120);
  });

  it("is idempotent — a re-run over the same chapter adds nothing", () => {
    const first = runPipeline({ candidates: [candidate()], grounding: GROUNDING });
    const second = runPipeline({
      candidates: [candidate()],
      grounding: GROUNDING,
      existingFingerprints: new Set(first.accepted.map((q) => q.fingerprint)),
    });
    expect(second.accepted).toHaveLength(0);
    expect(second.duplicates).toBe(1);
  });

  it("de-duplicates within one batch, as overlapping chunks produce", () => {
    const result = runPipeline({
      candidates: [candidate(), candidate({ sourceSentenceIds: [2] })],
      grounding: GROUNDING,
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it("respects the chapter ceiling", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      candidate({ prompt: `Pytanie ${i}?` }),
    );
    const result = runPipeline({
      candidates,
      grounding: GROUNDING,
      maxQuestions: 4,
      existingCount: 2,
    });
    expect(result.accepted).toHaveLength(2);
    expect(result.overflow).toBe(3);
  });
});

describe("bank publishability", () => {
  it("refuses a bank that could only ever produce a grammar test", () => {
    const { accepted } = runPipeline({
      candidates: Array.from({ length: 6 }, (_, i) =>
        candidate({
          prompt: `Uzupełnij zdanie ${i}: Er ___ das Buch.`,
          kind: "grammar",
          skillCode: "grammar",
          conceptCodes: ["past_tense"],
          type: "cloze",
          acceptedAnswers: ["las"],
          options: null,
          correctIdx: null,
        }),
      ),
      grounding: GROUNDING,
    });
    expect(accepted.length).toBe(6);
    expect(bankCoverage(accepted).comprehension).toBe(0);
    expect(isBankPublishable(accepted)).toBe(false);
  });

  it("accepts a balanced bank", () => {
    const { accepted } = runPipeline({
      candidates: [
        candidate({ prompt: "Co zrobiła Anna?" }),
        candidate({ prompt: "Dokąd poszła Anna?" }),
        candidate({
          prompt: "Co znaczy ziehen w tym zdaniu?",
          kind: "contextual_vocabulary",
          skillCode: "receptive_vocabulary",
          conceptCodes: ["lexical_recognition"],
          wordId: 10,
        }),
        candidate({
          prompt: "Co znaczy Schwert w tym zdaniu?",
          kind: "contextual_vocabulary",
          skillCode: "receptive_vocabulary",
          conceptCodes: ["lexical_recognition"],
          wordId: 20,
        }),
      ],
      grounding: GROUNDING,
    });
    expect(isBankPublishable(accepted)).toBe(true);
  });
});

describe("chunkSentences", () => {
  const sentences = Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    paragraphPosition: Math.floor(i / 5),
    text: `Satz ${i + 1}.`,
  }));

  it("never splits a sentence, and covers the whole chapter", () => {
    const chunks = chunkSentences(sentences, 60, 4);
    const covered = new Set(chunks.flatMap((c) => c.sentences.map((s) => s.id)));
    expect(covered.size).toBe(sentences.length);
    expect(chunks[0].isOpening).toBe(true);
    expect(chunks.at(-1)?.isClosing).toBe(true);
  });

  it("overlaps so a question across a boundary is still possible", () => {
    const chunks = chunkSentences(sentences, 60, 4);
    const first = new Set(chunks[0].sentences.map((s) => s.id));
    const shared = chunks[1].sentences.filter((s) => first.has(s.id));
    expect(shared.length).toBe(4);
  });

  it("is deterministic", () => {
    expect(chunkSentences(sentences)).toEqual(chunkSentences(sentences));
  });

  it("handles an empty chapter", () => {
    expect(chunkSentences([])).toEqual([]);
  });
});

describe("chapterOutline", () => {
  const sentences = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    paragraphPosition: i,
    text: `Satz ${i + 1}.`,
  }));

  it("samples the whole chapter, not just the opening", () => {
    const outline = chapterOutline(sentences, 20);
    expect(outline.length).toBeLessThanOrEqual(21);
    expect(outline.at(-1)?.id).toBe(300);
    expect(outline.some((s) => s.id > 100 && s.id < 200)).toBe(true);
  });

  it("returns a short chapter whole", () => {
    const short = sentences.slice(0, 10);
    expect(chapterOutline(short, 60)).toEqual(short);
  });
});

describe("checkProvider", () => {
  const base: StoryQuestionProvider = {
    capabilities: {
      name: "test",
      model: "test-1",
      supportsPrivateContent: false,
      supportsStructuredOutput: true,
    },
    generateChapterQuestions: async () => ({ candidates: [], usage: null }),
  };

  it("reports an unconfigured deployment rather than failing obscurely", () => {
    expect(checkProvider(null, { isPrivateContent: false })).toBe("not_configured");
  });

  it("refuses a provider that cannot be held to a schema", () => {
    expect(
      checkProvider(
        {
          ...base,
          capabilities: { ...base.capabilities, supportsStructuredOutput: false },
        },
        { isPrivateContent: false },
      ),
    ).toBe("structured_output_required");
  });

  it("fails closed on private content", () => {
    expect(checkProvider(base, { isPrivateContent: true })).toBe(
      "private_content_not_permitted",
    );
    expect(
      checkProvider(
        {
          ...base,
          capabilities: { ...base.capabilities, supportsPrivateContent: true },
        },
        { isPrivateContent: true },
      ),
    ).toBeNull();
  });
});
