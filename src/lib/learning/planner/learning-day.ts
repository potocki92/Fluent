/**
 * What "today" means for a learner.
 *
 * THE BUG THIS EXISTS TO PREVENT. Supabase runs in UTC, so `current_date` is the
 * *server's* day. For a learner in Europe/Warsaw that is the wrong day for one to
 * two hours out of every 24: at 23:30 local on 14 September the database still
 * says 13 September, and a plan keyed on that would hand them yesterday's plan
 * back, refuse to build today's, and — because `unique (user_id, learning_date)`
 * is what makes generation idempotent — silently make it impossible to ever have
 * one. A timezone mistake here is not cosmetic; it breaks the plan's identity.
 *
 * So every date in the Today engine is derived from `profiles.timezone`. The SQL
 * side has the same two functions (`learning_day`, `learning_day_start`) for the
 * places that must compute the day inside a transaction; both mean exactly this,
 * and neither may be replaced by `current_date`.
 *
 * Pure: `now` is always passed in, so the day boundary can be tested instead of
 * hoped for.
 */

/** Used when a stored zone is missing or unusable. */
export const FALLBACK_TIMEZONE = "UTC";

/** Default for a new learner. Fluent is a Polish-first app. */
export const DEFAULT_TIMEZONE = "Europe/Warsaw";

/**
 * The learner's calendar date, as `YYYY-MM-DD`.
 *
 * `en-CA` is used purely because it formats as ISO; the locale never reaches the
 * UI. An unusable zone falls back to UTC rather than throwing — a plan on the
 * wrong day boundary is a much smaller failure than a home screen that crashes.
 */
export function learningDateFor(timeZone: string, now: Date = new Date()): string {
  try {
    return formatter(timeZone).format(now);
  } catch {
    return formatter(FALLBACK_TIMEZONE).format(now);
  }
}

/** True when `timeZone` is one the runtime actually knows. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** A usable zone: the one given, or the app default when it is not. */
export function normalizeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
}

/**
 * The learner's local hour, 0–23 — the only thing the greeting needs.
 *
 * Asking the browser would be simpler and would also be wrong: the Today page
 * renders on the server, and a greeting that flips from "Dzień dobry" to "Dobry
 * wieczór" on hydration is worse than one that is occasionally an hour stale.
 */
export function localHour(timeZone: string, now: Date = new Date()): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        hour12: false,
      }).format(now),
    );
  } catch {
    return now.getUTCHours();
  }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Consecutive completed days ending today (or yesterday), from plan history.
 *
 * WHAT COUNTS AS AN ACTIVE DAY — one rule, stated once. Fluent already has two
 * counters that mean different things (`streak_days` moves on a finished reading
 * test, `word_streak_days` on a day of reviews), and adding a third incompatible
 * definition would make all three meaningless. So this one is not a new stored
 * counter at all: **an active day is a day whose plan was completed**, and the
 * plan history is already the record of it. Nothing is written; it is derived.
 *
 * Counting from yesterday when today is not yet finished is deliberate: a streak
 * that appears to reset at midnight and un-reset at lunchtime punishes people for
 * not having started yet.
 *
 * @param completedDates learning dates (`YYYY-MM-DD`) of completed plans
 * @param today the learner's current date
 */
export function completedDayStreak(
  completedDates: readonly string[],
  today: string,
): number {
  const done = new Set(completedDates);
  let cursor = done.has(today) ? today : previousDay(today);
  let streak = 0;

  while (done.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}

/** The calendar day before `date` (`YYYY-MM-DD`), calendar-correct across months. */
export function previousDay(date: string): string {
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}
