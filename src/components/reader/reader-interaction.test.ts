import { describe, expect, it } from "vitest";

import {
  glossTargetFrom,
  isUsableSelection,
  readerBarPlan,
  resolveReaderIntent,
  type ReaderGesture,
  type ReaderWordHit,
  type SelectedRange,
} from "@/components/reader/reader-interaction";
import { MAX_PHRASE_TOKENS } from "@/lib/notebook/constants";

/**
 * THE REGRESSION SUITE FOR THE iOS WORD TAP.
 *
 * The symptom was a learner tapping *Wir* and getting the SENTENCE action bar —
 * "Przetłumacz / Nie rozumiem" — instead of the word sheet, because Safari was
 * still holding a selection from an earlier gesture when the tap's click fired.
 * Every case below is one rung of the hierarchy in `reader-interaction.ts`, and
 * the two stale-selection cases are the bug itself.
 */

// „Wir sollten umkehren“, drängte Gared.
const SENTENCE = "Wir sollten umkehren, drängte Gared.";

function word(overrides: Partial<ReaderWordHit> = {}): ReaderWordHit {
  return {
    occurrenceId: "9001",
    wordId: "412",
    sentenceId: "77",
    position: "0",
    lemma: "wir",
    surface: "Wir",
    ...overrides,
  };
}

function range(overrides: Partial<SelectedRange> = {}): SelectedRange {
  return {
    sentenceId: 77,
    sentenceText: SENTENCE,
    charStart: 0,
    charEnd: 3,
    crossSentence: false,
    ...overrides,
  };
}

function gesture(overrides: Partial<ReaderGesture> = {}): ReaderGesture {
  return {
    word: null,
    sentenceId: 77,
    selection: null,
    selectionIsUncommitted: false,
    pointerInsideSelection: false,
    ...overrides,
  };
}

describe("resolveReaderIntent", () => {
  it("opens the gloss for a tap on a word the dictionary knows", () => {
    const intent = resolveReaderIntent(gesture({ word: word() }));

    expect(intent).toEqual({ kind: "word", word: word() });
  });

  it("opens the gloss for a tap on a word with no wordId", () => {
    // A token outside Fluent's dictionary is still a word the learner tapped.
    const intent = resolveReaderIntent(gesture({ word: word({ wordId: "" }) }));

    expect(intent.kind).toBe("word");
  });

  it("ignores a stale selection left over from an earlier gesture", () => {
    // THE BUG. Safari still holds the range from a long-press two paragraphs
    // ago; the tap that dismisses the callout is delivered to the word beneath
    // it. The selection has already been committed, so the tap stays a tap.
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection: range({ charStart: 4, charEnd: 11 }),
        selectionIsUncommitted: false,
        pointerInsideSelection: true,
      }),
    );

    expect(intent.kind).toBe("word");
  });

  it("ignores a selection the reader has already shown the bar for", () => {
    // THE BUG, SECOND FORM — the one a Safari-engine run reproduced after the
    // first fix. A long-press selects a word and the action bar appears; the tap
    // that dismisses iOS's callout arrives as a click with NO pointerdown of its
    // own, so "changed since this gesture began" was still true and swallowed
    // it. Committing the selection ends its claim on the next click.
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection: range({ charStart: 4, charEnd: 11 }),
        selectionIsUncommitted: false,
        pointerInsideSelection: true,
      }),
    );

    expect(intent.kind).toBe("word");
  });

  it("ignores an uncommitted selection the tap happened outside of", () => {
    // A drag ends inside its own selection. A tap on a word elsewhere does not,
    // so it cannot be that drag ending — whatever the browser still holds.
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection: range({ charStart: 4, charEnd: 11 }),
        selectionIsUncommitted: true,
        pointerInsideSelection: false,
      }),
    );

    expect(intent.kind).toBe("word");
  });

  it("ignores a collapsed selection the tap itself produced", () => {
    // Tapping text places a caret, which IS a selection change — but a caret is
    // not a selection, so it must not outrank the word under the finger.
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection: range({ charStart: 4, charEnd: 4 }),
        selectionIsUncommitted: true,
        pointerInsideSelection: true,
      }),
    );

    expect(intent.kind).toBe("word");
  });

  it("ignores a stale selection even where it covers the tapped word", () => {
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection: range({ charStart: 0, charEnd: 11 }),
        selectionIsUncommitted: false,
        pointerInsideSelection: true,
      }),
    );

    expect(intent.kind).toBe("word");
  });

  it("lets a selection made by THIS gesture win over the word it ended on", () => {
    // A drag-select ends on a word and fires a click there. That is not a tap.
    const selection = range({ charStart: 4, charEnd: 11 });
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection,
        selectionIsUncommitted: true,
        pointerInsideSelection: true,
      }),
    );

    expect(intent).toEqual({ kind: "selection", selection });
  });

  it("reports a live cross-sentence selection rather than the word under it", () => {
    const selection = range({ crossSentence: true, charStart: 0, charEnd: 0 });
    const intent = resolveReaderIntent(
      gesture({
        word: word(),
        selection,
        selectionIsUncommitted: true,
        pointerInsideSelection: true,
      }),
    );

    expect(intent).toEqual({ kind: "selection", selection });
  });

  it("offers the sentence's actions for a tap on the space between words", () => {
    const intent = resolveReaderIntent(gesture({ word: null, sentenceId: 77 }));

    expect(intent).toEqual({ kind: "sentence", sentenceId: 77 });
  });

  it("offers the sentence's actions for a tap on punctuation", () => {
    // Punctuation is not an occurrence, so there is no `.reader-word` under it.
    const intent = resolveReaderIntent(
      gesture({ word: null, sentenceId: 77, selection: null }),
    );

    expect(intent.kind).toBe("sentence");
  });

  it("does nothing for a tap outside any sentence", () => {
    expect(resolveReaderIntent(gesture({ sentenceId: null })).kind).toBe("none");
  });

  it("never lets the sentence outrank a word", () => {
    // Rule 5 is the FALLBACK, and a word hit always carries a sentence too.
    const intent = resolveReaderIntent(gesture({ word: word(), sentenceId: 77 }));

    expect(intent.kind).toBe("word");
  });
});

describe("isUsableSelection", () => {
  it("rejects nothing, a caret and a zero-width range", () => {
    expect(isUsableSelection(null)).toBe(false);
    expect(isUsableSelection(range({ charStart: 4, charEnd: 4 }))).toBe(false);
    expect(isUsableSelection(range({ charStart: 0, charEnd: 0 }))).toBe(false);
  });

  it("accepts a real range, and a cross-sentence one so it can be explained", () => {
    expect(isUsableSelection(range({ charStart: 0, charEnd: 3 }))).toBe(true);
    expect(isUsableSelection(range({ crossSentence: true }))).toBe(true);
  });
});

describe("glossTargetFrom", () => {
  it("carries the word's dictionary id and its anchor", () => {
    expect(glossTargetFrom(word(), ` ${SENTENCE} `)).toEqual({
      occurrenceId: 9001,
      wordId: 412,
      sentenceId: 77,
      tokenPosition: 0,
      lemma: "wir",
      surface: "Wir",
      sentence: SENTENCE,
    });
  });

  it("still opens for a token the dictionary does not know", () => {
    // `data-word-id=""` is what `ReaderProse` renders for an unmatched token.
    // The sheet offers "Dodaj do mojego słownika" off exactly this null (§4).
    const target = glossTargetFrom(
      word({ wordId: "", lemma: "", surface: "Winterfell" }),
      SENTENCE,
    );

    expect(target).not.toBeNull();
    expect(target?.wordId).toBeNull();
    expect(target?.occurrenceId).toBe(9001);
    // With no lemma attribute the surface is the headword to look up.
    expect(target?.lemma).toBe("Winterfell");
  });

  it("keeps a token position of zero, which is a real anchor", () => {
    expect(glossTargetFrom(word({ position: "0" }), SENTENCE)?.tokenPosition).toBe(0);
  });

  it("refuses a span with no occurrence id, which has nowhere to anchor", () => {
    expect(glossTargetFrom(word({ occurrenceId: null }), SENTENCE)).toBeNull();
    expect(glossTargetFrom(word({ occurrenceId: "" }), SENTENCE)).toBeNull();
  });
});

describe("readerBarPlan", () => {
  it("offers a contextual meaning for one selected token", () => {
    const plan = readerBarPlan({
      mode: "selection",
      selection: range({ charStart: 4, charEnd: 11 }), // sollten
    });

    expect(plan.note).toBeNull();
    expect(plan.span?.kind).toBe("word");
    expect(plan.span?.span.surface).toBe("sollten");
    expect(plan.offersUnclear).toBe(false);
  });

  it("offers a phrase for two or more selected tokens", () => {
    const plan = readerBarPlan({
      mode: "selection",
      selection: range({ charStart: 4, charEnd: 20 }), // sollten umkehren
    });

    expect(plan.span?.kind).toBe("phrase");
    expect(plan.span?.span.surface).toBe("sollten umkehren");
    expect(plan.span?.span.tokenCount).toBe(2);
  });

  it("snaps a sloppy drag out to whole tokens", () => {
    const plan = readerBarPlan({
      mode: "selection",
      selection: range({ charStart: 6, charEnd: 17 }), // "llten umke"
    });

    expect(plan.span?.span.surface).toBe("sollten umkehren");
  });

  it("explains a selection that ran past the end of the sentence", () => {
    const plan = readerBarPlan({
      mode: "selection",
      selection: range({ crossSentence: true, charStart: 0, charEnd: 0 }),
    });

    expect(plan.span).toBeNull();
    expect(plan.note).toBe("Zaznacz fragment jednego zdania, aby zapisać zwrot.");
  });

  it("explains a phrase that is too long rather than truncating it", () => {
    // Five tokens selected, two allowed.
    const plan = readerBarPlan(
      { mode: "selection", selection: range({ charStart: 0, charEnd: SENTENCE.length }) },
      2,
    );

    expect(plan.span).toBeNull();
    expect(plan.note).toBe("Zwrot może mieć najwyżej 2 słów.");
  });

  it("explains a selection that touched no token at all", () => {
    const plan = readerBarPlan({
      mode: "selection",
      selection: range({ charStart: 3, charEnd: 4 }), // the space
    });

    expect(plan.note).toBe("Zaznacz co najmniej jedno słowo.");
  });

  it("offers the sentence's own actions for a tapped sentence", () => {
    const plan = readerBarPlan({
      mode: "sentence",
      sentenceId: 77,
      sentenceText: SENTENCE,
    });

    expect(plan).toEqual({
      sentenceId: 77,
      sentenceText: SENTENCE,
      span: null,
      note: null,
      // "Nie rozumiem" belongs to the sentence as a whole, and only there.
      offersUnclear: true,
    });
  });

  it("uses the one phrase limit the database is also passed", () => {
    expect(MAX_PHRASE_TOKENS).toBeGreaterThan(1);
    const words = Array.from({ length: MAX_PHRASE_TOKENS + 1 }, () => "wort");
    const text = words.join(" ");

    const plan = readerBarPlan({
      mode: "selection",
      selection: range({ sentenceText: text, charStart: 0, charEnd: text.length }),
    });

    expect(plan.note).toBe(`Zwrot może mieć najwyżej ${MAX_PHRASE_TOKENS} słów.`);
  });
});
