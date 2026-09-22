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

  /**
   * PREFIXED STRONG VERBS. A prefix does not inherit the table: *hielt* maps to
   * *halten*, but nothing in the stripping rules turns *erhielt* into
   * *erhalten*, so the prefixed verb needs its own row. Both of these are B1
   * core — "sie erhielt einen Preis", "sie gewann" — and stayed unresolvable
   * until they were added.
   */
  it("recovers a prefixed strong verb from its preterite", () => {
    expect(baseFormCandidates("erhielt")).toContain("erhalten");
    expect(baseFormCandidates("erhielten")).toContain("erhalten");
    expect(baseFormCandidates("gewann")).toContain("gewinnen");
    expect(baseFormCandidates("gewannen")).toContain("gewinnen");
  });

  it("recovers gewinnen from its participle, whose vowel differs again", () => {
    // gewinnen / gewann / gewonnen — i, a, o. The participle carries no
    // separable `ge-` to strip, so the full form is what the table stores.
    expect(baseFormCandidates("gewonnen")).toContain("gewinnen");
  });

  it("does not strip ge- off a form the table already knows", () => {
    // The `ge-` rule fires on anything long enough, so *gewann* would also
    // yield the root *wann* — a question word every dictionary has, ranked
    // ABOVE the table's answer, which is "sie gewann" glossed as "kiedy". In
    // *gewinnen* the `ge` belongs to the stem, so the guess is not made at all.
    const candidates = baseFormCandidates("gewann");

    expect(candidates).toContain("gewinnen");
    expect(candidates).not.toContain("wann");

    // The genuine participles still lose their prefix: there the `ge-` is real.
    expect(baseFormCandidates("gegessen")).toContain("essen");
    expect(baseFormCandidates("gezogen")).toContain("ziehen");
    expect(baseFormCandidates("gespielt")).toContain("spielen");
  });

  /**
   * PRESENT TENSE, e → i/ie. Ablaut is not confined to the preterite: *gelten*
   * becomes *gilt*, *nehmen* becomes *nimmt*. These are the most frequent verbs
   * in German, so a de-inflector that misses them leaves ordinary prose
   * unglossable even when the infinitive is in the dictionary.
   */
  it("recovers an infinitive from a present tense with a changed stem vowel", () => {
    expect(baseFormCandidates("gilt")).toContain("gelten");
    expect(baseFormCandidates("gibt")).toContain("geben");
    expect(baseFormCandidates("nimmt")).toContain("nehmen");
    expect(baseFormCandidates("spricht")).toContain("sprechen");
    expect(baseFormCandidates("hilft")).toContain("helfen");
    expect(baseFormCandidates("sieht")).toContain("sehen");
    expect(baseFormCandidates("trifft")).toContain("treffen");
    expect(baseFormCandidates("hält")).toContain("halten");
  });

  it("answers lassen for lässt rather than lesen", () => {
    // *lässt* folded is *lasst*; stripped of `-st` that is *las*, which the
    // table maps to *lesen*. Before the present-tense rows existed, "er lässt"
    // was glossed "to read" — a wrong answer, not a missing one. The table is
    // consulted on the roots before the speculative stems, so the row wins.
    const candidates = baseFormCandidates("lässt");

    expect(candidates).toContain("lassen");
    expect(candidates.indexOf("lassen")).toBeLessThan(candidates.indexOf("lesen"));
  });

  it("needs no row for the verbs that only take an umlaut", () => {
    // Folding plus suffix stripping already reaches these, which is why the
    // block above stays as small as it does.
    expect(baseFormCandidates("fährt")).toContain("fahren");
    expect(baseFormCandidates("läuft")).toContain("laufen");
    expect(baseFormCandidates("trägt")).toContain("tragen");
    expect(baseFormCandidates("schläft")).toContain("schlafen");
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
