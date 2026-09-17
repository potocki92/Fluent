import { describe, expect, it } from "vitest";

import {
  buildDictionaryIndex,
  matchToken,
  resolveNormalizedForms,
} from "@/lib/content/dictionary-match";
import {
  isEmptySyncPlan,
  planDictionarySync,
  type MissingOccurrence,
  type StoredOccurrence,
  type StoredSentence,
} from "@/lib/content/dictionary-sync";
import { processChapterContent } from "@/lib/content/process";
import { tokenize } from "@/lib/content/tokenize";

/**
 * THE REGRESSION SUITE FOR "I ADDED THE WORD AND THE BOOK STILL DOES NOT KNOW IT".
 *
 * The bug: a chapter only stored an occurrence for a token the dictionary could
 * match AT IMPORT TIME, so the structure of a book was a function of the
 * dictionary on the day it arrived. Adding *ziehen* a month later left *zog* dead
 * text in every existing book until somebody reprocessed all forty chapters —
 * which rewrote every paragraph, sentence and occurrence row to change one
 * nullable column.
 *
 * What these tests pin down is the property that replaces it:
 *
 *     Every lexical token gets an occurrence. Dictionary resolution is optional
 *     and may evolve independently of the immutable reading structure.
 *
 * So: the row exists before the entry does (A), the entry can arrive later and
 * reach it without touching the text (B, C), the pass is idempotent (H), it uses
 * the real German morphology rather than an exact-lemma shortcut (G), and a word
 * nobody has added stays honestly unknown (F).
 */

/** The dictionary BEFORE anyone adds the verb. */
const WITHOUT_ZIEHEN = [
  { id: 1, lemma: "Schwert", display: "das Schwert" },
  { id: 3, lemma: "Buch", display: "das Buch" },
];

/** …and after. */
const WITH_ZIEHEN = [...WITHOUT_ZIEHEN, { id: 2, lemma: "ziehen", display: "ziehen" }];

const SENTENCE = "Er zog sein Schwert.";

/**
 * The rows a LEGACY chapter has: one per matched token, and nothing for the
 * rest. This is what every book imported before this phase looks like.
 */
function legacyRows(sentenceId: number, text: string, dictionary = WITHOUT_ZIEHEN) {
  const index = buildDictionaryIndex(dictionary);
  const rows: StoredOccurrence[] = [];

  for (const token of tokenize(text)) {
    const hit = matchToken(token.surface, index);
    if (!hit) continue;
    rows.push({
      sentenceId,
      position: token.position,
      normalized: token.normalized,
      wordId: hit.wordId,
    });
  }

  return rows;
}

/** The rows a chapter processed TODAY has: one per lexical token. */
function currentRows(sentenceId: number, text: string, dictionary = WITHOUT_ZIEHEN) {
  const index = buildDictionaryIndex(dictionary);

  return tokenize(text).map<StoredOccurrence>((token) => {
    const hit = matchToken(token.surface, index);
    return {
      sentenceId,
      position: token.position,
      normalized: token.normalized,
      wordId: hit?.wordId ?? null,
    };
  });
}

const sentences: StoredSentence[] = [{ id: 501, text: SENTENCE }];

describe("A — an unmatched token is still an occurrence", () => {
  it("gives *zog* a row even though the dictionary has no *ziehen*", () => {
    const result = processChapterContent(SENTENCE, WITHOUT_ZIEHEN);
    const occurrences = result.paragraphs[0].sentences[0].occurrences;

    const zog = occurrences.find((occurrence) => occurrence.surface === "zog");
    expect(zog).toBeDefined();
    expect(zog?.wordId).toBeNull();
    expect(zog?.normalized).toBe("zog");
    // The row is a real address in the sentence, not a placeholder: position 1,
    // and offsets that cut exactly the word out of the text.
    expect(zog?.position).toBe(1);
    expect(SENTENCE.slice(zog!.charStart, zog!.charEnd)).toBe("zog");
  });

  it("makes the chapter's rows independent of the dictionary's size", () => {
    const poor = processChapterContent(SENTENCE, []);
    const rich = processChapterContent(SENTENCE, WITH_ZIEHEN);

    const shape = (chapter: ReturnType<typeof processChapterContent>) =>
      chapter.paragraphs[0].sentences[0].occurrences.map((occurrence) => [
        occurrence.position,
        occurrence.surface,
        occurrence.charStart,
        occurrence.charEnd,
      ]);

    // Identical structure, different knowledge. That is the whole separation.
    expect(shape(poor)).toEqual(shape(rich));
    expect(shape(poor)).toHaveLength(4);
  });
});

describe("B — a dictionary entry added later reaches an existing chapter", () => {
  it("resolves *zog* to *ziehen* without reprocessing anything", () => {
    // T0: the chapter was processed when the dictionary had no *ziehen*.
    const stored = currentRows(501, SENTENCE, WITHOUT_ZIEHEN);
    expect(stored.find((row) => row.normalized === "zog")?.wordId).toBeNull();

    // T1: somebody adds it. T2: the reconciliation pass, over the SAME rows.
    const plan = planDictionarySync({
      sentences,
      occurrences: stored,
      index: buildDictionaryIndex(WITH_ZIEHEN),
    });

    expect(plan.resolutions).toContainEqual({
      normalized: "zog",
      wordId: 2,
      lemma: "ziehen",
    });
    // Nothing is inserted: every token already has its row. The dictionary
    // changed; the book did not.
    expect(plan.missing).toEqual([]);
  });

  it("asks the dictionary only about tokens that have no answer yet", () => {
    const stored = currentRows(501, SENTENCE, WITH_ZIEHEN);
    const plan = planDictionarySync({
      sentences,
      occurrences: stored,
      index: buildDictionaryIndex(WITH_ZIEHEN),
    });

    // *Schwert* and *zog* are already resolved; only *er* and *sein* are still
    // open, and neither is in this dictionary.
    expect(isEmptySyncPlan(plan)).toBe(true);
  });
});

describe("C — the chapter's structure is not what changes", () => {
  it("never proposes to touch a position that already has a row", () => {
    const stored = currentRows(501, SENTENCE, WITHOUT_ZIEHEN);
    const plan = planDictionarySync({
      sentences,
      occurrences: stored,
      index: buildDictionaryIndex(WITH_ZIEHEN),
    });

    const storedPositions = new Set(stored.map((row) => row.position));
    for (const row of plan.missing) {
      expect(storedPositions.has(row.position)).toBe(false);
    }
  });

  it("fills a legacy gap at exactly the position the tokenizer gives it", () => {
    // The only structural write the pass can make: a row for a token that never
    // got one. Its position comes from the same `tokenize()` that produced the
    // stored rows, so it lands beside them rather than renumbering them.
    const stored = legacyRows(501, SENTENCE);
    const plan = planDictionarySync({
      sentences,
      occurrences: stored,
      index: buildDictionaryIndex(WITHOUT_ZIEHEN),
    });

    expect(plan.missing.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(plan.missing.map((row) => row.surface)).toEqual(["Er", "zog", "sein"]);
    expect(plan.missing.every((row) => row.sentenceId === 501)).toBe(true);
    for (const row of plan.missing) {
      expect(SENTENCE.slice(row.charStart, row.charEnd)).toBe(row.surface);
    }
    // *Schwert* was already stored at position 3 and is left completely alone.
    expect(plan.missing.some((row) => row.surface === "Schwert")).toBe(false);
  });

  it("inserts a legacy gap already resolved when the dictionary knows it", () => {
    const plan = planDictionarySync({
      sentences,
      occurrences: legacyRows(501, SENTENCE),
      index: buildDictionaryIndex(WITH_ZIEHEN),
    });

    const zog = plan.missing.find((row: MissingOccurrence) => row.surface === "zog");
    expect(zog?.wordId).toBe(2);
    expect(zog?.lemma).toBe("ziehen");
  });
});

describe("H — the pass is idempotent", () => {
  it("proposes nothing the second time", () => {
    const index = buildDictionaryIndex(WITH_ZIEHEN);
    const stored = legacyRows(501, SENTENCE);

    const first = planDictionarySync({ sentences, occurrences: stored, index });
    expect(first.missing).toHaveLength(3);

    // Apply it, exactly as `sync_chapter_dictionary` does: insert the missing
    // rows, fill in the resolved ones. Then plan again.
    const applied: StoredOccurrence[] = [
      ...stored.map((row) => ({
        ...row,
        wordId:
          row.wordId ??
          first.resolutions.find((hit) => hit.normalized === row.normalized)?.wordId ??
          null,
      })),
      ...first.missing.map((row) => ({
        sentenceId: row.sentenceId,
        position: row.position,
        normalized: row.normalized,
        wordId: row.wordId,
      })),
    ];

    const second = planDictionarySync({ sentences, occurrences: applied, index });
    expect(second.missing).toEqual([]);
    expect(isEmptySyncPlan(second)).toBe(true);
  });

  it("re-resolves only what is still unresolved, however often it runs", () => {
    const index = buildDictionaryIndex(WITH_ZIEHEN);
    const stored = currentRows(501, SENTENCE, WITH_ZIEHEN);

    for (let run = 0; run < 3; run += 1) {
      expect(planDictionarySync({ sentences, occurrences: stored, index })).toEqual({
        missing: [],
        resolutions: [],
      });
    }
  });
});

describe("G — resolution uses the real morphology, not an exact lemma", () => {
  const dictionary = buildDictionaryIndex([
    { id: 1, lemma: "Buch", display: "das Buch" },
    { id: 2, lemma: "ziehen", display: "ziehen" },
    { id: 3, lemma: "Straße", display: "die Straße" },
    { id: 4, lemma: "spielen", display: "spielen" },
    { id: 5, lemma: "Autobahn", display: "die Autobahn" },
  ]);

  const cases: [string, number][] = [
    // A plural with an umlaut — neither the spelling nor the ending matches.
    ["bücher", 1],
    // A strong past tense, reachable through the de-inflection candidates.
    ["zog", 2],
    // ß folded against the dictionary's own folded key.
    ["strassen", 3],
    // Weak-verb conjugation and a past participle.
    ["spielte", 4],
    ["gespielt", 4],
    // The headword hidden behind an article in `display`.
    ["autobahn", 5],
  ];

  it.each(cases)("resolves %s", (form, wordId) => {
    expect(resolveNormalizedForms([form], dictionary).get(form)?.wordId).toBe(wordId);
  });

  it("is the SAME function the reader and the processor use", () => {
    // One algorithm, one answer. A second, simpler matcher in the gloss —
    // `ilike("lemma", surface)` — is what used to make *zog* "spoza słownika" on
    // a page where the processor had resolved it perfectly well.
    for (const [form, wordId] of cases) {
      expect(matchToken(form, dictionary)?.wordId).toBe(wordId);
    }
  });
});

describe("F — a word nobody has added stays honestly unknown", () => {
  it("leaves an unresolvable token as a row with no entry", () => {
    const index = buildDictionaryIndex(WITH_ZIEHEN);
    const text = "Die Wildlinge kamen.";
    const plan = planDictionarySync({
      sentences: [{ id: 700, text }],
      occurrences: [],
      index,
    });

    const wildlinge = plan.missing.find((row) => row.surface === "Wildlinge");
    expect(wildlinge).toBeDefined();
    expect(wildlinge?.wordId).toBeNull();
    // The provisional lemma is the normalized surface, never an invented
    // headword: the reader shows the word, and the learner can give it their own
    // contextual meaning.
    expect(wildlinge?.lemma).toBe("wildlinge");
    expect(plan.resolutions.some((hit) => hit.normalized === "wildlinge")).toBe(false);
  });
});
