import { describe, expect, it } from "vitest";

import type { TodayPlanItem } from "@/actions/today-plan";
import {
  planItemArtwork,
  planItemArtworkLookup,
  planItemWantsArtwork,
} from "@/lib/library/artwork";

function item(overrides: Partial<TodayPlanItem> = {}): TodayPlanItem {
  return {
    id: "item-1",
    position: 1,
    type: "review_due",
    status: "pending",
    estimatedMinutes: 3,
    targetCount: 8,
    completedCount: 0,
    reasonCode: "overdue_reviews",
    reasonData: { count: 8 },
    textId: null,
    libraryItemId: null,
    chapterId: null,
    conceptCode: null,
    wordIds: [],
    payload: {},
    signals: {},
    priorityScore: 0.9,
    ...overrides,
  };
}

const COVER = { url: "https://project.supabase.co/storage/v1/object/public/content-covers/library/11111111-1111-1111-1111-111111111111/a.webp" };

describe("planItemArtworkLookup", () => {
  it("finds a passage's material through the legacy mapping", () => {
    // `legacy_text_id` is how every other legacy id reaches the library; the
    // cover is not allowed a private route of its own.
    expect(planItemArtworkLookup(item({ type: "continue_text", textId: 7 }))).toEqual({
      by: "legacy_text",
      textId: 7,
    });
    expect(planItemArtworkLookup(item({ type: "new_text", textId: 9 }))).toEqual({
      by: "legacy_text",
      textId: 9,
    });
  });

  it("uses the book a chapter belongs to, never the chapter", () => {
    const lookup = planItemArtworkLookup(
      item({
        type: "continue_chapter",
        libraryItemId: "book-1",
        chapterId: "chapter-12",
      }),
    );
    expect(lookup).toEqual({ by: "library_item", itemId: "book-1" });
  });

  it("reaches the parent book when a plan item carries only a chapter", () => {
    // Older plan rows exist with no `library_item_id`. Falling back through the
    // chapter is what keeps yesterday's plan rendering the right cover.
    expect(
      planItemArtworkLookup(item({ type: "new_chapter", chapterId: "chapter-3" })),
    ).toEqual({ by: "chapter", chapterId: "chapter-3" });
  });

  it("asks for nothing on activities that have no material", () => {
    for (const type of ["review_due", "weakness_practice", "new_vocabulary", "placement"] as const) {
      expect(planItemArtworkLookup(item({ type }))).toBeNull();
      expect(planItemWantsArtwork(type)).toBe(false);
    }
  });

  it("asks for nothing when the reference the lookup needs is missing", () => {
    expect(planItemArtworkLookup(item({ type: "continue_text", textId: null }))).toBeNull();
    expect(planItemArtworkLookup(item({ type: "new_chapter" }))).toBeNull();
  });

  it("gives the Story-engine activities the book they are about", () => {
    // A preparation drill and a challenge both NAME a material, and the card
    // already says which kind of work it is in its kicker — so the picture is
    // how a learner recognises the book, not a claim about the task.
    expect(
      planItemArtworkLookup(
        item({ type: "chapter_preparation", libraryItemId: "book-1", chapterId: "ch-2" }),
      ),
    ).toEqual({ by: "library_item", itemId: "book-1" });
    expect(
      planItemArtworkLookup(
        item({ type: "chapter_assessment", chapterId: "ch-2" }),
      ),
    ).toEqual({ by: "chapter", chapterId: "ch-2" });
  });
});

describe("planItemArtwork", () => {
  it("renders the material's picture for a reading activity", () => {
    expect(planItemArtwork(item({ type: "continue_text", textId: 4 }), COVER)).toEqual(
      COVER,
    );
    expect(
      planItemArtwork(item({ type: "continue_chapter", libraryItemId: "b" }), COVER),
    ).toEqual(COVER);
    expect(
      planItemArtwork(item({ type: "chapter_preparation", libraryItemId: "b" }), COVER),
    ).toEqual(COVER);
    expect(
      planItemArtwork(item({ type: "chapter_assessment", libraryItemId: "b" }), COVER),
    ).toEqual(COVER);
  });

  it("falls back to the icon when the material has no artwork", () => {
    expect(planItemArtwork(item({ type: "new_text", textId: 4 }), null)).toBeNull();
    expect(planItemArtwork(item({ type: "new_text", textId: 4 }), undefined)).toBeNull();
    expect(planItemArtwork(item({ type: "new_text", textId: 4 }), { url: "  " })).toBeNull();
  });

  it("never puts a picture on an activity that is not a material", () => {
    // Even handed one. „Powtórki" is a deck; a photograph of one would be a
    // small, plausible-looking lie that would survive review.
    expect(planItemArtwork(item({ type: "review_due" }), COVER)).toBeNull();
    expect(planItemArtwork(item({ type: "weakness_practice" }), COVER)).toBeNull();
    expect(planItemArtwork(item({ type: "new_vocabulary" }), COVER)).toBeNull();
    expect(planItemArtwork(item({ type: "placement" }), COVER)).toBeNull();
  });
});
