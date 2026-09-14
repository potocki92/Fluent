#!/usr/bin/env bash
# Run Fluent's database security tests against throwaway PostgreSQL databases.
#
# The tests cover what the application layer cannot enforce on its own — RLS,
# EXECUTE grants, row locks, uniqueness — so they need a real Postgres. They do
# NOT need a Supabase project: supabase/tests/00_supabase_shim.sql stands in for
# `auth.users`, `auth.uid()` and the anon/authenticated/service_role roles.
#
# Connect with the standard libpq environment variables, as a superuser:
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh
#
# Two paths are verified, because both must produce the same database:
#   bootstrap — schema.sql on an empty database (what a new install runs)
#   upgrade   — the pre-migration schema, then every migration in order (what an
#               already-provisioned project runs)
# …and the final step compares the two schemas directly, so "both produce the
# same database" is an assertion rather than an aspiration.
set -euo pipefail

cd "$(dirname "$0")/../.."

PSQL=${PSQL_BIN:-psql}
ADMIN_DB=${PGDATABASE:-postgres}

# Applied in timestamp order on the upgrade path. Keep in step with
# supabase/migrations/ — a migration missing here is a migration whose upgrade
# path nobody is checking.
MIGRATIONS=(
  supabase/migrations/20260913120000_test_sessions_and_progress_security.sql
  supabase/migrations/20260913160000_learning_engine.sql
  supabase/migrations/20260913190000_today_engine.sql
  supabase/migrations/20260914090000_profile_daily_review_columns.sql
)

# The suites run against the same database, in order: 01 exercises the test
# lifecycle and leaves attempts behind, which 02 relies on to check the backfill,
# and 03 builds daily plans and weakness drills on top of both. Each suite owns
# its own id range and its own learners so they cannot collide.
SUITES=(
  supabase/tests/01_test_session_security.sql
  supabase/tests/02_learning_engine_security.sql
  supabase/tests/03_today_engine_security.sql
)

if ! "$PSQL" -d "$ADMIN_DB" -tAc 'select 1' >/dev/null 2>&1; then
  echo "Cannot reach PostgreSQL. Set PGHOST/PGPORT/PGUSER (superuser) first." >&2
  exit 2
fi

fresh_db() {
  "$PSQL" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q \
    -c "drop database if exists $1;" -c "create database $1;" >/dev/null 2>&1
}

# Expand an array into the repeated `-f <file>` arguments psql expects.
as_files() {
  local file
  for file in "$@"; do printf ' -f %s' "$file"; done
}

echo "▸ bootstrap path: schema.sql on an empty database"
fresh_db fluent_test_bootstrap
# shellcheck disable=SC2046  # deliberate word splitting of the -f arguments
"$PSQL" -d fluent_test_bootstrap -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/00_supabase_shim.sql \
  -f supabase/schema.sql \
  $(as_files "${SUITES[@]}")

echo "▸ upgrade path: migrations applied to a pre-migration database"
fresh_db fluent_test_upgrade
# shellcheck disable=SC2046
"$PSQL" -d fluent_test_upgrade -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/00_supabase_shim.sql \
  -f supabase/tests/fixtures/pre_migration_schema.sql \
  $(as_files "${MIGRATIONS[@]}") \
  $(as_files "${SUITES[@]}")

echo "▸ idempotency: re-applying every script changes nothing"
# shellcheck disable=SC2046
"$PSQL" -d fluent_test_bootstrap -v ON_ERROR_STOP=1 -q \
  -f supabase/schema.sql $(as_files "${MIGRATIONS[@]}")

# ─────────────────────────────────────────────────────────────────────────────
# PARITY: the two paths must produce the SAME database.
# ─────────────────────────────────────────────────────────────────────────────
# The README has always claimed this; nothing checked it. It went wrong exactly
# once and the failure was invisible for months: four columns were declared only
# inside `create table if not exists public.profiles ( … )`, so a fresh install
# had them and an upgraded database silently did not. Re-running schema.sql
# could never fix that, because schema.sql was where the omission lived.
#
# Comparing the two schemas directly catches the whole class — a column, a
# function or a signature that a new install gets and an existing project does
# not — instead of relying on a suite happening to exercise the missing piece.
echo "▸ parity: a fresh install and an upgraded database are identical"
schema_fingerprint() {
  "$PSQL" -d "$1" -tAq -c "
    select 'column  ' || table_name || '.' || column_name
    from information_schema.columns where table_schema = 'public'
    union all
    select 'routine ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by 1;"
}
if ! diff <(schema_fingerprint fluent_test_bootstrap) \
          <(schema_fingerprint fluent_test_upgrade) > /tmp/fluent_schema_diff.txt; then
  echo >&2
  echo "FAIL: the upgrade path does not reproduce a fresh install." >&2
  echo "      '<' = only in a fresh install (missing for existing projects)" >&2
  echo "      '>' = only after upgrading (left behind by schema.sql)" >&2
  sed 's/^/      /' /tmp/fluent_schema_diff.txt >&2
  rm -f /tmp/fluent_schema_diff.txt
  exit 1
fi
rm -f /tmp/fluent_schema_diff.txt

"$PSQL" -d "$ADMIN_DB" -q \
  -c "drop database if exists fluent_test_bootstrap;" \
  -c "drop database if exists fluent_test_upgrade;" >/dev/null 2>&1

echo
echo "✔ database tests passed (bootstrap + upgrade + idempotency + parity)"
