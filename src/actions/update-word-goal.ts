"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const MIN_GOAL = 5;
const MAX_GOAL = 100;

export async function updateWordGoal(
  goal: number,
): Promise<{ goal: number }> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const clamped = Math.min(MAX_GOAL, Math.max(MIN_GOAL, Math.round(goal)));

  const { error } = await supabase
    .from("profiles")
    .update({ daily_word_goal: clamped })
    .eq("id", user.id);
  if (error) throw error;

  return { goal: clamped };
}
