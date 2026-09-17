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

  /**
   * STRONG VERBS — the forms no rule can reach.
   *
   * Ablaut is not productive: nothing turns *ziehen* into *zog* by stripping an
   * ending, which is why these were dead text in the reader until the table
   * existed. German fiction runs on exactly these verbs.
   */
  it("recovers a strong-verb infinitive from its preterite", () => {
    expect(baseFormCandidates("zog")).toContain("ziehen");
    expect(baseFormCandidates("ging")).toContain("gehen");
    expect(baseFormCandidates("fand")).toContain("finden");
    expect(baseFormCandidates("sah")).toContain("sehen");
  });

  it("recovers it from the past participle too", () => {
    expect(baseFormCandidates("gezogen")).toContain("ziehen");
    expect(baseFormCandidates("gegangen")).toContain("gehen");
    expect(baseFormCandidates("genommen")).toContain("nehmen");
    expect(baseFormCandidates("gesprochen")).toContain("sprechen");
  });

  it("handles the weak verbs whose stem vowel changes", () => {
    expect(baseFormCandidates("dachte")).toContain("denken");
    expect(baseFormCandidates("brachte")).toContain("bringen");
    expect(baseFormCandidates("wusste")).toContain("wissen");
  });

  it("ranks a table hit ahead of a speculative stem", () => {
    // *dachte* minus `-te` is *dach*, and a dictionary with *Dach* in it would
    // otherwise answer "roof" for "thought". Order is what prevents that, since
    // `matchToken` takes the first candidate the dictionary recognises.
    const candidates = baseFormCandidates("dachte");

    expect(candidates.indexOf("denken")).toBeLessThan(candidates.indexOf("dach"));
  });

  it("leaves a modal alone rather than claiming it for a look-alike", () => {
    // *kannte* is *kennen*; *kann* is *können* and belongs to nobody else. A
    // table that mapped the stem would answer "to know" for the modal in every
    // second sentence of German.
    expect(baseFormCandidates("kannte")).toContain("kennen");
    expect(baseFormCandidates("kann")).not.toContain("kennen");
  });
});

describe("GERMAN_FUNCTION_WORDS", () => {
  it("covers core articles and prepositions", () => {
    expect(GERMAN_FUNCTION_WORDS.has("der")).toBe(true);
    expect(GERMAN_FUNCTION_WORDS.has("mit")).toBe(true);
    expect(GERMAN_FUNCTION_WORDS.has("und")).toBe(true);
  });
});
