import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import {
  DEFAULT_DAILY_MINUTES,
} from "@/lib/learning/planner/constants";
import { DEFAULT_TIMEZONE } from "@/lib/learning/planner/learning-day";

export interface LearningPreferencesData {
  dailyLearningMinutes: number;
  timezone: string;
}

export const LEARNING_PREFERENCES_KEY = ["learning-preferences"] as const;

/** The two preferences the Today planner reads: how long, and whose day. */
export function useLearningPreferences() {
  return useQuery({
    queryKey: LEARNING_PREFERENCES_KEY,
    queryFn: async (): Promise<LearningPreferencesData> => {
      const supabase = createClientSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return {
          dailyLearningMinutes: DEFAULT_DAILY_MINUTES,
          timezone: DEFAULT_TIMEZONE,
        };
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("daily_learning_minutes, timezone")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;

      return {
        dailyLearningMinutes: data?.daily_learning_minutes ?? DEFAULT_DAILY_MINUTES,
        timezone: data?.timezone ?? DEFAULT_TIMEZONE,
      };
    },
  });
}
