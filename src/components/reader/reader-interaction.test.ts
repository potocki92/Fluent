import { describe, expect, it } from "vitest";

import {
  distanceToRect,
  glossTargetFrom,
  isDragGesture,
  isUsableSelection,
  readerBarPlan,
  resolveReaderIntent,
  type PointerTrack,
  type ReaderGesture,
  type ReaderWordHit,
  type SelectedRange,
} from "@/components/reader/reader-interaction";
import { MAX_PHRASE_TOKENS } from "@/lib/notebook/constants";
import {
  CLICK_PAIRING_MS,
  TAP_SLOP_PX,
  WORD_TAP_SNAP_PX,
} from "@/lib/reading/constants";

/**
 * THE REGRESSION SUITE FOR THE iOS WORD TAP.
 *
 * The symptom was a learner tapping *Wir* and getting the SENTENCE action bar —
 * "Przetłumacz zdanie / Nie rozumiem" — instead of the word sheet. Two previous
 * fixes tried to teach the tap which selections to ignore; it kept coming back,
 * because on a phone no test of the browser's selection is decisive at the
 * moment a click fires. So the tap no longer reads the selection at all, and
 * these tests are what says so: there is no way to construct a gesture on a word
 * that resolves to anything but the word.
 *
 * What is left to decide is whether a click was a TAP, which is answered from
 * pointer movement — `isDragGesture` — and where a near miss lands, which is
 * answered from geometry — `distanceToRect`. Both are here.
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
  return { word: null, sentenceId: 77, isDrag: false, ...overrides };
}

function track(overrides: Partial<PointerTrack> = {}): PointerTrack {
  return {
    startX: 100,
    startY: 200,
    endX: 100,
    endY: 200,
    endedAt: 1_000,
    pointerType: "touch",
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

  it("never lets the sentence outrank a word", () => {
    // The sentence is the FALLBACK, and a word hit always carries a sentence too.
    const intent = resolveReaderIntent(gesture({ word: word(), sentenceId: 77 }));

    expect(intent.kind).toBe("word");
  });

  it("offers the sentence's actions for a tap on the space between words", () => {
    const intent = resolveReaderIntent(gesture({ word: null, sentenceId: 77 }));

    expect(intent).toEqual({ kind: "sentence", sentenceId: 77 });
  });

  it("offers the sentence's actions for a tap on punctuation", () => {
    // Punctuation is not an occurrence, so there is no `.reader-word` under it.
    expect(resolveReaderIntent(gesture({ word: null })).kind).toBe("sentence");
  });

  it("does nothing for a tap outside any sentence", () => {
    expect(resolveReaderIntent(gesture({ sentenceId: null })).kind).toBe("none");
  });

  it("leaves everything alone for the trailing click of a drag", () => {
    // A drag-select ends on a word and fires a click there. That is not a tap,
    // and it must not dismiss the bar the selection channel just opened — which
    // is why this is `ignore` and not `none`.
    const intent = resolveReaderIntent(gesture({ word: word(), isDrag: true }));

    expect(intent).toEqual({ kind: "ignore" });
  });
});

describe("isDragGesture", () => {
  it("calls a click with no pointer gesture behind it a tap", () => {
    // THE BUG, IN ITS PUREST FORM. iOS delivers the tap that dismisses a
    // selection callout as a click with NO pointerdown of its own. Two previous
    // fixes lost exactly this gesture to a leftover range; it is a tap.
    expect(isDragGesture(null, 1_000, TAP_SLOP_PX, CLICK_PAIRING_MS)).toBe(false);
  });

  it("calls a still-pressed pointer a tap rather than guessing", () => {
    expect(
      isDragGesture(track({ endedAt: null }), 1_000, TAP_SLOP_PX, CLICK_PAIRING_MS),
    ).toBe(false);
  });

  it("calls a finger that wobbled a tap", () => {
    const wobble = track({ endX: 100 + TAP_SLOP_PX - 1, endY: 200 });

    expect(isDragGesture(wobble, 1_010, TAP_SLOP_PX, CLICK_PAIRING_MS)).toBe(false);
  });

  it("calls a pointer that travelled a drag", () => {
    const dragged = track({ endX: 260, endY: 240 });

    expect(isDragGesture(dragged, 1_010, TAP_SLOP_PX, CLICK_PAIRING_MS)).toBe(true);
  });

  it("measures the distance, not either axis alone", () => {
    // 8px across and 8px down is 11.3px of travel — a drag, although neither
    // axis on its own passes the slop.
    const diagonal = track({ endX: 108, endY: 208 });

    expect(isDragGesture(diagonal, 1_010, TAP_SLOP_PX, CLICK_PAIRING_MS)).toBe(true);
  });

  it("refuses to pair a click with a gesture too old to be its own", () => {
    // A scroll whose click never came, then — seconds later — a click with no
    // pointerdown of its own. Pairing them would swallow a real tap.
    const scrolled = track({ endX: 100, endY: 900 });

    expect(
      isDragGesture(scrolled, 1_000 + CLICK_PAIRING_MS + 1, TAP_SLOP_PX, CLICK_PAIRING_MS),
    ).toBe(false);
  });
});

describe("distanceToRect", () => {
  // A word's inline box on a phone: about 46px across and 20px tall.
  const box = { left: 100, right: 146, top: 200, bottom: 220 };

  it("is zero anywhere inside the word", () => {
    expect(distanceToRect(box, 120, 210)).toBe(0);
    expect(distanceToRect(box, 100, 200)).toBe(0);
  });

  it("snaps the tap that lands in the gap beside a word", () => {
    // THE MISS THIS EXISTS FOR. The space between two words is 4–5px wide and a
    // fingertip is nine millimetres across, so this tap was meant for the word.
    expect(distanceToRect(box, 148, 210)).toBeLessThan(WORD_TAP_SNAP_PX);
  });

  it("snaps a tap in the leading just above the line", () => {
    expect(distanceToRect(box, 120, 194)).toBeLessThan(WORD_TAP_SNAP_PX);
  });

  it("does not reach the next line, or the far side of the column", () => {
    expect(distanceToRect(box, 120, 245)).toBeGreaterThan(WORD_TAP_SNAP_PX);
    expect(distanceToRect(box, 300, 210)).toBeGreaterThan(WORD_TAP_SNAP_PX);
  });

  it("measures the corner diagonally, so the snap is a radius and not a box", () => {
    expect(distanceToRect(box, 149, 197)).toBeCloseTo(Math.hypot(3, 3), 5);
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
