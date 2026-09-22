import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  DICTIONARY_DETAIL_COLUMNS,
  DICTIONARY_LIST_COLUMNS,
  type DictionaryWordDetail,
} from "@/lib/dictionary/contracts";
import {
  dictionaryKeys,
  fetchWordDetail,
  fetchWordsCursorPage,
  fetchWordsPage,
  WORDS_PAGE_SIZE,
} from "@/lib/dictionary/queries";
import type { Database } from "@/types/database";

/**
 * What the dictionary actually ASKS Postgres for.
 *
 * The bug these tests pin down was invisible to every other kind of check: the
 * list selected eleven columns, cast the result to the full `words` row, and
 * the detail sheet then rendered `{word.ipa && …}` against a field that had
 * never been fetched. Types agreed, lint passed, the build succeeded, and the
 * sheet showed nothing. The only thing that could have caught it is an
 * assertion on the SELECT itself — so that is what this file asserts on.
 */

/** Records the query as it was built, and answers with the rows it is given. */
function recordingClient(rows: unknown[] = [], count = 0) {
  const calls = {
    table: "",
    columns: "",
    order: [] as string[],
    eq: [] as [string, unknown][],
    or: [] as string[],
    gt: [] as [string, unknown][],
    range: null as [number, number] | null,
    limit: null as number | null,
    countOption: undefined as string | undefined,
  };

  const result = { data: rows, error: null, count };
  const chain = {
    select(columns: string, options?: { count?: string }) {
      calls.columns = columns;
      calls.countOption = options?.count;
      return chain;
    },
    order(column: string) {
      calls.order.push(column);
      return chain;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return chain;
    },
    or(filter: string) {
      calls.or.push(filter);
      return chain;
    },
    gt(column: string, value: unknown) {
      calls.gt.push([column, value]);
      return chain;
    },
    range(from: number, to: number) {
      calls.range = [from, to];
      return chain;
    },
    limit(n: number) {
      calls.limit = n;
      return chain;
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: typeof result) => unknown) =>
      Promise.resolve(result).then(resolve),
  };

  const client = {
    from(table: string) {
      calls.table = table;
      return chain;
    },
  };

  // The adapters call `from`, and then only the builder methods above. One
  // cast, at the seam, rather than a hundred unused stubs.
  return { calls, client: client as unknown as SupabaseClient<Database> };
}

/** Every field the detail sheet reads, with a value that is visibly present. */
const FULL_DETAIL: DictionaryWordDetail = {
  id: 77,
  lemma: "ziehen",
  display: "ziehen",
  article: null,
  word_type: "verb",
  gender: null,
  translation_pl: "ciągnąć",
  cefr: "B1",
  example_de: "Er zieht den Wagen.",
  example_pl: "On ciągnie wózek.",
  mnemonic: "🔑 zielony → ciągnie",
  ipa: "ˈtsiːən",
  plural: null,
  aux: "haben",
  synonyms: ["schleppen", "reißen"],
  topic: "bewegung",
};

describe("the detail projection", () => {
  it("selects every column the detail shape promises", () => {
    const selected = new Set(
      DICTIONARY_DETAIL_COLUMNS.split(",").map((column) => column.trim()),
    );

    // THE REGRESSION, stated structurally: a field on the detail type that is
    // not in the SELECT arrives as `undefined` and silently disables the block
    // that renders it. `ipa`, `plural`, `aux`, `synonyms` and `topic` were all
    // in exactly that state.
    for (const field of Object.keys(FULL_DETAIL)) {
      expect(selected, `"${field}" is read by the detail sheet`).toContain(field);
    }
  });

  it("keeps the list projection a strict subset of the detail one", () => {
    const list = DICTIONARY_LIST_COLUMNS.split(",").map((c) => c.trim());
    const detail = new Set(DICTIONARY_DETAIL_COLUMNS.split(",").map((c) => c.trim()));
    for (const column of list) expect(detail).toContain(column);
  });

  it("does NOT ship the detail-only columns on every list row", () => {
    const list = new Set(DICTIONARY_LIST_COLUMNS.split(",").map((c) => c.trim()));
    // Thirty rows per page would otherwise each carry two sentences and an
    // array to show at most one of them.
    for (const column of ["example_de", "example_pl", "synonyms", "mnemonic"]) {
      expect(list).not.toContain(column);
    }
  });

  it("returns every field, not just the ones the row happened to have", async () => {
    const { calls, client } = recordingClient([FULL_DETAIL]);

    const detail = await fetchWordDetail(client, 77);

    expect(calls.table).toBe("words");
    expect(calls.eq).toEqual([["id", 77]]);
    expect(detail).toEqual(FULL_DETAIL);
  });

  it("reports a missing word as null rather than an empty husk", async () => {
    const { client } = recordingClient([]);
    expect(await fetchWordDetail(client, 404)).toBeNull();
  });
});

describe("fetchWordsPage", () => {
  it("orders by lemma with id as the tie-breaker", async () => {
    const { calls, client } = recordingClient([]);

    await fetchWordsPage(client, 0, {});

    // `lemma` is not unique, so without `id` a page boundary falling between
    // two equal lemmas can repeat or drop a row.
    expect(calls.order).toEqual(["lemma", "id"]);
    expect(calls.range).toEqual([0, WORDS_PAGE_SIZE - 1]);
  });

  it("pays for the exact count on the first page only", async () => {
    const first = recordingClient([]);
    await fetchWordsPage(first.client, 0, {});
    expect(first.calls.countOption).toBe("exact");

    const second = recordingClient([]);
    await fetchWordsPage(second.client, 1, {});
    expect(second.calls.countOption).toBeUndefined();
    expect(second.calls.range).toEqual([WORDS_PAGE_SIZE, WORDS_PAGE_SIZE * 2 - 1]);
  });

  it("searches the German AND the Polish side", async () => {
    const { calls, client } = recordingClient([]);

    await fetchWordsPage(client, 0, { search: "ziehen" });

    expect(calls.or).toEqual([
      "lemma.ilike.%ziehen%,display.ilike.%ziehen%,translation_pl.ilike.%ziehen%",
    ]);
  });

  it("applies each narrowing filter to its own column", async () => {
    const { calls, client } = recordingClient([]);

    await fetchWordsPage(client, 0, { cefr: "B1", type: "verb", topic: "bewegung" });

    expect(calls.eq).toEqual([
      ["cefr", "B1"],
      ["word_type", "verb"],
      ["topic", "bewegung"],
    ]);
  });

  it("ends the list when a short page comes back", async () => {
    const { client } = recordingClient([{ id: 1 }], 1);
    const page = await fetchWordsPage(client, 0, {});
    expect(page.nextPage).toBeNull();
    expect(page.count).toBe(1);
  });

  it("offers another page when this one was full", async () => {
    const rows = Array.from({ length: WORDS_PAGE_SIZE }, (_, i) => ({ id: i + 1 }));
    const { client } = recordingClient(rows, 200);
    expect((await fetchWordsPage(client, 2, {})).nextPage).toBe(3);
  });
});

describe("fetchWordsCursorPage", () => {
  it("walks forward from the cursor and reports the next one", async () => {
    const rows = Array.from({ length: WORDS_PAGE_SIZE }, (_, i) => ({ id: i + 101 }));
    const { calls, client } = recordingClient(rows);

    const page = await fetchWordsCursorPage(client, 100, {});

    expect(calls.gt).toEqual([["id", 100]]);
    expect(calls.limit).toBe(WORDS_PAGE_SIZE);
    expect(page.nextCursor).toBe(100 + WORDS_PAGE_SIZE);
  });

  it("omits the cursor predicate on the first page", async () => {
    const { calls, client } = recordingClient([]);
    await fetchWordsCursorPage(client, null, {});
    expect(calls.gt).toEqual([]);
  });

  it("shares the one filter meaning with the offset page", async () => {
    const { calls, client } = recordingClient([]);

    await fetchWordsCursorPage(client, null, { search: "Haus" });

    // The module this replaced searched only `lemma`, so the same word was
    // findable on one dictionary screen and not the other.
    expect(calls.or).toEqual([
      "lemma.ilike.%Haus%,display.ilike.%Haus%,translation_pl.ilike.%Haus%",
    ]);
  });
});

describe("dictionaryKeys", () => {
  it("separates a list from a detail, and one detail from another", () => {
    expect(dictionaryKeys.list({})).not.toEqual(dictionaryKeys.detail(1));
    expect(dictionaryKeys.detail(1)).not.toEqual(dictionaryKeys.detail(2));
  });

  it("gives the same key for the same filters, so an SSR prefetch is reused", () => {
    expect(dictionaryKeys.list({ cefr: "B1" })).toEqual(
      dictionaryKeys.list({ cefr: "B1" }),
    );
  });
});
