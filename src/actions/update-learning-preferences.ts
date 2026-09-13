"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  MAX_DAILY_MINUTES,
  MIN_DAILY_MINUTES,
} from "@/lib/learning/planner/constants";
import { isValidTimeZone } from "@/lib/learning/planner/learning-day";
import { fail, failFrom, type ActionResult } from "@/lib/errors";

export interface LearningPreferences {
  dailyLearningMinutes: number;
  timezone: string;
}

/**
 * Update the two preferences the Today planner reads.
 *
 * Both are ordinary learner-editable profile columns, like `display_name` and
 * `daily_word_goal` — they express what someone WANTS, not what they have
 * proved, so the progress guard leaves them alone.
 *
 * The clamp and the timezone check are here as well as in the database because
 * they mean different things in each place: here they keep the UI honest, and
 * the `profiles_validate_timezone` trigger keeps a bad value out of the column
 * whatever writes it. A zone the database cannot resolve would make `at time
 * zone` raise inside plan generation — i.e. a settings typo would break the home
 * screen for good.
 */
export async function updateLearningPreferences(input: {
  dailyLearningMinutes?: number;
  timezone?: string;
}): Promise<ActionResult<LearningPreferences>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "updateLearningPreferences: no session");

  const update: { daily_learning_minutes?: number; timezone?: string } = {};

  if (input.dailyLearningMinutes !== undefined) {
    const minutes = Math.round(Number(input.dailyLearningMinutes));
    if (!Number.isFinite(minutes)) {
      return fail("invalid_input", "updateLearningPreferences: bad minutes", input);
    }
    update.daily_learning_minutes = Math.min(
      MAX_DAILY_MINUTES,
      Math.max(MIN_DAILY_MINUTES, minutes),
    );
  }

  if (input.timezone !== undefined) {
    if (!isValidTimeZone(input.timezone)) {
      return fail("invalid_input", "updateLearningPreferences: bad timezone", input);
    }
    update.timezone = input.timezone;
  }

  if (Object.keys(update).length === 0) {
    return fail("invalid_input", "updateLearningPreferences: nothing to update");
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id)
    .select("daily_learning_minutes, timezone")
    .single();
  if (error || !data) {
    return failFrom(error, `updateLearningPreferences: ${user.id}`);
  }

  return {
    ok: true,
    dailyLearningMinutes: data.daily_learning_minutes,
    timezone: data.timezone,
  };
}
