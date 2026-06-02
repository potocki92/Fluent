#!/usr/bin/env node
/**
 * seed-texts.mjs — standalone seeder (NOT part of the Next.js app).
 *
 * Inserts the 3 demo reading texts (original German, not from DTZ) and their
 * comprehension questions. Question difficulty is taken from ITEM_DIFFICULTY,
 * anchored on the same CEFR→Elo scale the app uses (src/lib/cefr.ts).
 * Idempotent: a text whose title already exists is skipped.
 *
 * Usage:
 *   export SUPABASE_URL=...
 *   export SUPABASE_SERVICE_KEY=...
 *   node import/seed-texts.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("✗ SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// CEFR→Elo anchors (mirror of src/lib/cefr.ts CEFR_DIFFICULTY).
const CEFR_DIFFICULTY = { A1: 1100, A2: 1300, B1: 1500, B2: 1700 };

/** Per-level item difficulty: medium = band anchor, easy/hard = ±100. */
const ITEM_DIFFICULTY = Object.fromEntries(
  Object.entries(CEFR_DIFFICULTY).map(([cefr, base]) => [
    cefr,
    { easy: base - 100, medium: base, hard: base + 100 },
  ]),
);

const TEXTS = [
  {
    title: "Im Supermarkt",
    cefr: "A1",
    body:
      'Anna geht in den <mark data-lemma="Supermarkt">Supermarkt</mark>. ' +
      'Sie <mark data-lemma="kaufen">kauft</mark> <mark data-lemma="Brot">Brot</mark>, ' +
      'einen <mark data-lemma="Apfel">Apfel</mark> und <mark data-lemma="Wasser">Wasser</mark>. ' +
      "An der Kasse bezahlt sie mit Karte. Dann geht sie nach Hause.",
    questions: [
      {
        prompt: "Dokąd idzie Anna?",
        options: ["Do szkoły", "Do supermarketu", "Do lekarza", "Do pracy"],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Co kupuje Anna?",
        options: ["Mleko i ser", "Tylko chleb", "Chleb, jabłko i wodę", "Owoce i warzywa"],
        correct_idx: 2,
        level: "medium",
      },
      {
        prompt: "Jak Anna płaci?",
        options: ["Gotówką", "Kartą", "Telefonem", "Nie płaci"],
        correct_idx: 1,
        level: "hard",
      },
    ],
  },
  {
    title: "Beim Arzt",
    cefr: "A2",
    body:
      'Herr Müller fühlt sich nicht <mark data-lemma="gut">gut</mark>. ' +
      'Er hat Kopfschmerzen und geht zum <mark data-lemma="Arzt">Arzt</mark>. ' +
      'Der Arzt untersucht ihn und sagt: „Sie haben eine Erkältung." ' +
      'Herr Müller bekommt ein Rezept und soll viel <mark data-lemma="Wasser">Wasser</mark> trinken.',
    questions: [
      {
        prompt: "Jak się czuje pan Müller?",
        options: ["Źle", "Bardzo dobrze", "Świetnie", "Wspaniale"],
        correct_idx: 0,
        level: "easy",
      },
      {
        prompt: "Co mu dolega?",
        options: ["Ból brzucha", "Ból głowy", "Ból nogi", "Ból zęba"],
        correct_idx: 1,
        level: "medium",
      },
      {
        prompt: "Co radzi lekarz?",
        options: ["Więcej pracować", "Jeść słodycze", "Pić dużo wody", "Biegać codziennie"],
        correct_idx: 2,
        level: "hard",
      },
    ],
  },
  {
    title: "Umzug",
    cefr: "B1",
    body:
      'Familie Schmidt zieht in eine andere <mark data-lemma="Stadt">Stadt</mark> um. ' +
      'Der Vater hat dort eine neue <mark data-lemma="Arbeit">Arbeit</mark> gefunden. ' +
      "Die Kinder sind traurig, weil sie ihre Freunde verlassen müssen. " +
      'Die neue Wohnung ist größer und liegt in einer ruhigen <mark data-lemma="Straße">Straße</mark>. ' +
      "Nach einigen Wochen fühlen sich alle wohl.",
    questions: [
      {
        prompt: "Dlaczego rodzina się przeprowadza?",
        options: [
          "Chcą mniejsze mieszkanie",
          "Ojciec znalazł nową pracę",
          "Dzieci tego chcą",
          "Z powodu pogody",
        ],
        correct_idx: 1,
        level: "easy",
      },
      {
        prompt: "Dlaczego dzieci są smutne?",
        options: [
          "Muszą zostawić przyjaciół",
          "Nie lubią nowego domu",
          "Nie chcą nowej szkoły",
          "Boją się miasta",
        ],
        correct_idx: 0,
        level: "medium",
      },
      {
        prompt: "Jaka jest nowa ulica?",
        options: ["Hałaśliwa", "Wąska", "Spokojna", "Daleko od centrum"],
        correct_idx: 2,
        level: "hard",
      },
    ],
  },
];

/** Rough word count from the body with HTML tags stripped. */
function countWords(body) {
  return body
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function main() {
  let inserted = 0;
  let skipped = 0;

  for (const t of TEXTS) {
    const { data: existing } = await supabase
      .from("texts")
      .select("id")
      .eq("title", t.title)
      .maybeSingle();

    if (existing) {
      console.log(`· "${t.title}" already exists — skipping`);
      skipped++;
      continue;
    }

    const { data: text, error: tErr } = await supabase
      .from("texts")
      .insert({
        title: t.title,
        cefr: t.cefr,
        body: t.body,
        word_count: countWords(t.body),
        difficulty: CEFR_DIFFICULTY[t.cefr],
      })
      .select("id")
      .single();
    if (tErr || !text) {
      console.error(`✗ failed to insert "${t.title}": ${tErr?.message}`);
      continue;
    }

    const rows = t.questions.map((q) => ({
      text_id: text.id,
      prompt: q.prompt,
      options: q.options,
      correct_idx: q.correct_idx,
      difficulty: ITEM_DIFFICULTY[t.cefr][q.level],
    }));

    const { error: qErr } = await supabase.from("questions").insert(rows);
    if (qErr) {
      console.error(`✗ failed to insert questions for "${t.title}": ${qErr.message}`);
      continue;
    }

    inserted++;
    console.log(`✓ "${t.title}" (${t.cefr}) + ${rows.length} questions`);
  }

  console.log(`\nDone. inserted: ${inserted} · skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
