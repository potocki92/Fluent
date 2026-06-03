import { describe, expect, it } from "vitest";

import {
  annotateVocabulary,
  buildDictIndex,
  compilePassage,
  markdownToHtml,
  type DictEntry,
} from "./text-compiler";

const DICT: DictEntry[] = [
  { lemma: "buch", display: "das Buch" },
  { lemma: "kind", display: "das Kind" },
  { lemma: "autobahn", display: "die Autobahn" },
  { lemma: "spielen", display: "spielen" },
  { lemma: "schön", display: "schön" },
];

describe("markdownToHtml", () => {
  it("wraps blank-line-separated blocks in paragraphs", () => {
    expect(markdownToHtml("Erste Zeile\n\nZweite Zeile")).toBe(
      "<p>Erste Zeile</p>\n<p>Zweite Zeile</p>",
    );
  });

  it("renders ## and ### as headings", () => {
    expect(markdownToHtml("## Titel")).toBe("<h2>Titel</h2>");
    expect(markdownToHtml("### Untertitel")).toBe("<h3>Untertitel</h3>");
  });

  it("renders dash lines as a list", () => {
    expect(markdownToHtml("- eins\n- zwei")).toBe(
      "<ul><li>eins</li><li>zwei</li></ul>",
    );
  });

  it("renders inline bold and italic", () => {
    expect(markdownToHtml("Das ist **fett** und _kursiv_")).toBe(
      "<p>Das ist <strong>fett</strong> und <em>kursiv</em></p>",
    );
  });

  it("joins single newlines inside a paragraph with <br />", () => {
    expect(markdownToHtml("Zeile eins\nZeile zwei")).toBe(
      "<p>Zeile eins<br />Zeile zwei</p>",
    );
  });

  it("escapes HTML in the source", () => {
    expect(markdownToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });
});

describe("buildDictIndex", () => {
  it("indexes the lemma and the noun (last word) of display", () => {
    const index = buildDictIndex(DICT);
    expect(index.get("buch")).toBe("buch");
    expect(index.get("autobahn")).toBe("autobahn");
  });
});

describe("annotateVocabulary", () => {
  const index = buildDictIndex(DICT);

  it("marks a dictionary word with its lemma", () => {
    const { html, matched } = annotateVocabulary("<p>Das Buch</p>", index);
    expect(html).toContain('<mark data-lemma="buch">Buch</mark>');
    expect(matched).toContain("buch");
  });

  it("marks an inflected form via de-inflection", () => {
    // Kinder → kind, Bücher → buch
    const { html } = annotateVocabulary("<p>Kinder lesen Bücher</p>", index);
    expect(html).toContain('<mark data-lemma="kind">Kinder</mark>');
    expect(html).toContain('<mark data-lemma="buch">Bücher</mark>');
  });

  it("respects word boundaries", () => {
    // "Bucharest" must not match "buch"
    const { html } = annotateVocabulary("<p>Bucharest</p>", index);
    expect(html).toBe("<p>Bucharest</p>");
  });

  it("does not re-wrap text already inside a mark (idempotent)", () => {
    const once = annotateVocabulary("<p>Das Buch</p>", index).html;
    const twice = annotateVocabulary(once, index).html;
    expect(twice).toBe(once);
  });

  it("collects unmatched content words", () => {
    const { unmatched } = annotateVocabulary("<p>Quatschwort</p>", index);
    expect(unmatched).toContain("quatschwort");
  });

  it("leaves HTML entities intact (no matching inside &amp;)", () => {
    const { html, unmatched } = annotateVocabulary("<p>Tom &amp; Jerry</p>", index);
    expect(html).toBe("<p>Tom &amp; Jerry</p>");
    expect(unmatched).not.toContain("amp");
  });
});

describe("compilePassage", () => {
  it("compiles source and annotates vocabulary end to end", () => {
    const { html, matched } = compilePassage("## Titel\n\nDas Kind spielt.", DICT);
    expect(html).toContain("<h2>Titel</h2>");
    expect(html).toContain('<mark data-lemma="kind">Kind</mark>');
    expect(html).toContain('<mark data-lemma="spielen">spielt</mark>');
    expect(matched).toEqual(expect.arrayContaining(["kind", "spielen"]));
  });

  it("returns empty output for blank input", () => {
    expect(compilePassage("   ", DICT)).toEqual({
      html: "",
      matched: [],
      unmatched: [],
    });
  });
});
