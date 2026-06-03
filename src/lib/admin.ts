import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Server-side admin guard. Throws when the caller is not a signed-in admin and
 * otherwise returns the already-built Supabase client plus the user, so callers
 * can reuse them without a second round trip. Use in admin Server Actions and as
 * the guard inside the admin layout/pages.
 *
 * Security note: this is defense in depth. The database RLS policies
 * (`is_admin()`) are the real enforcement — this guard exists so non-admin
 * requests fail fast with a clear Polish message before any write is attempted.
 */
export async function requireAdmin() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (profile?.role !== "admin") throw new Error("Brak dostępu");

  return { supabase, user };
}

/**
 * Non-throwing variant for Server Components that prefer to render a
 * "Brak dostępu" message (or redirect) rather than surface an error boundary.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return profile?.role === "admin";
}
