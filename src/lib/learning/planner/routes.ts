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
      return item.textId ? `/learn/${item.textId}` : "/learn";
    case "new_vocabulary":
      // The exact words are passed through, so that finishing them satisfies
      // THIS item rather than whatever the review deck would have served.
      return item.wordIds.length > 0
        ? `/review?words=${item.wordIds.join(",")}`
        : "/review";
  }
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
