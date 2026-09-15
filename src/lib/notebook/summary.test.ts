import { describe, expect, it } from "vitest";

import {
  EMPTY_SUMMARY,
  summarizeNotebook,
  type CountableEntry,
} from "@/lib/notebook/summary";

function entry(overrides: Partial<CountableEntry>): CountableEntry {
  return {
    entry_type: "word",
    word_id: 1,
    has_translation: false,
    is_unclear: false,
    ...overrides,
  };
}

describe("summarizeNotebook", () => {
  it("counts nothing for nothing", () => {
    expect(summarizeNotebook([])).toEqual(EMPTY_SUMMARY);
  });

  it("counts a personal word as a word too", () => {
    const summary = summarizeNotebook([
      entry({ word_id: 42 }),
      entry({ word_id: null }),
    ]);
    expect(summary.words).toBe(2);
    expect(summary.personalWords).toBe(1);
  });

  it("never counts a phrase as words", () => {
    const summary = summarizeNotebook([entry({ entry_type: "phrase", word_id: null })]);
    expect(summary).toMatchObject({ words: 0, personalWords: 0, phrases: 1 });
  });

  it("counts a sentence that is both translated and unclear in both columns", () => {
    const summary = summarizeNotebook([
      entry({
        entry_type: "sentence",
        word_id: null,
        has_translation: true,
        is_unclear: true,
      }),
    ]);
    expect(summary.translations).toBe(1);
    expect(summary.unclear).toBe(1);
    // …and still as ONE note, which is what the notebook lists.
    expect(summary.total).toBe(1);
  });

  it("does not count an unclear sentence as a translation", () => {
    const summary = summarizeNotebook([
      entry({ entry_type: "sentence", word_id: null, is_unclear: true }),
    ]);
    expect(summary.translations).toBe(0);
    expect(summary.unclear).toBe(1);
  });
});
