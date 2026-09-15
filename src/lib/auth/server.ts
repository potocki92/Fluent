import { redirect } from "next/navigation";

import { toFluentUser, isAccountUser, type FluentUser } from "@/lib/auth/identity";
import { authSignInUrl } from "@/lib/auth/redirects";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * THE SERVER IS THE AUTHORITY.
 *
 * Every question about who the caller is gets answered here, from the cookie
 * bound to the request, and nowhere else. The browser's idea of the current
 * user exists to render a name in the header; it decides nothing.
 *
 * WHY `getClaims()` AND NOT `getSession()`. `getSession()` returns whatever the
 * cookie says without checking whether the cookie is genuine — a forged one
 * would be believed. `getClaims()` verifies the JWT signature (locally against
 * the project's published JWKS when asymmetric signing keys are enabled, with
 * the same server round trip `getUser()` makes when they are not) and refreshes
 * an expiring session on the way. It is what Supabase currently documents for
 * protecting pages and user data, and it is the only identity source in this
 * file.
 */

/** Exactly what the cookie-bound factory returns — no structural near-miss. */
type Client = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * The verified caller, or `null`.
 *
 * Pass an existing client when the caller already built one — a page that reads
 * the database anyway should not create a second Supabase client just to learn
 * who is asking.
 */
export async function getCurrentUser(client?: Client): Promise<FluentUser | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;
    return toFluentUser(data.claims);
  } catch (error) {
    // The Auth service is unreachable, or the JWKS fetch failed. "We cannot
    // prove who this is" resolves to "nobody", which lands the app in a clean
    // signed-out state rather than a half-authenticated one (§20).
    console.error("[fluent:auth] could not verify the session", error);
    return null;
  }
}

/** Alias that reads better at a call site that tolerates a signed-out visitor. */
export const getOptionalUser = getCurrentUser;

/**
 * The caller if they hold a real Fluent account, `null` for a guest session or
 * nobody. Prefer this to {@link getCurrentUser} wherever account data is at
 * stake — see `isAccountUser` for why "signed in" and "has an account" are not
 * the same question.
 */
export async function getAccountUser(client?: Client): Promise<FluentUser | null> {
  const user = await getCurrentUser(client);
  return isAccountUser(user) ? user : null;
}

/**
 * Demand an account, or leave for the sign-in screen.
 *
 * `next` is the destination to come back to; it goes through the redirect
 * sanitiser like every other one. The proxy already turns away signed-out
 * requests to private routes, so reaching the redirect here means something
 * slipped past it — which is exactly why it is still here.
 */
export async function requireAccountUser(
  next?: string,
  client?: Client,
): Promise<FluentUser> {
  const user = await getAccountUser(client);
  if (!user) redirect(authSignInUrl(next));
  return user;
}

/** The result shape admin callers want: the user and a client, no second trip. */
export interface AdminContext {
  supabase: Client;
  user: FluentUser;
}

/**
 * Server-side admin guard for admin Server Actions.
 *
 * Throws rather than redirecting: an action has no screen to send anyone to.
 * As before, this is defence in depth — the database's `is_admin()` RLS
 * policies are the real enforcement, and the role is read from the database
 * here, never from anything the client sent.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createServerSupabaseClient();
  const user = await getAccountUser(supabase);
  if (!user) throw new Error("Not authenticated");

  if (!(await hasAdminRole(supabase, user.id))) {
    throw new Error("Brak dostępu");
  }

  return { supabase, user };
}

/**
 * Non-throwing variant, for the admin layout deciding whether to render the
 * panel or "Brak dostępu".
 */
export async function isCurrentUserAdmin(client?: Client): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());
  const user = await getAccountUser(supabase);
  if (!user) return false;
  return hasAdminRole(supabase, user.id);
}

/**
 * The role lives in `profiles`, which is a DATABASE read — deliberately not
 * done in the proxy. The proxy runs on every request including prefetches, and
 * a per-request `profiles` query to answer "is this person logged in" would be
 * a query nobody asked for on every navigation. Authentication and profile are
 * separate facts; only the admin subtree needs the second one.
 */
async function hasAdminRole(supabase: Client, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role === "admin";
}
