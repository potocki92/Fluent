import { describe, expect, it } from "vitest";

import { buildDictionaryIndex } from "@/lib/content/dictionary-match";
import { htmlToPlainText, normalizeText } from "@/lib/content/normalize";
import { splitParagraphs } from "@/lib/content/paragraphs";
import { contentHash, processChapterContent } from "@/lib/content/process";
import { splitSentences } from "@/lib/content/sentences";
import { tokenize } from "@/lib/content/tokenize";
import { CONTENT_PROCESSOR_VERSION } from "@/lib/content/version";

const DICT = [
  { id: 1, lemma: "Schwert", display: "das Schwert" },
  { id: 2, lemma: "ziehen", display: "ziehen" },
  { id: 3, lemma: "Buch", display: "das Buch" },
  { id: 4, lemma: "Kind", display: "das Kind" },
  { id: 5, lemma: "Straße", display: "die Straße" },
  { id: 6, lemma: "Krankenversicherung", display: "die Krankenversicherung" },
];

describe("normalize", () => {
  it("recovers plain text from a legacy annotated body", () => {
    const html =
      '<p>Das <mark data-lemma="Kind">Kind</mark> liest ein Buch.</p><p>Ende.</p>';
    expect(htmlToPlainText(html)).toBe("Das Kind liest ein Buch.\n\nEnde.");
  });

  it("never lets markup become content", () => {
    const html = "<p>Hallo</p><script>alert(1)</script><p>Welt</p>";
    const text = htmlToPlainText(html);
    expect(text).not.toContain("<");
    expect(text).not.toContain("alert");
    expect(text).toBe("Hallo\n\nWelt");
  });

  it("decodes entities and strips invisible characters", () => {
    expect(htmlToPlainText("<p>Stra&szlig;e &amp; Haus</p>")).toBe("Straße & Haus");
    expect(normalizeText("Fu­ß​ball")).toBe("Fußball");
    expect(normalizeText("a b")).toBe("a b");
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines and joins soft wraps", () => {
    const blocks = splitParagraphs(
      "Erste Zeile\nzweite Zeile.\n\nZweiter Absatz.\n\n\n\nDritter.",
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "Erste Zeile zweite Zeile.",
      "Zweiter Absatz.",
      "Dritter.",
    ]);
    expect(blocks.map((block) => block.position)).toEqual([0, 1, 2]);
  });

  it("recognises headings and list items", () => {
    const blocks = splitParagraphs("## Kapitel 1\n\n- eins\n- zwei\n\nText.");
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "list_item",
      "list_item",
      "paragraph",
    ]);
    expect(blocks[0].text).toBe("Kapitel 1");
  });

  it("drops empty blocks rather than emitting empty paragraphs", () => {
    expect(splitParagraphs("\n\n   \n\n")).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("splits on the full range of German terminators", () => {
    const sentences = splitSentences("Er kam. Warum? Unglaublich! Und dann …");
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "Er kam.",
      "Warum?",
      "Unglaublich!",
      "Und dann …",
    ]);
    expect(sentences.map((sentence) => sentence.position)).toEqual([0, 1, 2, 3]);
  });

  it("does not split inside abbreviations", () => {
    expect(splitSentences("Das ist z. B. ein Hund.")).toHaveLength(1);
    expect(splitSentences("Dr. Müller kam an.")).toHaveLength(1);
    expect(splitSentences("Es kostet ca. 20 Euro und mehr.")).toHaveLength(1);
    expect(splitSentences("Nr. 4 ist frei.")).toHaveLength(1);
  });

  it("does not split ordinals or decimals", () => {
    expect(splitSentences("Am 3. Mai fuhr er weg.")).toHaveLength(1);
    expect(splitSentences("Es kostet 2.500 Euro.")).toHaveLength(1);
  });

  it("keeps dialogue with its speech tag, and closing quotes with their sentence", () => {
    // "»Warum?« fragte sie." is ONE German sentence: the question mark belongs
    // to the quotation, and the speech tag after it continues in lower case.
    // Splitting on the `?` is the single most visible way a naive splitter
    // shreds fiction.
    const sentences = splitSentences('»Warum?« fragte sie. „Darum.“ Er ging.');
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "»Warum?« fragte sie.",
      "„Darum.“",
      "Er ging.",
    ]);
  });

  it("never loses text", () => {
    const source = "Er zog sein Schwert. Es glänzte! Wirklich?";
    const joined = splitSentences(source)
      .map((sentence) => sentence.text)
      .join(" ");
    expect(joined).toBe(source);
  });

  it("anchors each sentence at its real offset in the paragraph", () => {
    const source = "Eins. Zwei.";
    const [first, second] = splitSentences(source);
    expect(source.slice(first.charStart, first.charEnd)).toBe("Eins.");
    expect(source.slice(second.charStart, second.charEnd)).toBe("Zwei.");
  });
});

describe("tokenize", () => {
  it("keeps punctuation out of tokens", () => {
    expect(tokenize("Er zog sein Schwert.").map((t) => t.surface)).toEqual([
      "Er",
      "zog",
      "sein",
      "Schwert",
    ]);
  });

  it("keeps umlauts, ß, inner hyphens and apostrophes inside the word", () => {
    expect(tokenize("Fußgängerübergang").map((t) => t.surface)).toEqual([
      "Fußgängerübergang",
    ]);
    expect(tokenize("E-Mail-Adresse").map((t) => t.surface)).toEqual([
      "E-Mail-Adresse",
    ]);
    expect(tokenize("geht's").map((t) => t.surface)).toEqual(["geht's"]);
    expect(tokenize("»Schön!«").map((t) => t.surface)).toEqual(["Schön"]);
  });

  it("reports offsets that address the original text", () => {
    const sentence = "Er zog sein Schwert.";
    const token = tokenize(sentence)[3];
    expect(sentence.slice(token.charStart, token.charEnd)).toBe("Schwert");
  });
});

describe("processChapterContent", () => {
  const source =
    "## Das Duell\n\nEr zog sein Schwert. Das Kind sah zu.\n\n" +
    "Auf der Straße war es still. Die Krankenversicherung zahlte nichts.";

  it("produces the full structure with stable positions", () => {
    const result = processChapterContent(source, DICT);

    expect(result.paragraphCount).toBe(3);
    expect(result.paragraphs.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(result.paragraphs[0].kind).toBe("heading");

    const sentencePositions = result.paragraphs.flatMap((p) =>
      p.sentences.map((s) => s.chapterPosition),
    );
    expect(sentencePositions).toEqual([0, 1, 2, 3, 4]);

    // Positions WITHIN a paragraph restart at 0 — that is what makes
    // `(paragraph_id, position)` a unique key.
    expect(result.paragraphs[1].sentences.map((s) => s.position)).toEqual([0, 1]);
  });

  it("resolves inflected forms to dictionary entries", () => {
    const result = processChapterContent(source, DICT);
    const lemmas = result.paragraphs
      .flatMap((p) => p.sentences)
      .flatMap((s) => s.occurrences)
      .map((o) => o.lemma);

    expect(lemmas).toContain("Schwert");
    expect(lemmas).toContain("Kind");
    expect(lemmas).toContain("Straße");
  });

  it("gives every occurrence an offset inside its own sentence", () => {
    const result = processChapterContent(source, DICT);
    for (const paragraph of result.paragraphs) {
      for (const sentence of paragraph.sentences) {
        for (const occurrence of sentence.occurrences) {
          expect(sentence.text.slice(occurrence.charStart, occurrence.charEnd)).toBe(
            occurrence.surface,
          );
        }
      }
    }
  });

  it("numbers occurrences by lexical token, not by match", () => {
    const result = processChapterContent("Das Kind liest das Buch.", DICT);
    const occurrences = result.paragraphs[0].sentences[0].occurrences;
    // EVERY lexical token gets a row, and the position is its address among the
    // sentence's lexical tokens — which is what a notebook note is anchored on,
    // so it must not renumber because a neighbour did or did not match.
    expect(occurrences.map((o) => o.position)).toEqual([0, 1, 2, 3, 4]);
    expect(occurrences.map((o) => o.surface)).toEqual([
      "Das",
      "Kind",
      "liest",
      "das",
      "Buch",
    ]);
    // …and only the two the dictionary knows carry an entry.
    expect(occurrences.map((o) => o.wordId)).toEqual([null, 4, null, null, 3]);
  });

  it("writes an occurrence for a token the dictionary has never heard of", () => {
    // TEST A, and the whole point of the phase. `ziehen` is in DICT here; the
    // regression this guards is the OPPOSITE case — see the suite below, where
    // the dictionary does not have it and *zog* must still be a row.
    const result = processChapterContent("Er zog sein Schwert.", []);
    const occurrences = result.paragraphs[0].sentences[0].occurrences;

    expect(occurrences.map((o) => o.surface)).toEqual([
      "Er",
      "zog",
      "sein",
      "Schwert",
    ]);
    expect(occurrences.every((o) => o.wordId === null)).toBe(true);
    // The provisional lemma is the normalized surface: a stand-in for a headword
    // nobody has curated, never a claim about German.
    expect(occurrences.map((o) => o.lemma)).toEqual([
      "er",
      "zog",
      "sein",
      "schwert",
    ]);
  });

  it("keeps the statistics about the DICTIONARY, not about the rows", () => {
    // The rows now exist either way, so `matchRate` would be a meaningless 1.0 if
    // it counted them. It counts real matches, exactly as before.
    const known = processChapterContent("Das Kind liest das Buch.", DICT);
    const unknown = processChapterContent("Das Kind liest das Buch.", []);

    expect(known.stats.matchedTokenCount).toBe(2);
    expect(unknown.stats.matchedTokenCount).toBe(0);
    expect(unknown.stats.matchRate).toBe(0);
    expect(unknown.stats.matchedWordCount).toBe(0);
    expect(unknown.vocabulary).toEqual([]);
    // …while both produced the same five rows.
    expect(unknown.paragraphs[0].sentences[0].occurrences).toHaveLength(5);
  });

  it("resolves a closed-class word like any other — *wir* is a word", () => {
    // It used to refuse before the lookup, so an imported *wir* was in the
    // dictionary and dead in the book. Loudness is the reader's decision now.
    const dict = [
      ...DICT,
      { id: 7, lemma: "wir", display: "wir" },
      { id: 8, lemma: "sollen", display: "sollen" },
    ];
    const result = processChapterContent("Wir sollen das Buch lesen.", dict);
    const occurrences = result.paragraphs[0].sentences[0].occurrences;

    expect(occurrences.map((o) => o.lemma)).toEqual([
      "wir",
      "sollen",
      "das",
      "Buch",
      "lesen",
    ]);
    // Still addressed by lexical token: Wir(0) sollen(1) das(2) Buch(3) lesen(4).
    expect(occurrences.map((o) => o.position)).toEqual([0, 1, 2, 3, 4]);
    // *das* and *lesen* are rows without an entry; *wir* and *sollen* are rows
    // with one. The difference is the column, never the row's existence.
    expect(occurrences.map((o) => o.wordId)).toEqual([7, 8, null, 3, null]);
  });

  it("aggregates the chapter's vocabulary by frequency", () => {
    const result = processChapterContent(
      "Das Kind liest. Das Kind schläft. Ein Buch liegt da.",
      DICT,
    );
    expect(result.vocabulary[0].lemma).toBe("Kind");
    expect(result.vocabulary[0].occurrenceCount).toBe(2);
  });

  it("reports the dictionary gap instead of hiding it", () => {
    const result = processChapterContent("Das Kind sah einen Drachenflieger.", DICT);
    expect(result.stats.unmatchedTokenCount).toBeGreaterThan(0);
    expect(result.stats.unmatchedSample.map((entry) => entry.token)).toContain(
      "drachenflieger",
    );
    expect(result.stats.matchRate).toBeLessThan(1);
    expect(result.stats.matchRate).toBeGreaterThan(0);
  });

  it("is deterministic — the same input yields the same structure", () => {
    const a = processChapterContent(source, DICT);
    const b = processChapterContent(source, DICT);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.processorVersion).toBe(CONTENT_PROCESSOR_VERSION);
  });

  it("processes a legacy HTML body into the same structure as its plain text", () => {
    const html =
      '<p>Er zog sein <mark data-lemma="Schwert">Schwert</mark>. Das Kind sah zu.</p>';
    const plain = "Er zog sein Schwert. Das Kind sah zu.";
    expect(JSON.stringify(processChapterContent(html, DICT))).toBe(
      JSON.stringify(processChapterContent(plain, DICT)),
    );
  });

  it("handles an empty source without producing empty rows", () => {
    const result = processChapterContent("   \n\n  ", DICT);
    expect(result.paragraphs).toEqual([]);
    expect(result.wordCount).toBe(0);
    expect(result.stats.matchRate).toBe(0);
  });
});

describe("contentHash", () => {
  it("is stable for the same content, and changes when the content does", () => {
    expect(contentHash("Er zog sein Schwert.")).toBe(
      contentHash("Er zog sein Schwert."),
    );
    expect(contentHash("Er zog sein Schwert.")).not.toBe(
      contentHash("Er zog sein Buch."),
    );
  });

  it("ignores differences the pipeline itself would normalise away", () => {
    expect(contentHash("<p>Hallo Welt.</p>")).toBe(contentHash("Hallo Welt."));
  });
});

describe("buildDictionaryIndex", () => {
  it("indexes the lemma and the noun of `display`", () => {
    const index = buildDictionaryIndex(DICT);
    expect(index.get("schwert")?.wordId).toBe(1);
    expect(index.get("strasse")?.wordId).toBe(5);
  });
});
