"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuthUser } from "@/components/auth/AuthProvider";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { isAccountUser } from "@/lib/auth/identity";
import { learnerKeys } from "@/lib/query-keys";

/**
 * Whether the current user is an admin. Drives UI affordances only (e.g. the
 * Header "Admin" link) — never security. Real enforcement is server-side
 * (`requireAdmin`) and in the database (RLS `is_admin()`).
 *
 * The identity comes from `AuthProvider`; only the ROLE is fetched, and only
 * when there is somebody to fetch it for.
 */
export function useIsAdmin() {
  const user = useAuthUser();
  const userId = isAccountUser(user) ? user.id : null;

  const query = useQuery({
    queryKey: learnerKeys.isAdmin(),
    enabled: !!userId,
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;

      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data?.role === "admin";
    },
  });

  return { isAdmin: query.data ?? false, isLoading: query.isLoading };
}
