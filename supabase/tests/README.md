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

1. **bootstrap** — `schema.sql` on an empty database, then both suites;
2. **upgrade** — the pre-migration schema (`fixtures/pre_migration_schema.sql`),
   then every migration in order, then the same suites. This is what proves the
   migrations work on an already-provisioned project, not only a fresh one;
3. **idempotency** — re-applying every script changes nothing.

All three suites run against the same database, in order:
`01_test_session_security.sql` exercises the test lifecycle and leaves `attempts`
behind, which `02_learning_engine_security.sql` relies on to check the backfill;
`03_today_engine_security.sql` then builds plans and drills on top of both.
Because they share a database, each suite uses its own id range (9xxx / 8xxx /
7xxx) and its own learners.

## What is asserted — test sessions (01)

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

## What is asserted — learning engine (02)

| # | Invariant |
| - | --------- |
| L1 | The skill/concept catalogs are readable by a learner and editable only by an admin — someone who can rewrite the taxonomy can rewrite what their own weaknesses are called. |
| L2 | A learner cannot forge a learning event or a review event, nor set their own skill, concept or word mastery. `apply_learning_evidence` and `apply_word_review_counter` are revoked from *every* role; `apply_review` is reachable only by `service_role`; every new `SECURITY DEFINER` function pins `search_path`. |
| L3 | One graded card writes the review event, the SM-2 schedule, the daily counter, the learning event and the word knowledge **together**; a receptive review never creates active knowledge; a replayed `interaction_id` changes nothing; a failure partway through rolls all of it back. |
| L4 | A write computed from a stale state version is rejected (`FL423`) rather than silently overwriting a concurrent update. |
| L5 | Finalizing a test writes evidence for the tagged skill and concepts, invents no concept for an untagged question, exposes the tags through `questions_public` (never the raw tables), and produces nothing on a replay. |
| L6 | User A can read their own learning history and knowledge state, and none of user B's. |
| L7 | Historical `attempts` are backfilled as `legacy_backfill` evidence, an answer already recorded natively is not duplicated, re-running the backfill adds nothing — and no review history is fabricated from SM-2 state. |
| L8 | Every item tag points at a catalog row, and placement items keep the mapping their coarse `skill` implies (a multiple-choice vocabulary item is *receptive*, never active). |

## What is asserted — Today engine (03)

| # | Invariant |
| - | --------- |
| T1 | A learning day is the **learner's** day: 23:30 UTC is already tomorrow in Warsaw, still today in New York, and an unresolvable zone falls back to UTC instead of raising. An unresolvable zone is rejected at the write; the minute budget is range-checked. |
| T2 | A learner cannot insert a plan, call `create_daily_plan`, seal a drill, or forge a completed `practice_session`. Plan generation and drill finalization are `service_role` only; `sync_daily_plan` / `start_practice_session` stay learner-callable because they derive the user from `auth.uid()`. |
| T3 | Ten calls on the same learning day produce **one** plan (the unique index, not a JavaScript check); `estimated_minutes` is summed from the items; a different day gets its own plan. |
| T4 | An untouched placement-only plan may be replaced once the learner has a level — and a real plan is never rebuilt mid-day, flag or no flag. |
| T5 | User A cannot read user B's plans or items, and cannot reconcile B's plan. |
| T6 | A learner cannot mark an item complete or set its `priority_score`; an untouched item reconciles as `pending`. |
| T7 | A drill's items are server-picked, drawn only from published texts, resumed rather than duplicated; the answer key is revealed only after the answer is committed, a replay does not overwrite a wrong answer, a foreign question is refused, and partial progress shows as partial. |
| T8 | An unfinished drill cannot be sealed; finishing one scores it, writes exactly one `practice_answer` event, updates concept knowledge and completes the plan item **in the same transaction**; a replayed finalize duplicates nothing; a drill cannot be sealed for another user. |
| T9 | Reconciling repeatedly changes nothing (it recomputes, never increments); a skip survives reconciliation, cannot downgrade a completed item, and cannot be applied to another learner's plan. |
| T10 | A day where every activity was skipped is **not** a completed day. |
| T11 | `mark_text_opened` records only the caller's reading and refuses a draft passage; `text_progress` is not learner-writable; the practice pool counts only published questions, omits concepts with none, and a drill for such a concept is refused rather than opened empty. |

## Note on the shim

`00_supabase_shim.sql` is a **test fixture** and is never applied to a real
project. A hosted Supabase database already provides these objects, with more
behaviour than is reproduced here — the shim exists so these invariants can be
checked in CI without provisioning a project.
