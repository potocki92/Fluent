import { describe, expect, it } from "vitest";

import {
  baseFormCandidates,
  foldUmlauts,
  GERMAN_FUNCTION_WORDS,
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
});
