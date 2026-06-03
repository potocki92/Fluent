import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { createClientSupabaseClient } from "@/lib/supabase/client";
import { useAbility } from "@/hooks/useAbility";
import type { Profile } from "@/types";

/**
 * Fetch the current user's profile and hydrate the ability store so the rest
 * of the UI reads ability/rd/answered from Supabase (the source of truth)
 * rather than the local defaults.
 */
export function useProfile() {
  const setAbility = useAbility((s) => s.setAbility);

  const query = useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile | null> => {
      const supabase = createClientSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = query.data ?? null;

  // Hydrate once on initial load. A background refetch must not clobber newer
  // local state (e.g. set after finishing a test) with stale DB values.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!profile || hydratedRef.current) return;
    // cefrEstimate is derived from ability inside setAbility.
    setAbility({
      ability: profile.ability,
      rd: profile.rd,
      answered: profile.answered,
    });
    hydratedRef.current = true;
  }, [profile, setAbility]);

  return { profile, isLoading: query.isLoading };
}
