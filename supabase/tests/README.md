# Database security tests

Most of Fluent's security is not in the application layer. Row Level Security,
`EXECUTE` grants, unique constraints and `select … for update` are what actually
stop a learner forging progress, so they are tested where they live — against a
real PostgreSQL, not a mock.

## Running

Any PostgreSQL 15+ superuser connection works; **no Supabase project is
needed**. `00_supabase_shim.sql` stands in for `auth.users`, `auth.uid()` and the
`anon` / `authenticated` / `service_role` roles.

```bash
# against a local Postgres
PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh

# or against the local Supabase stack
supabase start
PGHOST=localhost PGPORT=54322 PGUSER=postgres ./supabase/tests/run.sh
```

The runner exercises three things:

1. **bootstrap** — `schema.sql` on an empty database, then the suite;
2. **upgrade** — the pre-migration schema (`fixtures/pre_migration_schema.sql`),
   then the migration on top, then the same suite. This is what proves the
   migration works on an already-provisioned project, not only a fresh one;
3. **idempotency** — re-applying both scripts changes nothing.

## What is asserted

| # | Invariant |
| - | --------- |
| 1 | A learner cannot read `questions` (the answer key); the removed `grade_*` / `update_streak` functions no longer exist; every `SECURITY DEFINER` function pins `search_path`; `finalize_test_session` is not executable by `anon`/`authenticated`. |
| 2 | A learner cannot insert `attempts` or `text_completions`, nor update `ability` / `answered` / `streak_days` on their own profile — while `display_name` and `daily_word_goal` still work. |
| 3 | The server picks the session's questions; re-entering resumes the same session; a question from another text cannot be answered into it. |
| 4 | User B cannot read or write user A's session, by table or by RPC. |
| 5 | A second answer to the same item returns the stored one (a retry with the *right* answer does not overwrite a wrong one); a negative `response_ms` is discarded; an incomplete session cannot be finalized. |
| 6 | Finalize writes attempts + completion + profile + streak once; a second call is a no-op returning the stored result; a rating computed from a stale profile is rejected; a session cannot be finalized for the wrong user. |
| 7 | A retake opens a new session, overwrites the completion, advances `answered` — and does not bump the streak twice in one day. |
| 8 | Calibration answers are replayable in order; an item cannot be answered twice; finalize is idempotent and labels the level as `placement`. |
| 9 | A manually chosen level is accepted but clamped and stamped `manual`. |
| 10 | `bump_word_review()` advances only the caller's counters. |

## Note on the shim

`00_supabase_shim.sql` is a **test fixture** and is never applied to a real
project. A hosted Supabase database already provides these objects, with more
behaviour than is reproduced here — the shim exists so these invariants can be
checked in CI without provisioning a project.
