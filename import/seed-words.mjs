#!/usr/bin/env node
/**
 * seed-words.mjs — standalone words loader (NOT part of the Next.js app).
 *
 * Upserts the DTZ headword seed (import/dtz_words_seed.json) into the Supabase
 * `words` table WITHOUT calling any external API. Translations, examples and
 * CEFR are left null — the app works with `translation_pl = null` and they can
 * be filled in later by `translate-import.mjs` (which does need the Claude API).
 *
 * Idempotent: upserts on `id`, so re-running is safe.
 *
 * Usage:
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_KEY=...
 *   node import/seed-words.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const CHUNK = 500;

async function main() {
  const seedPath = join(__dirname, "dtz_words_seed.json");
  const seed = JSON.parse(readFileSync(seedPath, "utf8"));

  // Only the headword columns; enrichment fields stay null / default.
  const rows = seed.map((w) => ({
    id: w.id,
    lemma: w.lemma,
    display: w.display,
    article: w.article ?? null,
    word_type: w.word_type,
    gender: w.gender ?? null,
    source: "DTZ",
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("words")
      .upsert(chunk, { onConflict: "id" });
    if (error) {
      console.error(`✗ upsert failed at row ${i}: ${error.message}`);
      process.exit(1);
    }
    upserted += chunk.length;
    console.log(`✓ ${upserted}/${rows.length}`);
  }

  console.log(`\nDone. upserted ${upserted} headwords (no translations).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
