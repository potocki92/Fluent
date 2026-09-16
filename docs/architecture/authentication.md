# Authentication

**Status:** accepted · **Applies to:** `src/lib/auth/`, `src/lib/supabase/`,
`src/proxy.ts`, `src/components/auth/`, `src/app/auth/`, `src/actions/auth.ts`

Read this before touching sign-in, sign-up, sign-out, route protection, the
browser cache lifecycle, or anything that asks "who is the user?".

---

## The invariant

> After an authenticated identity is lost, nothing in the application may keep
> behaving as though the previous user were still signed in — not for one frame
> of one render.

And its twin:

> User B must never see User A's data through a client cache, a route cache,
> persisted state, or a request that started before the account changed.

Everything below exists to make those two sentences true.

---

## The bug this replaced

A learner reported that after signing out they still sometimes looked signed in,
and still saw their own data. It was not one bug. It was four, and every one of
them had to be fixed for the invariant to hold:

1. **Sign-out was a local `useState` update.** `AuthButton` called
   `supabase.auth.signOut()` and then `setUser(null)`. It never told the server,
   never navigated, and never called `router.refresh()`. The App Router keeps an
   RSC payload per visited route, so `/today` — with the learner's name, plan and
   streak rendered into it — stayed in the router cache and was replayed on the
   next navigation back to it.
2. **The QueryClient outlived the identity.** It was created once per browser
   session in `providers.tsx`, with a five-minute `staleTime`, and every
   user-scoped query key was identity-free: `["profile"]`, `["isAdmin"]`,
   `["saved_words"]`, `["completedTexts"]`, `["learning-preferences"]`,
   `["word-goal"]`, `["notebook", …]`. Mounted components kept rendering the
   previous learner's rows, and inside `staleTime` no refetch was even attempted.
3. **The ability store was never reset, and could never re-hydrate.**
   `useAbility` held ability, RD, answered and CEFR; the header's level ring reads
   it. `useProfile` guarded hydration with a plain boolean ref, so once it had run
   it never ran again — A's level stayed on screen under B's name.
4. **There was no route protection at all.** `proxy.ts` refreshed the session and
   nothing else. Each private screen decided for itself: `/today` and `/notebook`
   rendered their own "zaloguj się" cards, `/stats` quietly rendered zeroes, and
   `/settings`, `/calibration` and `/practice/*` were client components that never
   checked anything. A signed-out learner standing on `/settings` saw a page
   assembled entirely from the stale cache and the stale store.

The redirect away from `/auth` for an already-signed-in learner was also
client-side only, in a `useEffect`, so the login form was painted first.

---

## The shape now

```
                     Supabase Auth  (the only identity authority)
                              │
                     cookies (@supabase/ssr)
                              │
  ┌───────────────────────────┴────────────────────────────┐
  │  src/proxy.ts → updateSession()                        │
  │    • getClaims(): verify signature, refresh if expiring │
  │    • routeAccess(path): public | account | admin        │
  │    • no account + private path → /auth?next=…           │
  │    • account + /auth → next or /today                   │
  │    • private responses → Cache-Control: no-store        │
  └───────────────────────────┬────────────────────────────┘
                              │
  ┌───────────────────────────┴────────────────────────────┐
  │  Server Components / Server Actions                     │
  │    getCurrentUser() · getAccountUser()                  │
  │    requireAccountUser() · requireAdmin()                │
  │    ← the second lock; pages get a non-null user         │
  └───────────────────────────┬────────────────────────────┘
                              │  identity resolved once in the root layout
  ┌───────────────────────────┴────────────────────────────┐
  │  AuthProvider (client)                                  │
  │    • seeded with the SERVER's answer → no flash         │
  │    • the one onAuthStateChange subscription             │
  │    • planAuthTransition() decides what an event means   │
  │    • identity changed → new QueryClient, stores reset,  │
  │      router.refresh(), leave any private page           │
  └───────────────────────────┬────────────────────────────┘
                              │
                        UI (renders identity; decides nothing)
                              │
                    Postgres RLS (the last word, always)
```

### Server is the authority

`src/lib/auth/server.ts` is the only place that answers "who is the caller?", and
it answers from the request's cookie via **`getClaims()`** — which verifies the
JWT signature (locally against the project's published JWKS when asymmetric
signing keys are enabled, with a server round trip when they are not) and
refreshes an expiring session on the way. `getSession()` is never used for an
authorization decision anywhere in this codebase: it returns whatever the cookie
says without checking whether the cookie is genuine.

The one `getSession()` call that remains is in `AuthProvider`'s back-forward-cache
guard, where the worst outcome of a tampered cookie is a page reload.

**Known trade-off.** With asymmetric signing keys, `getClaims()` validates
locally, so a user deleted or banned mid-session stays valid until their access
token expires (one hour by default). This is the behaviour Supabase currently
documents and recommends; RLS still refuses their rows the moment the row-level
predicates stop matching.

### Route access is a table, not fifteen copies of a redirect

`src/lib/auth/routes.ts` maps a path to `public | account | admin`. It is pure —
no Supabase, no request, no cookies — and it is what the proxy enforces and what
the client lifecycle consults before ejecting anyone.

| Access | Routes |
| --- | --- |
| `public` | `/`, `/auth/**`, `/browse`, `/words`, `/library`, `/library/<slug>`, `/learn` |
| `account` | everything else — `/today`, `/review/**`, `/stats`, `/settings`, `/notebook`, `/calibration`, `/practice/**`, `/learn/<id>/**`, `/library/import/**`, and the reader `/library/<slug>/<chapter>/**` |
| `admin` | `/admin/**` |

**Unknown paths default to `account`.** A new private screen is protected the day
it exists; a new public one is a deliberate, reviewable line in that table. The
failure mode of forgetting is "too strict", never "wide open".

The reader is `account` on purpose: it records progress, logs lookups and writes
the personal notebook, and a privately imported book is readable by exactly one
person. A signed-out reader is a broken reader.

**The proxy never reads the database.** It runs on every request including every
`<Link>` prefetch, so "is this person signed in" must not cost a `profiles`
query. Authentication and profile are separate facts; the admin ROLE is read in
the admin layout, in `requireAdmin()`, and by RLS — never in the proxy.

### `?next=` goes through one function

`sanitizeAuthRedirect()` in `src/lib/auth/redirects.ts` accepts a root-relative
path on this origin and nothing else. It rejects absolute URLs, protocol-relative
`//` and `/\`, non-http schemes, C0 controls (the tab/newline tricks), anything
over 512 characters, and `/auth/**` itself (which would be a loop). The
authoritative check is a full `new URL()` parse against a sentinel origin with an
`origin` equality test — the syntactic rules in front of it are defence in depth.

Nothing else parses `next`. The auth page sanitises it server-side and hands the
sanitised value to the forms; the callback re-sanitises it because it has been
round-tripped through an email.

**Password recovery does not travel as `next`.** Its destination lives inside
`/auth`, which the sanitiser refuses by design, so the recovery link carries
`flow=recovery` and `/auth/callback` resolves the destination from a constant.

### Client cache isolation

An identity change **abandons the whole QueryClient** and mounts a fresh, empty
one (`src/lib/auth/client-state.ts`). This is deliberately stronger than putting
a user id in every query key:

- a key-scoping change touches a dozen hooks *and* every `invalidateQueries` call
  that references them, and one missed call site is a leak;
- a request already in flight for A can only ever resolve into the abandoned
  client, which nothing is subscribed to, so it cannot reach B's screen even as
  a flash.

The cost is that public data is refetched too. That is the right trade: one
handful of requests per sign-in, in exchange for an isolation property that does
not depend on remembering anything.

`resetUserScopedStores()` resets `useAbility`, the only client store holding
user-specific state. **`localStorage` is never blanket-cleared** — nothing in this
app persists user-private state to browser storage (reader typography lives on
the profile row so it follows the learner between devices), and clearing the
origin would destroy unrelated preferences. A store that gains persistence is
reset there, by name.

### A token refresh is not an identity change

`planAuthTransition()` in `src/lib/auth/lifecycle.ts` is a pure function over
`(previousIdentity, nextUser, pathname)` returning what must happen. It is the
one place that distinguishes "the same learner got a new token" (do nothing) from
"the identity changed" (reset everything) — and because it is pure, that
distinction has tests instead of a comment.

### Sign-out

`useSignOut()` runs three steps, in this order, and the order is the point:

1. **`endServerSession()`** — a Server Action. Revokes the refresh token at the
   Auth server and deletes the auth cookies on a real HTTP response. Until this
   has happened, "logged out" is an opinion the browser holds.
2. **`signOut({ scope: "local" })`** — clears the browser's in-memory session and,
   crucially, emits `SIGNED_OUT`, which is what `AuthProvider` listens for. That
   listener abandons the QueryClient, resets the stores and calls
   `router.refresh()`. `local` because step 1 already revoked; repeating it with a
   token that no longer exists only produces an error.
3. **`router.replace("/auth")` + `router.refresh()`** — nobody is left standing on
   the URL they were just ejected from.

Steps 2 and 3 run even if step 1 fails: a sign-out that half-worked must still
leave the learner signed out locally.

### The back button

Private responses carry `Cache-Control: no-store`, scoped to private routes so the
public shelf and dictionary stay cacheable. That keeps Chromium and Firefox from
putting a private page in the back-forward cache at all. Safari caches it anyway,
so `AuthProvider` listens for `pageshow` with `persisted` and reloads when the
live session no longer matches the identity the document was rendered for.

### Anonymous users

Fluent **never calls `signInAnonymously()`** — there is no guest mode, and the
audit found no code path that creates one. The distinction is kept anyway:
`isAccountUser()` is the predicate every private route and account feature asks,
and it is not `user !== null`. If anonymous sign-in is ever switched on, every
`if (user)` in the codebase would silently start admitting guests; `isAccountUser`
is the seam that stops that from being a one-line security regression.

---

## Rules

- **Never** use `getSession()` to decide access. `getClaims()` server-side, or
  RLS.
- **Never** treat `user !== null` as "has a Fluent account". Use `isAccountUser`.
- **Never** treat "a profile row exists" as "authenticated". They are separate
  facts (`profiles` is created by the `handle_new_user` trigger, not by the app).
- **Never** parse `?next=` anywhere but `sanitizeAuthRedirect`.
- **Never** add a per-screen sign-in branch. Add the route to `routes.ts` and let
  the proxy and `requireAccountUser()` do it.
- **Never** read the database in the proxy.
- **Never** render a raw provider message. `describeAuthError()` owns the copy,
  and it keys on `AuthError.code`, not on `message.includes(...)`.
- **Never** log a password, an access token, a magic-link token or a reset token.
  `endServerSession` logs a failure without the session; the forms log nothing.
- **Never** create a second source of truth for auth state (`localStorage
  .isLoggedIn` and friends). Supabase's session is the only one.
- The service-role client stays out of the auth path entirely. It never decides
  who the caller is.
