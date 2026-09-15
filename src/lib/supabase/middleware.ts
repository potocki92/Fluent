import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { toFluentUser, isAccountUser } from "@/lib/auth/identity";
import {
  AUTH_NEXT_PARAM,
  authSignInUrl,
  isAuthPath,
  resolveSignedInDestination,
} from "@/lib/auth/redirects";
import { routeAccess } from "@/lib/auth/routes";
import type { Database } from "@/types/database";

/**
 * The authentication boundary, enforced once for the whole application.
 *
 * It does two things on every request, in this order:
 *
 *  1. REFRESHES THE SESSION. Server Components cannot write cookies, so the
 *     proxy is the only place a rotated Supabase token can be handed to both
 *     the request (so Server Components see it) and the browser (so it replaces
 *     the old one). This half is unchanged in spirit from the original file.
 *
 *  2. ENFORCES ROUTE ACCESS. `src/lib/auth/routes.ts` says what a path
 *     requires; this decides whether the caller may have it. A signed-out
 *     request to a private route never reaches the page — it does not render
 *     half a dashboard, it does not run ten queries and then apologise, and it
 *     does not leave the learner sitting on a private URL.
 *
 * It deliberately does NOT read the database. The proxy runs on every request,
 * including every `<Link>` prefetch, and "is this person signed in" must not
 * cost a `profiles` query. Admin ROLE is checked where it belongs: in the admin
 * layout, in `requireAdmin()`, and in RLS.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and the claims call.
  // `getClaims()` verifies the token's signature and refreshes it when it is
  // about to expire — `getSession()` would hand back an unverified cookie, which
  // is never an authorization answer.
  const user = await verifiedUser(supabase);
  const hasAccount = isAccountUser(user);

  const { pathname, search } = request.nextUrl;
  const access = routeAccess(pathname);

  // A signed-out visitor on a private route goes to sign in, and comes back to
  // exactly where they were aiming.
  if (!hasAccount && access !== "public") {
    return redirectTo(request, authSignInUrl(`${pathname}${search}`), supabaseResponse);
  }

  // A signed-in learner has no use for the sign-in form. Resolved HERE, on the
  // server, before the form is ever rendered — the old client-side `useEffect`
  // redirect showed it for a couple of hundred milliseconds first.
  if (hasAccount && isAuthPath(pathname) && !isAuthUtilityPath(pathname)) {
    const next = request.nextUrl.searchParams.get(AUTH_NEXT_PARAM);
    return redirectTo(request, resolveSignedInDestination(next), supabaseResponse);
  }

  if (access !== "public") {
    applyPrivateCacheHeaders(supabaseResponse);
  }

  return supabaseResponse;
}

/**
 * The verified caller, or nobody.
 *
 * A thrown error here — the Auth service unreachable, a JWKS fetch that failed —
 * must not take every route down with it. It resolves to "not signed in", which
 * sends the learner to a working sign-in screen instead of a 500 (§20, §102).
 */
async function verifiedUser(supabase: ReturnType<typeof createServerClient<Database>>) {
  try {
    const { data } = await supabase.auth.getClaims();
    return toFluentUser(data?.claims);
  } catch (error) {
    console.error("[fluent:auth] session verification failed in the proxy", error);
    return null;
  }
}

/**
 * Parts of `/auth` a signed-in learner still needs.
 *
 * `/auth/callback` completes a flow — confirming an email, or finishing a
 * password recovery — and by the time it runs there IS a session, so bouncing
 * it as "already signed in" would break the very flow that created the session.
 * `/auth/reset-password` is the same story: recovery hands you a session and
 * then asks for the new password.
 */
function isAuthUtilityPath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/reset-password")
  );
}

/**
 * Keep private pages out of every cache that could replay them to the wrong
 * person — including the browser's back-forward cache.
 *
 * Scoped to private routes on purpose (§19). A blanket `no-store` would also
 * throw away the shelf and the dictionary, which are shared, public content and
 * exactly the sort of thing a cache should keep.
 */
function applyPrivateCacheHeaders(response: NextResponse) {
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private",
  );
}

/**
 * Redirect while preserving whatever cookies the refresh just produced.
 *
 * Dropping them would mean the rotated token never reaches the browser and the
 * next request has to refresh all over again — and, on an expiring session,
 * could bounce the learner in a loop.
 */
function redirectTo(request: NextRequest, path: string, carrying: NextResponse) {
  const url = new URL(path, request.nextUrl.origin);
  const response = NextResponse.redirect(url);

  carrying.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  applyPrivateCacheHeaders(response);

  return response;
}
