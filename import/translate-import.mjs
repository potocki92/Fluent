#!/usr/bin/env node
/**
 * translate-import.mjs — standalone import pipeline (NOT part of the Next.js app).
 *
 * Reads the DTZ headword seed, asks Claude for Polish translations + original
 * example sentences + a CEFR estimate, and upserts each enriched row into the
 * Supabase `words` table. Run manually, in batches; safe to re-run (already
 * translated rows are skipped).
 *
 * Usage:
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_KEY=...
 *   export ANTHROPIC_API_KEY=...
 *   node import/translate-import.mjs [--start 0] [--batch 50] [--dry-run]
 *
 * Optional: CLAUDE_MODEL (defaults to a fast, low-cost model).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { start: 0, batch: 50, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--start") args.start = Number(argv[++i]);
    else if (a === "--batch") args.batch = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
  }
  if (!Number.isInteger(args.start) || args.start < 0) args.start = 0;
  if (!Number.isInteger(args.batch) || args.batch < 1) args.batch = 50;
  return args;
}

const { start, batch, dryRun } = parseArgs(process.argv.slice(2));

// ── Env ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY && !dryRun) {
  console.error("✗ ANTHROPIC_API_KEY is required (or pass --dry-run).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const CEFR_VALUES = new Set(["A1", "A2", "B1", "B2"]);

// ── Claude call ─────────────────────────────────────────────────────────────
function buildPrompt(words) {
  const list = words
    .map((w) => `- id ${w.id}: "${w.display}" (${w.word_type})`)
    .join("\n");
  return `You are building a German→Polish learner dictionary.
For each German word below, return a Polish translation, a SHORT original German
example sentence (write your own, do not copy from any source), its Polish
translation, and a CEFR level you assign from the word's frequency/complexity.

Words:
${list}

Respond with ONLY a JSON array, no prose, in this exact shape:
[{"id": <number>, "pl": "<polish translation>", "example_de": "<short german sentence>", "example_pl": "<polish translation of example_de>", "cefr": "A1|A2|B1|B2"}]`;
}

async function callClaude(words) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt(words) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text ?? "";
}

/** Extract and parse the JSON array from a Claude text response. */
function parseArray(text) {
  const open = text.indexOf("[");
  const close = text.lastIndexOf("]");
  if (open === -1 || close === -1) throw new Error("No JSON array found");
  return JSON.parse(text.slice(open, close + 1));
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const seedPath = join(__dirname, "dtz_words_seed.json");
  const seed = JSON.parse(readFileSync(seedPath, "utf8"));
  const seedById = new Map(seed.map((w) => [w.id, w]));

  // Already-translated ids (skip them).
  const { data: done, error: doneErr } = await supabase
    .from("words")
    .select("id")
    .not("translation_pl", "is", null);
  if (doneErr) {
    console.error("✗ Could not read existing words:", doneErr.message);
    process.exit(1);
  }
  const doneIds = new Set((done ?? []).map((r) => r.id));

  const pending = seed
    .filter((w) => !doneIds.has(w.id))
    .slice(start);

  const total = seed.length;
  console.log(
    `Seed: ${total} words · already translated: ${doneIds.size} · to process: ${pending.length}` +
      (dryRun ? " · DRY RUN" : ""),
  );

  let processed = doneIds.size;
  let failures = 0;

  for (let i = 0; i < pending.length; i += batch) {
    const chunk = pending.slice(i, i + batch);

    if (dryRun) {
      processed += chunk.length;
      console.log(
        `· (dry-run) would translate ${chunk.length} words [${chunk[0].id}…${chunk[chunk.length - 1].id}]`,
      );
      continue;
    }

    let items;
    try {
      items = parseArray(await callClaude(chunk));
    } catch {
      // Retry once on parse/transport failure.
      try {
        items = parseArray(await callClaude(chunk));
      } catch (err) {
        failures += chunk.length;
        console.error(`✗ batch [${chunk[0].id}…] failed: ${err.message}`);
        continue;
      }
    }

    const rows = [];
    for (const item of items) {
      const seedWord = seedById.get(item.id);
      if (!seedWord) continue;
      rows.push({
        ...seedWord,
        translation_pl: item.pl ?? null,
        example_de: item.example_de ?? null,
        example_pl: item.example_pl ?? null,
        cefr: CEFR_VALUES.has(item.cefr) ? item.cefr : null,
        source: "DTZ",
      });
    }

    const { error: upErr } = await supabase
      .from("words")
      .upsert(rows, { onConflict: "id" });
    if (upErr) {
      failures += chunk.length;
      console.error(`✗ upsert failed: ${upErr.message}`);
      continue;
    }

    processed += rows.length;
    const pct = Math.round((processed / total) * 100);
    console.log(`✓ ${processed}/${total} (${pct}%)`);
  }

  console.log(
    `\nDone. translated total: ${processed}/${total}` +
      (failures ? ` · failures: ${failures}` : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
