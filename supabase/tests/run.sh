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
#   upgrade   — the pre-migration schema, then the migration on top (what an
#               already-provisioned project runs)
set -euo pipefail

cd "$(dirname "$0")/../.."

PSQL=${PSQL_BIN:-psql}
ADMIN_DB=${PGDATABASE:-postgres}
MIGRATION=supabase/migrations/20260913120000_test_sessions_and_progress_security.sql

if ! "$PSQL" -d "$ADMIN_DB" -tAc 'select 1' >/dev/null 2>&1; then
  echo "Cannot reach PostgreSQL. Set PGHOST/PGPORT/PGUSER (superuser) first." >&2
  exit 2
fi

fresh_db() {
  "$PSQL" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -q \
    -c "drop database if exists $1;" -c "create database $1;" >/dev/null 2>&1
}

echo "▸ bootstrap path: schema.sql on an empty database"
fresh_db fluent_test_bootstrap
"$PSQL" -d fluent_test_bootstrap -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/00_supabase_shim.sql \
  -f supabase/schema.sql \
  -f supabase/tests/01_test_session_security.sql

echo "▸ upgrade path: migration applied to a pre-migration database"
fresh_db fluent_test_upgrade
"$PSQL" -d fluent_test_upgrade -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/00_supabase_shim.sql \
  -f supabase/tests/fixtures/pre_migration_schema.sql \
  -f "$MIGRATION" \
  -f supabase/tests/01_test_session_security.sql

echo "▸ idempotency: re-applying both scripts changes nothing"
"$PSQL" -d fluent_test_bootstrap -v ON_ERROR_STOP=1 -q \
  -f supabase/schema.sql -f "$MIGRATION"

"$PSQL" -d "$ADMIN_DB" -q \
  -c "drop database if exists fluent_test_bootstrap;" \
  -c "drop database if exists fluent_test_upgrade;" >/dev/null 2>&1

echo
echo "✔ database tests passed (bootstrap + upgrade + idempotency)"
