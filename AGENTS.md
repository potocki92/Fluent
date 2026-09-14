<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Fluent Agent Rules

These instructions are mandatory for every AI coding agent working in this repository.

The goal is to preserve and extend the architecture that already exists in this app. Do not invent a new architecture unless the requested task explicitly requires a migration.

## Project Snapshot

**Fluent** is a Polish-first app for learning German. Users read German texts, take adaptive comprehension tests (ability tracked with an Elo-style rating), practise the concepts they keep failing, and review vocabulary with SM-2 spaced-repetition flashcards. The home screen (`/today`) is a personalised daily plan built from all of that.

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
- `src/components/` — UI grouped by area: `ui/` (shadcn primitives), `auth/`, `layout/`, `flashcard/`, `charts/`, `words/`, `texts/`, `level/`, `reader/` (the chapter reader), `library/` (the shelf and book pages).
- `src/hooks/` — TanStack Query data hooks (`useTexts`, `useWords`, `useSavedWords`, `useDueWords`) and the Zustand store (`useAbility`).
- `src/actions/` — server actions (`"use server"`): the test lifecycle
  (`start-test-session.ts`, `answer-test-question.ts`, `finalize-test-session.ts`),
  the placement lifecycle (`start-`/`answer-`/`finalize-calibration-*.ts`),
  the story lifecycle (`chapter-analysis.ts`, `chapter-preparation.ts`,
  `chapter-assessment.ts`, `admin-chapter-questions.ts`, `admin-story.ts`),
  the weakness-drill lifecycle (`start-`/`answer-`/`finalize-practice-*.ts`),
  the daily plan (`today-plan.ts`), the reader (`reading.ts` — sessions, progress,
  lookups, saving a word with its sentence), library content
  (`admin-library.ts` — creating and processing chapters),
  `update-reader-preferences.ts`, `save-word.ts`, `update-srs.ts`.
- `src/lib/` — domain logic (`elo.ts`, `sm2.ts`, `cefr.ts`, `test-session.ts`),
  `learning/` (the knowledge model: skill/concept catalogs, the evidence map,
  `knowledge-model.ts`, `aggregate.ts`, `queries.ts`, `weakness.ts` — all pure,
  no Supabase), `learning/planner/` (the Today engine: `constants.ts` holds every
  weight and estimate, `priority.ts` scores, `select.ts` fits the budget,
  `reasons.ts` renders the "why", `learning-day.ts` owns the timezone rules;
  `candidates.ts` and `build.ts` are the only files there that touch Supabase),
  `content/` (the content pipeline: `normalize`, `paragraphs`, `sentences`,
  `tokenize`, `dictionary-match`, `process`, `version` — all pure and
  deterministic, no Supabase), `reading/` (the reader's domain: `constants.ts`
  holds every threshold, `progress.ts` owns resume-vs-furthest, `coverage.ts`
  owns vocabulary coverage, `preferences.ts` owns typography), `library/queries.ts`
  (the reader's read layer, the only file there that touches Supabase),
  `errors.ts` (the error taxonomy for the learning engine), `utils.ts` (`cn`), and the
  Supabase seam in `src/lib/supabase/{client,server,service,middleware}.ts`.
- `src/types/` — `index.ts` (domain types) and `database.ts` (DB types).
- `src/proxy.ts` — Next 16 middleware entry (`proxy`), delegates to `updateSession`.
- `supabase/schema.sql` — database schema (one-paste bootstrap). Incremental history
  lives in `supabase/migrations/`; the two are kept identical by
  `node supabase/sync-schema.mjs`. Database security tests: `supabase/tests/`.
- `docs/architecture/` — ADRs. Read `test-sessions.md` before touching the test,
  calibration or progress-write paths, `learning-engine.md` before touching
  learning events, review history or any knowledge/skill/concept state,
  `today-engine.md` before touching daily plans, the priority engine, weakness
  ranking, weakness practice or the learning-day/timezone rules, and
  `reader-story-engine.md` before touching library content, chapters, structured
  text, word occurrences, reading progress/sessions/lookups or the content
  pipeline, and `story-learning-engine.md` before touching chapter analysis,
  preparation, the chapter question bank, question generation, the Chapter
  Challenge or the chapter learning lifecycle.
- Tests are colocated as `src/**/*.test.ts` (Vitest), e.g. `src/lib/elo.test.ts`, `src/lib/sm2.test.ts`.
- Database migrations may only ever WIDEN a check constraint on a re-run. Guard
  every `drop constraint` / `add constraint` block on whether the value that
  migration introduces is already permitted, or re-applying `schema.sql` to a
  provisioned database will reinstate an older phase's shorter whitelist and fail
  against rows a later phase has since written.

Do NOT move the project to root-level folders or out of `src/`. There is no `features/`, `store/`, or `data/` directory — do not assume them.

## App Router Rules

- Route files in `src/app/` should stay thin and compose components/hooks.
- Routing is flat: `/today`, `/library`, `/library/[slug]`, `/library/[slug]/[chapter]`,
  `/library/[slug]/[chapter]/przygotowanie`, `/library/[slug]/[chapter]/wyzwanie`, `/learn`, `/learn/[textId]`, `/learn/[textId]/test`, `/learn/[textId]/results`, `/review`, `/practice/[conceptCode]`, `/browse`, `/stats`, `/settings`, `/calibration`, `/auth`, `/auth/callback`. There are no route groups like `(app)`/`(auth)` — do not introduce them casually. `/` redirects to `/today`. The reader opts out of the app chrome through `AppShell`, not through a route group.
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
- **Progress is server-owned.** `attempts`, `text_completions`, the session tables,
  the learning-engine tables (`learning_events`, `review_events`, `user_*_state`,
  `user_word_knowledge`), the Today-engine tables (`daily_plans`,
  `daily_plan_items`, `practice_sessions`, `practice_session_items`,
  `text_progress`) and the progress columns of `profiles` have no client write
  path, by design. Do not add one. New progress writes belong inside the existing
  SECURITY DEFINER functions, or a new one that derives its user from `auth.uid()`
  and has `EXECUTE` granted narrowly.
- **Plan completion is derived, never asserted.** There is no "mark this done"
  endpoint and there must not be one. `sync_daily_plan` recomputes each activity
  from the table that recorded the underlying work, which is what makes completion
  idempotent, unforgeable and self-healing all at once.
- **A learning day is the learner's day.** Never use `current_date` for anything
  plan-related; use `learning_day(tz, at)` in SQL or `learningDateFor(tz, now)` in
  TypeScript. A UTC server day is the wrong day for hours at a time, and the date
  is a daily plan's identity.
- **Reading progress never goes backwards, and reading content is never markup.**
  `furthest_*` is monotonic in SQL (`greatest(...)`), `resume_*` is not, and the
  two are different facts — never collapse them. Chapters are stored as plain
  text plus positions; the reader renders structure and never stores or renders
  arbitrary HTML. Positions are the bookmark, so the content pipeline must stay
  deterministic and `CONTENT_PROCESSOR_VERSION` must be bumped whenever its
  output for the same input could change.
- **A lookup is not a failed test.** Tapping a word is weak evidence about that
  word and nothing else: no concept is attributed, and the weight lives in
  `src/lib/learning/evidence.ts` with `src/lib/reading/constants.ts`. Opening or
  finishing a chapter is history and moves no knowledge state at all.
- **Knowledge is evidence-backed.** A skill, concept or word state is only ever
  written as the result of a real answer, through `apply_learning_evidence`. Never
  infer one dimension from another (reading does not imply speaking), never
  attribute a wrong answer to a concept the item is not tagged with, and never let
  a recognition exercise feed active vocabulary. When there is no evidence, the
  answer is "unknown" — not a default score.
- `src/lib/supabase/service.ts` (service role) bypasses RLS entirely. Import it only
  from `"use server"` modules, only for the finalize RPCs, and only after the acting
  user has been established from the cookie-bound client.
- Expected failures in these flows are RETURNED as `ActionResult<T>` from
  `src/lib/errors.ts`, never thrown — Next redacts thrown Server Action errors in
  production, so a thrown error cannot be branched on by the UI.
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
- `supabase/tests/run.sh` when RLS, grants, migrations or any SQL function changes.
  It needs only a PostgreSQL superuser connection (`PGHOST`/`PGPORT`/`PGUSER`), not a
  Supabase project, and verifies the bootstrap path, the upgrade path and idempotency.

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
- duplicate domain calculations already in `src/lib/` (Elo / SM-2 / CEFR / the
  knowledge model / the priority engine) — including re-implementing them in
  PL/pgSQL; the database owns transactions, `src/lib/` owns the arithmetic
- scatter tuning constants: every planner weight, budget and time estimate lives
  in `src/lib/learning/planner/constants.ts`, every reader threshold (idle
  timeout, flush cadence, completion ratio, coverage floors, lookup discount)
  lives in `src/lib/reading/constants.ts`, every Story-engine weight, threshold
  and budget lives in `src/lib/story/constants.ts`, and a bare `* 0.35` anywhere
  else in any of them is a bug
- let the client decide anything authoritative: which questions a test contains, what
  a score is, or what a learner's ability becomes
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
