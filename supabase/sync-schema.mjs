/**
 * Re-append `supabase/migrations/*.sql` to the end of `supabase/schema.sql`.
 *
 * The repository keeps both: `schema.sql` is the one-paste bootstrap documented
 * in the README (Supabase Studio > SQL Editor) and the readable picture of the
 * target schema, while `supabase/migrations/` is the incremental history applied
 * with `supabase db push`. They must describe the same database, so the
 * migrations are copied into `schema.sql` verbatim by this script rather than
 * maintained twice by hand.
 *
 * Run after editing or adding a migration:
 *   node supabase/sync-schema.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = "supabase/schema.sql";
const MIGRATIONS_DIR = "supabase/migrations";
const START = "-- ═══ MIGRATIONS APPENDED";

const HEADER = `
${START} ═════════════════════════════════════════════════════
-- Everything below is a VERBATIM copy of the files in \`supabase/migrations/\`,
-- concatenated in timestamp order, produced by \`node supabase/sync-schema.mjs\`.
-- Do not hand-edit these blocks — edit the migration and re-run the script.
-- ═════════════════════════════════════════════════════════════════════════════
`;

const baseline = readFileSync(SCHEMA, "utf8");
const head = baseline.includes(START)
  ? baseline.slice(0, baseline.indexOf(START)).replace(/\n+$/, "")
  : baseline.replace(/\n+$/, "");

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const body = migrations
  .map((name) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8").replace(/\n+$/, "");
    return `-- === BEGIN ${MIGRATIONS_DIR}/${name} ===\n\n${sql}\n\n-- === END ${name} ===`;
  })
  .join("\n\n");

writeFileSync(SCHEMA, `${head}\n${HEADER}\n${body}\n`);
console.log(`schema.sql synced with ${migrations.length} migration(s)`);
