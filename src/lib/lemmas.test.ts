import { describe, expect, it } from "vitest";

import { extractLemmas } from "./lemmas";

describe("extractLemmas", () => {
  it("reads the data-lemma attribute", () => {
    const html = '<p>Ich <mark data-lemma="gehen">gehe</mark> heim.</p>';
    expect(extractLemmas(html)).toEqual(["gehen"]);
  });

  it("falls back to the inner text when data-lemma is missing", () => {
    const html = "<p>Die <mark>Frau</mark> liest.</p>";
    expect(extractLemmas(html)).toEqual(["Frau"]);
  });

  it("returns distinct lemmas, keeping first-seen order", () => {
    const html =
      '<mark data-lemma="Haus">Haus</mark> ... <mark data-lemma="gehen">geht</mark> ... <mark data-lemma="haus">Häuser</mark>';
    expect(extractLemmas(html)).toEqual(["Haus", "gehen"]);
  });

  it("strips nested tags from the fallback text", () => {
    const html = "<mark><strong>laufen</strong></mark>";
    expect(extractLemmas(html)).toEqual(["laufen"]);
  });

  it("ignores empty annotations and returns [] when there are none", () => {
    expect(extractLemmas("<p>Kein Wort hier.</p>")).toEqual([]);
    expect(extractLemmas('<mark data-lemma="  "></mark>')).toEqual([]);
  });
});
