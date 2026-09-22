/**
 * Which plan activity has a picture, and where to look for it.
 *
 * ARTWORK IS NOT PLAN DATA. A daily plan is a snapshot of what to do today, and
 * `today-engine.md`'s stability rule says it is generated once and never
 * rewritten. A cover is presentation metadata about the MATERIAL — an admin who
 * replaces a photo at noon must not thereby invalidate anybody's plan, reset a
 * task's status or trigger a regeneration. So the cover is never written into
 * `daily_plan_items.payload`; the card resolves it at render time from the
 * library, using ids the plan already carries.
 *
 * NOT EVERY ACTIVITY WANTS ONE. „Powtórki" is a deck, not a material — there is
 * no honest picture of it, and inventing one would make the image decorative
 * noise rather than a way to recognise what you were reading. The six activities
 * that name a material have one; everything else keeps `PLAN_ITEM_ICONS`, and
 * {@link planItemArtwork} enforces that even if a caller hands over a URL for
 * something else.
 *
 * PURE. The lookup this produces is executed by `getMaterialArtwork` in
 * `src/lib/library/queries.ts`, which is the only file in this folder allowed to
 * touch Supabase.
 */

import type { TodayPlanItem } from "@/actions/today-plan";
import type { PlanItemType } from "@/lib/learning/planner/types";

/**
 * A material's picture, as the UI needs it.
 *
 * An object rather than a bare string because a cover is one of several things a
 * material could later hand a card (a dominant colour, a blur placeholder), and
 * widening a record is cheaper than changing every prop that passes a string.
 */
export interface MaterialArtwork {
  /** Absolute, public, and — for a managed cover — served from our own bucket. */
  url: string;
}

/**
 * The activities whose material has artwork.
 *
 * THE TEST IS "DOES THIS NAME A MATERIAL", NOT "IS THIS READING". The two
 * Story-engine activities were once excluded on the grounds that preparation is
 * work ABOUT a chapter rather than the chapter itself — but the card already
 * says which kind of work it is, in the kicker above the title („PRZYGOTOWANIE",
 * „WYZWANIE"), and it names the material underneath. Withholding the picture
 * there did not keep the two kinds of task apart; it only made the card that
 * offers *Die neuen Nachbarn* unrecognisable next to the shelf that shows it,
 * which is precisely the recognition the artwork exists for.
 *
 * `review_due`, `weakness_practice`, `new_vocabulary` and `placement` stay out,
 * and for the original reason: there is no material behind them, so any picture
 * would be decoration pretending to be information.
 */
export const ARTWORK_PLAN_ITEM_TYPES: readonly PlanItemType[] = [
  "continue_text",
  "new_text",
  "continue_chapter",
  "new_chapter",
  "chapter_preparation",
  "chapter_assessment",
];

export function planItemWantsArtwork(type: PlanItemType): boolean {
  return ARTWORK_PLAN_ITEM_TYPES.includes(type);
}

/**
 * How to find a material's library item from a plan item.
 *
 *  - a passage (`continue_text` / `new_text`) is reached through
 *    `library_items.legacy_text_id`, the mapping every other legacy id already
 *    travels;
 *  - a chapter activity — including the preparation and challenge drills built
 *    on one — normally carries `library_item_id` directly;
 *  - an older plan item may carry only `chapter_id`, so the chapter's parent is
 *    the third route. It is a route, not a duplicate: the cover belongs to the
 *    BOOK, and a 30-chapter novel stores one URL rather than thirty.
 */
export type ArtworkLookup =
  | { by: "legacy_text"; textId: number }
  | { by: "library_item"; itemId: string }
  | { by: "chapter"; chapterId: string };

export function planItemArtworkLookup(item: TodayPlanItem): ArtworkLookup | null {
  if (!planItemWantsArtwork(item.type)) return null;

  if (item.type === "continue_text" || item.type === "new_text") {
    return item.textId === null ? null : { by: "legacy_text", textId: item.textId };
  }

  if (item.libraryItemId) return { by: "library_item", itemId: item.libraryItemId };
  if (item.chapterId) return { by: "chapter", chapterId: item.chapterId };
  return null;
}

/**
 * The artwork this card may actually render.
 *
 * The last gate before the pixels. It re-checks the activity's type rather than
 * trusting that whoever resolved the artwork checked it, because the failure it
 * prevents — a photograph of a café on „Powtórki" — is silent, plausible-looking
 * and would survive review. A blank or whitespace URL is no artwork either; the
 * card falls back to its icon.
 */
export function planItemArtwork(
  item: TodayPlanItem,
  artwork: MaterialArtwork | null | undefined,
): MaterialArtwork | null {
  if (!artwork || !planItemWantsArtwork(item.type)) return null;
  const url = artwork.url.trim();
  return url ? { url } : null;
}
