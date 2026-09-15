import { describe, expect, it } from "vitest";

import { MAX_PHRASE_TOKENS } from "@/lib/notebook/constants";
import {
  annotationKindForSpan,
  spanFromCharRange,
  spanFromTokenPositions,
} from "@/lib/notebook/selection";

const SENTENCE = "„Wir sollten umkehren“, drängte Gared.";
const PHRASE_SENTENCE = "Machen euch die Toten Angst?";

function span(result: ReturnType<typeof spanFromCharRange>) {
  if (!result.ok) throw new Error(`expected a span, got ${result.reason}`);
  return result.span;
}

describe("spanFromCharRange", () => {
  it("snaps a sloppy drag out to whole tokens", () => {
    // "ollte" — starts and ends inside the word, as a finger on glass does.
    const from = SENTENCE.indexOf("sollten") + 1;
    const result = span(spanFromCharRange(SENTENCE, from, from + 5));

    expect(result.surface).toBe("sollten");
    expect(result.tokenCount).toBe(1);
    expect(SENTENCE.slice(result.charStart, result.charEnd)).toBe("sollten");
  });

  it("keeps the text between tokens exactly as the book has it", () => {
    const from = PHRASE_SENTENCE.indexOf("die");
    const to = PHRASE_SENTENCE.indexOf("Angst") + "Angst".length;
    const result = span(spanFromCharRange(PHRASE_SENTENCE, from, to));

    expect(result.surface).toBe("die Toten Angst");
    expect(result.tokenCount).toBe(3);
  });

  it("tolerates a backwards drag", () => {
    const to = SENTENCE.indexOf("Gared");
    const from = to + 5;
    expect(span(spanFromCharRange(SENTENCE, from, to)).surface).toBe("Gared");
  });

  it("refuses a selection that covers no word", () => {
    // The typographic quote and the comma after "umkehren".
    const at = SENTENCE.indexOf("“");
    const result = spanFromCharRange(SENTENCE, at, at + 2);
    expect(result).toEqual({ ok: false, reason: "no_tokens" });
  });

  it("refuses a selection longer than a phrase may be", () => {
    const long = Array.from({ length: MAX_PHRASE_TOKENS + 1 }, (_, i) => `wort${i}`).join(
      " ",
    );
    expect(spanFromCharRange(long, 0, long.length)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts a selection exactly at the limit", () => {
    const limit = Array.from({ length: MAX_PHRASE_TOKENS }, (_, i) => `wort${i}`).join(
      " ",
    );
    expect(span(spanFromCharRange(limit, 0, limit.length)).tokenCount).toBe(
      MAX_PHRASE_TOKENS,
    );
  });
});

describe("spanFromTokenPositions", () => {
  it("re-derives the same offsets the reader computed", () => {
    const fromChars = span(
      spanFromCharRange(
        PHRASE_SENTENCE,
        PHRASE_SENTENCE.indexOf("Toten"),
        PHRASE_SENTENCE.indexOf("Angst") + 5,
      ),
    );
    const fromPositions = span(
      spanFromTokenPositions(
        PHRASE_SENTENCE,
        fromChars.startPosition,
        fromChars.endPosition,
      ),
    );

    expect(fromPositions).toEqual(fromChars);
  });

  it("refuses positions the sentence does not have", () => {
    expect(spanFromTokenPositions(PHRASE_SENTENCE, 0, 99)).toEqual({
      ok: false,
      reason: "no_tokens",
    });
    expect(spanFromTokenPositions(PHRASE_SENTENCE, 3, 1)).toEqual({
      ok: false,
      reason: "no_tokens",
    });
  });

  it("agrees with the pipeline's token positions", () => {
    // "sollten" is the second LEXICAL token of the sentence — the quote marks
    // are not tokens. This is the number `word_occurrences.position` holds, and
    // the whole anchoring scheme depends on the two staying identical.
    const result = span(
      spanFromCharRange(
        SENTENCE,
        SENTENCE.indexOf("sollten"),
        SENTENCE.indexOf("sollten") + 7,
      ),
    );
    expect(result.startPosition).toBe(1);
  });
});

describe("annotationKindForSpan", () => {
  it("calls one token a word and two a phrase", () => {
    const word = span(
      spanFromCharRange(PHRASE_SENTENCE, 0, "Machen".length),
    );
    const phrase = span(
      spanFromCharRange(
        PHRASE_SENTENCE,
        PHRASE_SENTENCE.indexOf("Toten"),
        PHRASE_SENTENCE.indexOf("Angst") + 5,
      ),
    );

    expect(annotationKindForSpan(word)).toBe("word");
    expect(annotationKindForSpan(phrase)).toBe("phrase");
  });
});
