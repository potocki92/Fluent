"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuthUser } from "@/components/auth/AuthProvider";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { isAccountUser } from "@/lib/auth/identity";
import { DEFAULT_DAILY_MINUTES } from "@/lib/learning/planner/constants";
import { DEFAULT_TIMEZONE } from "@/lib/learning/planner/learning-day";

export interface LearningPreferencesData {
  dailyLearningMinutes: number;
  timezone: string;
}

export const LEARNING_PREFERENCES_KEY = ["learning-preferences"] as const;

/** The two preferences the Today planner reads: how long, and whose day. */
export function useLearningPreferences() {
  const user = useAuthUser();
  const userId = isAccountUser(user) ? user.id : null;

  return useQuery({
    queryKey: LEARNING_PREFERENCES_KEY,
    queryFn: async (): Promise<LearningPreferencesData> => {
      if (!userId) {
        return {
          dailyLearningMinutes: DEFAULT_DAILY_MINUTES,
          timezone: DEFAULT_TIMEZONE,
        };
      }

      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("daily_learning_minutes, timezone")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;

      return {
        dailyLearningMinutes:
          data?.daily_learning_minutes ?? DEFAULT_DAILY_MINUTES,
        timezone: data?.timezone ?? DEFAULT_TIMEZONE,
      };
    },
  });
}
