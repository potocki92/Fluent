"use server";

import { abilityToCefr } from "@/lib/cefr";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AbilityState } from "@/types";

export type CalibrationLevel = "green" | "a1" | "a2" | "b1" | "b2";

const CALIBRATION_PRESETS: Record<
  CalibrationLevel,
  { ability: number; rd: number }
> = {
  green: { ability: 1000, rd: 350 },
  a1: { ability: 1100, rd: 350 },
  a2: { ability: 1300, rd: 300 },
  b1: { ability: 1450, rd: 300 },
  b2: { ability: 1600, rd: 300 },
};

export async function calibrateLevel(
  level: CalibrationLevel,
): Promise<AbilityState> {
  const preset = CALIBRATION_PRESETS[level];
  if (!preset) throw new Error("Nieprawidłowy poziom kalibracji.");

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const next: AbilityState = {
    ability: preset.ability,
    rd: preset.rd,
    answered: 0,
    cefrEstimate: abilityToCefr(preset.ability),
  };

  const { error } = await supabase
    .from("profiles")
    .update({
      ability: next.ability,
      rd: next.rd,
      answered: next.answered,
      cefr_estimate: next.cefrEstimate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) throw error;

  return next;
}
