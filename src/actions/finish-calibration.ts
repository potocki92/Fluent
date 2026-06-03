"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { abilityToCefr } from "@/lib/cefr";
import { RD_MIN } from "@/lib/elo";
import { FINAL_RD } from "@/lib/calibration-test";
import type { AbilityState } from "@/types";

export interface FinishCalibrationInput {
  ability: number;
  rd: number;
  /** How many placement items the learner just answered. */
  items: number;
}

/** Keep a placement result inside a sane Elo range. */
const ABILITY_MIN = 900;
const ABILITY_MAX = 2000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Persist the result of the adaptive placement test to the learner's profile.
 * Trusting the client estimate here is acceptable for the same reason as the
 * manual `calibrateLevel` action — a user can only set their *own* level, so the
 * worst case is a worse learning experience for themselves.
 */
export async function finishCalibration(
  input: FinishCalibrationInput,
): Promise<AbilityState> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile, error: pError } = await supabase
    .from("profiles")
    .select("answered")
    .eq("id", user.id)
    .single();
  if (pError || !profile) throw new Error("Profile not found");

  const ability = Math.round(clamp(input.ability, ABILITY_MIN, ABILITY_MAX));
  const rd = clamp(input.rd, RD_MIN, FINAL_RD);
  // A completed placement counts as real signal, but never lowers an existing
  // answer count.
  const answered = Math.max(profile.answered, input.items);
  const cefrEstimate = abilityToCefr(ability);

  const { error } = await supabase
    .from("profiles")
    .update({
      ability,
      rd,
      answered,
      cefr_estimate: cefrEstimate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) throw error;

  return { ability, rd, answered, cefrEstimate };
}
