import { describe, expect, it } from "vitest";

import { CLOZE_BLANK } from "@/lib/notebook/constants";
import {
  buildPhraseCard,
  buildTranslationCard,
  buildWordCard,
  wordCardKind,
  type NotebookCardSource,
} from "@/lib/notebook/review";

const SOLLTEN: NotebookCardSource = {
  surface: "sollten",
  sentenceText: "Wir sollten umkehren.",
  charStart: 4,
  charEnd: 11,
  meaning: "powinniśmy",
  translation: "Powinniśmy zawrócić.",
  dictionaryTranslation: "powinien / mieć powinność",
};

describe("buildWordCard", () => {
  it("asks for the German form, with the learner's meaning as the cue", () => {
    const card = buildWordCard(SOLLTEN);

    expect(card.kind).toBe("context_cloze");
    expect(card.front).toBe(`Wir ${CLOZE_BLANK} umkehren.`);
    expect(card.back).toBe("sollten");
    expect(card.context).toBe("powinniśmy");
  });

  it("counts a cloze as recall, so it feeds the ACTIVE channel", () => {
    const card = buildWordCard(SOLLTEN);
    // Self-rated, because the UI reveals and the learner grades themselves…
    expect(card.mode).toBe("flashcard");
    // …and still recall, because the answer is German produced from a Polish cue.
    expect(card.direction).toBe("pl_to_de");
    expect(card.retrieval).toBe("cued_recall");
  });

  it("falls back to a meaning question when no cloze can be built", () => {
    const orphan = { ...SOLLTEN, charStart: null, charEnd: null };

    expect(wordCardKind(orphan)).toBe("context_meaning");
    const card = buildWordCard(orphan);
    expect(card.kind).toBe("context_meaning");
    expect(card.front).toBe("Wir sollten umkehren.");
    expect(card.back).toBe("powinniśmy");
    expect(card.prompt).toContain("sollten");
    // A weaker, honest card — recognition, not production.
    expect(card.retrieval).toBe("recognition");
  });

  it("uses the shared dictionary only when the learner wrote nothing", () => {
    const card = buildWordCard({ ...SOLLTEN, meaning: null });
    expect(card.context).toBe("powinien / mieć powinność");
  });

  it("works for a personal word the dictionary does not know", () => {
    const card = buildWordCard({
      ...SOLLTEN,
      charStart: null,
      charEnd: null,
      dictionaryTranslation: null,
      meaning: "mój własny przekład",
    });
    expect(card.back).toBe("mój własny przekład");
  });
});

describe("buildPhraseCard", () => {
  it("shows the phrase and keeps its sentence as context", () => {
    const card = buildPhraseCard({
      surface: "Angst machen",
      sentenceText: "Machen euch die Toten Angst?",
      charStart: 0,
      charEnd: 6,
      meaning: "straszyć / budzić strach",
      translation: null,
      dictionaryTranslation: null,
    });

    expect(card.kind).toBe("phrase");
    expect(card.front).toBe("Angst machen");
    expect(card.back).toBe("straszyć / budzić strach");
    expect(card.context).toBe("Machen euch die Toten Angst?");
  });
});

describe("buildTranslationCard", () => {
  it("puts the learner's Polish on the front and the German on the back", () => {
    const card = buildTranslationCard(SOLLTEN);

    expect(card.front).toBe("Powinniśmy zawrócić.");
    expect(card.back).toBe("Wir sollten umkehren.");
    expect(card.direction).toBe("pl_to_de");
  });
});
