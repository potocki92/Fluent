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
