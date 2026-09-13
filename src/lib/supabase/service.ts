import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Supabase client authenticated as the SERVICE ROLE.
 *
 * This is the learning engine's credential. It exists so that finalizing a test
 * — the only operation allowed to move a learner's ability, attempts, completion
 * and streak — is reachable from trusted server code and from nowhere else:
 * `finalize_test_session` / `finalize_calibration_session` have EXECUTE revoked
 * from `anon` and `authenticated`, so a browser holding the public anon key
 * cannot call them however it crafts the request.
 *
 * RULES FOR USING IT:
 *  - Import it ONLY from `"use server"` modules. It bypasses RLS entirely, so
 *    every call must have already established *which* user it acts for, from
 *    the cookie-bound server client (`createServerSupabaseClient`), never from
 *    a parameter the client controls.
 *  - Use it for the finalize RPCs only. Reads and per-answer writes go through
 *    the learner's own session, where RLS and `auth.uid()` still apply.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be exposed with a
 * `NEXT_PUBLIC_` prefix; the explicit check below turns a missing key into a
 * clear startup-time failure rather than a confusing 401 mid-test.
 */
export function createServiceRoleSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set — " +
        "the learning engine cannot finalize tests without it.",
    );
  }

  return createClient<Database>(url, serviceKey, {
    // A service-role client is never a signed-in user: it must not pick up,
    // refresh or persist any session.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
