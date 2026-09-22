import { describe, expect, it } from "vitest";

import {
  adminKeys,
  learnerKeys,
  notebookKeys,
  savedWordKeys,
  textKeys,
  wordKeys,
} from "@/lib/query-keys";

/**
 * The one property that makes these keys work, asserted once.
 *
 * `invalidateQueries({ queryKey: X })` matches every key that STARTS WITH `X`.
 * So a narrower key that does not begin with its family's `all` is not
 * invalidated by it — and nothing fails: the screen simply keeps showing what
 * it showed, and the learner decides their edit did not save.
 *
 * That is the whole reason this file exists. It cannot be caught by a type,
 * because every key is a valid array of strings whichever segments it holds.
 */

/** Does invalidating `prefix` match `key`? TanStack's rule, written out. */
function matches(prefix: readonly unknown[], key: readonly unknown[]): boolean {
  return (
    prefix.length <= key.length &&
    prefix.every((segment, i) => Object.is(segment, key[i]))
  );
}

describe("a family's `all` invalidates everything beneath it", () => {
  it("covers both dictionary pagination strategies and the detail sheet", () => {
    for (const key of [
      wordKeys.list({}),
      wordKeys.list({ cefr: "B1" }),
      wordKeys.cursor({}),
      wordKeys.detail(7),
    ]) {
      expect(matches(wordKeys.all, key), JSON.stringify(key)).toBe(true);
    }
  });

  it("covers the deck and its due slice", () => {
    expect(matches(savedWordKeys.all, savedWordKeys.due())).toBe(true);
  });

  it("covers a passage's detail", () => {
    expect(matches(textKeys.all, textKeys.detail(41))).toBe(true);
  });

  it("covers every notebook view", () => {
    for (const key of [
      notebookKeys.entries({ filter: "all" }),
      notebookKeys.books(),
      notebookKeys.sentence(12),
      notebookKeys.chapter("c-1"),
    ]) {
      expect(matches(notebookKeys.all, key), JSON.stringify(key)).toBe(true);
    }
  });

  it("covers the admin word list from the bare admin-words key", () => {
    expect(matches(adminKeys.words(), adminKeys.words({ cefr: "A1" }))).toBe(true);
    expect(matches(adminKeys.words(), adminKeys.wordsMissingCount())).toBe(true);
  });
});

describe("families stay apart", () => {
  it("does not let one family's invalidation reach another's", () => {
    const families: [string, readonly unknown[]][] = [
      ["words", wordKeys.all],
      ["saved_words", savedWordKeys.all],
      ["texts", textKeys.all],
      ["notebook", notebookKeys.all],
      ["adminTexts", adminKeys.texts()],
      ["adminWords", adminKeys.words()],
    ];

    for (const [nameA, a] of families) {
      for (const [nameB, b] of families) {
        if (nameA === nameB) continue;
        expect(matches(a, b), `${nameA} must not match ${nameB}`).toBe(false);
      }
    }
  });

  it("keeps the dictionary's two pagination strategies on separate keys", () => {
    // They have different page shapes; sharing a key would hand an offset page
    // to a reader expecting a cursor one.
    expect(matches(wordKeys.list({}), wordKeys.cursor({}))).toBe(false);
    expect(matches(wordKeys.cursor({}), wordKeys.list({}))).toBe(false);
  });

  it("gives each learner-scoped fact its own key", () => {
    const keys = [
      learnerKeys.profile(),
      learnerKeys.isAdmin(),
      learnerKeys.completedTexts(),
      learnerKeys.wordGoal(),
      learnerKeys.learningPreferences(),
      learnerKeys.calibrationQuestions(),
    ];
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
  });
});

describe("the same question produces the same key", () => {
  it("so an SSR prefetch is read rather than refetched on mount", () => {
    expect(wordKeys.list({ cefr: "B1", type: "verb" })).toEqual(
      wordKeys.list({ cefr: "B1", type: "verb" }),
    );
    expect(notebookKeys.entries({ filter: "words", search: "  Haus  " })).toEqual(
      notebookKeys.entries({ filter: "words", search: "Haus" }),
    );
  });

  it("normalises an absent filter to null rather than undefined", () => {
    // `undefined` and `null` are different cache keys, so a caller that omits a
    // field and one that passes null explicitly must not end up on two keys.
    expect(notebookKeys.entries({ filter: "all" })).toEqual(
      notebookKeys.entries({
        filter: "all",
        libraryItemId: null,
        chapterId: null,
        search: null,
      }),
    );
    expect(notebookKeys.entries({ filter: "all", search: "   " })).toEqual(
      notebookKeys.entries({ filter: "all", search: null }),
    );
  });
});
