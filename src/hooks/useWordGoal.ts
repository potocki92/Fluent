"use client";

import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";

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

interface WordGoalProfile {
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

export function useWordGoal(): { data: WordGoalData | undefined; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: WORD_GOAL_KEY,
    queryFn: async (): Promise<WordGoalData> => {
      const supabase = createClientSupabaseClient();
      const { data: profile, error } = await supabase
        .from("profiles")
        .select(WORD_GOAL_COLUMNS)
        .maybeSingle();
      if (error) throw error;

      return toWordGoalData(profile);
    },
    staleTime: 30_000,
  });

  return { data, isLoading };
}
