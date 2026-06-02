<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Fluent Agent Rules

These instructions are mandatory for every AI coding agent working in this repository.

The goal is to preserve and extend the architecture that already exists in this app. Do not invent a new architecture unless the requested task explicitly requires a migration.

## Project Snapshot

**Fluent** is a Polish-first app for learning German vocabulary. Users read German texts, take adaptive comprehension tests (ability tracked with an Elo-style rating), and review vocabulary with SM-2 spaced-repetition flashcards.

Current stack and conventions:

- Next.js App Router, currently Next `16.2.7`.
- React `19.2.4`.
- TypeScript with `strict: true`.
- Tailwind CSS v4 with CSS variables in `src/app/globals.css`.
- shadcn/ui primitives on top of `radix-ui`, configured through `components.json`.
- lucide-react icons; Framer Motion for animation; Recharts for charts.
- TanStack Query (`@tanstack/react-query` v5) for server-data fetching/caching.
- Zustand for the small amount of client-only app state.
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`) accessed through `src/lib/supabase/*`.
- Polish UI copy written inline in components. There is currently no i18n library.
- `@/*` import alias mapped to `./src/*`. **All application code lives under `src/`.**

## Repository Shape

Respect the existing `src/`-rooted structure:

- `src/app/` — Next App Router routes, layouts, metadata. Flat routing (no route groups).
- `src/components/` — UI grouped by area: `ui/` (shadcn primitives), `auth/`, `layout/`, `flashcard/`, `charts/`, `words/`, `texts/`, `level/`.
- `src/hooks/` — TanStack Query data hooks (`useTexts`, `useWords`, `useSavedWords`, `useDueWords`) and the Zustand store (`useAbility`).
- `src/actions/` — server actions (`"use server"`): `submit-answer.ts`, `save-word.ts`, `update-srs.ts`.
- `src/lib/` — domain logic (`elo.ts`, `sm2.ts`, `cefr.ts`), `utils.ts` (`cn`), and the Supabase seam in `src/lib/supabase/{client,server,middleware}.ts`.
- `src/types/` — `index.ts` (domain types) and `database.ts` (DB types).
- `src/proxy.ts` — Next 16 middleware entry (`proxy`), delegates to `updateSession`.
- `supabase/schema.sql` — database schema.
- Tests are colocated as `src/**/*.test.ts` (Vitest), e.g. `src/lib/elo.test.ts`, `src/lib/sm2.test.ts`.

Do NOT move the project to root-level folders or out of `src/`. There is no `features/`, `store/`, or `data/` directory — do not assume them.

## App Router Rules

- Route files in `src/app/` should stay thin and compose components/hooks.
- Routing is flat: `/learn`, `/learn/[textId]`, `/learn/[textId]/test`, `/learn/[textId]/results`, `/review`, `/browse`, `/stats`, `/auth`, `/auth/callback`. There are no route groups like `(app)`/`(auth)` — do not introduce them casually.
- Add `metadata` where appropriate; copy stays Polish (see `src/app/layout.tsx`).
- Middleware lives in `src/proxy.ts` (Next 16 renamed `middleware` → `proxy`). It calls `updateSession` from `src/lib/supabase/middleware.ts` to refresh the Supabase session. Preserve this pattern.
- Mutations that touch the database go through server actions in `src/actions/`, not ad-hoc API routes, unless a route is genuinely required.

## Client and Server Boundaries

- Use `"use client"` only when a file uses hooks, browser APIs, local state, Zustand, event handlers, or client-only UI.
- Keep server-compatible files server-compatible by default.
- Do not import client-only hooks/stores into server-only modules.
- Use the browser Supabase client in client code, the server client in server actions/components. Do not mix them.
- Before using a Next API, check the local Next docs referenced at the top of this file.

## Data Fetching and State

The app cleanly separates **server data** (TanStack Query) from **client state** (Zustand).

- Fetch and cache server data with TanStack Query hooks in `src/hooks/`. Follow the existing pattern: a `useQuery` with a string-array `queryKey`, an async `queryFn` with an explicit return type, calling the browser Supabase client directly (`createClientSupabaseClient()`), throwing on `error`, coalescing data with `?? []`.
- Reuse existing hooks (`useTexts`, `useWords`, `useSavedWords`, `useDueWords`) before adding new ones.
- Use the Zustand store `useAbility` (`src/hooks/useAbility.ts`) for ability/RD/CEFR client state. Match its style: typed `create<Store>`, defaults in a `DEFAULTS` constant, immutable `set((prev) => ...)` updates.
- Do NOT add Redux, Jotai, or another state library. Do NOT replace TanStack Query — it is core.

## Supabase

- Browser client: `createClientSupabaseClient()` in `src/lib/supabase/client.ts` (singleton, `createBrowserClient`).
- Server client: `await createServerSupabaseClient()` in `src/lib/supabase/server.ts` (async factory, `createServerClient`, cookie-aware).
- Session refresh: `updateSession` in `src/lib/supabase/middleware.ts`, wired through `src/proxy.ts`.
- Read paths: TanStack Query hooks call the browser client directly.
- Write paths: server actions (`src/actions/*`) use the server client — typically auth check (`supabase.auth.getUser()`), load, domain logic from `src/lib/`, persist (`insert`/`update`/`delete`/`rpc`), return a typed result.
- Type all Supabase access with the `Database` type from `src/types/database.ts`.
- When changing schema, update `supabase/schema.sql`. Do not commit secrets; env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Types

- Use strict TypeScript. Do not use `any` unless unavoidable and justified with a local comment.
- Domain enums are explicit union types (e.g. `CefrLevel`, `WordType`); state shapes are interfaces (e.g. `AbilityState`, `TestResult`).
- DB-backed types map directly from generated rows, e.g. `type Word = Tables["words"]["Row"]`. Use `Omit`/intersections to shape server-only fields (see `Question` hiding `correct_idx`).
- Add domain types in `src/types/index.ts`; keep DB types in `src/types/database.ts`. Avoid duplicating definitions.

## Domain Logic

- Keep reusable calculations as pure functions in `src/lib/`: Elo/ability (`elo.ts`), SM-2 scheduling (`sm2.ts`), CEFR mapping (`cefr.ts`).
- Reuse these helpers (e.g. `updateAbility`, `review`, `abilityToCefr`) — do not re-implement Elo updates, SM-2 intervals, or CEFR banding inline.
- Add/update colocated `*.test.ts` (Vitest) for non-trivial domain logic.

## UI and Styling

- Use existing `src/components/ui/*` primitives before adding new UI.
- Use `cn` from `@/lib/utils` for conditional classes.
- Preserve Tailwind v4 + CSS-variable tokens defined in `src/app/globals.css`. Use semantic tokens (`bg-background`, `text-foreground`, `card`, `primary`, `secondary`, `muted`, `border`, `ring`) and the Fluent custom tokens (`gold`, `blue`, `green`, `red`, `dark`).
- Do not hardcode colors when a token exists. Keep dynamic Tailwind class strings literal so they are detected.
- Use lucide-react icons consistently; keep behavior mobile-first; use semantic, accessible markup.

## Copy and i18n

The UI is Polish-first and copy is currently hardcoded inline in components (there is no dictionary system).

- Write user-facing strings in Polish, matching surrounding tone.
- Do NOT introduce an i18n library or dictionary as a side effect of an unrelated change. If i18n is wanted, treat it as its own deliberate task.

## Coding Standards

- Use `@/` imports for internal modules.
- Keep import groups clean: external packages, then `@/` aliases, then relative.
- Use **named exports** for components, hooks, stores, actions, and utilities (no default exports).
- Type small component props inline in the destructuring params (the prevailing style); use named types only for larger/reused shapes.
- Keep files focused. Prefer clarity over cleverness. Preserve existing naming conventions.

## Forms and Mutations

- There is currently no form library. Do NOT introduce React Hook Form or Zod unless explicitly requested.
- Validate before persisting; keep commit/persist logic in server actions or domain helpers, not scattered across components.

## Testing

Before considering a task complete, run the most relevant available checks:

- `npm run lint` (ESLint).
- `npm run build` when the change touches routing, Next config, server/client boundaries, metadata, server actions, or shared UI.
- `npm run test` (Vitest, `vitest run`) when domain logic in `src/lib/` changes; add/update colocated `*.test.ts`.

The only test/build scripts that exist are `dev`, `build`, `start`, `lint`, `test`, `test:watch`. Do not invent results for scripts that do not exist.

## Forbidden Patterns

Do not:

- move code out of `src/` or remove the `src/` layout
- introduce a new state, form, or UI library without an explicit request
- replace TanStack Query or bypass the Supabase `lib/supabase/*` seam from UI
- add route groups, `features/`, `store/`, or `data/` directories on a whim
- bypass strict TypeScript or add `any` as a shortcut
- silence ESLint without fixing the cause
- hardcode colors when a token exists, or change global design tokens casually
- duplicate domain calculations already in `src/lib/` (Elo / SM-2 / CEFR)
- change Next/React APIs based only on model memory — check the local Next docs
- perform broad refactors or rewrite unrelated files while doing a small task

## Before Editing

1. Inspect the relevant route, component, hook, action, type, and lib helper.
2. Identify the existing pattern in nearby files.
3. Reuse existing components and utilities first.
4. Make the smallest coherent change.
5. Preserve the current architecture and Polish UX.
6. Check TypeScript and lint impact.

## Definition of Done

A change is complete only when:

- it follows this `AGENTS.md` and preserves the `src/` structure
- TypeScript remains strict and clean; lint/build impact has been checked
- user-facing text is Polish and consistent with existing copy
- UI stays responsive and consistent with the existing design system/tokens
- server data goes through TanStack Query and mutations through server actions/Supabase seam
- domain logic is not duplicated; tests are added/updated when logic changes
- no unrelated files were modified

## If Unsure

- Prefer existing architecture over new abstractions.
- Search for similar code in `src/components/`, `src/hooks/`, `src/actions/`, `src/lib/`, and `src/types/`.
- Follow the closest existing pattern.
- If a requested change conflicts with this architecture, explain the conflict and propose the smallest safe path forward.
