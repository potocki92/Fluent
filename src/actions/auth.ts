"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * End the session on the SERVER, where the cookies actually live.
 *
 * The old sign-out was `supabase.auth.signOut()` in a click handler followed by
 * `setUser(null)`. That is a cosmetic change to one component's state: the
 * server was never asked anything, so every Server Component the router had
 * already rendered — the header greeting, the Today plan, the notebook — stayed
 * exactly as it was, rendered for a learner who had just left.
 *
 * Doing it in a Server Action fixes that at the root. The action runs with the
 * request's cookie jar, so:
 *
 *  - the refresh token is revoked at the Auth server (the default `global`
 *    scope, unchanged from before, so a stolen token is dead everywhere);
 *  - the auth cookies are deleted on a real HTTP response, which is the only
 *    way to be sure the browser drops them;
 *  - the next request genuinely has no session, which is what makes the proxy's
 *    redirect to `/auth` truthful rather than decorative.
 *
 * It returns nothing and throws nothing. A sign-out that fails halfway must
 * still leave the learner signed out locally, so the caller clears the browser
 * side regardless — see `useSignOut`.
 */
export async function endServerSession(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    // Nothing the learner can do about it, and nothing they should see: the
    // cookies are cleared either way and the client half runs next.
    console.error("[fluent:auth] sign-out failed on the server", error.message);
  }
}
