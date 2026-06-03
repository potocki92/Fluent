import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Whether the current user is an admin. Drives UI affordances only (e.g. the
 * Header "Admin" link) — never security. Real enforcement is server-side
 * (`requireAdmin`) and in the database (RLS `is_admin()`).
 */
export function useIsAdmin() {
  const query = useQuery({
    queryKey: ["isAdmin"],
    queryFn: async (): Promise<boolean> => {
      const supabase = createClientSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;

      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.role === "admin";
    },
  });

  return { isAdmin: query.data ?? false, isLoading: query.isLoading };
}
