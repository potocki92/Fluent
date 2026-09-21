import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the library panel is handed about each material.
 *
 * The one thing worth pinning here is the artwork. A card that shows a
 * material's picture can get it two ways: selected with the row it is a column
 * of, or fetched per card afterwards — and the second way is invisible in a
 * screenshot and costs one request per book. So this asserts the shape of the
 * QUERY as much as the shape of the result: `cover_url` is in the select list,
 * it reaches `coverUrl` on the row, and the whole screen is still two round
 * trips whatever the library grows to.
 */

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/content/processor", () => ({
  loadDictionarySnapshot: vi.fn(),
  processChapterById: vi.fn(),
}));

const { listLibraryContent } = await import("@/actions/admin-library");

const STORY = "3e1f0a7c-1111-4aaa-8bbb-000000000001";
const PASSAGE = "3e1f0a7c-2222-4aaa-8bbb-000000000002";
const COVER = "https://project.supabase.co/storage/v1/object/public/content-covers/library/x/a.jpg";

type Row = Record<string, unknown>;

let selects: string[];
let itemRows: Row[];
let chapterRows: Row[];

beforeEach(() => {
  vi.clearAllMocks();
  selects = [];

  itemRows = [
    {
      id: STORY,
      slug: "der-schluessel",
      title: "Der Schlüssel",
      author: null,
      content_type: "story",
      rights: "first_party",
      status: "published",
      cefr_estimate: "A2",
      word_count: 1200,
      chapter_count: 3,
      legacy_text_id: null,
      archived_at: null,
      cover_url: COVER,
    },
    {
      id: PASSAGE,
      slug: "nikolaus-kopernikus",
      title: "Nikolaus Kopernikus",
      author: null,
      content_type: "article",
      rights: "first_party",
      status: "published",
      cefr_estimate: "A1",
      word_count: 300,
      chapter_count: 1,
      legacy_text_id: 41,
      archived_at: null,
      cover_url: null,
    },
  ];

  chapterRows = [
    {
      id: "c1",
      library_item_id: STORY,
      position: 1,
      title: "Der Anfang",
      status: "ready",
      word_count: 400,
      paragraph_count: 8,
      sentence_count: 30,
      estimated_reading_minutes: 3,
      processor_version: "content-1",
      processed_at: "2026-09-01T10:00:00Z",
      processing_error: null,
      dictionary_match_rate: "0.92",
      unmatched_sample: [],
      source_text: "Der Anfang…",
    },
  ];

  mocks.requireAdmin.mockResolvedValue({
    supabase: {
      from(table: string) {
        return builder(table === "library_items" ? itemRows : chapterRows);
      },
    },
    user: { id: "admin-1" },
  });
});

/** Only the operators `listLibraryContent` actually uses. */
function builder(rows: Row[]) {
  const chain = {
    select(columns: string) {
      selects.push(columns);
      return chain;
    },
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return chain as never;
}

describe("listLibraryContent", () => {
  it("hands every material its artwork, straight off the row", async () => {
    const items = await listLibraryContent();

    expect(items).toHaveLength(2);
    expect(items[0].coverUrl).toBe(COVER);
    // A material with no picture says so; the card falls back to its icon
    // rather than rendering an empty box.
    expect(items[1].coverUrl).toBeNull();
  });

  it("selects the cover with the item instead of fetching one per card", async () => {
    await listLibraryContent();

    expect(selects[0]).toContain("cover_url");
    // Two queries for the whole screen — items, then their chapters — however
    // many materials the library holds.
    expect(selects).toHaveLength(2);
  });

  it("still carries the rest of what the panel renders", async () => {
    const [story] = await listLibraryContent();

    expect(story).toMatchObject({
      id: STORY,
      slug: "der-schluessel",
      contentType: "story",
      rights: "first_party",
      legacyTextId: null,
      chapterCount: 3,
    });
    expect(story.chapters).toHaveLength(1);
    expect(story.chapters[0].matchRate).toBeCloseTo(0.92);
  });
});
