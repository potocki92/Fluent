import { describe, expect, it } from "vitest";

import { buildCloze, renderCloze } from "@/lib/notebook/cloze";
import { CLOZE_BLANK } from "@/lib/notebook/constants";

const SENTENCE = "Wir sollten umkehren.";

describe("buildCloze", () => {
  it("cuts the span out at its offsets", () => {
    const cloze = buildCloze(SENTENCE, 4, 11);
    expect(cloze).not.toBeNull();
    expect(cloze!.answer).toBe("sollten");
    expect(renderCloze(cloze!)).toBe(`Wir ${CLOZE_BLANK} umkehren.`);
  });

  it("blanks the RIGHT occurrence when the surface repeats", () => {
    // The bug this module exists to prevent: `replace` would blank the first
    // "sah", which is not the one that was saved.
    const repeated = "Er sah sie an, und sie sah ihn an.";
    const second = repeated.lastIndexOf("sah");
    const cloze = buildCloze(repeated, second, second + 3)!;

    expect(renderCloze(cloze)).toBe(`Er sah sie an, und sie ${CLOZE_BLANK} ihn an.`);
    expect(cloze.before).toContain("Er sah sie an");
  });

  it("returns null for offsets that do not describe this text", () => {
    expect(buildCloze(SENTENCE, null, 11)).toBeNull();
    expect(buildCloze(SENTENCE, 4, null)).toBeNull();
    expect(buildCloze(SENTENCE, 4, 4)).toBeNull();
    expect(buildCloze(SENTENCE, 11, 4)).toBeNull();
    expect(buildCloze(SENTENCE, -1, 4)).toBeNull();
    expect(buildCloze(SENTENCE, 4, SENTENCE.length + 1)).toBeNull();
    expect(buildCloze(SENTENCE, 1.5, 4)).toBeNull();
  });

  it("returns null when the span is only whitespace", () => {
    expect(buildCloze(SENTENCE, 3, 4)).toBeNull();
  });

  it("shortens a long sentence on word boundaries and says it did", () => {
    // Distinct filler so every offset below is unambiguous.
    const before = Array.from({ length: 12 }, (_, i) => `vorher${i}`).join(" ");
    const after = Array.from({ length: 12 }, (_, i) => `nachher${i}`).join(" ");
    const long = `${before} sollten ${after}`;
    const at = long.indexOf("sollten");
    const cloze = buildCloze(long, at, at + 7, 20)!;

    expect(cloze.elided).toBe(true);
    expect(cloze.before.startsWith("\u2026 ")).toBe(true);
    expect(cloze.after.endsWith(" \u2026")).toBe(true);

    // Never cut mid-word: each side is a run of WHOLE filler words.
    const keptBefore = cloze.before.slice(2).trim().split(" ");
    const keptAfter = cloze.after.slice(0, -2).trim().split(" ");
    expect(keptBefore.every((word) => /^vorher\d+$/.test(word))).toBe(true);
    expect(keptAfter.every((word) => /^nachher\d+$/.test(word))).toBe(true);
    // …and it really is the end of the left side and the start of the right.
    expect(keptBefore.at(-1)).toBe("vorher11");
    expect(keptAfter[0]).toBe("nachher0");
  });

  it("leaves a short sentence whole", () => {
    const cloze = buildCloze(SENTENCE, 4, 11)!;
    expect(cloze.elided).toBe(false);
  });
});
