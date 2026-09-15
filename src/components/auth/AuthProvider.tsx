"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { QueryClientProvider } from "@tanstack/react-query";

import { abandonQueryClient, resetUserScopedStores } from "@/lib/auth/client-state";
import { identityKey, toFluentUser, type FluentUser } from "@/lib/auth/identity";
import { planAuthTransition } from "@/lib/auth/lifecycle";
import { AUTH_ROUTE } from "@/lib/auth/redirects";
import { createAppQueryClient } from "@/lib/query-defaults";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * THE CLIENT HALF OF THE AUTH BOUNDARY.
 *
 * What it is NOT: an authority. Nothing here decides whether a learner may see
 * anything. The proxy and the server components did that before this component
 * rendered, and RLS does it again in the database.
 *
 * What it IS: the thing that keeps the BROWSER'S MEMORY honest. A single page
 * can outlive an identity — a sign-out in this tab, a sign-out in another one, a
 * refresh token that expired overnight — and when that happens the in-memory
 * state belonging to the old identity has to go, all of it, at once. That is
 * what this does and all that it does:
 *
 *   identity changed → cancel and abandon the QueryClient
 *                    → reset user-scoped stores
 *                    → re-render the server tree (`router.refresh()`)
 *                    → leave any private page we are standing on
 *
 * The initial value comes from the SERVER (`initialUser`, resolved in the root
 * layout). That is what stops the header flashing "Załóż konto" at a signed-in
 * learner, or a name at a signed-out one, before the browser has asked anybody
 * (§89, §142, §143).
 *
 * It is also the only `onAuthStateChange` subscription in the app: the header,
 * the admin link and every hook read identity from this context instead of each
 * calling `getUser()` after mount (§144).
 */

const AuthContext = createContext<FluentUser | null>(null);

/** The current learner, as the UI understands them. For rendering only. */
export function useAuthUser(): FluentUser | null {
  return useContext(AuthContext);
}

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: FluentUser | null;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [user, setUser] = useState<FluentUser | null>(initialUser);
  const [queryClient, setQueryClient] = useState(createAppQueryClient);

  // The identity this component last reconciled. A token refresh reports the
  // same value and must NOT reset anything (§17); a sign-out, a sign-in or a
  // switch reports a different one and resets everything.
  const identityRef = useRef(identityKey(initialUser));

  // The identity this DOCUMENT was server-rendered for. Used only by the
  // back-forward cache guard below, which compares it against the live session.
  const renderedIdentityRef = useRef(identityKey(initialUser));

  // The client that was in use before the most recent swap. Cancelling and
  // clearing it is done in an effect rather than in the handler below, so the
  // handler stays a pure state update and the abandoned client is dealt with
  // exactly once, after the replacement is live.
  const previousClientRef = useRef(queryClient);

  useEffect(() => {
    if (previousClientRef.current === queryClient) return;
    abandonQueryClient(previousClientRef.current);
    previousClientRef.current = queryClient;
  }, [queryClient]);

  const applyAuthEvent = useCallback(
    (next: FluentUser | null) => {
      // WHAT this event means is decided by a pure, tested function; this
      // callback only carries it out. Reading the path from the browser rather
      // than from `usePathname()` keeps the auth subscription from having to be
      // torn down and rebuilt on every navigation.
      const plan = planAuthTransition({
        previousIdentity: identityRef.current,
        nextUser: next,
        pathname: window.location.pathname,
      });

      setUser(next);
      if (!plan.resetIdentityScopedState) return;

      identityRef.current = identityKey(next);

      // A brand-new, empty QueryClient takes over. Nothing subscribed to the old
      // one survives the swap, so a response still in flight for the previous
      // learner has nowhere to land (§87, §88).
      setQueryClient(createAppQueryClient());
      resetUserScopedStores();

      // Drop every RSC payload the router is holding. Without this, going back
      // to a private route we already visited replays the HTML that was rendered
      // for the previous learner, with their name and their plan in it.
      if (plan.refreshServerState) router.refresh();
      if (plan.leaveForSignIn) router.replace(AUTH_ROUTE);
    },
    [router],
  );

  useEffect(() => {
    const supabase = createClientSupabaseClient();

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => applyAuthEvent(toFluentUser(session?.user)),
    );

    return () => subscription.subscription.unsubscribe();
  }, [applyAuthEvent]);

  // THE BACK BUTTON AFTER A SIGN-OUT (§19, §100).
  //
  // Private responses carry `no-store`, which keeps Chromium and Firefox from
  // putting them in the back-forward cache at all. Safari caches them anyway, so
  // when a restored page turns out to have been rendered for somebody who is no
  // longer signed in, it is reloaded — and the proxy then sends it to `/auth`.
  //
  // `getSession()` reads the local cookie without a round trip. That is fine
  // here precisely because this is not an authorization decision: the worst a
  // tampered cookie buys is a page reload.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;

      void createClientSupabaseClient()
        .auth.getSession()
        .then(({ data }) => {
          const live = identityKey(toFluentUser(data.session?.user));
          if (live !== renderedIdentityRef.current) window.location.reload();
        });
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return (
    <AuthContext.Provider value={user}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}
