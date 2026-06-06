/**
 * Daily word-goal helpers — pure, framework-agnostic, and crucially *not* in a
 * `"use client"` module. Both the client hook (`useWordGoal`) and the `/review`
 * Server Component import these. If they lived in the client hook, importing
 * them server-side would yield client-reference proxies instead of the real
 * string/function (breaking `supabase.select(WORD_GOAL_COLUMNS)`).
 */

export interface WordGoalData {
  goal: number;
  /** Reviews done today — 0 when the last review date is not today. */
  reviewedToday: number;
  wordStreak: number;
  /** 0–100 percent toward today's goal. */
  progressPct: number;
}

/** TanStack key for the daily word goal — shared so the server can prime it. */
export const WORD_GOAL_KEY = ["word-goal"] as const;

/** Profile columns the daily goal needs; shared by the client fetch + prefetch. */
export const WORD_GOAL_COLUMNS =
  "daily_word_goal, words_reviewed_today, word_streak_days, last_word_review";

export interface WordGoalProfile {
  daily_word_goal: number | null;
  words_reviewed_today: number | null;
  word_streak_days: number | null;
  last_word_review: string | null;
}

/**
 * Pure transform from a profile row to {@link WordGoalData}. Shared by the
 * client hook and the server prefetch so both write the identical cache value.
 */
export function toWordGoalData(profile: WordGoalProfile | null): WordGoalData {
  const goal = profile?.daily_word_goal ?? 20;
  const wordStreak = profile?.word_streak_days ?? 0;

  // Zero out the count if the last review was not today (day rollover).
  const today = new Date().toISOString().slice(0, 10);
  const reviewedToday =
    profile?.last_word_review === today
      ? (profile.words_reviewed_today ?? 0)
      : 0;

  const progressPct = Math.min(100, Math.round((reviewedToday / goal) * 100));

  return { goal, reviewedToday, wordStreak, progressPct };
}
