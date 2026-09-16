#!/usr/bin/env node
/**
 * seed-study-pack.mjs — standalone loader for a `fluent-vocabulary-study-pack`
 * (NOT part of the Next.js app).
 *
 * Takes a study pack produced outside the app (German→Polish entries harvested
 * from one text) and turns it into rows of the shared `words` dictionary.
 *
 * WHAT IT WILL AND WILL NOT DO. Only `entries[].word_input` becomes a word.
 * `phrases`, `proper_names`, `wordforms` and `context_examples` are reported and
 * then dropped, on purpose:
 *   - a phrase in `words` would poison the matcher — `dictionary-match.ts`
 *     indexes an entry by the LAST word of `display`, so "Angst machen" would
 *     claim every *machen* in the library;
 *   - a proper name is not vocabulary;
 *   - a contextual meaning ("dieser here means tej") is one learner's note about
 *     one sentence, and `words.translation_pl` is the global, admin-curated
 *     dictionary. See `docs/architecture/personal-language-notebook.md`.
 *
 * AN EXISTING ENTRY IS NEVER OVERWRITTEN. Identity is (lower(lemma), word_type),
 * so *sein* the verb and *sein* the pronoun stay two rows and neither replaces
 * the other. A pack entry that already exists is skipped; `--fill-missing` only
 * writes columns that are still NULL in the database.
 *
 * Idempotent: re-running inserts nothing the second time.
 *
 * Usage:
 *   # A. straight into Supabase (needs the service-role key)
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_KEY=...
 *   node import/seed-study-pack.mjs import/prolog_study_pack.json
 *   node import/seed-study-pack.mjs import/prolog_study_pack.json --dry-run
 *   node import/seed-study-pack.mjs import/prolog_study_pack.json --fill-missing
 *
 *   # B. no key, no network: emit SQL to paste into the Supabase SQL editor
 *   node import/seed-study-pack.mjs import/prolog_study_pack.json \
 *     --sql import/prolog_study_pack.sql
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PACK = join(__dirname, "prolog_study_pack.json");
const CHUNK = 500;

/** Mirrors the check constraints on `public.words` in supabase/schema.sql. */
const WORD_TYPES = ["noun", "verb", "other"];
const ARTICLES = ["der", "die", "das"];
const GENDERS = ["m", "f", "n"];
const CEFR = ["A1", "A2", "B1", "B2"];
const AUX = ["haben", "sein"];
/** Mirrors WORD_TOPICS in src/lib/word-topics.ts. */
const TOPICS = [
  "praca", "zdrowie", "urzad", "mieszkanie", "zakupy",
  "rodzina", "edukacja", "podroze", "czas-wolny", "jedzenie",
];

/** Column order used by every insert, the SQL emitter and the temp table. */
const COLUMNS = [
  "lemma", "display", "article", "word_type", "gender", "translation_pl",
  "example_de", "example_pl", "cefr", "source", "topic", "plural", "aux",
  "synonyms", "ipa",
];
/** Postgres types for the temp table / VALUES casts, aligned with COLUMNS. */
const COLUMN_TYPES = {
  lemma: "text", display: "text", article: "text", word_type: "text",
  gender: "text", translation_pl: "text", example_de: "text",
  example_pl: "text", cefr: "text", source: "text", topic: "text",
  plural: "text", aux: "text", synonyms: "text[]", ipa: "text",
};
/** Columns `--fill-missing` may write — never lemma/display/word_type. */
const FILLABLE = [
  "article", "gender", "translation_pl", "example_de", "example_pl",
  "cefr", "source", "topic", "plural", "aux", "synonyms", "ipa",
];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { pack: null, dryRun: false, fillMissing: false, sql: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--fill-missing") opts.fillMissing = true;
    else if (arg === "--sql") {
      opts.sql = argv[i + 1];
      i += 1;
      if (!opts.sql) fail("--sql wymaga ścieżki pliku wyjściowego.");
    } else if (arg.startsWith("--")) fail(`Nieznana opcja: ${arg}`);
    else if (!opts.pack) opts.pack = arg;
    else fail(`Podano więcej niż jeden pakiet: ${arg}`);
  }
  opts.pack = opts.pack ?? DEFAULT_PACK;
  return opts;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------- normalisation

function trimOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireEnum(value, allowed, label, where) {
  if (value === null) return null;
  if (!allowed.includes(value)) {
    fail(`${where}: nieprawidłowa wartość ${label} — "${value}".`);
  }
  return value;
}

/**
 * The dictionary stores a noun WITH its article in `display` ("die Autobahn"),
 * which is what the gloss sheet shows and what text-to-speech reads. A pack may
 * ship the bare lemma, so restore the convention rather than mixing two.
 */
function displayFor(lemma, display, article, wordType) {
  if (wordType !== "noun" || !article) return display;
  return display.toLowerCase().startsWith(`${article} `)
    ? display
    : `${article} ${display}`;
}

/** One `entries[].word_input` → one row of `words` (without an id). */
function toRow(entry, index) {
  const where = `entries[${index}] (${entry?.entry_key ?? "?"})`;
  const input = entry?.word_input;
  if (!input || typeof input !== "object") fail(`${where}: brak word_input.`);

  const lemma = trimOrNull(input.lemma);
  if (!lemma) fail(`${where}: lemat jest wymagany.`);
  const display = trimOrNull(input.display) ?? lemma;

  const wordType = requireEnum(
    trimOrNull(input.word_type), WORD_TYPES, "word_type", where,
  );
  if (!wordType) fail(`${where}: word_type jest wymagany.`);

  const article = requireEnum(trimOrNull(input.article), ARTICLES, "article", where);
  const synonyms = Array.isArray(input.synonyms)
    ? input.synonyms.map((s) => trimOrNull(s)).filter(Boolean)
    : null;

  return {
    lemma,
    display: displayFor(lemma, display, article, wordType),
    article,
    word_type: wordType,
    gender: requireEnum(trimOrNull(input.gender), GENDERS, "gender", where),
    translation_pl: trimOrNull(input.translation_pl),
    example_de: trimOrNull(input.example_de),
    example_pl: trimOrNull(input.example_pl),
    cefr: requireEnum(trimOrNull(input.cefr), CEFR, "cefr", where),
    source: trimOrNull(input.source),
    topic: requireEnum(trimOrNull(input.topic), TOPICS, "topic", where),
    plural: trimOrNull(input.plural),
    aux: requireEnum(trimOrNull(input.aux), AUX, "aux", where),
    synonyms: synonyms && synonyms.length ? synonyms : null,
    ipa: trimOrNull(input.ipa),
  };
}

/** Identity of a dictionary entry: the lemma, case-folded, plus its part of speech. */
function keyOf(lemma, wordType) {
  return `${lemma.toLowerCase()}\u0000${wordType}`;
}

function readPack(path) {
  let pack;
  try {
    pack = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`nie udało się wczytać pakietu ${path}: ${err.message}`);
  }
  if (pack?.format !== "fluent-vocabulary-study-pack") {
    fail(`${path}: nieobsługiwany format "${pack?.format}".`);
  }
  if (pack.format_version !== 1) {
    fail(`${path}: nieobsługiwana wersja formatu ${pack.format_version}.`);
  }
  if (pack.language_from !== "de" || pack.language_to !== "pl") {
    fail(`${path}: obsługiwane są tylko pakiety de→pl.`);
  }
  if (!Array.isArray(pack.entries) || pack.entries.length === 0) {
    fail(`${path}: pakiet nie zawiera haseł.`);
  }

  const rows = [];
  const seen = new Map();
  pack.entries.forEach((entry, index) => {
    const row = toRow(entry, index);
    const key = keyOf(row.lemma, row.word_type);
    const first = seen.get(key);
    if (first !== undefined) {
      fail(
        `entries[${index}]: hasło "${row.lemma}" (${row.word_type}) powtarza ` +
        `się w pakiecie — już jako entries[${first}].`,
      );
    }
    seen.set(key, index);
    rows.push(row);
  });

  return { pack, rows };
}

// ------------------------------------------------------------------- reports

function reportPack(pack, rows) {
  console.log(`Pakiet: ${pack.title ?? "(bez tytułu)"}`);
  console.log(`  haseł do słownika:  ${rows.length}`);
  const skipped = [
    ["phrases", pack.phrases],
    ["proper_names", pack.proper_names],
    ["context_examples", pack.context_examples],
    ["wordforms", pack.wordforms],
  ].filter(([, list]) => Array.isArray(list) && list.length > 0);
  for (const [name, list] of skipped) {
    console.log(`  pominięto ${name}: ${list.length} (nie trafiają do words)`);
  }
}

// ------------------------------------------------------------------ SQL mode

function sqlLiteral(value, type) {
  if (value === null || value === undefined) return "null";
  if (type === "text[]") {
    const items = value.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`);
    return `'{${items.join(",")}}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function emitSql(pack, rows, { fillMissing }) {
  const cols = COLUMNS.join(", ");
  const values = rows
    .map((row, i) =>
      "  (" +
      COLUMNS.map((col) => {
        const literal = sqlLiteral(row[col], COLUMN_TYPES[col]);
        // Only the first row needs casts; it fixes the column types for the rest.
        return i === 0 ? `${literal}::${COLUMN_TYPES[col]}` : literal;
      }).join(", ") +
      ")")
    .join(",\n");

  const fill = FILLABLE.map(
    (col) => `       ${col} = coalesce(w.${col}, p.${col})`,
  ).join(",\n");

  return `-- ${pack.title ?? "fluent-vocabulary-study-pack"}
-- Wygenerowane przez import/seed-study-pack.mjs — nie edytuj ręcznie.
-- ${rows.length} haseł. Wklej całość do edytora SQL w Supabase i uruchom.
--
-- Skrypt jest idempotentny: hasło o tym samym lemacie i tej samej części mowy
-- nie zostanie dodane po raz drugi ani nadpisane.

begin;

create temporary table fluent_study_pack (
${COLUMNS.map((col) => `  ${col.padEnd(15)} ${COLUMN_TYPES[col]}${["lemma", "display", "word_type"].includes(col) ? " not null" : ""}`).join(",\n")}
) on commit drop;

insert into fluent_study_pack (${cols}) values
${values};

-- 1. Nowe hasła. \`words.id\` nie jest kolumną identity, więc numerujemy od
--    bieżącego maksimum; podzapytanie liczone jest raz, przed wstawieniem.
insert into public.words (id, ${cols})
select (select coalesce(max(id), 0) from public.words)
         + row_number() over (order by p.lemma, p.word_type),
       ${COLUMNS.map((col) => `p.${col}`).join(", ")}
  from fluent_study_pack p
 where not exists (
         select 1
           from public.words w
          where lower(w.lemma) = lower(p.lemma)
            and w.word_type = p.word_type
       );
${fillMissing ? `
-- 2. Uzupełnienie pustych kolumn w istniejących hasłach. \`coalesce\` pilnuje,
--    by nic już wypełnionego nie zostało nadpisane.
update public.words w
   set
${fill}
  from fluent_study_pack p
 where lower(w.lemma) = lower(p.lemma)
   and w.word_type = p.word_type;
` : ""}
-- Podsumowanie (temp table znika przy commit, więc liczymy przed nim).
select count(*)                             as hasla_w_pakiecie,
       count(w.id)                          as hasla_w_slowniku,
       count(*) filter (where w.id is null) as brakujace
  from fluent_study_pack p
  left join public.words w
    on lower(w.lemma) = lower(p.lemma)
   and w.word_type = p.word_type;

commit;
`;
}

// ------------------------------------------------------------- Supabase mode

/** Read every dictionary row; Supabase caps a single select at 1000 rows. */
async function fetchAllWords(supabase) {
  const columns = ["id", "lemma", "word_type", ...FILLABLE].join(", ");
  const page = 1000;
  const words = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("words")
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) fail(`nie udało się odczytać słownika: ${error.message}`);
    words.push(...data);
    if (data.length < page) return words;
  }
}

async function seedToSupabase(rows, { dryRun, fillMissing }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    fail(
      "SUPABASE_URL i SUPABASE_SERVICE_KEY są wymagane " +
      "(albo użyj --sql, żeby wygenerować skrypt bez połączenia).",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const existing = await fetchAllWords(supabase);
  const byKey = new Map(existing.map((w) => [keyOf(w.lemma, w.word_type), w]));
  const maxId = existing.reduce((max, w) => (w.id > max ? w.id : max), 0);

  const fresh = rows.filter((row) => !byKey.has(keyOf(row.lemma, row.word_type)));
  const known = rows.length - fresh.length;

  // Existing rows whose NULL columns the pack could fill.
  const patches = [];
  for (const row of rows) {
    const current = byKey.get(keyOf(row.lemma, row.word_type));
    if (!current) continue;
    const patch = {};
    for (const col of FILLABLE) {
      if (current[col] === null && row[col] !== null) patch[col] = row[col];
    }
    if (Object.keys(patch).length) patches.push({ id: current.id, patch });
  }

  console.log(`\nW słowniku jest ${existing.length} haseł (max id ${maxId}).`);
  console.log(`  nowych do dodania:  ${fresh.length}`);
  console.log(`  już w bazie:        ${known}`);
  console.log(`  z pustymi polami:   ${patches.length}${fillMissing ? "" : " (użyj --fill-missing)"}`);

  if (dryRun) {
    console.log("\n--dry-run: nic nie zapisano.");
    return;
  }

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh
      .slice(i, i + CHUNK)
      .map((row, j) => ({ id: maxId + i + j + 1, ...row }));
    const { error } = await supabase.from("words").insert(chunk);
    if (error) fail(`insert nie powiódł się przy wierszu ${i}: ${error.message}`);
    inserted += chunk.length;
    console.log(`✓ dodano ${inserted}/${fresh.length}`);
  }

  let filled = 0;
  if (fillMissing) {
    for (const { id, patch } of patches) {
      const { error } = await supabase.from("words").update(patch).eq("id", id);
      if (error) fail(`update hasła ${id} nie powiódł się: ${error.message}`);
      filled += 1;
    }
  }

  console.log(
    `\nGotowe. Dodano ${inserted} haseł` +
    (fillMissing ? `, uzupełniono ${filled}.` : "."),
  );
}

// ---------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { pack, rows } = readPack(opts.pack);

  reportPack(pack, rows);

  if (opts.sql) {
    writeFileSync(opts.sql, emitSql(pack, rows, opts), "utf8");
    console.log(`\n✓ zapisano SQL: ${opts.sql}`);
    console.log("  Wklej go do edytora SQL w Supabase i uruchom.");
    return;
  }

  await seedToSupabase(rows, opts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
