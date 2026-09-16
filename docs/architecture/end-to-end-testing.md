# ADR: end-to-end tests (Playwright)

**Status:** deferred — not adopted now, with the conditions for adopting it
written down · **Relates to:** [`authentication.md`](./authentication.md),
[`today-engine.md`](./today-engine.md)

## Context

The authentication rebuild turned on one invariant that unit tests cannot hold:

> User B must never see User A's data through a client cache, a route cache,
> persisted state, or a request that started before the account changed.

Every *piece* of it is already tested. `src/lib/auth/*.test.ts` covers the route
access table, the `?next=` sanitiser, what an auth event means and what the
browser must forget; `supabase/tests/` covers RLS, grants and the SECURITY
DEFINER functions against a real PostgreSQL. What nothing covers is the
*composition*: proxy redirect → sign-in → RSC payload → QueryClient identity →
router cache, end to end, in a browser. That is exactly where the four bugs in
`authentication.md` lived — each layer was individually defensible.

So the question is not whether an E2E test would be valuable. It is what it costs
today.

## Decision

**Playwright is not added yet.** The value is real but the prerequisites are not
in place, and a suite that cannot run is worse than none: it rots, and its green
badge is then a lie about the one invariant nobody may be wrong about.

What it would need that does not exist:

1. **A live Supabase project per run.** Every flow worth testing starts with a
   session cookie minted by Supabase Auth. There is no local stand-in in this
   repo — `supabase/tests/` deliberately needs only a superuser connection
   because it tests SQL, not sessions. An E2E run needs a real project URL, anon
   key and service-role key, plus two seeded learners with `profiles` rows.
2. **A place to run it.** There is no CI in this repository at all — no
   `.github/workflows`. Adding Playwright means adding the first pipeline, the
   browser cache, the secrets and the `next build && next start` step alongside
   it. That is a separate deliverable from fixing a Today bug.
3. **Test-user lifecycle.** Two accounts whose data is created and torn down per
   run, through the service role, without ever touching a production project.
   Credentials in env, never in the repo.

None of that is hard. It is simply not free, and none of it is what the current
task is about.

## What to build when it is adopted

The structure, so the first person to do it does not also design it:

```
e2e/
  fixtures/auth.ts        ← signIn(page, user), signOut(page)
  auth.spec.ts            ← the two flows below
playwright.config.ts      ← webServer: `npm run build && npm run start`
```

`vitest.config.ts` includes `src/**/*.test.ts` only, so `e2e/*.spec.ts` will not
be picked up by the unit runner — the two suites can coexist untouched. Add
`npm run test:e2e`; leave `npm test` meaning "unit tests", which is what every
existing instruction assumes.

### The test that matters

```
A signs in  →  /today renders A's plan
A signs out →  lands on /auth
A navigates back to /today  →  redirected to /auth?next=%2Ftoday
                            →  and A's name, plan and streak are NOT in the HTML
```

The last assertion is the whole point, and it must be made against the response
body, not against what is painted: the original bug served A's plan out of the
router cache *after* sign-out. Assert on `page.goBack()` too — the
back-forward cache is why private responses carry `no-store`.

### The second test, once two users can be seeded

```
A signs out → B signs in → no query key, no store value and no rendered string
              from A survives anywhere on B's screen
```

### Environment

Documented rather than hardcoded, and a run without them **skips** rather than
silently passing:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The app under test |
| `SUPABASE_SERVICE_ROLE_KEY` | Seeding and tearing down test learners |
| `E2E_USER_A_EMAIL` · `E2E_USER_A_PASSWORD` | First test learner |
| `E2E_USER_B_EMAIL` · `E2E_USER_B_PASSWORD` | Second test learner (test 2 only) |

Never a real learner's credentials, and never a production project.

## Consequences

The auth invariant stays covered by unit tests over its pure parts plus SQL tests
over its data layer, with the composition verified by hand until the above is
built. That gap is stated here on purpose, so it is a known risk rather than an
assumed absence.
