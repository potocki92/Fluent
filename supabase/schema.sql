-- Fluent — Supabase schema.
-- Run in Supabase Studio > SQL Editor (or `supabase db push`).
-- The whole script is idempotent: safe to run repeatedly on a fresh OR an
-- already-provisioned database.

-- ENABLE EXTENSIONS
create extension if not exists pg_trgm;

-- WORDS (DTZ dictionary, 2588 entries)
create table if not exists public.words (
  id             bigint primary key,
  lemma          text not null,
  display        text not null,            -- "die Autobahn"
  article        text check (article in ('der','die','das')),
  word_type      text not null check (word_type in ('noun','verb','other')),
  gender         char(1) check (gender in ('m','f','n')),
  translation_pl text,
  example_de     text,
  example_pl     text,
  cefr           text check (cefr in ('A1','A2','B1','B2')),
  source         text default 'DTZ',
  created_at     timestamptz default now()
);
create index if not exists words_cefr_idx   on public.words(cefr);
create index if not exists words_type_idx   on public.words(word_type);
-- Btree on lemma backs the dictionary's default `order by lemma` + range
-- pagination; the trgm GIN indexes below serve substring ILIKE search.
create index if not exists words_lemma_idx  on public.words(lemma);
-- Trigram indexes back `col ILIKE '%term%'` across every column the dictionary
-- and admin search query. The old index was on `lower(lemma)`, which the
-- planner can't use for `lemma ILIKE …`; gin_trgm_ops on the raw column can
-- (trigram matching is already case-insensitive for ILIKE).
drop index if exists public.words_lemma_trgm;
create index if not exists words_lemma_trgm       on public.words using gin (lemma gin_trgm_ops);
create index if not exists words_display_trgm     on public.words using gin (display gin_trgm_ops);
create index if not exists words_translation_trgm on public.words using gin (translation_pl gin_trgm_ops);

-- TEXTS (reading passages)
create table if not exists public.texts (
  id          bigint generated always as identity primary key,
  title       text not null,
  cefr        text not null check (cefr in ('A1','A2','B1','B2')),
  body        text not null,   -- HTML string, links to word lemmas via <mark data-lemma="X">
  word_count  int,
  difficulty  int not null default 1200,  -- Elo of the text itself
  status      text not null default 'draft' check (status in ('draft','published')),
  created_at  timestamptz default now()
);
create index if not exists texts_status_idx on public.texts(status);

-- QUESTIONS (comprehension questions per text)
-- correct_idx is NEVER returned to the client. Learners read the answer-free
-- `questions_public` view; grading goes through `answer_test_question`, which
-- only reveals the key for a question inside the caller's own test session.
create table if not exists public.questions (
  id          bigint generated always as identity primary key,
  text_id     bigint not null references public.texts(id) on delete cascade,
  prompt      text not null,
  options     text[] not null,   -- {"option A","option B","option C","option D"}
  correct_idx int  not null,
  difficulty  int  not null default 1200,
  created_at  timestamptz default now()
);
create index if not exists questions_text_idx on public.questions(text_id);

-- CALIBRATION QUESTIONS (standalone placement-test item bank, not tied to a text)
-- Used by the adaptive level test. As with `questions`, `correct_idx` is never
-- selectable on the client — learners read `calibration_questions_public` and
-- grading happens in `answer_calibration_question`, bound to a placement
-- session.
create table if not exists public.calibration_questions (
  id          bigint generated always as identity primary key,
  prompt      text not null,
  options     text[] not null,   -- {"option A","option B","option C","option D"}
  correct_idx int  not null,
  difficulty  int  not null,    -- Elo difficulty of the item
  cefr        text not null check (cefr in ('A1','A2','B1','B2')),
  skill       text check (skill in ('vocab','grammar')),
  created_at  timestamptz default now()
);
create index if not exists calibration_difficulty_idx
  on public.calibration_questions(difficulty);

-- PROFILES (one per auth user, holds Elo ability)
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  role            text    not null default 'user' check (role in ('user','admin')),
  ability         numeric not null default 1000,
  rd              numeric not null default 350,   -- rating deviation
  answered        int     not null default 0,
  cefr_estimate   text,
  promotion_streak int    not null default 0,   -- consecutive strong passes toward next CEFR band
  streak_days          int     not null default 0,
  last_active          date,
  daily_word_goal      int     not null default 20,
  word_streak_days     int     not null default 0,
  words_reviewed_today int     not null default 0,
  last_word_review     date,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- ATTEMPTS (immutable audit log — one row per answered question)
create table if not exists public.attempts (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  question_id     bigint not null references public.questions(id) on delete cascade,
  text_id         bigint not null references public.texts(id) on delete cascade,
  is_correct      boolean not null,
  ability_before  numeric not null,
  ability_after   numeric not null,
  response_ms     int,   -- time the learner took to answer, when captured
  created_at      timestamptz default now()
);
create index if not exists attempts_user_idx on public.attempts(user_id, created_at desc);

-- TEXT COMPLETIONS (one row per learner+text — the latest test result for it)
-- The `attempts` log records every answered question; this table is the compact
-- "did I finish this text and did I pass" summary the /learn page reads to filter
-- out completed texts and build the "read & passed" section. Upserted by the
-- `complete-test` Server Action so a retake overwrites the previous result
-- (latest wins), which a plain aggregate over `attempts` could not do reliably.
create table if not exists public.text_completions (
  user_id      uuid    not null references auth.users(id) on delete cascade,
  text_id      bigint  not null references public.texts(id) on delete cascade,
  passed       boolean not null,
  correct      int     not null,
  total        int     not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, text_id)
);
create index if not exists text_completions_user_idx
  on public.text_completions(user_id, completed_at desc);

-- SAVED WORDS with SRS data
create table if not exists public.saved_words (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  word_id     bigint  not null references public.words(id) on delete cascade,
  -- SM-2 fields
  interval    int     not null default 0,       -- days
  repetitions int     not null default 0,
  ease_factor numeric not null default 2.5,
  due_at      timestamptz not null default now(),
  is_mastered boolean not null default false,
  saved_at    timestamptz default now(),
  primary key (user_id, word_id)
);
create index if not exists saved_due_idx on public.saved_words(user_id, due_at);

-- WORD SUGGESTIONS (learner-submitted corrections, reviewed by admins)
-- A signed-in learner proposes a better translation/example for a word; an admin
-- approves (which overwrites the word field) or rejects. `field` names the words
-- column the suggestion targets.
create table if not exists public.word_suggestions (
  id          bigint generated always as identity primary key,
  word_id     bigint not null references public.words(id) on delete cascade,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  field       text   not null check (field in ('translation_pl','example_de','example_pl','other')),
  suggestion  text   not null,
  note        text,
  status      text   not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists word_suggestions_status_idx
  on public.word_suggestions(status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS for already-provisioned databases. The CREATE statements above are
-- skipped when a table already exists, so bring older installs up to date here.
-- Each step is guarded and safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────
-- options jsonb -> text[]. The conversion is wrapped in a helper function
-- because Postgres forbids a subquery directly inside an ALTER COLUMN ... USING
-- transform expression. The helper is dropped again once the migration is done.
-- The dependent public views are dropped only when the migration actually runs
-- (i.e. the column is still jsonb); they are recreated further down by the
-- `create or replace view` statements.
create or replace function public.jsonb_to_text_array(j jsonb)
returns text[] language sql immutable as $$
  select array(select jsonb_array_elements_text(j));
$$;
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'questions'
        and column_name = 'options') = 'jsonb' then
    drop view if exists public.questions_public;
    alter table public.questions
      alter column options type text[]
      using public.jsonb_to_text_array(options);
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'calibration_questions'
        and column_name = 'options') = 'jsonb' then
    drop view if exists public.calibration_questions_public;
    alter table public.calibration_questions
      alter column options type text[]
      using public.jsonb_to_text_array(options);
  end if;
end $$;
drop function if exists public.jsonb_to_text_array(jsonb);
-- response time on attempts
alter table public.attempts add column if not exists response_ms int;

-- ReadTheory-style promotion gate: consecutive strong passes toward the next band
alter table public.profiles add column if not exists promotion_streak int not null default 0;

-- dictionary enrichment: topic/category (#tematy) + richer entry detail
-- (plural form, verb auxiliary, synonyms, IPA). All nullable; `aux`/`topic` are
-- validated in the admin Server Action rather than via a DB check so the column
-- can be added idempotently to already-provisioned databases.
alter table public.words add column if not exists topic    text;
alter table public.words add column if not exists plural   text;
alter table public.words add column if not exists aux      text;
alter table public.words add column if not exists synonyms text[];
alter table public.words add column if not exists ipa      text;
-- mnemonic: keyword-method association shown on flashcards. Shared per word and
-- edited through the dictionary, so the existing "words admin update" policy
-- already covers writes — no extra RLS needed.
alter table public.words add column if not exists mnemonic text;
create index if not exists words_topic_idx on public.words(topic);

-- AUTO-CREATE PROFILE ON SIGNUP
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id,
    coalesce(new.raw_user_meta_data->>'name',
             split_part(new.email,'@',1),
             'Learner'));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at maintenance: stamp profiles.updated_at on every update so the
-- column stays accurate without each caller having to set it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ADMIN CHECK (used by the texts/questions write policies and the draft read
-- policy). `security definer` + `stable` so the policy can query `profiles`
-- without tripping RLS recursion.
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;


-- Prevent privilege escalation: the "own profile update" policy lets a user
-- edit their own row, so without this a learner could set their own role to
-- 'admin'. Only an existing admin may change the role column.
create or replace function public.prevent_role_change()
returns trigger language plpgsql security definer as $$
begin
  -- Only block end-user (authenticated) requests. A null auth.uid() means a
  -- trusted context — the SQL editor / service role bootstrapping the first
  -- admin — which must be allowed through.
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Nie można zmienić roli użytkownika.';
  end if;
  return new;
end; $$;

drop trigger if exists profiles_no_role_change on public.profiles;
create trigger profiles_no_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ROW LEVEL SECURITY
alter table public.words                 enable row level security;
alter table public.texts                 enable row level security;
alter table public.questions             enable row level security;
alter table public.calibration_questions enable row level security;
alter table public.profiles              enable row level security;
alter table public.attempts              enable row level security;
alter table public.text_completions      enable row level security;
alter table public.saved_words           enable row level security;
alter table public.word_suggestions      enable row level security;

drop policy if exists "words public read" on public.words;
create policy "words public read" on public.words for select using (true);

-- words: only admins may insert/update/delete dictionary entries (the admin
-- editor). Learners keep public read above.
drop policy if exists "words admin insert" on public.words;
create policy "words admin insert" on public.words
  for insert with check (public.is_admin());
drop policy if exists "words admin update" on public.words;
create policy "words admin update" on public.words
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "words admin delete" on public.words;
create policy "words admin delete" on public.words
  for delete using (public.is_admin());

-- questions / calibration_questions: NO public SELECT policy. Learners never
-- touch these tables directly — they read the answer-free `*_public` views and
-- are graded through the SECURITY DEFINER functions. Only admins may read the
-- raw rows (including `correct_idx`) to verify and edit them.
drop policy if exists "questions public read"    on public.questions;
drop policy if exists "calibration public read"  on public.calibration_questions;

drop policy if exists "questions admin read" on public.questions;
create policy "questions admin read" on public.questions
  for select using (public.is_admin());
drop policy if exists "calibration admin read" on public.calibration_questions;
create policy "calibration admin read" on public.calibration_questions
  for select using (public.is_admin());

drop policy if exists "calibration admin insert" on public.calibration_questions;
create policy "calibration admin insert" on public.calibration_questions
  for insert with check (public.is_admin());
drop policy if exists "calibration admin update" on public.calibration_questions;
create policy "calibration admin update" on public.calibration_questions
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "calibration admin delete" on public.calibration_questions;
create policy "calibration admin delete" on public.calibration_questions
  for delete using (public.is_admin());

-- texts: learners read only published passages; admins also read drafts.
drop policy if exists "texts published read" on public.texts;
create policy "texts published read" on public.texts
  for select using (status = 'published' or public.is_admin());

-- ADMIN WRITES (texts + questions). Only admins may insert/update/delete content.
drop policy if exists "texts admin insert" on public.texts;
create policy "texts admin insert" on public.texts
  for insert with check (public.is_admin());
drop policy if exists "texts admin update" on public.texts;
create policy "texts admin update" on public.texts
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "texts admin delete" on public.texts;
create policy "texts admin delete" on public.texts
  for delete using (public.is_admin());

drop policy if exists "questions admin insert" on public.questions;
create policy "questions admin insert" on public.questions
  for insert with check (public.is_admin());
drop policy if exists "questions admin update" on public.questions;
create policy "questions admin update" on public.questions
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "questions admin delete" on public.questions;
create policy "questions admin delete" on public.questions
  for delete using (public.is_admin());

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read"   on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id);

-- attempts / text_completions are written ONLY by the learning engine
-- (finalize_test_session, which runs as the service role). Learners read their
-- own rows and nothing more — an insert policy here would make the audit log
-- forgeable. See section 12 of the test-sessions migration appended below.
drop policy if exists "own attempts read" on public.attempts;
create policy "own attempts read"   on public.attempts
  for select using (auth.uid() = user_id);

drop policy if exists "own completions read" on public.text_completions;
create policy "own completions read"   on public.text_completions
  for select using (auth.uid() = user_id);

drop policy if exists "own saved read" on public.saved_words;
create policy "own saved read"   on public.saved_words
  for select using (auth.uid() = user_id);
drop policy if exists "own saved write" on public.saved_words;
create policy "own saved write"  on public.saved_words
  for insert with check (auth.uid() = user_id);
drop policy if exists "own saved delete" on public.saved_words;
create policy "own saved delete" on public.saved_words
  for delete using (auth.uid() = user_id);
drop policy if exists "own saved update" on public.saved_words;
create policy "own saved update" on public.saved_words
  for update using (auth.uid() = user_id);

-- word_suggestions: a learner inserts/reads their own; admins read & review all.
drop policy if exists "suggestions insert own" on public.word_suggestions;
create policy "suggestions insert own" on public.word_suggestions
  for insert with check (auth.uid() = user_id);
drop policy if exists "suggestions read own or admin" on public.word_suggestions;
create policy "suggestions read own or admin" on public.word_suggestions
  for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists "suggestions admin update" on public.word_suggestions;
create policy "suggestions admin update" on public.word_suggestions
  for update using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC VIEWS — the answer-free read surface for learners. These are owned by
-- the schema owner and so bypass the (deliberately absent) SELECT policy on the
-- base tables, exposing every column EXCEPT `correct_idx`. Supabase's linter
-- flags these as "Security Definer View"; that is the intended behaviour here.
--
-- NOT DUPLICATE TABLES. `questions_public` / `calibration_questions_public` are
-- VIEWS, not tables — they store no data of their own. The rows live exactly
-- once, in the base tables `questions` / `calibration_questions`; each view is
-- just a safe projection of those same rows with `correct_idx` removed. So the
-- table↔view pair is intentional, not redundant: learners read the view (no
-- answer key), and grading goes through the session-bound SECURITY DEFINER
-- functions (answer_test_question / answer_calibration_question), the only code
-- allowed to touch `correct_idx`. Consumers: src/hooks/useTexts.ts,
-- src/hooks/useCalibrationQuestions.ts.
--
-- This schema defines NO objects with a `_local` suffix. If a project shows
-- e.g. `questions_public_local`, it came from outside this repo (a Studio
-- Duplicate/CSV import, a branch, or a local seed) and the app does not use it.
-- ─────────────────────────────────────────────────────────────────────────────
-- DROPPED FIRST, deliberately. Later migrations (appended at the end of this
-- file) widen these views with columns that do not exist yet at this point in
-- the script — the learning engine's `skill_code` / `concepts` tags. On a
-- re-run of schema.sql against an already-migrated database, a bare
-- `create or replace view` here would be asked to REMOVE those columns, which
-- Postgres refuses ("cannot drop columns from view"). Dropping and recreating
-- keeps the one-paste bootstrap re-runnable: this narrow definition is put back
-- and the migration block below widens it again.
drop view if exists public.questions_public;
create view public.questions_public as
  select q.id, q.text_id, q.prompt, q.options, q.difficulty, q.created_at
  from public.questions q
  join public.texts t on t.id = q.text_id
  where t.status = 'published';

drop view if exists public.calibration_questions_public;
create view public.calibration_questions_public as
  select id, prompt, options, difficulty, cefr, skill, created_at
  from public.calibration_questions;

grant select on public.questions_public             to anon, authenticated;
grant select on public.calibration_questions_public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — starter calibration item bank (Polish prompts, German vocab/grammar)
-- spanning A1–B2 so the adaptive level test works out of the box. The correct
-- option sits at a varied index per item (so the answer key isn't predictable);
-- `correct_idx` points at it. Only seeded when the bank is empty, so re-running
-- the script never duplicates it.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.calibration_questions) then
    insert into public.calibration_questions (prompt, options, correct_idx, difficulty, cefr, skill) values
      ('Jak po niemiecku „dziękuję"?', array['Bitte','Tschüss','Danke','Hallo'], 2, 1080, 'A1', 'vocab'),
      ('Co znaczy „das Haus"?', array['kot','dom','stół','pies'], 1, 1100, 'A1', 'vocab'),
      ('Uzupełnij: Ich ___ Anna.', array['ist','sind','bist','bin'], 3, 1120, 'A1', 'grammar'),
      ('Jak po niemiecku „woda"?', array['das Brot','das Wasser','der Apfel','die Milch'], 1, 1140, 'A1', 'vocab'),
      ('Co znaczy „einkaufen"?', array['gotować','spać','robić zakupy','biegać'], 2, 1280, 'A2', 'vocab'),
      ('Co znaczy „der Bahnhof"?', array['dworzec','lotnisko','sklep','szpital'], 0, 1260, 'A2', 'vocab'),
      ('Jaki rodzajnik: ___ Sonne?', array['der','das','den','die'], 3, 1300, 'A2', 'grammar'),
      ('Uzupełnij: Gestern ___ ich ins Kino gegangen.', array['habe','bin','war','bist'], 1, 1320, 'A2', 'grammar'),
      ('Co znaczy „die Umwelt"?', array['umowa','sąsiedztwo','środowisko','podróż'], 2, 1500, 'B1', 'vocab'),
      ('Co znaczy „sich bewerben"?', array['martwić się','cieszyć się','spóźnić się','ubiegać się (o pracę)'], 3, 1480, 'B1', 'vocab'),
      ('Uzupełnij: Wenn ich Zeit ___, würde ich reisen.', array['hätte','habe','hatte','haben'], 0, 1520, 'B1', 'grammar'),
      ('Wybierz poprawne: Der Film, ___ ich gesehen habe, war gut.', array['der','dem','den','das'], 2, 1540, 'B1', 'grammar'),
      ('Co znaczy „der Vorschlag"?', array['przewaga','propozycja','uprzedzenie','postęp'], 1, 1680, 'B2', 'vocab'),
      ('Co znaczy „nachhaltig"?', array['następny','niedbały','głośny','zrównoważony'], 3, 1700, 'B2', 'vocab'),
      ('Uzupełnij: Er tat so, als ___ er nichts gehört.', array['hätte','hat','habe','würde'], 0, 1720, 'B2', 'grammar'),
      ('Wybierz formę grzeczną: „___ Sie mir bitte helfen?"', array['Kannst','Könnt','Könnten','Konntest'], 2, 1660, 'B2', 'grammar');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOTSTRAP FIRST ADMIN — run once after deploy, replacing the uuid with the
-- target user's id from auth.users.
-- ─────────────────────────────────────────────────────────────────────────────
-- update public.profiles set role = 'admin' where id = '<auth-user-uuid>';

-- ═══ MIGRATIONS APPENDED ═════════════════════════════════════════════════════
-- Everything below is a VERBATIM copy of the files in `supabase/migrations/`,
-- concatenated in timestamp order, produced by `node supabase/sync-schema.mjs`.
-- Do not hand-edit these blocks — edit the migration and re-run the script.
-- ═════════════════════════════════════════════════════════════════════════════

-- === BEGIN supabase/migrations/20260913120000_test_sessions_and_progress_security.sql ===

-- Fluent — authoritative test sessions + progress-write lockdown.
--
-- WHY THIS MIGRATION EXISTS
-- Before it, a comprehension "test" was just a list of question ids the browser
-- chose and posted back. Three consequences, all exploitable with nothing but
-- the public anon key:
--   1. `grade_question` / `grade_calibration` returned `correct_idx` for ANY
--      item id, to any signed-in user, with no session and no ownership check —
--      a public answer oracle.
--   2. `attempts`, `text_completions` and every server-owned `profiles` column
--      (ability, rd, answered, streak…) were directly writable by the owning
--      user, so progress could simply be typed in.
--   3. Scoring a test ran as four independent statements, so a failure halfway
--      through left the database with e.g. attempts but no profile update.
--
-- After it, a test is a persisted, server-owned session: the server picks the
-- questions, each answer is written exactly once against that session, and one
-- atomic, idempotent function turns the session into attempts + completion +
-- profile + streak.
--
-- The whole script is idempotent and safe to run on an already-provisioned
-- database: it creates nothing that exists, drops no user data, and leaves
-- historical `attempts` / `text_completions` rows untouched (their new
-- `test_session_id` stays null — see the "historical rows" note below).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TEST SESSIONS — the unit of a graded reading test.
-- ─────────────────────────────────────────────────────────────────────────────
-- A session is created by the server (never the client), snapshots the
-- learner's rating at the moment the test starts, and becomes immutable once
-- finalized. `ability_after`/`correct`/… are null while `status = 'in_progress'`
-- and are written exactly once, by `finalize_test_session`.
create table if not exists public.test_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid   not null references auth.users(id) on delete cascade,
  text_id        bigint not null references public.texts(id) on delete cascade,
  status         text   not null default 'in_progress'
                   check (status in ('in_progress', 'completed', 'abandoned')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  -- Rating snapshot taken at start, so the result screen can show a truthful
  -- before/after even if the profile moves for other reasons meanwhile.
  ability_before numeric not null,
  rd_before      numeric not null,
  ability_after  numeric,
  rd_after       numeric,
  correct        int,
  total          int,
  score_ratio    numeric,
  passed         boolean
);

-- Exactly one live session per (learner, text). This is what makes re-entering
-- a half-finished test *resume* it instead of silently starting a second one,
-- and what makes two concurrent `start_test_session` calls converge.
create unique index if not exists test_sessions_one_active_idx
  on public.test_sessions (user_id, text_id)
  where status = 'in_progress';

-- Results screen / history lookups.
create index if not exists test_sessions_user_completed_idx
  on public.test_sessions (user_id, completed_at desc)
  where status = 'completed';

-- SNAPSHOT OF THE QUESTIONS BELONGING TO ONE SESSION.
-- `correct_idx` is deliberately NOT copied here — `public.questions` stays the
-- single source of truth for the answer key. What is snapshotted is the item's
-- Elo difficulty, so an admin editing a question mid-test cannot change the
-- basis the session is scored on.
--
-- The primary key (session_id, question_id) is the idempotency guarantee for
-- answering: a question can appear at most once per session, so a double tap or
-- a replayed request can never produce two answers.
--
-- Named `item_position` rather than `position` because `position` is a reserved
-- word in SQL and a built-in function name.
create table if not exists public.test_session_items (
  session_id      uuid   not null references public.test_sessions(id) on delete cascade,
  question_id     bigint not null references public.questions(id) on delete cascade,
  item_position   int    not null,
  item_difficulty int    not null,
  selected_idx    int,
  is_correct      boolean,
  response_ms     int,
  answered_at     timestamptz,
  primary key (session_id, question_id)
);

create unique index if not exists test_session_items_position_idx
  on public.test_session_items (session_id, item_position);

-- Partial index backing the "is this session fully answered?" check in
-- `finalize_test_session` — it only ever looks for unanswered rows.
create index if not exists test_session_items_unanswered_idx
  on public.test_session_items (session_id)
  where answered_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CALIBRATION SESSIONS — the same model for the adaptive placement test.
-- ─────────────────────────────────────────────────────────────────────────────
-- Kept as its own pair of tables rather than forced into `test_sessions`: a
-- placement test has no `text_id`, draws from a separate item bank, and picks
-- its items adaptively rather than from a fixed snapshot. What matters for
-- security is shared: every answer is persisted server-side, so the final
-- rating is *replayed* from stored answers instead of being posted by the
-- client.
create table if not exists public.calibration_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'in_progress'
                  check (status in ('in_progress', 'completed', 'abandoned')),
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  ability_after numeric,
  rd_after      numeric,
  items         int
);

create unique index if not exists calibration_sessions_one_active_idx
  on public.calibration_sessions (user_id)
  where status = 'in_progress';

-- Items are appended as they are answered (the test is adaptive, so the set is
-- not known up front). `item_difficulty` is snapshotted at answer time because
-- it is the value the rating update was computed against — replaying the
-- session must reproduce the original arithmetic exactly.
create table if not exists public.calibration_session_items (
  session_id      uuid   not null references public.calibration_sessions(id) on delete cascade,
  question_id     bigint not null references public.calibration_questions(id) on delete cascade,
  item_position   int    not null,
  item_difficulty int    not null,
  selected_idx    int    not null,
  is_correct      boolean not null,
  response_ms     int,
  answered_at     timestamptz not null default now(),
  primary key (session_id, question_id)
);

create unique index if not exists calibration_session_items_position_idx
  on public.calibration_session_items (session_id, item_position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COLUMN ADDITIONS on existing tables.
-- ─────────────────────────────────────────────────────────────────────────────
-- Attempts now carry the session they came from. HISTORICAL ROWS KEEP NULL:
-- attempts written before this migration have no session, and that is fine —
-- the column is nullable and the unique constraint below treats nulls as
-- distinct, so old rows neither collide nor block anything.
alter table public.attempts
  add column if not exists test_session_id uuid
  references public.test_sessions(id) on delete set null;

-- One attempt per (session, question). This is the database-level guarantee
-- that re-running finalize cannot log the same answer twice.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attempts_session_question_key'
      and conrelid = 'public.attempts'::regclass
  ) then
    alter table public.attempts
      add constraint attempts_session_question_key
      unique (test_session_id, question_id);
  end if;
end $$;

create index if not exists attempts_session_idx
  on public.attempts (test_session_id)
  where test_session_id is not null;

-- Backs the stats chart, which reads the learner's MOST RECENT attempts
-- (`order by created_at desc limit N`) rather than their oldest.
create index if not exists attempts_user_recent_idx
  on public.attempts (user_id, created_at desc, id desc);

-- Same idea for completions: which session produced this result.
alter table public.text_completions
  add column if not exists test_session_id uuid
  references public.test_sessions(id) on delete set null;

-- Where the learner's displayed level came from. This is the separation the
-- product needs between "I told the app my level" and "I proved it on a test":
--   default   — never calibrated
--   manual    — self-declared in settings (the user's own explicit choice)
--   placement — adaptive placement test, replayed server-side
--   test      — earned by finishing reading tests
alter table public.profiles
  add column if not exists level_source text not null default 'default';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_level_source_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_level_source_check
      check (level_source in ('default', 'manual', 'placement', 'test'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REMOVE THE ANSWER ORACLE AND THE CROSS-USER PROGRESS WRITERS.
-- ─────────────────────────────────────────────────────────────────────────────
-- `grade_question(question_id, selected_idx)` answered "what is the correct
-- index of item N" for any N, to any signed-in user, with no session attached.
-- `grade_calibration` did the same for the placement bank. `grade_test` let the
-- client choose which questions counted toward a result. All three are replaced
-- by the session-bound functions below; dropping them (rather than leaving them
-- unused) removes the backdoor instead of just stopping using it.
drop function if exists public.grade_question(bigint, int);
drop function if exists public.grade_calibration(bigint, int);
drop function if exists public.grade_test(bigint, bigint[], int[]);

-- `update_streak(p_user_id)` and `bump_word_review(p_user_id)` ran as SECURITY
-- DEFINER while trusting a caller-supplied uuid, so any signed-in user could
-- write to *another* user's profile. Both are replaced below: the streak helper
-- is no longer reachable from client roles at all, and the word-review counter
-- derives the user from auth.uid().
drop function if exists public.update_streak(uuid);
drop function if exists public.bump_word_review(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. HARDEN THE FUNCTIONS THAT STAY.
-- ─────────────────────────────────────────────────────────────────────────────
-- Every SECURITY DEFINER function below pins `search_path = ''` and fully
-- qualifies every relation, per Supabase's current guidance: without it, a role
-- able to create objects in a schema on the default path could shadow a table
-- and have it read with the definer's privileges. (Built-ins such as `now()` or
-- `count()` live in `pg_catalog`, which Postgres always searches implicitly, so
-- they need no prefix.)

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id,
    coalesce(new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1),
             'Learner'));
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only block end-user (authenticated) requests. A null auth.uid() means a
  -- trusted context — the SQL editor / service role bootstrapping the first
  -- admin — which must be allowed through.
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Nie można zmienić roli użytkownika.' using errcode = 'FL403';
  end if;
  return new;
end;
$$;

-- CEFR banding, mirrored from `src/lib/cefr.ts`.
--
-- This is the one intentional duplication of a domain rule in SQL, and it is
-- deliberately the *simplest* one: a fixed table of band floors that changes
-- only when the product redefines its levels. Everything with real arithmetic
-- in it — the Elo update, the test score, the promotion gate, SM-2 — stays in
-- `src/lib/` and is computed by the server before it reaches the database.
-- Keep this in step with `CEFR_BANDS`.
create or replace function public.cefr_for_ability(p_ability numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ability >= 1600 then 'B2'
    when p_ability >= 1450 then 'B1'
    when p_ability >= 1300 then 'A2'
    when p_ability >= 1150 then 'A1+'
    else 'A1'
  end;
$$;

-- Daily reading streak. No longer callable by clients at all: it is an internal
-- step of `finalize_test_session`, which is the only thing allowed to decide
-- that a learner was active today.
create or replace function public.apply_daily_streak(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last   date;
  v_streak int;
begin
  select p.last_active, p.streak_days into v_last, v_streak
  from public.profiles p where p.id = p_user_id for update;
  if v_last = current_date then return; end if;
  -- `>=` rather than `=` so a clock/timezone rollover still counts as a
  -- continued streak instead of silently resetting it.
  if v_last >= current_date - 1 then v_streak := v_streak + 1;
  else v_streak := 1; end if;
  update public.profiles p
    set streak_days = v_streak, last_active = current_date
    where p.id = p_user_id;
end;
$$;

-- Spaced-repetition daily counter. Derives the user from auth.uid() instead of
-- trusting a parameter, so it can only ever advance the caller's own counters.
create or replace function public.bump_word_review()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_last   date;
  v_streak int;
  v_count  int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select p.last_word_review, p.word_streak_days, p.words_reviewed_today
    into v_last, v_streak, v_count
    from public.profiles p where p.id = v_user for update;
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
    where p.id = v_user;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SERVER-OWNED PROFILE COLUMNS.
-- ─────────────────────────────────────────────────────────────────────────────
-- The "own profile update" RLS policy has to stay, because learners legitimately
-- edit `display_name` and `daily_word_goal`. This trigger narrows what that
-- policy actually permits: the progress columns can only change when the write
-- arrives from the learning engine.
--
-- HOW THE TRUST BOUNDARY IS DETECTED: PostgREST executes a request with
-- `current_user` set to `authenticated` (or `anon`). Inside a SECURITY DEFINER
-- function `current_user` is the function owner instead, and the service role
-- runs as `service_role`. So "current_user is authenticated/anon" is exactly
-- "this write came straight from a browser", which is exactly what must not be
-- allowed to move progress. `role` is deliberately not listed — the dedicated
-- `prevent_role_change` trigger reports that case with its own message.
--
-- THIS FUNCTION MUST STAY SECURITY INVOKER. A SECURITY DEFINER trigger would
-- switch `current_user` to the function owner before its body runs, so the
-- check would report "trusted" for every caller and silently allow exactly the
-- writes it exists to block. Postgres checks EXECUTE on a trigger function when
-- the trigger is created, not when it fires, so the revoked grants below do not
-- affect it.
create or replace function public.guard_profile_server_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.ability              is distinct from old.ability
  or new.rd                   is distinct from old.rd
  or new.answered             is distinct from old.answered
  or new.cefr_estimate        is distinct from old.cefr_estimate
  or new.promotion_streak     is distinct from old.promotion_streak
  or new.level_source         is distinct from old.level_source
  or new.streak_days          is distinct from old.streak_days
  or new.last_active          is distinct from old.last_active
  or new.words_reviewed_today is distinct from old.words_reviewed_today
  or new.word_streak_days     is distinct from old.word_streak_days
  or new.last_word_review     is distinct from old.last_word_review
  then
    raise exception 'Postęp nauki zmienia wyłącznie silnik nauki.' using errcode = 'FL403';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_server_fields on public.profiles;
create trigger profiles_guard_server_fields
  before update on public.profiles
  for each row execute function public.guard_profile_server_fields();

-- Self-declared level from settings. This is the ONE place a learner may move
-- their own ability, and it is explicitly labelled as such: `level_source`
-- becomes 'manual', `rd` is reset to full uncertainty so the estimate is treated
-- as a guess, and `answered` is left alone so a self-declaration never buys
-- confidence. A test-verified result always overwrites it.
create or replace function public.set_manual_level(p_ability numeric, p_rd numeric)
returns table (ability numeric, rd numeric, answered int, cefr_estimate text)
language plpgsql
security definer
set search_path = ''
as $$
-- Every ambiguous bare name in this body is meant as the table column; the
-- RETURNS TABLE names exist only to shape the result.
#variable_conflict use_column
declare
  v_user    uuid := auth.uid();
  v_ability numeric;
  v_rd      numeric;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  v_ability := greatest(900::numeric,  least(2000::numeric, round(p_ability, 2)));
  v_rd      := greatest(50::numeric,   least(350::numeric,  round(p_rd, 2)));

  return query
  update public.profiles p
     set ability          = v_ability,
         rd               = v_rd,
         cefr_estimate    = public.cefr_for_ability(v_ability),
         level_source     = 'manual',
         promotion_streak = 0
   where p.id = v_user
  returning p.ability, p.rd, p.answered, p.cefr_estimate;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. TEST SESSION LIFECYCLE — start.
-- ─────────────────────────────────────────────────────────────────────────────
-- The server decides which questions count. The client never sends a question
-- list, so it cannot pick an easy subset, repeat one item five times, or pull in
-- items from another text.
--
-- Re-entering an unfinished test resumes the existing session (see the partial
-- unique index above); finishing one and starting again creates a fresh session,
-- which is how a retake works.
create or replace function public.start_test_session(p_text_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_session uuid;
  v_ability numeric;
  v_rd      numeric;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  if not exists (
    select 1 from public.texts t
    where t.id = p_text_id and t.status = 'published'
  ) then
    raise exception 'Tekst nie istnieje lub nie jest opublikowany.' using errcode = 'FL404';
  end if;

  -- Resume an unfinished attempt at this text.
  select s.id into v_session
  from public.test_sessions s
  where s.user_id = v_user and s.text_id = p_text_id and s.status = 'in_progress';
  if v_session is not null then
    return v_session;
  end if;

  if not exists (select 1 from public.questions q where q.text_id = p_text_id) then
    raise exception 'Tekst nie ma pytań.' using errcode = 'FL404';
  end if;

  select p.ability, p.rd into v_ability, v_rd
  from public.profiles p where p.id = v_user;
  if not found then
    raise exception 'Profil nie istnieje.' using errcode = 'FL404';
  end if;

  -- Two tabs opening the test at the same moment race here. The partial unique
  -- index makes one of them lose; the loser adopts the winner's session rather
  -- than creating a second, competing one.
  begin
    insert into public.test_sessions (user_id, text_id, ability_before, rd_before)
    values (v_user, p_text_id, v_ability, v_rd)
    returning id into v_session;
  exception when unique_violation then
    select s.id into v_session
    from public.test_sessions s
    where s.user_id = v_user and s.text_id = p_text_id and s.status = 'in_progress';
    return v_session;
  end;

  insert into public.test_session_items
    (session_id, question_id, item_position, item_difficulty)
  select v_session, q.id, row_number() over (order by q.id), q.difficulty
  from public.questions q
  where q.text_id = p_text_id;

  return v_session;
end;
$$;

-- Read a session's question snapshot. Returns the prompt and options — never
-- `correct_idx` — plus whatever has already been answered, which is what lets
-- the client resume a half-finished test at the right question.
create or replace function public.get_test_session(p_session_id uuid)
returns table (
  question_id     bigint,
  item_position   int,
  prompt          text,
  options         text[],
  item_difficulty int,
  selected_idx    int,
  is_correct      boolean,
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

  select s.user_id into v_owner from public.test_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja testu nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.question_id, i.item_position, q.prompt, q.options, i.item_difficulty,
         i.selected_idx, i.is_correct, i.answered_at
  from public.test_session_items i
  join public.questions q on q.id = i.question_id
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. TEST SESSION LIFECYCLE — answer one question.
-- ─────────────────────────────────────────────────────────────────────────────
-- This replaces the old answer oracle. `correct_idx` is still revealed — the
-- product wants immediate feedback — but only for a question that belongs to
-- the caller's own in-progress session, and only once the answer for it has been
-- committed. There is no longer any way to ask "what is the answer to question
-- N" without spending that session's one shot at it.
--
-- IDEMPOTENCY: the first answer wins. A double tap, a retried Server Action or a
-- replayed POST re-reads the stored answer (`already_answered = true`) instead of
-- overwriting it, so a session's score cannot drift after the fact.
create or replace function public.answer_test_question(
  p_session_id   uuid,
  p_question_id  bigint,
  p_selected_idx int,
  p_response_ms  int
)
returns table (
  is_answer_correct boolean,
  answer_key_idx    int,
  already_answered  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := auth.uid();
  v_owner       uuid;
  v_status      text;
  v_answered_at timestamptz;
  v_stored      boolean;
  v_correct_idx int;
  v_options     int;
  v_response_ms int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  -- Lock the session for the rest of the transaction. This serialises answers
  -- within a session and, more importantly, blocks a concurrent finalize from
  -- reading a half-written answer.
  select s.user_id, s.status into v_owner, v_status
  from public.test_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja testu nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'Ta sesja testu jest już zakończona.' using errcode = 'FL409';
  end if;

  select i.answered_at, i.is_correct into v_answered_at, v_stored
  from public.test_session_items i
  where i.session_id = p_session_id and i.question_id = p_question_id;
  if not found then
    raise exception 'To pytanie nie należy do tej sesji.' using errcode = 'FL410';
  end if;

  select q.correct_idx, coalesce(array_length(q.options, 1), 0)
    into v_correct_idx, v_options
  from public.questions q where q.id = p_question_id;
  if not found then
    raise exception 'To pytanie nie istnieje.' using errcode = 'FL410';
  end if;

  if v_answered_at is not null then
    return query select v_stored, v_correct_idx, true;
    return;
  end if;

  if p_selected_idx is null or p_selected_idx < 0 or p_selected_idx >= v_options then
    raise exception 'Nieprawidłowy numer odpowiedzi.' using errcode = 'FL422';
  end if;

  -- `response_ms` comes from the browser's clock, so it is analytics data, not
  -- evidence: negatives and absurd values are discarded rather than stored.
  v_response_ms := case
    when p_response_ms is null or p_response_ms < 0 then null
    else least(p_response_ms, 3600000)
  end;

  update public.test_session_items i
     set selected_idx = p_selected_idx,
         is_correct   = (p_selected_idx = v_correct_idx),
         response_ms  = v_response_ms,
         answered_at  = now()
   where i.session_id  = p_session_id
     and i.question_id = p_question_id
     and i.answered_at is null;

  return query select (p_selected_idx = v_correct_idx), v_correct_idx, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. TEST SESSION LIFECYCLE — atomic, idempotent finalize.
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything a finished test changes happens here, in ONE transaction: attempts,
-- the per-text completion, the profile rating, the daily streak and the session
-- row itself. If any step raises, the whole thing rolls back — there is no state
-- where the learner has a completion but no rating change, or a streak bump for
-- a test that was never recorded.
--
-- WHY THE RATING ARRIVES AS A PARAMETER: the Elo maths (`scoreTest`) and the
-- CEFR promotion gate (`gatePromotion`) live in `src/lib/` with unit tests, and
-- duplicating them in PL/pgSQL would guarantee drift. So the *number* is
-- computed by trusted server code and this function owns the *transaction*. The
-- parameters are therefore not client input, and the grants below enforce that:
-- EXECUTE is revoked from anon/authenticated and granted only to `service_role`,
-- a credential that exists solely on the server. A browser cannot reach this
-- function at all.
--
-- What is NOT trusted even from that caller: `correct` and `total` are counted
-- from the stored session items, never passed in; the session's owner is checked
-- against `p_user_id`; and `p_ability_before` must still match the profile, so a
-- rating computed from a stale read is rejected (FL422) rather than applied.
--
-- IDEMPOTENCY: a second call on an already-completed session writes nothing and
-- returns the stored result, so a retry, a double submit or a refresh of the
-- results page can never score the same test twice.
create or replace function public.finalize_test_session(
  p_session_id       uuid,
  p_user_id          uuid,
  p_ability_before   numeric,
  p_ability_after    numeric,
  p_rd_after         numeric,
  p_cefr_estimate    text,
  p_promotion_streak int,
  p_passed           boolean
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

  -- 5. Seal the session. From here it is an immutable result.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. CALIBRATION SESSION LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.start_calibration_session()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_session uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  -- A leftover in-progress placement test is abandoned rather than resumed: the
  -- adaptive item selection keeps no persisted cursor, so a half-finished run
  -- cannot be picked up mid-way. Abandoning it frees the partial unique index.
  update public.calibration_sessions s
     set status = 'abandoned', completed_at = now()
   where s.user_id = v_user and s.status = 'in_progress';

  begin
    insert into public.calibration_sessions (user_id)
    values (v_user)
    returning id into v_session;
  exception when unique_violation then
    -- Lost a race with another tab: adopt the session that won.
    select s.id into v_session
    from public.calibration_sessions s
    where s.user_id = v_user and s.status = 'in_progress';
  end;

  return v_session;
end;
$$;

-- Grade one placement item and record it against the session. As with the
-- reading test, the answer key is revealed only for an item the caller has just
-- committed an answer to, inside their own in-progress session.
create or replace function public.answer_calibration_question(
  p_session_id   uuid,
  p_question_id  bigint,
  p_selected_idx int,
  p_response_ms  int
)
returns table (
  is_answer_correct boolean,
  answer_key_idx    int,
  item_difficulty   int,
  already_answered  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := auth.uid();
  v_owner       uuid;
  v_status      text;
  v_stored      boolean;
  v_is_correct  boolean;
  v_correct_idx int;
  v_difficulty  int;
  v_options     int;
  v_response_ms int;
  v_position    int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id, s.status into v_owner, v_status
  from public.calibration_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja testu nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'Ta sesja testu jest już zakończona.' using errcode = 'FL409';
  end if;

  select c.correct_idx, c.difficulty, coalesce(array_length(c.options, 1), 0)
    into v_correct_idx, v_difficulty, v_options
  from public.calibration_questions c where c.id = p_question_id;
  if not found then
    raise exception 'To pytanie nie istnieje.' using errcode = 'FL410';
  end if;

  select i.is_correct into v_stored
  from public.calibration_session_items i
  where i.session_id = p_session_id and i.question_id = p_question_id;
  if found then
    return query select v_stored, v_correct_idx, v_difficulty, true;
    return;
  end if;

  if p_selected_idx is null or p_selected_idx < 0 or p_selected_idx >= v_options then
    raise exception 'Nieprawidłowy numer odpowiedzi.' using errcode = 'FL422';
  end if;

  v_response_ms := case
    when p_response_ms is null or p_response_ms < 0 then null
    else least(p_response_ms, 3600000)
  end;

  select coalesce(max(i.item_position), 0) + 1 into v_position
  from public.calibration_session_items i where i.session_id = p_session_id;

  v_is_correct := (p_selected_idx = v_correct_idx);

  insert into public.calibration_session_items
    (session_id, question_id, item_position, item_difficulty,
     selected_idx, is_correct, response_ms)
  values (p_session_id, p_question_id, v_position, v_difficulty,
          p_selected_idx, v_is_correct, v_response_ms)
  on conflict (session_id, question_id) do nothing;

  return query select v_is_correct, v_correct_idx, v_difficulty, false;
end;
$$;

-- The stored answers of a placement session, in the order they were given —
-- everything the server needs to REPLAY the adaptive rating from scratch instead
-- of believing a number the browser computed.
-- Dropped first so this migration stays re-runnable. A later migration widens
-- this function's RETURNS TABLE with the answer timestamps the learning engine
-- needs; re-running the whole history (or `schema.sql`, which concatenates it)
-- would then ask `create or replace` to narrow the return type again, which
-- Postgres refuses. Dropping by argument signature removes whichever version is
-- present, and the later migration puts its own back.
drop function if exists public.get_calibration_session_answers(uuid);

create or replace function public.get_calibration_session_answers(p_session_id uuid)
returns table (
  question_id     bigint,
  item_position   int,
  item_difficulty int,
  is_correct      boolean
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
  select i.question_id, i.item_position, i.item_difficulty, i.is_correct
  from public.calibration_session_items i
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- Persist a replayed placement result. Same trust model as
-- `finalize_test_session`: service-role only, atomic, idempotent — and the
-- rating it writes was replayed by the server from `calibration_session_items`,
-- so the client contributes nothing but the session id.
create or replace function public.finalize_calibration_session(
  p_session_id    uuid,
  p_user_id       uuid,
  p_ability       numeric,
  p_rd            numeric,
  p_cefr_estimate text
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. EXECUTE PRIVILEGES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default, which for a SECURITY DEFINER
-- function means "anyone who can reach the database", including the `anon` role
-- behind the public API key. Every function is therefore revoked first and
-- granted back only to the roles that genuinely need it.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.is_admin()',
    'public.handle_new_user()',
    'public.touch_updated_at()',
    'public.prevent_role_change()',
    'public.guard_profile_server_fields()',
    'public.cefr_for_ability(numeric)',
    'public.apply_daily_streak(uuid)',
    'public.bump_word_review()',
    'public.set_manual_level(numeric, numeric)',
    'public.start_test_session(bigint)',
    'public.get_test_session(uuid)',
    'public.answer_test_question(uuid, bigint, int, int)',
    'public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean)',
    'public.start_calibration_session()',
    'public.answer_calibration_question(uuid, bigint, int, int)',
    'public.get_calibration_session_answers(uuid)',
    'public.finalize_calibration_session(uuid, uuid, numeric, numeric, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
  end loop;
end $$;

-- Evaluated inside RLS policies for both signed-in and anonymous readers.
grant execute on function public.is_admin() to anon, authenticated;

-- Reachable by a signed-in learner. Each derives the acting user from auth.uid()
-- and checks ownership itself — none of them takes a user id.
grant execute on function public.bump_word_review()                                  to authenticated;
grant execute on function public.set_manual_level(numeric, numeric)                  to authenticated;
grant execute on function public.start_test_session(bigint)                          to authenticated;
grant execute on function public.get_test_session(uuid)                              to authenticated;
grant execute on function public.answer_test_question(uuid, bigint, int, int)        to authenticated;
grant execute on function public.start_calibration_session()                         to authenticated;
grant execute on function public.answer_calibration_question(uuid, bigint, int, int) to authenticated;
grant execute on function public.get_calibration_session_answers(uuid)               to authenticated;

-- Finalization IS the learning engine. It is reachable only by trusted server
-- code holding the service-role key — never from a browser, whatever it sends.
grant execute on function public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean) to service_role;
grant execute on function public.finalize_calibration_session(uuid, uuid, numeric, numeric, text)                 to service_role;

-- `apply_daily_streak` and `cefr_for_ability` stay revoked from every role:
-- they are internal steps of the functions above, not an API. The trigger
-- functions are invoked by Postgres itself and need no EXECUTE grant at all.

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.test_sessions             enable row level security;
alter table public.test_session_items        enable row level security;
alter table public.calibration_sessions      enable row level security;
alter table public.calibration_session_items enable row level security;

-- Learners may READ their own sessions (the results screen and any future
-- history view need this) and nothing else. There is deliberately no insert,
-- update or delete policy on any of these tables: every write goes through the
-- SECURITY DEFINER functions above or the service role, both of which bypass
-- RLS. Session items carry no `correct_idx`, so reading them is safe.
drop policy if exists "own test sessions read" on public.test_sessions;
create policy "own test sessions read" on public.test_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "own test session items read" on public.test_session_items;
create policy "own test session items read" on public.test_session_items
  for select using (
    exists (
      select 1 from public.test_sessions s
      where s.id = test_session_items.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "own calibration sessions read" on public.calibration_sessions;
create policy "own calibration sessions read" on public.calibration_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "own calibration session items read" on public.calibration_session_items;
create policy "own calibration session items read" on public.calibration_session_items
  for select using (
    exists (
      select 1 from public.calibration_sessions s
      where s.id = calibration_session_items.session_id and s.user_id = auth.uid()
    )
  );

-- ATTEMPTS are an audit log written by the learning engine. Letting the owner
-- INSERT made the log forgeable — any ability_before/ability_after pair could be
-- typed straight in. Read-only from here on.
drop policy if exists "own attempts insert" on public.attempts;

-- TEXT COMPLETIONS decide which texts count as read & passed, so the same
-- applies: the engine writes them, the learner reads them.
drop policy if exists "own completions insert" on public.text_completions;
drop policy if exists "own completions update" on public.text_completions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. BACKFILL.
-- ─────────────────────────────────────────────────────────────────────────────
-- Existing learners keep their progress; only the provenance label is set, and
-- only where it can be inferred. Nothing is deleted or recomputed.
update public.profiles
   set level_source = 'test'
 where level_source = 'default' and answered > 0;

-- === END 20260913120000_test_sessions_and_progress_security.sql ===

-- === BEGIN supabase/migrations/20260913160000_learning_engine.sql ===

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

-- === END 20260913160000_learning_engine.sql ===
