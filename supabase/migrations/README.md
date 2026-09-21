# Database migrations

Two files describe the same database, and both are kept current:

| File | Role |
| ---- | ---- |
| `supabase/schema.sql` | One-paste bootstrap (Supabase Studio → SQL Editor) and the readable picture of the target schema. Safe to run on a fresh **or** an already-provisioned database. |
| `supabase/migrations/*.sql` | Incremental history, applied with the Supabase CLI. |

`schema.sql` ends with a verbatim copy of every migration, concatenated in
timestamp order. **Do not hand-edit those blocks** — edit the migration, then:

```bash
node supabase/sync-schema.mjs
```

## Adding a migration

```bash
supabase migration new <short_description>   # creates <timestamp>_<name>.sql
# …write the DDL…
node supabase/sync-schema.mjs                # mirror it into schema.sql
supabase/tests/run.sh                        # verify (see supabase/tests/README.md)
```

Applying:

```bash
supabase db push        # remote (linked project)
supabase migration up   # local stack
```

## Rules

Migrations here run against databases that already hold real learner progress,
so each one must be:

- **Idempotent** — `create … if not exists`, `create or replace function`,
  `drop policy if exists` before `create policy`, guarded `do $$ … $$` blocks for
  constraints. Re-running a migration is a normal event, not an accident.
- **Non-destructive** — never drop a column or delete rows that hold progress.
  New columns are nullable or carry a default; historical rows keep their nulls
  (`attempts.test_session_id` is null for every answer recorded before test
  sessions existed, and the unique constraint treats nulls as distinct so they
  neither collide nor block anything).
- **Verified, not assumed** — `supabase/tests/run.sh` applies the migration to a
  copy of the *pre-migration* schema and then runs the full security suite
  against it, so the upgrade path is exercised, not hoped for.

## Storage

`20260915120000_private_book_import.sql` creates the private
`private-book-imports` bucket and four owner-scoped policies on
`storage.objects`. The whole block is guarded on the `storage` schema existing —
so it is a no-op on a plain PostgreSQL instance — and wrapped in an
`insufficient_privilege` handler, because some managed deployments lock that
schema to its own admin role.

If you see

```
WARNING: book import storage objects were not created (...)
```

the rest of the migration applied cleanly and only the Storage half needs to be
run by hand, as a role that owns `storage.objects`. **The failure mode is safe:**
without the bucket, uploads fail loudly, and without the policies RLS denies
everything. Book import simply will not work until the block is applied.

`20260921120000_material_covers.sql` creates the second bucket, `content-covers`,
under the same guard and the same warning (`content cover storage objects were
not created (...)`). It is the **public** one: material artwork is the picture of
published teaching content, so every visitor may read it, while insert, update
and delete are restricted to `public.is_admin()`. The two buckets are opposites
on purpose and neither inherits the other's rule — a learner's own file is
private, a published material's cover is not.
