"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fail, failFrom, type ActionResult } from "@/lib/errors";

/**
 * Open a placement-test session.
 *
 * Unlike a reading test, the item set is not snapshotted up front — the test is
 * adaptive, so the next item depends on the previous answer. What the session
 * provides is a server-side record every answer is written to, which is what
 * makes the final rating reproducible from stored data rather than reported by
 * the browser (see `finalizeCalibrationSession`).
 *
 * A leftover unfinished session is abandoned rather than resumed: the adaptive
 * cursor is not persisted, so a half-finished run cannot be picked up mid-way.
 */
export async function startCalibrationSession(): Promise<
  ActionResult<{ sessionId: string }>
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startCalibrationSession: no session");

  const { data, error } = await supabase.rpc("start_calibration_session");
  if (error || !data) {
    return failFrom(error, "startCalibrationSession: rpc failed");
  }

  return { ok: true, sessionId: data };
}
