/**
 * Where a plan activity actually takes the learner.
 *
 * One function, used by both the primary CTA and the individual cards, so the
 * button at the top of Today and the row it refers to can never disagree about
 * where "Kontynuuj naukę" goes.
 *
 * Every destination is a screen that already exists. That is the constraint that
 * decided the item types in the first place: a plan must not contain a task
 * whose button leads nowhere.
 */

import type { TodayPlanItem } from "@/actions/today-plan";

export function planItemHref(item: TodayPlanItem): string {
  switch (item.type) {
    case "placement":
      return "/calibration";
    case "review_due":
      return "/review";
    case "weakness_practice":
      return item.conceptCode
        ? `/practice/${item.conceptCode}?item=${item.id}`
        : "/review";
    case "continue_text":
    case "new_text":
      // `/learn/[id]` redirects into the reader once the passage has been
      // processed, so this one href is correct either side of the migration.
      return item.textId ? `/learn/${item.textId}` : "/learn";
    case "continue_chapter":
    case "new_chapter":
      return chapterHref(item);
    case "new_vocabulary":
      // The exact words are passed through, so that finishing them satisfies
      // THIS item rather than whatever the review deck would have served.
      return item.wordIds.length > 0
        ? `/review?words=${item.wordIds.join(",")}`
        : "/review";
  }
}

/**
 * Where a reading activity goes.
 *
 * The slug and the chapter position were SNAPSHOTTED onto the item when the plan
 * was built, so yesterday's plan still links to the chapter it recommended even
 * if the book has since been renamed — and so rendering the plan needs no join.
 * Without both, the fallback is the library rather than a 404.
 */
function chapterHref(item: TodayPlanItem): string {
  const slug = typeof item.payload.slug === "string" ? item.payload.slug : null;
  const position =
    typeof item.payload.chapterPosition === "number"
      ? item.payload.chapterPosition
      : null;
  if (!slug || position === null) return "/library";
  return `/library/${slug}/${position}`;
}

/** The first activity still to do — what the one big button opens. */
export function nextPlanItem(items: readonly TodayPlanItem[]): TodayPlanItem | null {
  return (
    items.find((item) => item.status === "in_progress") ??
    items.find((item) => item.status === "pending") ??
    null
  );
}

/** Items that count toward "3 z 4 ukończone" — a skipped task is resolved, not done. */
export function planProgress(items: readonly TodayPlanItem[]): {
  done: number;
  total: number;
  percent: number;
} {
  const total = items.length;
  const done = items.filter((item) => item.status === "completed").length;
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
