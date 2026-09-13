-- Fluent — Learning Data Engine: evidence history + user knowledge model.
--
-- WHY THIS MIGRATION EXISTS
-- After the test-session migration, Fluent could say "this answer was right" and
-- "this learner's Elo is 1387". It could not say *what* the learner knows, *how*
-- we know it, or *how sure* we are. Everything that Fluent wants to build next —
-- a weakness engine, a daily plan, a tutor — needs that, and needs it recorded
-- while the learning happens, because it cannot be reconstructed afterwards.
--
-- The model is deliberately split in two:
--
--   EVIDENCE (append-only)   learning_events, review_events
--       what actually happened, one row per interaction, never rewritten.
--
--   STATE (aggregated)       user_skill_state, user_concept_state,
--                            user_word_knowledge
--       a small, fast summary the app reads. Derived from evidence, never the
--       other way round; recomputable, and cheap to query on every render.
--
-- Keeping both is the whole point. State alone cannot answer "why do you think
-- that?" or feed a better algorithm later (FSRS, a real IRT model); evidence
-- alone cannot be read on every page without scanning a learner's whole history.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   - it does not touch SM-2 scheduling maths, and does not introduce FSRS;
--   - it does not compute mastery in PL/pgSQL. The V1 knowledge model lives in
--     `src/lib/learning/knowledge-model.ts` with unit tests, exactly as the Elo
--     maths does. This file owns TRANSACTIONS and CONSTRAINTS; TypeScript owns
--     arithmetic. Section 8 explains the contract that makes that safe.
--   - it invents no knowledge. A skill Fluent never tests has no state row, and
--     "unknown" is the honest answer for it.
--
-- The whole script is idempotent and non-destructive: it creates nothing that
-- exists, deletes no learner data, and its backfill can be re-run without
-- producing duplicates.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SKILL CATALOG — the one source of truth for skill codes.
-- ─────────────────────────────────────────────────────────────────────────────
-- A reference table rather than scattered string literals, so a skill can be
-- added without a code change in ten components, and so `skill_code` columns can
-- carry a real foreign key instead of a check constraint that drifts.
--
-- `is_assessed` is the honesty flag: it records whether Fluent currently has any
-- exercise that produces evidence for the skill. Speaking is in the catalog
-- because the model must not need rebuilding when speaking ships — not because
-- we have the faintest idea how well anyone speaks.
--
-- The mirror of this table in TypeScript is `src/lib/learning/skills.ts`; the
-- two are kept in step by hand and asserted by the test suite.
create table if not exists public.skills (
  code        text primary key,
  label_pl    text not null,
  description text not null,
  -- Does any current Fluent exercise produce evidence for this skill?
  is_assessed boolean not null default false,
  sort_order  int     not null default 100
);

insert into public.skills (code, label_pl, description, is_assessed, sort_order) values
  ('reading_comprehension', 'Rozumienie tekstu',
   'Rozumienie sensu i szczegółów niemieckiego tekstu pisanego.', true, 10),
  ('receptive_vocabulary', 'Słownictwo bierne',
   'Rozpoznawanie znaczenia niemieckiego słowa, gdy się je widzi lub słyszy.', true, 20),
  ('active_vocabulary', 'Słownictwo czynne',
   'Samodzielne przywołanie niemieckiego słowa na podstawie znaczenia.', false, 30),
  ('grammar', 'Gramatyka',
   'Formy i struktury: przypadki, rodzajniki, szyk zdania, czasy.', true, 40),
  ('listening', 'Rozumienie ze słuchu',
   'Rozumienie mówionego niemieckiego.', false, 50),
  ('writing', 'Pisanie',
   'Tworzenie poprawnego tekstu pisanego po niemiecku.', false, 60),
  ('speaking', 'Mówienie',
   'Swobodne wypowiadanie się po niemiecku.', false, 70),
  ('pronunciation', 'Wymowa',
   'Poprawna artykulacja i akcent.', false, 80)
on conflict (code) do update
  set label_pl    = excluded.label_pl,
      description = excluded.description,
      is_assessed = excluded.is_assessed,
      sort_order  = excluded.sort_order;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONCEPT CATALOG — the weakness taxonomy.
-- ─────────────────────────────────────────────────────────────────────────────
-- A concept is the smallest thing Fluent is willing to tell a learner they are
-- struggling with: "Dativ po przyimkach", not "64% poprawnych odpowiedzi".
--
-- Codes are stable and machine-readable; `label_pl` exists so the eventual UI
-- reads one translation from here instead of hardcoding ten copies. The list is
-- deliberately short — every entry has to be something a learner could act on.
create table if not exists public.concepts (
  code        text primary key,
  skill_code  text not null references public.skills(code),
  -- Coarse grouping for UI sectioning: grammar / vocabulary / reading / listening.
  category    text not null check (category in ('grammar', 'vocabulary', 'reading', 'listening')),
  label_pl    text not null,
  description text not null,
  sort_order  int  not null default 100
);

create index if not exists concepts_skill_idx on public.concepts (skill_code, sort_order);

insert into public.concepts (code, skill_code, category, label_pl, description, sort_order) values
  -- Grammar
  ('article_gender',      'grammar', 'grammar', 'Rodzajnik określony',
   'Dobór der/die/das do rzeczownika w zdaniu.', 10),
  ('case_nominative',     'grammar', 'grammar', 'Mianownik (Nominativ)',
   'Forma podmiotu i orzecznika.', 20),
  ('case_accusative',     'grammar', 'grammar', 'Biernik (Akkusativ)',
   'Forma dopełnienia bliższego.', 30),
  ('case_dative',         'grammar', 'grammar', 'Celownik (Dativ)',
   'Forma dopełnienia dalszego.', 40),
  ('case_genitive',       'grammar', 'grammar', 'Dopełniacz (Genitiv)',
   'Forma przynależności.', 50),
  ('preposition_case',    'grammar', 'grammar', 'Przypadek po przyimku',
   'Dobór Akkusativ/Dativ po niemieckich przyimkach.', 60),
  ('adjective_ending',    'grammar', 'grammar', 'Końcówki przymiotnika',
   'Odmiana przymiotnika zależnie od rodzajnika, rodzaju i przypadku.', 70),
  ('verb_conjugation',    'grammar', 'grammar', 'Odmiana czasownika',
   'Formy osobowe czasownika, w tym czasowniki nieregularne.', 80),
  ('verb_position',       'grammar', 'grammar', 'Pozycja czasownika',
   'Miejsce czasownika w zdaniu oznajmującym, pytającym i podrzędnym.', 90),
  ('separable_prefix',    'grammar', 'grammar', 'Czasowniki rozdzielnie złożone',
   'Odłączanie przedrostka i jego pozycja w zdaniu.', 100),
  ('modal_verb',          'grammar', 'grammar', 'Czasowniki modalne',
   'Znaczenie i składnia können, müssen, dürfen, sollen, wollen, mögen.', 110),
  ('past_tense',          'grammar', 'grammar', 'Czas przeszły Präteritum',
   'Formy prostego czasu przeszłego.', 120),
  ('perfect_tense',       'grammar', 'grammar', 'Czas przeszły Perfekt',
   'Dobór haben/sein oraz forma Partizip II.', 130),
  ('word_order',          'grammar', 'grammar', 'Szyk zdania',
   'Kolejność części zdania, w tym zasada TeKaMoLo.', 140),
  ('relative_clause',     'grammar', 'grammar', 'Zdania względne',
   'Zaimek względny i szyk w zdaniu podrzędnym.', 150),
  ('plural_form',         'grammar', 'grammar', 'Liczba mnoga',
   'Tworzenie liczby mnogiej rzeczownika.', 160),
  -- Vocabulary
  ('lexical_recognition', 'receptive_vocabulary', 'vocabulary', 'Rozpoznawanie słowa',
   'Rozumienie niemieckiego słowa, gdy się je widzi.', 200),
  ('lexical_recall',      'active_vocabulary',    'vocabulary', 'Przywoływanie słowa',
   'Samodzielne podanie niemieckiego słowa dla danego znaczenia.', 210),
  ('false_friend',        'receptive_vocabulary', 'vocabulary', 'Fałszywi przyjaciele',
   'Słowa podobne do polskich, ale o innym znaczeniu.', 220),
  ('collocation',         'active_vocabulary',    'vocabulary', 'Kolokacje',
   'Naturalne połączenia wyrazowe (np. eine Entscheidung treffen).', 230),
  ('word_gender',         'receptive_vocabulary', 'vocabulary', 'Rodzaj rzeczownika',
   'Znajomość rodzaju rzeczownika jako cechy słownikowej.', 240),
  ('compound_word',       'receptive_vocabulary', 'vocabulary', 'Rzeczowniki złożone',
   'Odczytywanie znaczenia złożeń (Handschuh, Krankenhaus).', 250),
  -- Reading
  ('main_idea',            'reading_comprehension', 'reading', 'Główna myśl',
   'Uchwycenie sensu całego tekstu lub akapitu.', 300),
  ('detail',               'reading_comprehension', 'reading', 'Szczegół w tekście',
   'Odnalezienie konkretnej informacji.', 310),
  ('inference',            'reading_comprehension', 'reading', 'Wnioskowanie',
   'Wyciąganie wniosków, które nie są w tekście wprost.', 320),
  ('sequence',             'reading_comprehension', 'reading', 'Kolejność zdarzeń',
   'Ustalenie, co wydarzyło się wcześniej, a co później.', 330),
  ('reference_resolution', 'reading_comprehension', 'reading', 'Odniesienia w tekście',
   'Rozpoznanie, do czego odnosi się zaimek lub określenie.', 340),
  -- Listening (catalogued now so the future model needs no migration)
  ('listening_discrimination', 'listening', 'listening', 'Rozróżnianie dźwięków',
   'Odróżnianie podobnie brzmiących słów i form.', 400),
  ('connected_speech',         'listening', 'listening', 'Mowa łączona',
   'Rozumienie szybkiej, naturalnie łączonej wymowy.', 410),
  ('numbers_dates',            'listening', 'listening', 'Liczby i daty',
   'Wychwytywanie liczb, godzin i dat ze słuchu.', 420)
on conflict (code) do update
  set skill_code  = excluded.skill_code,
      category    = excluded.category,
      label_pl    = excluded.label_pl,
      description = excluded.description,
      sort_order  = excluded.sort_order;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ITEM TAGGING — what does this question actually test?
-- ─────────────────────────────────────────────────────────────────────────────
-- Without this, a wrong answer is only "wrong". With it, a wrong answer is
-- evidence about a named skill and (when tagged) one or more named concepts.
--
-- EXISTING ROWS ARE NOT GUESSED AT. `questions` all hang off a reading passage
-- and ask about it, so `reading_comprehension` is a safe default for the skill.
-- Concepts are left empty: inventing "this one was probably about adjective
-- endings" would poison the weakness model with fiction, which is worse than
-- having no weakness data at all.
alter table public.questions
  add column if not exists skill_code text not null default 'reading_comprehension';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_skill_code_fkey' and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_skill_code_fkey
      foreign key (skill_code) references public.skills(code);
  end if;
end $$;

-- Set only when the item genuinely tests one dictionary word. A word merely
-- APPEARING in the passage is not evidence that the learner knows it, so this
-- stays null for every existing comprehension question (see section 9).
alter table public.questions
  add column if not exists tested_word_id bigint references public.words(id) on delete set null;

alter table public.calibration_questions
  add column if not exists skill_code text references public.skills(code);
alter table public.calibration_questions
  add column if not exists tested_word_id bigint references public.words(id) on delete set null;

-- The placement bank already carries a coarse `skill` ('vocab' | 'grammar'), so
-- this mapping is a rename, not a guess. Note that a multiple-choice vocabulary
-- item is RECEPTIVE evidence whichever direction it is asked in: picking the
-- right option out of four is recognition, not recall.
update public.calibration_questions
   set skill_code = case skill
                      when 'vocab'   then 'receptive_vocabulary'
                      when 'grammar' then 'grammar'
                    end
 where skill_code is null and skill is not null;

-- Many-to-many: one item can exercise several concepts ("Ich fahre mit ___ Bus"
-- is preposition_case AND case_dative). Separate tables per bank because the two
-- banks are separate tables and a real foreign key is worth more than a
-- polymorphic `item_kind` column that nothing can enforce.
create table if not exists public.question_concepts (
  question_id  bigint not null references public.questions(id) on delete cascade,
  concept_code text   not null references public.concepts(code) on delete cascade,
  primary key (question_id, concept_code)
);

create table if not exists public.calibration_question_concepts (
  question_id  bigint not null references public.calibration_questions(id) on delete cascade,
  concept_code text   not null references public.concepts(code) on delete cascade,
  primary key (question_id, concept_code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. LEARNING EVENTS — the append-only evidence log.
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per meaningful learning interaction, written once and never updated.
-- This is the table that makes a better algorithm possible in a year: if all we
-- ever stored was `interval = 21, ease = 2.5`, there would be nothing to fit a
-- new memory model to.
--
-- SHAPE: the columns that matter are columns. `metadata` exists for genuinely
-- auxiliary detail and must never become the place where the important fields
-- live — a jsonb blob cannot be indexed, constrained or migrated with any
-- confidence.
--
-- SOURCE: `source_kind` is deliberately broader than today's three flows. When
-- books arrive, a paragraph lookup is `source_kind = 'book'` plus a new
-- nullable id column; nothing about this table has to be rebuilt.
create table if not exists public.learning_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- IDEMPOTENCY. Every producer derives a deterministic key from the thing that
  -- happened — 'test:<session>:<question>', 'review:<interaction>',
  -- 'legacy-attempt:<id>'. The unique constraint below is what guarantees "one
  -- authoritative answer → one learning event" no matter how many times a
  -- request is retried, replayed or re-run; a JavaScript `if (!exists)` cannot.
  event_key   text not null,

  event_type  text not null check (event_type in (
    -- produced today
    'test_answer', 'calibration_answer', 'review',
    -- accepted by the model, produced by nothing yet. Listed so that shipping
    -- one of these needs an exercise, not a migration.
    'reading_lookup', 'reading_sentence_help', 'typed_recall',
    'listening_answer', 'speaking_answer', 'writing_answer'
  )),
  occurred_at timestamptz not null default now(),

  -- WHAT THE INTERACTION SAYS ABOUT THE LEARNER.
  skill_code     text references public.skills(code),
  -- How the answer was given. This is what separates "recognised it among four
  -- options" from "typed it from memory"; they are not the same evidence.
  response_mode  text not null check (response_mode in (
    'multiple_choice', 'self_rated', 'typed', 'spoken', 'passive'
  )),
  -- What kind of knowledge it demanded.
  retrieval_type text not null check (retrieval_type in (
    'recognition', 'cued_recall', 'free_production'
  )),

  is_correct  boolean,
  response_ms int,
  hints_used  int not null default 0 check (hints_used >= 0),

  source_kind text not null check (source_kind in (
    'reading_test', 'placement_test', 'review', 'reader', 'book', 'import'
  )),
  -- Provenance of the ROW, not of the learning: 'legacy_backfill' marks evidence
  -- reconstructed from pre-Phase-2 tables, which is thinner than a native event
  -- and should be weighted as such by anything that ever refits the model.
  origin      text not null default 'native'
                check (origin in ('native', 'legacy_backfill', 'import')),

  -- Typed links to whatever the event came from. All nullable: a review has no
  -- question, a placement answer has no text.
  text_id                 bigint references public.texts(id) on delete set null,
  question_id             bigint references public.questions(id) on delete set null,
  calibration_question_id bigint references public.calibration_questions(id) on delete set null,
  word_id                 bigint references public.words(id) on delete set null,
  test_session_id         uuid   references public.test_sessions(id) on delete set null,
  calibration_session_id  uuid   references public.calibration_sessions(id) on delete set null,
  review_event_id         bigint,

  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_events_user_key_unique'
      and conrelid = 'public.learning_events'::regclass
  ) then
    alter table public.learning_events
      add constraint learning_events_user_key_unique unique (user_id, event_key);
  end if;
end $$;

-- Query patterns this table actually serves (nothing speculative):
--   "this learner's recent history"            → (user_id, occurred_at desc)
--   "recompute one skill from evidence"        → (user_id, skill_code, occurred_at)
--   "everything we know about this word"       → (user_id, word_id, occurred_at)
--   "has this answer already been recorded?"   → (user_id, question_id), used by
--                                                 the backfill guard in section 11
create index if not exists learning_events_user_time_idx
  on public.learning_events (user_id, occurred_at desc);
create index if not exists learning_events_user_skill_idx
  on public.learning_events (user_id, skill_code, occurred_at desc)
  where skill_code is not null;
create index if not exists learning_events_user_word_idx
  on public.learning_events (user_id, word_id, occurred_at desc)
  where word_id is not null;
create index if not exists learning_events_user_question_idx
  on public.learning_events (user_id, question_id)
  where question_id is not null;

-- Which concepts an event was attributed to, snapshotted at the time. Stored on
-- the event rather than re-read from `question_concepts` later, so retagging a
-- question does not silently rewrite history.
create table if not exists public.learning_event_concepts (
  event_id     bigint not null references public.learning_events(id) on delete cascade,
  concept_code text   not null references public.concepts(code) on delete cascade,
  primary key (event_id, concept_code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REVIEW EVENTS — the full spaced-repetition history.
-- ─────────────────────────────────────────────────────────────────────────────
-- `saved_words` holds the CURRENT schedule and nothing else: after a review it
-- has forgotten that there ever was a previous interval. That is fine for
-- scheduling and useless for everything else. This table records the whole
-- interaction, before and after, so that a future memory model (FSRS or
-- otherwise) can be fitted to what learners actually did rather than guessed at.
--
-- BEFORE/AFTER, not just after: the pair is what makes a row self-contained
-- training data — "at ease 2.4 and a 6-day interval, this learner pressed Good".
create table if not exists public.review_events (
  id          bigint generated always as identity primary key,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  word_id     bigint not null references public.words(id) on delete cascade,
  reviewed_at timestamptz not null default now(),

  -- IDEMPOTENCY. The client mints one id per card presentation; a double tap, a
  -- retried Server Action and a replayed POST all carry the same one, and the
  -- unique index below makes the second one a no-op instead of a second interval
  -- jump. See `apply_review`.
  interaction_id text not null,

  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  mode   text not null check (mode in ('flashcard', 'quiz', 'typed_recall', 'listening')),
  -- Which way the card was asked. This is what decides receptive vs active
  -- evidence; it is not cosmetic. See section 9.
  direction text not null check (direction in ('de_to_pl', 'pl_to_de')),

  repetitions_before int,
  interval_before    int,
  ease_before        numeric,
  due_before         timestamptz,

  repetitions_after int     not null,
  interval_after    int     not null,
  ease_after        numeric not null,
  due_after         timestamptz not null,

  response_ms int,
  source_kind text not null default 'review'
                check (source_kind in ('review', 'reader', 'book', 'import')),
  origin      text not null default 'native'
                check (origin in ('native', 'legacy_backfill', 'import'))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'review_events_interaction_unique'
      and conrelid = 'public.review_events'::regclass
  ) then
    alter table public.review_events
      add constraint review_events_interaction_unique unique (user_id, interaction_id);
  end if;
end $$;

create index if not exists review_events_user_word_idx
  on public.review_events (user_id, word_id, reviewed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. AGGREGATED KNOWLEDGE STATE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Three summaries the app can read on every render without touching the event
-- log. Each one stores an ESTIMATE and, separately, how much we should trust it.
--
-- WHY score AND confidence. "reading 0.78, confidence 0.91" and "speaking 0.80,
-- confidence 0.04" are not the same statement, and collapsing them into one
-- number is how a product ends up telling someone they are B1 at speaking
-- because they read well. A row with almost no evidence is reported as
-- *insufficient*, never as a level.
--
-- WHY accumulators as well as counts. The V1 model is a recency-weighted,
-- prior-blended average; `evidence_weight` / `success_weight` are its decayed
-- accumulators, while `evidence_count` and friends are honest lifetime totals
-- for display. Storing both means the next version can be computed from the same
-- row without re-reading the event log.
--
-- `version` is the optimistic-concurrency token: the writer passes the version it
-- computed from and the update only applies if nothing moved meanwhile
-- (see section 8). `model_version` records WHICH algorithm produced the numbers,
-- so a future `knowledge_v2` can be rolled out without guessing at provenance.
create table if not exists public.user_skill_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  skill_code text not null references public.skills(code),

  score               numeric,              -- 0..1, null only for an empty state
  confidence          numeric not null default 0,   -- 0..1
  evidence_weight     numeric not null default 0,   -- decayed Σ weights
  success_weight      numeric not null default 0,   -- decayed Σ weights of successes
  evidence_count      int     not null default 0,
  successful_evidence int     not null default 0,
  failed_evidence     int     not null default 0,
  -- Distinct exercise kinds this estimate rests on. One source can only take
  -- confidence so far, however many answers it produces.
  source_kinds        text[]  not null default '{}',

  first_evidence_at timestamptz,
  last_evidence_at  timestamptz,
  model_version     text not null default 'knowledge_v1',
  version           int  not null default 0,
  updated_at        timestamptz not null default now(),

  primary key (user_id, skill_code)
);

create table if not exists public.user_concept_state (
  user_id      uuid not null references auth.users(id) on delete cascade,
  concept_code text not null references public.concepts(code) on delete cascade,

  score               numeric,
  confidence          numeric not null default 0,
  evidence_weight     numeric not null default 0,
  success_weight      numeric not null default 0,
  evidence_count      int     not null default 0,
  successful_evidence int     not null default 0,
  failed_evidence     int     not null default 0,
  source_kinds        text[]  not null default '{}',

  first_evidence_at timestamptz,
  last_evidence_at  timestamptz,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  model_version     text not null default 'knowledge_v1',
  version           int  not null default 0,
  updated_at        timestamptz not null default now(),

  primary key (user_id, concept_code)
);

-- Backs "this learner's weakest concepts", which is the whole reason the table
-- exists — the weakness engine must never scan the event log for it.
create index if not exists user_concept_state_weak_idx
  on public.user_concept_state (user_id, score)
  where score is not null;

-- WORD KNOWLEDGE ≠ SCHEDULING. `saved_words` answers "when should this card come
-- back?"; this table answers "does the learner know this word, and how do we
-- know?". They are different questions with different lifetimes — a word can be
-- known without ever being in the review deck, and can sit in the deck for
-- months without being known — so they are different tables.
--
-- RECEPTIVE vs ACTIVE are kept in two independent channels because recognising
-- `Schwert` on a flashcard is simply not evidence that the learner can produce
-- it from "miecz". Nothing in this schema lets receptive evidence raise the
-- active score; that separation is the point.
create table if not exists public.user_word_knowledge (
  user_id uuid   not null references auth.users(id) on delete cascade,
  word_id bigint not null references public.words(id) on delete cascade,

  first_seen_at   timestamptz,
  last_seen_at    timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,

  exposure_count        int not null default 0,
  successful_retrievals int not null default 0,
  failed_retrievals     int not null default 0,

  receptive_score           numeric,
  receptive_confidence      numeric not null default 0,
  receptive_evidence_weight numeric not null default 0,
  receptive_success_weight  numeric not null default 0,
  receptive_evidence_count  int     not null default 0,
  receptive_last_at         timestamptz,

  active_score           numeric,
  active_confidence      numeric not null default 0,
  active_evidence_weight numeric not null default 0,
  active_success_weight  numeric not null default 0,
  active_evidence_count  int     not null default 0,
  active_last_at         timestamptz,

  source_kinds  text[] not null default '{}',
  model_version text   not null default 'knowledge_v1',
  version       int    not null default 0,
  updated_at    timestamptz not null default now(),

  primary key (user_id, word_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. INTERNAL HELPERS.
-- ─────────────────────────────────────────────────────────────────────────────
-- The daily vocabulary counter, split out from `bump_word_review()` so the same
-- logic can run inside `apply_review`'s transaction. `bump_word_review()` stays
-- as the learner-callable wrapper it has always been, delegating here rather
-- than keeping a second copy that would drift.
create or replace function public.apply_word_review_counter(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last   date;
  v_streak int;
  v_count  int;
begin
  select p.last_word_review, p.word_streak_days, p.words_reviewed_today
    into v_last, v_streak, v_count
    from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'Profil nie istnieje.' using errcode = 'FL404';
  end if;

  if v_last = current_date then
    v_count := v_count + 1;
  else
    v_count := 1;
    -- `>=` so a timezone rollover still counts as a continued streak.
    if v_last >= current_date - 1 then v_streak := v_streak + 1;
    else v_streak := 1; end if;
  end if;

  update public.profiles p
     set words_reviewed_today = v_count,
         word_streak_days     = v_streak,
         last_word_review     = current_date
   where p.id = p_user_id;
  return v_count;
end;
$$;

create or replace function public.bump_word_review()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  return public.apply_word_review_counter(v_user);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. apply_learning_evidence — the single write path for evidence + state.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CONTRACT. The caller (trusted server code) has already:
--   1. read the learner's current state rows, with their `version`s;
--   2. folded the new evidence through the V1 model in TypeScript;
--   3. produced the NEXT state for every row the evidence touches.
-- This function commits all of it — events, skills, concepts, words — in one
-- transaction, or none of it. It is called from inside `finalize_test_session`,
-- `finalize_calibration_session` and `apply_review`, so "one interaction, one
-- transaction" holds end to end: there is no state where a review moved the SM-2
-- schedule but left no evidence, or credited a skill but not the word.
--
-- WHY THE MATHS IS NOT HERE. The same reason the Elo update is not: the model
-- has to be unit-tested and replaced later, and a second implementation in
-- PL/pgSQL would drift from the first the day either changed. The database owns
-- the transaction and the constraints; `src/lib/learning/` owns the arithmetic.
--
-- WHY THAT IS STILL SAFE. Nothing here is reachable from a browser. EXECUTE is
-- revoked from every client role (section 10) and the calling functions are
-- either SECURITY DEFINER with their own ownership checks or service-role only.
-- A learner cannot hand this function a state of their choosing any more than
-- they can hand `finalize_test_session` an ability of 2000.
--
-- CONCURRENCY. Each state row carries a `version`; the update applies only if it
-- still matches what the caller computed from. A lost update — two tabs grading
-- two different words into the same vocabulary skill at the same moment — is
-- rejected with FL423 instead of silently overwriting, and the caller re-reads
-- and recomputes. That is the same guard `finalize_test_session` already uses
-- for `profiles.ability`.
--
-- `p_payload` is a transport envelope, not storage: every field is unpacked into
-- a real column below, and anything it does not carry keeps its column default.
create or replace function public.apply_learning_evidence(
  p_user_id         uuid,
  p_payload         jsonb,
  p_review_event_id bigint default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event    jsonb;
  v_state    jsonb;
  v_channel  jsonb;
  v_event_id bigint;
  v_written  int := 0;
  v_rows     int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika dla dowodu nauki.' using errcode = 'FL401';
  end if;
  if p_payload is null then
    return 0;
  end if;

  -- EVENTS. `on conflict do nothing` is the idempotency guarantee in action: a
  -- replayed finalize re-sends the same event keys and writes nothing.
  for v_event in
    select value from jsonb_array_elements(coalesce(p_payload -> 'events', '[]'::jsonb))
  loop
    v_event_id := null;

    insert into public.learning_events (
      user_id, event_key, event_type, occurred_at, skill_code,
      response_mode, retrieval_type, is_correct, response_ms, hints_used,
      source_kind, origin, text_id, question_id, calibration_question_id,
      word_id, test_session_id, calibration_session_id, review_event_id, metadata
    ) values (
      p_user_id,
      v_event ->> 'event_key',
      v_event ->> 'event_type',
      coalesce((v_event ->> 'occurred_at')::timestamptz, now()),
      v_event ->> 'skill_code',
      v_event ->> 'response_mode',
      v_event ->> 'retrieval_type',
      (v_event ->> 'is_correct')::boolean,
      (v_event ->> 'response_ms')::int,
      coalesce((v_event ->> 'hints_used')::int, 0),
      v_event ->> 'source_kind',
      coalesce(v_event ->> 'origin', 'native'),
      (v_event ->> 'text_id')::bigint,
      (v_event ->> 'question_id')::bigint,
      (v_event ->> 'calibration_question_id')::bigint,
      (v_event ->> 'word_id')::bigint,
      (v_event ->> 'test_session_id')::uuid,
      (v_event ->> 'calibration_session_id')::uuid,
      coalesce((v_event ->> 'review_event_id')::bigint, p_review_event_id),
      coalesce(v_event -> 'metadata', '{}'::jsonb)
    )
    on conflict (user_id, event_key) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      v_written := v_written + 1;
      insert into public.learning_event_concepts (event_id, concept_code)
      select v_event_id, code
      from jsonb_array_elements_text(coalesce(v_event -> 'concepts', '[]'::jsonb)) as t(code)
      on conflict do nothing;
    end if;
  end loop;

  -- SKILL STATE.
  for v_state in
    select value from jsonb_array_elements(coalesce(p_payload -> 'skills', '[]'::jsonb))
  loop
    insert into public.user_skill_state as s (
      user_id, skill_code, score, confidence, evidence_weight, success_weight,
      evidence_count, successful_evidence, failed_evidence, source_kinds,
      first_evidence_at, last_evidence_at, model_version, version, updated_at
    ) values (
      p_user_id,
      v_state ->> 'skill_code',
      (v_state ->> 'score')::numeric,
      (v_state ->> 'confidence')::numeric,
      (v_state ->> 'evidence_weight')::numeric,
      (v_state ->> 'success_weight')::numeric,
      (v_state ->> 'evidence_count')::int,
      (v_state ->> 'successful_evidence')::int,
      (v_state ->> 'failed_evidence')::int,
      coalesce(
        array(select jsonb_array_elements_text(v_state -> 'source_kinds')),
        array[]::text[]
      ),
      (v_state ->> 'first_evidence_at')::timestamptz,
      (v_state ->> 'last_evidence_at')::timestamptz,
      coalesce(v_state ->> 'model_version', 'knowledge_v1'),
      coalesce((v_state ->> 'expected_version')::int, 0) + 1,
      now()
    )
    on conflict (user_id, skill_code) do update
      set score               = excluded.score,
          confidence          = excluded.confidence,
          evidence_weight     = excluded.evidence_weight,
          success_weight      = excluded.success_weight,
          evidence_count      = excluded.evidence_count,
          successful_evidence = excluded.successful_evidence,
          failed_evidence     = excluded.failed_evidence,
          source_kinds        = excluded.source_kinds,
          first_evidence_at   = coalesce(s.first_evidence_at, excluded.first_evidence_at),
          last_evidence_at    = excluded.last_evidence_at,
          model_version       = excluded.model_version,
          version             = excluded.version,
          updated_at          = excluded.updated_at
      where s.version = coalesce((v_state ->> 'expected_version')::int, 0);

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Stan umiejętności zmienił się w trakcie zapisu.' using errcode = 'FL423';
    end if;
  end loop;

  -- CONCEPT STATE.
  for v_state in
    select value from jsonb_array_elements(coalesce(p_payload -> 'concepts', '[]'::jsonb))
  loop
    insert into public.user_concept_state as c (
      user_id, concept_code, score, confidence, evidence_weight, success_weight,
      evidence_count, successful_evidence, failed_evidence, source_kinds,
      first_evidence_at, last_evidence_at, last_success_at, last_failure_at,
      model_version, version, updated_at
    ) values (
      p_user_id,
      v_state ->> 'concept_code',
      (v_state ->> 'score')::numeric,
      (v_state ->> 'confidence')::numeric,
      (v_state ->> 'evidence_weight')::numeric,
      (v_state ->> 'success_weight')::numeric,
      (v_state ->> 'evidence_count')::int,
      (v_state ->> 'successful_evidence')::int,
      (v_state ->> 'failed_evidence')::int,
      coalesce(
        array(select jsonb_array_elements_text(v_state -> 'source_kinds')),
        array[]::text[]
      ),
      (v_state ->> 'first_evidence_at')::timestamptz,
      (v_state ->> 'last_evidence_at')::timestamptz,
      (v_state ->> 'last_success_at')::timestamptz,
      (v_state ->> 'last_failure_at')::timestamptz,
      coalesce(v_state ->> 'model_version', 'knowledge_v1'),
      coalesce((v_state ->> 'expected_version')::int, 0) + 1,
      now()
    )
    on conflict (user_id, concept_code) do update
      set score               = excluded.score,
          confidence          = excluded.confidence,
          evidence_weight     = excluded.evidence_weight,
          success_weight      = excluded.success_weight,
          evidence_count      = excluded.evidence_count,
          successful_evidence = excluded.successful_evidence,
          failed_evidence     = excluded.failed_evidence,
          source_kinds        = excluded.source_kinds,
          first_evidence_at   = coalesce(c.first_evidence_at, excluded.first_evidence_at),
          last_evidence_at    = excluded.last_evidence_at,
          last_success_at     = coalesce(excluded.last_success_at, c.last_success_at),
          last_failure_at     = coalesce(excluded.last_failure_at, c.last_failure_at),
          model_version       = excluded.model_version,
          version             = excluded.version,
          updated_at          = excluded.updated_at
      where c.version = coalesce((v_state ->> 'expected_version')::int, 0);

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Stan zagadnienia zmienił się w trakcie zapisu.' using errcode = 'FL423';
    end if;
  end loop;

  -- WORD KNOWLEDGE. The two channels arrive as separate objects and are written
  -- independently — a receptive exercise sends no `active` object at all, so the
  -- active columns below simply keep whatever they already held.
  for v_state in
    select value from jsonb_array_elements(coalesce(p_payload -> 'words', '[]'::jsonb))
  loop
    v_channel := coalesce(v_state -> 'receptive', '{}'::jsonb);

    insert into public.user_word_knowledge as w (
      user_id, word_id, first_seen_at, last_seen_at, last_success_at, last_failure_at,
      exposure_count, successful_retrievals, failed_retrievals,
      receptive_score, receptive_confidence, receptive_evidence_weight,
      receptive_success_weight, receptive_evidence_count, receptive_last_at,
      active_score, active_confidence, active_evidence_weight,
      active_success_weight, active_evidence_count, active_last_at,
      source_kinds, model_version, version, updated_at
    ) values (
      p_user_id,
      (v_state ->> 'word_id')::bigint,
      (v_state ->> 'first_seen_at')::timestamptz,
      (v_state ->> 'last_seen_at')::timestamptz,
      (v_state ->> 'last_success_at')::timestamptz,
      (v_state ->> 'last_failure_at')::timestamptz,
      (v_state ->> 'exposure_count')::int,
      (v_state ->> 'successful_retrievals')::int,
      (v_state ->> 'failed_retrievals')::int,
      (v_channel ->> 'score')::numeric,
      coalesce((v_channel ->> 'confidence')::numeric, 0),
      coalesce((v_channel ->> 'evidence_weight')::numeric, 0),
      coalesce((v_channel ->> 'success_weight')::numeric, 0),
      coalesce((v_channel ->> 'evidence_count')::int, 0),
      (v_channel ->> 'last_evidence_at')::timestamptz,
      (v_state -> 'active' ->> 'score')::numeric,
      coalesce((v_state -> 'active' ->> 'confidence')::numeric, 0),
      coalesce((v_state -> 'active' ->> 'evidence_weight')::numeric, 0),
      coalesce((v_state -> 'active' ->> 'success_weight')::numeric, 0),
      coalesce((v_state -> 'active' ->> 'evidence_count')::int, 0),
      (v_state -> 'active' ->> 'last_evidence_at')::timestamptz,
      coalesce(
        array(select jsonb_array_elements_text(v_state -> 'source_kinds')),
        array[]::text[]
      ),
      coalesce(v_state ->> 'model_version', 'knowledge_v1'),
      coalesce((v_state ->> 'expected_version')::int, 0) + 1,
      now()
    )
    on conflict (user_id, word_id) do update
      set first_seen_at         = coalesce(w.first_seen_at, excluded.first_seen_at),
          last_seen_at          = excluded.last_seen_at,
          last_success_at       = coalesce(excluded.last_success_at, w.last_success_at),
          last_failure_at       = coalesce(excluded.last_failure_at, w.last_failure_at),
          exposure_count        = excluded.exposure_count,
          successful_retrievals = excluded.successful_retrievals,
          failed_retrievals     = excluded.failed_retrievals,
          receptive_score           = excluded.receptive_score,
          receptive_confidence      = excluded.receptive_confidence,
          receptive_evidence_weight = excluded.receptive_evidence_weight,
          receptive_success_weight  = excluded.receptive_success_weight,
          receptive_evidence_count  = excluded.receptive_evidence_count,
          receptive_last_at         = excluded.receptive_last_at,
          active_score           = excluded.active_score,
          active_confidence      = excluded.active_confidence,
          active_evidence_weight = excluded.active_evidence_weight,
          active_success_weight  = excluded.active_success_weight,
          active_evidence_count  = excluded.active_evidence_count,
          active_last_at         = excluded.active_last_at,
          source_kinds  = excluded.source_kinds,
          model_version = excluded.model_version,
          version       = excluded.version,
          updated_at    = excluded.updated_at
      where w.version = coalesce((v_state ->> 'expected_version')::int, 0);

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Stan znajomości słowa zmienił się w trakcie zapisu.' using errcode = 'FL423';
    end if;
  end loop;

  return v_written;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. apply_review — one review interaction, one transaction.
-- ─────────────────────────────────────────────────────────────────────────────
-- Before this, grading a card was three independent round trips: upsert
-- `saved_words`, bump the counter, and nothing else. A failure between them left
-- the schedule moved with no record of why. Now a single call performs:
--
--   1. lock the card's scheduling row,
--   2. write the immutable `review_events` row (before → after),
--   3. move the SM-2 schedule,
--   4. advance the daily counter and vocabulary streak,
--   5. write the learning event + word/skill knowledge (section 8),
--
-- all in one transaction. Either the learner's review happened or it did not.
--
-- IDEMPOTENCY: `p_interaction_id` is minted once per card presentation. A second
-- request carrying it returns the stored outcome and changes nothing — a double
-- tap on "Dobrze" cannot push the interval out twice. The unique constraint on
-- (user_id, interaction_id) makes that hold even for two requests racing inside
-- the database, not merely for a re-submit the UI could have debounced.
--
-- CONCURRENCY: the SM-2 state the caller computed from is re-checked against the
-- locked row. If another request moved the card in between, the write is refused
-- with FL423 rather than applied on top of a stale read, and the caller recomputes.
--
-- WHY THE SM-2 RESULT IS A PARAMETER: same contract as everywhere else in this
-- schema — `src/lib/sm2.ts` owns the arithmetic and has the unit tests, this
-- function owns the transaction.
create or replace function public.apply_review(
  p_user_id        uuid,
  p_interaction_id text,
  p_word_id        bigint,
  p_rating         text,
  p_mode           text,
  p_direction      text,
  p_response_ms    int,
  p_srs            jsonb,
  p_evidence       jsonb
)
returns table (
  review_event_id bigint,
  due_at          timestamptz,
  is_mastered     boolean,
  interval_days   int,
  repetitions     int,
  ease_factor     numeric,
  reviewed_today  int,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_existing     public.review_events%rowtype;
  v_card         public.saved_words%rowtype;
  v_has_card     boolean;
  v_before       jsonb := coalesce(p_srs -> 'before', '{}'::jsonb);
  v_after        jsonb := coalesce(p_srs -> 'after', '{}'::jsonb);
  v_event_id     bigint;
  v_reviewed     int;
  v_is_mastered  boolean;
  v_settled      boolean := false;
begin
  if p_user_id is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_interaction_id is null or length(trim(p_interaction_id)) = 0 then
    raise exception 'Brak identyfikatora powtórki.' using errcode = 'FL422';
  end if;

  -- Already settled? Return what was stored; touch nothing.
  select * into v_existing
  from public.review_events r
  where r.user_id = p_user_id and r.interaction_id = p_interaction_id;
  v_settled := found;

  if v_settled then
    select p.words_reviewed_today into v_reviewed
    from public.profiles p where p.id = p_user_id;
    select s.is_mastered into v_is_mastered
    from public.saved_words s
    where s.user_id = p_user_id and s.word_id = v_existing.word_id;
    return query select v_existing.id, v_existing.due_after,
                        coalesce(v_is_mastered, false), v_existing.interval_after,
                        v_existing.repetitions_after, v_existing.ease_after,
                        coalesce(v_reviewed, 0), true;
    return;
  end if;

  -- Lock the card for the rest of the transaction. A brand-new word has no row
  -- yet — grading a dictionary entry straight from the "ucz się dalej" deck
  -- enrols it — so a missing row is expected, not an error.
  select * into v_card
  from public.saved_words s
  where s.user_id = p_user_id and s.word_id = p_word_id
  for update;
  v_has_card := found;

  -- Stale-read guard: the schedule the caller computed from must still be the
  -- one in the table.
  if v_has_card <> coalesce((v_before ->> 'exists')::boolean, false)
     or (v_has_card and (
          v_card.interval    is distinct from (v_before ->> 'interval')::int
       or v_card.repetitions is distinct from (v_before ->> 'repetitions')::int
       or round(v_card.ease_factor, 2) is distinct from round((v_before ->> 'ease_factor')::numeric, 2)
     ))
  then
    raise exception 'Harmonogram powtórki zmienił się w trakcie zapisu.' using errcode = 'FL423';
  end if;

  -- Two identical requests can still race past the lookup above; the unique
  -- constraint decides, and the loser reports the winner's outcome instead of an
  -- error the learner could not act on. Only this statement can raise it, so the
  -- handler is scoped to it rather than to the whole function body.
  begin
    insert into public.review_events (
      user_id, word_id, interaction_id, rating, mode, direction,
      repetitions_before, interval_before, ease_before, due_before,
      repetitions_after, interval_after, ease_after, due_after,
      response_ms
    ) values (
      p_user_id, p_word_id, p_interaction_id, p_rating, p_mode, p_direction,
      case when v_has_card then v_card.repetitions end,
      case when v_has_card then v_card.interval end,
      case when v_has_card then v_card.ease_factor end,
      case when v_has_card then v_card.due_at end,
      (v_after ->> 'repetitions')::int,
      (v_after ->> 'interval')::int,
      (v_after ->> 'ease_factor')::numeric,
      (v_after ->> 'due_at')::timestamptz,
      case when p_response_ms is null or p_response_ms < 0 then null
           else least(p_response_ms, 3600000) end
    )
    returning id into v_event_id;
  exception when unique_violation then
    v_event_id := null;
  end;

  if v_event_id is null then
    select * into v_existing
    from public.review_events r
    where r.user_id = p_user_id and r.interaction_id = p_interaction_id;
    if not found then
      raise exception 'Nie udało się zapisać powtórki.' using errcode = 'FL409';
    end if;
    select p.words_reviewed_today into v_reviewed
    from public.profiles p where p.id = p_user_id;
    select s.is_mastered into v_is_mastered
    from public.saved_words s
    where s.user_id = p_user_id and s.word_id = v_existing.word_id;
    return query select v_existing.id, v_existing.due_after,
                        coalesce(v_is_mastered, false), v_existing.interval_after,
                        v_existing.repetitions_after, v_existing.ease_after,
                        coalesce(v_reviewed, 0), true;
    return;
  end if;

  insert into public.saved_words as s
    (user_id, word_id, interval, repetitions, ease_factor, due_at, is_mastered)
  values (
    p_user_id, p_word_id,
    (v_after ->> 'interval')::int,
    (v_after ->> 'repetitions')::int,
    (v_after ->> 'ease_factor')::numeric,
    (v_after ->> 'due_at')::timestamptz,
    coalesce((v_after ->> 'is_mastered')::boolean, false)
  )
  on conflict (user_id, word_id) do update
    set interval    = excluded.interval,
        repetitions = excluded.repetitions,
        ease_factor = excluded.ease_factor,
        due_at      = excluded.due_at,
        is_mastered = excluded.is_mastered;

  v_reviewed := public.apply_word_review_counter(p_user_id);
  perform public.apply_learning_evidence(p_user_id, p_evidence, v_event_id);

  return query select v_event_id,
                      (v_after ->> 'due_at')::timestamptz,
                      coalesce((v_after ->> 'is_mastered')::boolean, false),
                      (v_after ->> 'interval')::int,
                      (v_after ->> 'repetitions')::int,
                      (v_after ->> 'ease_factor')::numeric,
                      v_reviewed,
                      false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. FINALIZE FUNCTIONS — now also the evidence boundary.
-- ─────────────────────────────────────────────────────────────────────────────
-- Both gain a `p_evidence` payload applied inside the SAME transaction that
-- already writes attempts / completion / profile / session. A test either
-- produced a result AND its evidence, or neither.
--
-- The old signatures are dropped rather than left as overloads: two functions
-- with the same name and a defaulted argument would make every call ambiguous.
drop function if exists public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean);
drop function if exists public.finalize_calibration_session(uuid, uuid, numeric, numeric, text);

create or replace function public.finalize_test_session(
  p_session_id       uuid,
  p_user_id          uuid,
  p_ability_before   numeric,
  p_ability_after    numeric,
  p_rd_after         numeric,
  p_cefr_estimate    text,
  p_promotion_streak int,
  p_passed           boolean,
  p_evidence         jsonb
)
returns table (
  correct_count     int,
  total_count       int,
  ability_start     numeric,
  ability_end       numeric,
  rd_end            numeric,
  test_passed       boolean,
  profile_answered  int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session    public.test_sessions%rowtype;
  v_ability    numeric;
  v_answered   int;
  v_total      int;
  v_correct    int;
  v_unanswered int;
  v_ratio      numeric;
begin
  -- Serialise finalization: two near-simultaneous calls queue here, and the
  -- second one finds the session already completed.
  select * into v_session
  from public.test_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja testu nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status = 'completed' then
    -- Evidence is deliberately NOT re-applied here. It was written by the call
    -- that completed the session; re-running the fold against a state snapshot
    -- taken afterwards would count the same answers twice.
    select p.answered into v_answered from public.profiles p where p.id = p_user_id;
    return query select v_session.correct, v_session.total, v_session.ability_before,
                        v_session.ability_after, v_session.rd_after, v_session.passed,
                        v_answered, true;
    return;
  end if;

  if v_session.status <> 'in_progress' then
    raise exception 'Ta sesja testu została porzucona.' using errcode = 'FL409';
  end if;

  select count(*)::int,
         count(*) filter (where i.answered_at is null)::int,
         count(*) filter (where i.is_correct)::int
    into v_total, v_unanswered, v_correct
  from public.test_session_items i
  where i.session_id = p_session_id;

  if v_total = 0 then
    raise exception 'Sesja testu nie ma pytań.' using errcode = 'FL404';
  end if;
  if v_unanswered > 0 then
    raise exception 'Nie wszystkie pytania mają odpowiedź.' using errcode = 'FL412';
  end if;

  -- Reject a rating computed from a profile that has since moved (for example a
  -- second test finalized in another tab). The caller re-reads and retries.
  select p.ability, p.answered into v_ability, v_answered
  from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'Profil nie istnieje.' using errcode = 'FL404';
  end if;
  if abs(v_ability - p_ability_before) > 0.005 then
    raise exception 'Profil zmienił się w trakcie liczenia wyniku.' using errcode = 'FL423';
  end if;

  v_ratio := round(v_correct::numeric / v_total, 4);

  -- 1. Immutable audit log, one row per answered question, tagged with the
  --    session. The unique constraint makes this a no-op on a repeat.
  insert into public.attempts
    (user_id, question_id, text_id, test_session_id, is_correct,
     ability_before, ability_after, response_ms)
  select p_user_id, i.question_id, v_session.text_id, p_session_id, i.is_correct,
         p_ability_before, p_ability_after, i.response_ms
  from public.test_session_items i
  where i.session_id = p_session_id
  on conflict (test_session_id, question_id) do nothing;

  -- 2. Compact per-text result (latest wins, so a retake overwrites).
  insert into public.text_completions
    (user_id, text_id, passed, correct, total, completed_at, test_session_id)
  values (p_user_id, v_session.text_id, p_passed, v_correct, v_total, now(), p_session_id)
  on conflict (user_id, text_id) do update
    set passed          = excluded.passed,
        correct         = excluded.correct,
        total           = excluded.total,
        completed_at    = excluded.completed_at,
        test_session_id = excluded.test_session_id;

  -- 3. Rating. `answered` advances by the session's item count exactly once,
  --    because this branch only runs on the in_progress -> completed transition.
  update public.profiles p
     set ability          = p_ability_after,
         rd               = p_rd_after,
         answered         = p.answered + v_total,
         cefr_estimate    = p_cefr_estimate,
         promotion_streak = p_promotion_streak,
         level_source     = 'test'
   where p.id = p_user_id;

  -- 4. Daily streak — same transaction, so it can never be bumped for a test
  --    that did not actually get recorded.
  perform public.apply_daily_streak(p_user_id);

  -- 5. Learning evidence — likewise. A finished test that left no trace in the
  --    knowledge model would be exactly the data loss this phase exists to stop.
  perform public.apply_learning_evidence(p_user_id, p_evidence);

  -- 6. Seal the session. From here it is an immutable result.
  update public.test_sessions s
     set status        = 'completed',
         completed_at  = now(),
         ability_after = p_ability_after,
         rd_after      = p_rd_after,
         correct       = v_correct,
         total         = v_total,
         score_ratio   = v_ratio,
         passed        = p_passed
   where s.id = p_session_id;

  return query select v_correct, v_total, p_ability_before, p_ability_after,
                      p_rd_after, p_passed, v_answered + v_total, false;
end;
$$;

create or replace function public.finalize_calibration_session(
  p_session_id    uuid,
  p_user_id       uuid,
  p_ability       numeric,
  p_rd            numeric,
  p_cefr_estimate text,
  p_evidence      jsonb
)
returns table (
  ability_value     numeric,
  rd_value          numeric,
  profile_answered  int,
  cefr_value        text,
  item_count        int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session  public.calibration_sessions%rowtype;
  v_answered int;
  v_cefr     text;
  v_items    int;
begin
  select * into v_session
  from public.calibration_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja testu nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status = 'completed' then
    select p.answered, p.cefr_estimate into v_answered, v_cefr
    from public.profiles p where p.id = p_user_id;
    return query select v_session.ability_after, v_session.rd_after, v_answered,
                        v_cefr, v_session.items, true;
    return;
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'Ta sesja testu została porzucona.' using errcode = 'FL409';
  end if;

  select count(*)::int into v_items
  from public.calibration_session_items i where i.session_id = p_session_id;
  if v_items = 0 then
    raise exception 'Nie udzielono żadnej odpowiedzi.' using errcode = 'FL412';
  end if;

  select p.answered into v_answered
  from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'Profil nie istnieje.' using errcode = 'FL404';
  end if;

  -- A placement test is real signal, but it never lowers an answer count earned
  -- by actually working through texts.
  v_answered := greatest(v_answered, v_items);

  update public.profiles p
     set ability          = p_ability,
         rd               = p_rd,
         answered         = v_answered,
         cefr_estimate    = p_cefr_estimate,
         level_source     = 'placement',
         promotion_streak = 0
   where p.id = p_user_id;

  perform public.apply_learning_evidence(p_user_id, p_evidence);

  update public.calibration_sessions s
     set status        = 'completed',
         completed_at  = now(),
         ability_after = p_ability,
         rd_after      = p_rd,
         items         = v_items
   where s.id = p_session_id;

  return query select p_ability, p_rd, v_answered, p_cefr_estimate, v_items, false;
end;
$$;

-- The placement replay now also needs WHEN each item was answered, so the
-- evidence it produces carries the learner's real timestamps instead of the
-- moment the test happened to be finalized. Changing a RETURNS TABLE shape means
-- dropping and recreating rather than replacing.
drop function if exists public.get_calibration_session_answers(uuid);

create or replace function public.get_calibration_session_answers(p_session_id uuid)
returns table (
  question_id     bigint,
  item_position   int,
  item_difficulty int,
  is_correct      boolean,
  response_ms     int,
  answered_at     timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user  uuid := auth.uid();
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id into v_owner
  from public.calibration_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja testu nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.question_id, i.item_position, i.item_difficulty, i.is_correct,
         i.response_ms, i.answered_at
  from public.calibration_session_items i
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. PUBLIC VIEWS — the answer-free read surface, now carrying the tags.
-- ─────────────────────────────────────────────────────────────────────────────
-- `correct_idx` stays out, exactly as before; what is added is what the item
-- EXERCISES. The finalize actions read the tags from here rather than from
-- `questions` (which learners cannot read) or through the service role (which
-- exists for the finalize RPCs, not for convenience reads).
--
-- Concepts arrive as an array rather than a join so one query per test is
-- enough; `question_concepts` itself stays admin-only.
create or replace view public.questions_public as
  select q.id, q.text_id, q.prompt, q.options, q.difficulty, q.created_at,
         q.skill_code, q.tested_word_id,
         coalesce(
           array(select qc.concept_code
                 from public.question_concepts qc
                 where qc.question_id = q.id
                 order by qc.concept_code),
           array[]::text[]
         ) as concepts
  from public.questions q
  join public.texts t on t.id = q.text_id
  where t.status = 'published';

create or replace view public.calibration_questions_public as
  select c.id, c.prompt, c.options, c.difficulty, c.cefr, c.skill, c.created_at,
         c.skill_code, c.tested_word_id,
         coalesce(
           array(select cc.concept_code
                 from public.calibration_question_concepts cc
                 where cc.question_id = c.id
                 order by cc.concept_code),
           array[]::text[]
         ) as concepts
  from public.calibration_questions c;

grant select on public.questions_public             to anon, authenticated;
grant select on public.calibration_questions_public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. EXECUTE PRIVILEGES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same rule as the test-session migration: Postgres grants EXECUTE to PUBLIC by
-- default, so every function is revoked first and granted back only where it is
-- genuinely needed. Nothing that writes learning evidence is reachable from a
-- browser-facing role.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.apply_word_review_counter(uuid)',
    'public.bump_word_review()',
    'public.get_calibration_session_answers(uuid)',
    'public.apply_learning_evidence(uuid, jsonb, bigint)',
    'public.apply_review(uuid, text, bigint, text, text, text, int, jsonb, jsonb)',
    'public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean, jsonb)',
    'public.finalize_calibration_session(uuid, uuid, numeric, numeric, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
  end loop;
end $$;

-- The learner-callable wrapper keeps its grant; it derives the user from
-- auth.uid() and can only ever move the caller's own counters.
grant execute on function public.bump_word_review() to authenticated;
grant execute on function public.get_calibration_session_answers(uuid) to authenticated;

-- Everything that creates learning evidence is server-only. `apply_review` takes
-- a user id, which is precisely why it must never be callable by a role a
-- browser can hold.
grant execute on function public.apply_review(uuid, text, bigint, text, text, text, int, jsonb, jsonb) to service_role;
grant execute on function public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean, jsonb) to service_role;
grant execute on function public.finalize_calibration_session(uuid, uuid, numeric, numeric, text, jsonb) to service_role;

-- `apply_learning_evidence` and `apply_word_review_counter` stay revoked from
-- every role including service_role: they are internal steps of the functions
-- above, not an API. The owner retains its own privileges, which is how the
-- SECURITY DEFINER callers reach them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- The rule for every table added here: a learner may READ their own learning
-- history and their own knowledge state, and may write NONE of it. There is
-- deliberately no insert/update/delete policy anywhere below — evidence that a
-- learner can author is not evidence, and a mastery score someone can set is not
-- a measurement. Every write arrives through the SECURITY DEFINER functions
-- above, which run as the table owner and so bypass RLS.
alter table public.skills                        enable row level security;
alter table public.concepts                      enable row level security;
alter table public.question_concepts             enable row level security;
alter table public.calibration_question_concepts enable row level security;
alter table public.learning_events               enable row level security;
alter table public.learning_event_concepts       enable row level security;
alter table public.review_events                 enable row level security;
alter table public.user_skill_state              enable row level security;
alter table public.user_concept_state            enable row level security;
alter table public.user_word_knowledge           enable row level security;

-- The two catalogs are public reference data: no learner information in them,
-- and the UI needs the Polish labels. Writes are admin-only.
drop policy if exists "skills public read" on public.skills;
create policy "skills public read" on public.skills for select using (true);
drop policy if exists "skills admin write" on public.skills;
create policy "skills admin write" on public.skills
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "concepts public read" on public.concepts;
create policy "concepts public read" on public.concepts for select using (true);
drop policy if exists "concepts admin write" on public.concepts;
create policy "concepts admin write" on public.concepts
  for all using (public.is_admin()) with check (public.is_admin());

-- Item tags follow their item bank. `question_concepts` would leak nothing on
-- its own (a concept code is not an answer key), but only admins ever edit it
-- and reading it from a browser has no use, so it stays admin-only.
drop policy if exists "question concepts admin" on public.question_concepts;
create policy "question concepts admin" on public.question_concepts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "calibration concepts admin" on public.calibration_question_concepts;
create policy "calibration concepts admin" on public.calibration_question_concepts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own learning events read" on public.learning_events;
create policy "own learning events read" on public.learning_events
  for select using (auth.uid() = user_id);

drop policy if exists "own learning event concepts read" on public.learning_event_concepts;
create policy "own learning event concepts read" on public.learning_event_concepts
  for select using (
    exists (
      select 1 from public.learning_events e
      where e.id = learning_event_concepts.event_id and e.user_id = auth.uid()
    )
  );

drop policy if exists "own review events read" on public.review_events;
create policy "own review events read" on public.review_events
  for select using (auth.uid() = user_id);

drop policy if exists "own skill state read" on public.user_skill_state;
create policy "own skill state read" on public.user_skill_state
  for select using (auth.uid() = user_id);

drop policy if exists "own concept state read" on public.user_concept_state;
create policy "own concept state read" on public.user_concept_state
  for select using (auth.uid() = user_id);

drop policy if exists "own word knowledge read" on public.user_word_knowledge;
create policy "own word knowledge read" on public.user_word_knowledge
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. BACKFILL.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT CAN HONESTLY BE RECOVERED: `attempts` already records one row per
-- answered comprehension question, with correctness, timing and the passage it
-- came from. That is a real learning event and is reconstructed here, marked
-- `origin = 'legacy_backfill'` so nothing downstream mistakes it for a
-- first-class record.
--
-- WHAT CANNOT: review history. `saved_words` keeps only the latest SM-2 state,
-- so `repetitions = 5` says five reviews happened and nothing about when, how
-- they were graded, or what the intervals were. Fabricating five plausible
-- review events would put invented data into the exact table whose purpose is to
-- be trustworthy training data later. The existing schedules are left untouched
-- and review history simply begins now.
--
-- AGGREGATED STATE IS NOT BACKFILLED EITHER. The V1 model lives in TypeScript;
-- re-implementing it here to replay history would create the second
-- implementation this schema exists to avoid. The events are in place, so a
-- replay job can build state from them whenever it is wanted — and until then an
-- existing learner shows "brak danych", which is true.
--
-- IDEMPOTENT: the guard matches on the answer itself, so re-running the
-- migration adds nothing, and an answer recorded natively after the migration is
-- never shadowed by a legacy duplicate.
insert into public.learning_events (
  user_id, event_key, event_type, occurred_at, skill_code,
  response_mode, retrieval_type, is_correct, response_ms,
  source_kind, origin, text_id, question_id, test_session_id
)
select a.user_id,
       'legacy-attempt:' || a.id,
       'test_answer',
       a.created_at,
       'reading_comprehension',
       'multiple_choice',
       'recognition',
       a.is_correct,
       a.response_ms,
       'reading_test',
       'legacy_backfill',
       a.text_id,
       a.question_id,
       a.test_session_id
from public.attempts a
where not exists (
  select 1 from public.learning_events e
  where e.user_id     = a.user_id
    and e.question_id = a.question_id
    and e.event_type  = 'test_answer'
    and e.test_session_id is not distinct from a.test_session_id
)
on conflict (user_id, event_key) do nothing;
