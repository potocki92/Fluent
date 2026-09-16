# Data import (standalone — NOT part of the Next.js app)

Scripts that seed the Supabase database. Run them manually from the repo root.
They are independent of the app and are safe to re-run (idempotent / upsert).

## Prerequisites

```bash
export SUPABASE_URL=...            # https://<ref>.supabase.co
export SUPABASE_SERVICE_KEY=...    # service-role key (server-side only)
```

The schema must already exist — apply `supabase/schema.sql` first.

## 1. Words — DTZ / Goethe-ÖSD B1 wordlist (~2650 headwords)

The headword seed `dtz_words_seed.json` is generated from the official
alphabetical wordlist PDF (`dtz_wortliste.pdf`) by `parse-wortliste.py`:

```bash
pip install pymupdf
python import/parse-wortliste.py        # → import/dtz_words_seed.json
```

Load the headwords into Supabase. **No API key needed** for this step:

```bash
node import/seed-words.mjs        # upserts ~2650 headwords (translation_pl = null)
```

> Run this on a fresh `words` table. The seed assigns its own ids, so if you had
> previously loaded a different word set and users saved flashcards, the upsert
> would remap existing `saved_words.word_id` references — clear `words` first.

Then optionally enrich them with Polish translations, example sentences and a
CEFR level. This step calls the Claude API and runs on top of the rows above:

```bash
export ANTHROPIC_API_KEY=...
node import/translate-import.mjs --batch 50      # add --dry-run to preview
```

> The Anthropic API is a separate pay-as-you-go product and is **not** covered
> by a Claude Pro/Max subscription. It is only needed for this enrichment step.
> Until you run it, `translation_pl`/`example_*`/`cefr` stay null, so word
> tooltips and the browse list show the German headword without a Polish
> translation. The reading texts and tests work regardless.

## 2. Texts + comprehension questions (20 texts: 5× A1 / A2 / B1 / B2)

```bash
node import/seed-texts.mjs
```

Each text links vocabulary to word lemmas via `<mark data-lemma="…">` and ships
three Polish questions (easy / medium / hard); question difficulty is anchored
on the CEFR→Elo scale from `src/lib/cefr.ts`.

## 3. Study packs — vocabulary harvested from one text

A *study pack* (`format: "fluent-vocabulary-study-pack"`) is a German→Polish
word list prepared outside the app for one piece of content — e.g.
`prolog_study_pack.json`, the 423 headwords of the prologue fragment. Load it
with:

```bash
node import/seed-study-pack.mjs import/prolog_study_pack.json --dry-run
node import/seed-study-pack.mjs import/prolog_study_pack.json
```

No key at hand? Generate SQL for the Supabase SQL editor instead — same result,
no network:

```bash
node import/seed-study-pack.mjs import/prolog_study_pack.json \
  --sql import/prolog_study_pack.sql
```

`import/prolog_study_pack.sql` is that file, regenerated from the pack. It is
a SINGLE statement built from data-modifying CTEs — the Supabase SQL editor
runs each statement in its own transaction on a pooled connection, so a temp
table would be gone before the next statement could read it. Both
paths are idempotent and **never overwrite an existing entry**: a word is
identified by `(lower(lemma), word_type)`, so *sein* the verb and *sein* the
pronoun stay two rows and a re-run inserts nothing. Add `--fill-missing` to also
write the pack's translations, plurals and genders into columns that are still
`NULL` — useful on top of the DTZ headwords, which ship untranslated.

Only `entries[]` becomes a word. `phrases`, `proper_names`, `wordforms` and
`context_examples` are counted in the report and then dropped: a phrase in
`words` would poison the matcher (`dictionary-match.ts` indexes an entry by the
last word of `display`, so "Angst machen" would claim every *machen*), a proper
name is not vocabulary, and a contextual meaning belongs to one learner's
notebook rather than to the shared dictionary.
