# Fluent

A German vocabulary learning app for Polish speakers — learn through reading
passages, adaptive comprehension tests (Elo-rated), and SM-2 spaced-repetition
flashcards.

## Stack

- **Next.js 16** (App Router, TypeScript, `src/`)
- **Tailwind CSS v4** + **shadcn/ui** (dark theme)
- **Supabase** (`@supabase/ssr`) — auth, Postgres, RLS
- **Zustand** (ability store) + **TanStack Query** (data fetching)
- **Framer Motion** (flashcard flips) + **Recharts** (progress chart)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase keys
npm run dev
```

Open http://localhost:3000 — the root redirects to `/learn`.

### Environment variables

| Variable                        | Where     | Notes                          |
| ------------------------------- | --------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | client    | Project URL                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client    | Anon public key                |
| `SUPABASE_SERVICE_ROLE_KEY`     | server    | **Never** prefix `NEXT_PUBLIC` |

### Database

Run [`supabase/schema.sql`](./supabase/schema.sql) in **Supabase Studio → SQL
Editor**. Then in **Authentication → Providers** enable **Anonymous** and
**Email (magic link)**.

Regenerate types after schema changes:

```bash
npx supabase gen types typescript --project-id <REF> > src/types/database.ts
```

## Scripts

| Script           | Description                          |
| ---------------- | ----------------------------------- |
| `npm run dev`    | Start the dev server                |
| `npm run build`  | Production build                    |
| `npm test`       | Run unit tests (Vitest)             |
| `npm run lint`   | ESLint                              |

## Architecture notes

- **`src/proxy.ts`** — Next.js 16 renamed the `middleware` convention to
  `proxy`. It refreshes the Supabase session on every request via
  `lib/supabase/middleware.ts → updateSession()`.
- **`src/actions/submit-answer.ts`** — the only place a question's
  `correct_idx` is read. The answer key never reaches the client; the action
  grades the answer, updates the learner's Elo ability, writes an immutable
  `attempts` row, and bumps the daily streak.
- **`src/lib/elo.ts` / `src/lib/sm2.ts`** — pure, unit-tested algorithms for
  ability estimation and spaced repetition.
- **`src/lib/cefr.ts`** — maps Elo ability ↔ CEFR level.

## Design tokens

Defined in `src/app/globals.css` (`@theme`) and mapped onto the shadcn
semantic tokens so every component inherits the theme:

| Token         | Value     | Utility                                 |
| ------------- | --------- | --------------------------------------- |
| background    | `#1a202c` | `bg-dark` / `bg-background`             |
| card          | `#2d3748` | `bg-card`                               |
| nested card   | `#374151` | `bg-card2`                              |
| text main     | `#e2e8f0` | `text-main` / `text-foreground`         |
| text muted    | `#a0aec0` | `text-muted2` / `text-muted-foreground` |
| gold (accent) | `#d4a574` | `text-gold` / `bg-gold`                 |
| gold-dark     | `#b8935f` | `bg-gold-dark`                          |
| blue          | `#4299e1` | `text-blue`                             |
| green         | `#48bb78` | `text-green`                            |
| red           | `#f56565` | `text-red`                              |
