"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuthUser } from "@/components/auth/AuthProvider";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { useAbility } from "@/hooks/useAbility";
import { isAccountUser } from "@/lib/auth/identity";
import type { Profile } from "@/types";

/**
 * Fetch the current user's profile and hydrate the ability store so the rest
 * of the UI reads ability/rd/answered from Supabase (the source of truth)
 * rather than the local defaults.
 *
 * The user id comes from `AuthProvider`, which already knows it from the server
 * render — this hook no longer makes its own `getUser()` call, so mounting three
 * profile-aware components no longer means three round trips (§144).
 */
export function useProfile() {
  const user = useAuthUser();
  const userId = isAccountUser(user) ? user.id : null;
  const setAbility = useAbility((s) => s.setAbility);

  const query = useQuery({
    queryKey: ["profile"],
    enabled: !!userId,
    queryFn: async (): Promise<Profile | null> => {
      if (!userId) return null;

      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = query.data ?? null;

  /**
   * Hydrate once PER LEARNER, not once per component lifetime.
   *
   * A plain boolean ref was a real account-switching leak: after A → logout →
   * B the header still held A's ability, because the flag said "already
   * hydrated" and nothing ever cleared it. Keying it on the profile id means a
   * different learner always hydrates, while a background refetch for the SAME
   * learner still cannot clobber newer local state (e.g. set after a test).
   */
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!profile || hydratedFor.current === profile.id) return;
    // cefrEstimate is derived from ability inside setAbility.
    setAbility({
      ability: profile.ability,
      rd: profile.rd,
      answered: profile.answered,
    });
    hydratedFor.current = profile.id;
  }, [profile, setAbility]);

  return { profile, isLoading: query.isLoading };
}
