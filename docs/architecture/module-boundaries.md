# ADR: module boundaries, import rules and the order of change

**Status:** accepted · **Applies to:** the whole of `src/`

## Context

Fluent is already a modular monolith. Its domains — learning, today, reader,
story, import, notebook, auth, library — each have a folder under `src/lib/`,
their own ADR, and a pure core that a Vitest run exercises without a database.
That part works, and this ADR does not relitigate it.

What was missing was a written statement of *which direction the arrows point*.
Without one, three things drifted, and each of them cost data or correctness:

1. **A failed read was allowed to look like an empty one.** Seven commit paths
   read the learner's knowledge state, caught the failure, logged it, and then
   handed the database an empty evidence payload — which sealed the session and
   applied nothing. The information needed to refuse was present at the failure
   site and thrown away one line later, because nothing said a read that a
   commit depends on must travel as a *result*, not as a `?? default`.
2. **Contracts lived inside implementations.** `TodayPlanItem` was exported from
   a `"use server"` module, so a client component importing the type dragged a
   Server Action module into its graph.
3. **Nothing enforced any of it.** The rules existed in `AGENTS.md` as prose. A
   rule that only prose enforces is a rule that regresses at the next deadline.

## Decision

### 1. Five layers, and the arrows only point one way

```
  app/          routes: compose a screen, own metadata and access. Thin.
    │
    ▼
  components/   views: render props. No Supabase, no Server Action imports
    │           beyond the ones a route handed them.
    ▼
  hooks/        controllers: UI state, cache, interaction. TanStack Query
    │           and Zustand live here and only here.
    ▼
  actions/      "use server" entry points: authenticate, load, call the
    │           domain, persist, return `ActionResult<T>`. Thin.
    ▼
  lib/<domain>/ the functional core: pure functions, no React, no Next,
                no Supabase client, no `"use server"`.

  lib/<domain>/queries.ts (and friends) — adapters. They know Supabase.
                They take a client; they never construct one from `next/headers`.
```

Nothing in a lower box may import from a higher one. Concretely:

| Importer | May not import |
| --- | --- |
| `src/lib/**` (pure core) | `react`, `next/*`, `@/actions/**`, `@/hooks/**`, `@/components/**`, `@/lib/supabase/**` |
| `src/components/ui/**` | `@/actions/**`, `@/hooks/**`, `@/lib/supabase/**` — shared primitives know nothing about the product |
| client components | the implementation of a `"use server"` module, for a **type** it could get from a contract module |
| anything but `"use server"` | `@/lib/supabase/service` — the service role |

The exception, stated explicitly so it is not mistaken for drift: an *adapter*
(`lib/*/queries.ts`, `lib/learning/snapshot.ts`, `lib/learning/commit-evidence.ts`)
lives under `lib/` and does touch Supabase. It is distinguished by taking the
client as a **parameter**. That is what lets the same query serve a browser hook
under RLS and a Server Component under the cookie-bound client, with one
contract and one set of query options — and it is why "pure core" in the table
above means "does not *construct* a client", enforced as "does not import
`@/lib/supabase/{client,server,service}`".

### 2. Contracts are neutral modules

A type two layers share lives in a file neither of them owns:

- `src/lib/<domain>/contracts.ts` — the shape of a plan item, a session, a
  question, a result. Pure types and the pure guards over them.
- The Server Action `import type`s the contract and re-exports nothing.
- The client component `import type`s the same contract.

Client and server exports never share a barrel. A file that a browser bundle can
reach must not, through any edge, reach `@/lib/supabase/service`.

### 3. A read that a write depends on returns a result, never a default

This is the rule the seven finalization paths broke, and it is the one with
teeth:

> If a commit's correctness depends on a read, a failed read produces a
> `FluentFailure`. It never produces an empty collection, a `null` that a `??`
> absorbs, or a default score.

A legitimately empty *result* (this learner has no state for that concept yet;
this operation proves nothing) is a different fact from a failed *read*, and the
two must not share a representation. `src/lib/learning/commit-evidence.ts` is
the reference implementation: `count === 0` is a normal outcome; an unreadable
snapshot is a refusal that leaves the session re-runnable.

Deliberate best-effort paths remain allowed where the ADR for that domain says
the data is history rather than state — `recordReadingEvent` is the example —
and they say so at the call site.

### 4. Errors keep the taxonomy they already have

`ActionResult<T>` / `FluentFailure` / `settleAction` from `src/lib/errors.ts` are
the one vocabulary. This refactor extends them; it does not build a parallel
system, and it does not introduce a validation library. Raw Postgres and
provider messages go to the server log through `fail`/`failFrom`; the learner
sees `FLUENT_ERROR_MESSAGES`. Framework control-flow exceptions (`redirect`,
`notFound`) are never caught by `settleAction`-style wrappers.

### 5. Order of change

Each step lands on its own, green, before the next begins:

1. Correctness fixes with regressions, where the bug is data loss.
2. Contracts and cache keys — moves and re-exports, no behaviour change.
3. Composition — session controllers and shared components, behaviour-preserving.
4. Application layer — splitting the large read and write modules.
5. Enforcement — the lint rules, once the tree already satisfies them.

Enforcement comes last on purpose: a boundary rule added before the code obeys
it is either disabled or worked around within a week.

## Consequences

**Good.** A read failure can no longer masquerade as an empty state anywhere the
knowledge model is committed. The layering is machine-checked rather than
remembered. A contract can be shared without dragging a server module into a
browser bundle.

**Costs.** Some call sites grew an `if (!x.ok) return x;` line. Adapters take a
client parameter rather than reaching for one, which is one more argument at
every call. Both are deliberate: they are the syntax of the rule.

**Not decided here.** Routing stays flat and stays where it is — no route
groups, no `features/`, no move out of `src/`. The state, form and UI libraries
stay exactly as they are.
