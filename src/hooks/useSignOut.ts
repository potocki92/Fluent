"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { endServerSession } from "@/actions/auth";
import { AUTH_ROUTE } from "@/lib/auth/redirects";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Signing out, in the order that makes it true.
 *
 *  1. THE SERVER. `endServerSession()` revokes the refresh token and deletes the
 *     auth cookies on a real response. Until this has happened, "logged out" is
 *     an opinion the browser holds.
 *
 *  2. THE BROWSER. `signOut({ scope: "local" })` drops the in-memory session and
 *     — the part that matters — emits `SIGNED_OUT`, which is what
 *     `AuthProvider` listens for. That listener abandons the QueryClient, resets
 *     the user-scoped stores and calls `router.refresh()`, so every cached row
 *     and every server-rendered payload belonging to the old identity is gone
 *     before the next paint. `local` because step 1 already did the revoking;
 *     repeating it with a token that no longer exists just produces an error.
 *
 *  3. THE DESTINATION. `/auth`, always. Leaving somebody standing on the URL
 *     they were just ejected from is how "am I actually logged out?" happens.
 *
 * Step 1 failing (offline, provider down) must not strand the learner in a
 * half-signed-in state, so steps 2 and 3 run regardless.
 *
 * `isPending` stays `true` after a successful sign-out on purpose: the menu item
 * must not flick back to "Wyloguj się" during the navigation, and it must not be
 * clickable twice (§68).
 */
export function useSignOut() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const signOut = useCallback(async () => {
    if (isPending) return;
    setIsPending(true);

    try {
      await endServerSession();
    } catch (error) {
      console.error("[fluent:auth] server sign-out unreachable", error);
    }

    try {
      await createClientSupabaseClient().auth.signOut({ scope: "local" });
    } catch (error) {
      console.error("[fluent:auth] local sign-out failed", error);
    }

    router.replace(AUTH_ROUTE);
    router.refresh();
  }, [isPending, router]);

  return { signOut, isPending };
}
