"use server";

import { calibrationSnapshot, type CalibrationLevel } from "@/lib/calibration";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AbilityState } from "@/types";

export async function calibrateLevel(
  level: CalibrationLevel,
): Promise<AbilityState> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("answered")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) throw new Error("Profile not found");

  const next = calibrationSnapshot(level, profile.answered);

  const { error } = await supabase
    .from("profiles")
    .update({
      ability: next.ability,
      rd: next.rd,
      cefr_estimate: next.cefrEstimate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) throw error;

  return next;
}
