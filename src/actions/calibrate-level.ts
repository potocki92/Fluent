"use server";

import { calibrationSnapshot, type CalibrationLevel } from "@/lib/calibration";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { AbilityState } from "@/types";

/**
 * Set the learner's level from the preset they picked in settings.
 *
 * This is the one path where a learner may move their own ability, and it is
 * deliberate product behaviour: someone who knows they read at B1 should not
 * have to grind up from the default. It is kept honest rather than blocked —
 * `set_manual_level` clamps the value, resets `rd` to full uncertainty so the
 * estimate is treated as a guess, leaves `answered` alone so a self-declaration
 * buys no confidence, and stamps `level_source = 'manual'`.
 *
 * That stamp is the separation the product needs: a level someone typed in is
 * never mistaken for one they proved on a test, and the next finished test
 * overwrites it with `level_source = 'test'`.
 */
export async function calibrateLevel(
  level: CalibrationLevel,
): Promise<ActionResult<AbilityState>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "calibrateLevel: no session");

  let preset;
  try {
    // The preset table is the allowed set; an unknown key never reaches the DB.
    preset = calibrationSnapshot(level, 0);
  } catch (error) {
    return fail("invalid_input", `calibrateLevel: unknown level ${level}`, error);
  }

  const { data, error } = await supabase.rpc("set_manual_level", {
    p_ability: preset.ability,
    p_rd: preset.rd,
  });

  const row = data?.[0];
  if (error || !row) return failFrom(error, `calibrateLevel: ${level}`);

  return {
    ok: true,
    ability: Number(row.ability),
    rd: Number(row.rd),
    answered: row.answered,
    cefrEstimate: (row.cefr_estimate ?? preset.cefrEstimate) as AbilityState["cefrEstimate"],
  };
}
