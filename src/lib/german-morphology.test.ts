import { describe, expect, it } from "vitest";

import {
  baseFormCandidates,
  foldUmlauts,
  GERMAN_FUNCTION_WORDS,
  IRREGULAR_BASE_FORMS,
} from "./german-morphology";

describe("foldUmlauts", () => {
  it("expands umlauts and ß to ASCII", () => {
    expect(foldUmlauts("bücher")).toBe("bucher");
    expect(foldUmlauts("schön")).toBe("schon");
    expect(foldUmlauts("straße")).toBe("strasse");
  });
});

describe("baseFormCandidates", () => {
  it("includes the token itself", () => {
    expect(baseFormCandidates("buch")).toContain("buch");
  });

  it("recovers a noun base from a regular plural", () => {
    // Kinder → Kind (strip -er)
    expect(baseFormCandidates("Kinder")).toContain("kind");
  });

  it("recovers a noun base from an umlaut plural", () => {
    // Bücher → buch (fold umlaut + strip -er)
    expect(baseFormCandidates("Bücher")).toContain("buch");
  });

  it("reconstructs a weak-verb infinitive from a conjugated form", () => {
    // spielt → spiel → spielen
    expect(baseFormCandidates("spielt")).toContain("spielen");
  });

  it("handles the ge- past participle of weak verbs", () => {
    // gemacht → macht → mach → machen
    expect(baseFormCandidates("gemacht")).toContain("machen");
  });

  it("ignores tokens shorter than three characters", () => {
    expect(baseFormCandidates("am")).toEqual([]);
  });
});

describe("GERMAN_FUNCTION_WORDS", () => {
  it("covers core articles and prepositions", () => {
    expect(GERMAN_FUNCTION_WORDS.has("der")).toBe(true);
    expect(GERMAN_FUNCTION_WORDS.has("mit")).toBe(true);
    expect(GERMAN_FUNCTION_WORDS.has("und")).toBe(true);
  });

  it("holds no verb form — a modal is the word a sentence turns on", () => {
    for (const form of [
      "ist", "war", "sein", "haben", "hat", "werden", "wird",
      "können", "kann", "müssen", "sollen", "soll", "wollen",
    ]) {
      expect(GERMAN_FUNCTION_WORDS.has(form)).toBe(false);
    }
  });
});

describe("IRREGULAR_BASE_FORMS", () => {
  it("reaches bases no suffix rule can reach", () => {
    // The whole point: these share no stem with their infinitive.
    expect(IRREGULAR_BASE_FORMS.get("ist")).toBe("sein");
    expect(IRREGULAR_BASE_FORMS.get("war")).toBe("sein");
    expect(IRREGULAR_BASE_FORMS.get("hat")).toBe("haben");
    expect(IRREGULAR_BASE_FORMS.get("wird")).toBe("werden");
    expect(IRREGULAR_BASE_FORMS.get("kann")).toBe("können");
    expect(IRREGULAR_BASE_FORMS.get("sollte")).toBe("sollen");
  });

  it("is ranked ahead of the stems the suffix rules produce", () => {
    // Without this, *waren* strips its -n to *Ware* and *bist* strips its -t to
    // *bis* — both real dictionary entries, both the wrong word.
    expect(baseFormCandidates("waren")[0]).toBe("sein");
    expect(baseFormCandidates("bist")[0]).toBe("sein");
    expect(baseFormCandidates("waren")).toContain("ware");
  });
});
