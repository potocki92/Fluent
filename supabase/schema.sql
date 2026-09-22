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

-- === BEGIN supabase/migrations/20260913190000_today_engine.sql ===

-- Fluent — Today Engine: the daily learning plan, weakness practice and the
-- minimal reading state the planner needs.
--
-- WHAT THIS ADDS, AND WHY IT IS NOT JUST A DASHBOARD.
-- Phase 2 recorded what a learner knows. Nothing yet decided what they should do
-- about it: the app was a catalogue of features and the learner was the planner.
-- This migration stores the answer to "what should I do today?" so that it is a
-- durable, inspectable, historical fact rather than something a React component
-- recomputes on every render and forgets.
--
-- THE SHAPE:
--
--   daily_plans           one row per (learner, learning day)  ← unique, stable
--     daily_plan_items    the activities, snapshotted with WHY they were chosen
--
--   practice_sessions     a weakness drill, modelled on test_sessions
--     practice_session_items
--
--   text_progress         "this learner opened this passage", the one fact the
--                         planner needed that nothing recorded
--
-- THREE RULES GOVERN ALL OF IT.
--
--  1. **A plan is generated once per learning day.** `unique (user_id,
--     learning_date)` is what makes `getOrCreateTodayPlan()` idempotent under
--     concurrency; a JavaScript `if (!exists)` cannot be.
--  2. **A learning day is the LEARNER's day.** Every date here is derived from
--     `profiles.timezone`, never from the server's `current_date`. A Warsaw
--     learner at 23:30 UTC is already on tomorrow, and the plan must agree with
--     them.
--  3. **Completion is DERIVED, never asserted.** There is no "mark this done"
--     write path. `sync_daily_plan` recomputes every item's status from the
--     authoritative tables that recorded the underlying activity — review
--     events, practice sessions, text completions. That makes completion
--     idempotent by construction (it recomputes, it never increments), makes it
--     unforgeable (a learner cannot complete a drill they did not do), and makes
--     it self-healing: a session that finished while the plan write failed is
--     reconciled the next time the page is opened.
--
-- Idempotent and non-destructive, per supabase/migrations/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LEARNING PREFERENCES — the learner's day, and how long they want it.
-- ─────────────────────────────────────────────────────────────────────────────
-- `daily_word_goal` stays exactly as it is: it answers "how many cards do I want
-- to review?" and the review screen still uses it. It is the wrong unit for a
-- plan, though — a plan mixes reviews, drills and reading, and the only thing
-- those share is time. So minutes are a NEW preference alongside the old one,
-- not a replacement for it.
alter table public.profiles
  add column if not exists timezone text not null default 'Europe/Warsaw';

alter table public.profiles
  add column if not exists daily_learning_minutes int not null default 12;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_daily_learning_minutes_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_daily_learning_minutes_check
      check (daily_learning_minutes between 5 and 60);
  end if;
end $$;

-- An unknown IANA zone would make `at time zone` raise inside plan generation,
-- i.e. a bad settings value would break the home screen. Rejected at the write
-- instead — and for EVERY caller, which is why this is its own trigger rather
-- than a branch inside `guard_profile_server_fields` (that one returns early for
-- trusted callers, by design).
create or replace function public.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone
  ) then
    raise exception 'Nieznana strefa czasowa.' using errcode = 'FL422';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_validate_timezone on public.profiles;
create trigger profiles_validate_timezone
  before insert or update on public.profiles
  for each row execute function public.validate_profile_timezone();

-- THE LEARNING DAY. `current_date` in a UTC database is the server's day, which
-- is a different day from the learner's for several hours out of every 24. Every
-- date in this migration goes through here instead.
--
-- A zone that cannot be resolved falls back to UTC rather than raising: the
-- trigger above stops a bad value being stored in the first place, and a plan
-- that renders on the wrong day boundary is a far smaller failure than a home
-- screen that 500s.
create or replace function public.learning_day(
  p_timezone text,
  p_at timestamptz default now()
)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  return (p_at at time zone coalesce(nullif(p_timezone, ''), 'UTC'))::date;
exception when others then
  return (p_at at time zone 'UTC')::date;
end;
$$;

-- The instant a learning day begins, in absolute time. Used to scope "did this
-- happen today?" queries; the day runs [day_start, day_start + 1 day).
create or replace function public.learning_day_start(
  p_learning_date date,
  p_timezone text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  return (p_learning_date::timestamp at time zone coalesce(nullif(p_timezone, ''), 'UTC'));
exception when others then
  return (p_learning_date::timestamp at time zone 'UTC');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. READING STATE — the one fact the planner was missing.
-- ─────────────────────────────────────────────────────────────────────────────
-- "Continue the text you started" needs to know a text was started. Nothing
-- recorded that: `test_completions` only knows about finished tests, and an
-- in-progress `test_session` only exists once the learner reached the test.
--
-- This is DELIBERATELY the smallest possible thing — an open marker, not a
-- reader session. Scroll position, per-paragraph progress and a resumable reader
-- belong to the reading work, not here, and inventing half of them now would
-- guarantee they are rebuilt later.
create table if not exists public.text_progress (
  user_id         uuid   not null references auth.users(id) on delete cascade,
  text_id         bigint not null references public.texts(id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  last_opened_at  timestamptz not null default now(),
  open_count      int    not null default 1,
  primary key (user_id, text_id)
);

create index if not exists text_progress_user_recent_idx
  on public.text_progress (user_id, last_opened_at desc);

-- Derives the learner from auth.uid() rather than trusting a parameter, so it
-- can only ever record the caller's own reading.
create or replace function public.mark_text_opened(p_text_id bigint)
returns void
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
  if not exists (
    select 1 from public.texts t where t.id = p_text_id and t.status = 'published'
  ) then
    raise exception 'Tekst nie istnieje lub nie jest opublikowany.' using errcode = 'FL404';
  end if;

  insert into public.text_progress (user_id, text_id)
  values (v_user, p_text_id)
  on conflict (user_id, text_id) do update
    set last_opened_at = now(),
        open_count     = public.text_progress.open_count + 1;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE DAILY PLAN.
-- ─────────────────────────────────────────────────────────────────────────────
-- `algorithm_version` is not decoration. In six months the scoring will change,
-- and the only way to tell whether it changed anything for the better is to know
-- which planner produced which plan. Same reason `evidence_level` is stored: a
-- plan built from 5 observations and one built from 500 are different artefacts
-- and should not be compared as if they were the same.
create table if not exists public.daily_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- The LEARNER's date (see `learning_day`), plus the zone it was computed in,
  -- so a learner who travels does not retroactively change what "2026-09-14"
  -- meant.
  learning_date date not null,
  timezone      text not null,

  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed')),

  target_minutes    int not null,
  estimated_minutes int not null default 0,

  algorithm_version text not null,
  -- How much the planner actually had to work with. 'none' is an onboarding
  -- plan; 'high' is a genuinely personalised one. Storing it stops the product
  -- claiming personalisation it did not have.
  evidence_level text not null default 'none'
    check (evidence_level in ('none', 'low', 'medium', 'high')),

  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz
);

-- ONE PLAN PER LEARNING DAY. This index is the whole of the idempotency
-- guarantee: two tabs opening the app at the same second both try to insert, one
-- loses, and the loser adopts the winner's plan (see `create_daily_plan`).
create unique index if not exists daily_plans_user_day_idx
  on public.daily_plans (user_id, learning_date);

-- Plan history: "my last 30 days", used for the completed-day streak.
create index if not exists daily_plans_user_recent_idx
  on public.daily_plans (user_id, learning_date desc);

-- ONE ACTIVITY OF THE PLAN.
--
-- Everything needed to render it is SNAPSHOTTED here — the reason, the counts,
-- the labels — because yesterday's plan must keep showing what was recommended
-- yesterday. If the view were rebuilt from today's live weakness ranking, plan
-- history would silently rewrite itself every time the learner practised.
create table if not exists public.daily_plan_items (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.daily_plans(id) on delete cascade,
  item_position int  not null,

  -- Only activities the app can actually RUN today. A type with no screen
  -- behind it would be a dead task, so there is no 'listening' here waiting for
  -- a feature that does not exist.
  item_type text not null check (item_type in (
    'placement', 'review_due', 'weakness_practice',
    'continue_text', 'new_text', 'new_vocabulary'
  )),

  -- 'skipped' is deliberately NOT 'completed': the learner passed on it, and the
  -- planner must be able to tell the difference tomorrow.
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),

  estimated_minutes int     not null,
  priority_score    numeric not null default 0,

  -- WHY THIS TASK. Stored structurally — a code plus its data — never as a
  -- ready-made Polish sentence. The copy lives in the UI so it can be reworded
  -- (or translated) without a migration, and so the reason stays queryable.
  reason_code text  not null,
  reason_data jsonb not null default '{}'::jsonb,
  -- The individual priority signals, for tuning the algorithm. Developer-facing
  -- only; a learner is never shown a number like `dueUrgency: 0.9`.
  signals     jsonb not null default '{}'::jsonb,

  -- Progress. `completed_count` is recomputed from the underlying activity, so
  -- "4 / 8 powtórek" is a measurement rather than a claim.
  target_count    int not null default 1,
  completed_count int not null default 0,

  -- Typed references to whatever the item points at. All nullable: a review
  -- batch has no text, a reading task has no concept.
  text_id      bigint references public.texts(id) on delete set null,
  concept_code text   references public.concepts(code),
  -- Snapshot, not a join: these exact words were the recommendation, whatever
  -- the dictionary looks like later.
  word_ids     bigint[] not null default '{}'::bigint[],

  payload jsonb not null default '{}'::jsonb,

  started_at   timestamptz,
  completed_at timestamptz
);

create unique index if not exists daily_plan_items_position_idx
  on public.daily_plan_items (plan_id, item_position);

create index if not exists daily_plan_items_plan_idx
  on public.daily_plan_items (plan_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. WEAKNESS PRACTICE SESSIONS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Telling a learner "you are weak at Dativ after prepositions" and stopping
-- there is the failure mode this exists to avoid. A weakness has to be
-- practisable.
--
-- Modelled on `test_sessions` rather than reusing it: a drill has no text, is
-- not scored on Elo, must not overwrite a text completion and must not move the
-- learner's displayed level. What IS shared is the part that matters — the
-- server picks the items, each answer is written exactly once, and the answer
-- key is revealed only after the answer is committed.
create table if not exists public.practice_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  concept_code text not null references public.concepts(code),
  -- Set when the drill was started from a plan; null when the learner opened it
  -- themselves. Practice is never gated on having a plan.
  plan_item_id uuid references public.daily_plan_items(id) on delete set null,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),

  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  correct      int,
  total        int
);

-- One live drill per (learner, concept), so re-entering resumes instead of
-- silently starting a second one — the same rule test sessions use.
create unique index if not exists practice_sessions_one_active_idx
  on public.practice_sessions (user_id, concept_code)
  where status = 'in_progress';

create index if not exists practice_sessions_plan_item_idx
  on public.practice_sessions (plan_item_id)
  where plan_item_id is not null;

create index if not exists practice_sessions_user_recent_idx
  on public.practice_sessions (user_id, completed_at desc)
  where status = 'completed';

create table if not exists public.practice_session_items (
  session_id      uuid   not null references public.practice_sessions(id) on delete cascade,
  question_id     bigint not null references public.questions(id) on delete cascade,
  item_position   int    not null,
  item_difficulty int    not null,
  selected_idx    int,
  is_correct      boolean,
  response_ms     int,
  answered_at     timestamptz,
  primary key (session_id, question_id)
);

create unique index if not exists practice_session_items_position_idx
  on public.practice_session_items (session_id, item_position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. EVIDENCE FROM PRACTICE.
-- ─────────────────────────────────────────────────────────────────────────────
-- A drill answer is real evidence about a concept and must close the loop:
-- practising Dativ is exactly how a Dativ weakness stops being one. Both check
-- constraints are widened so the event log can say where it came from instead of
-- a practice answer masquerading as a reading test.
--
-- GUARDED, because widening a whitelist is only idempotent if re-running it
-- cannot NARROW one. A later migration adds more event types; without this
-- check, re-applying `schema.sql` to an already-provisioned database would try
-- to reinstate this shorter list and fail against the rows the later phase has
-- since written. The guard asks whether the value THIS migration introduces is
-- already permitted, so a fresh install still widens exactly once.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_event_type_check'
      and pg_get_constraintdef(oid) like '%''practice_answer''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_event_type_check;
    alter table public.learning_events
      add constraint learning_events_event_type_check check (event_type in (
        'test_answer', 'calibration_answer', 'review', 'practice_answer',
        'reading_lookup', 'reading_sentence_help', 'typed_recall',
        'listening_answer', 'speaking_answer', 'writing_answer'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''practice''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_source_kind_check;
    alter table public.learning_events
      add constraint learning_events_source_kind_check check (source_kind in (
        'reading_test', 'placement_test', 'review', 'practice', 'reader', 'book', 'import'
      ));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CONTENT COVERAGE — which concepts can actually be practised?
-- ─────────────────────────────────────────────────────────────────────────────
-- A weakness with no items behind it must not become a task the learner cannot
-- start. The planner checks this view before proposing a drill, and the admin
-- panel reads it to see where the item bank has holes — which is the thing that
-- limits how good the plan can get.
--
-- Exposing counts is safe: a tally of how many questions touch a concept is not
-- an answer key, and `questions` itself stays unreadable from a browser.
create or replace view public.concept_practice_pool as
  select qc.concept_code,
         count(*)::int as question_count
  from public.question_concepts qc
  join public.questions q on q.id = qc.question_id
  join public.texts t     on t.id = q.text_id and t.status = 'published'
  group by qc.concept_code;

grant select on public.concept_practice_pool to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PLAN GENERATION.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE ITEMS ARRIVE AS A PARAMETER. Same split as the Elo and knowledge work:
-- the scoring lives in `src/lib/learning/planner/`, unit-tested, and a second
-- implementation in PL/pgSQL would drift the first time either changed. This
-- function owns the TRANSACTION and the uniqueness; TypeScript owns the choice.
--
-- The obvious objection — "then a client posts `priority_score = 999999`" — is
-- answered by the grant: EXECUTE is revoked from anon/authenticated and given to
-- `service_role` only, a credential that exists solely on the server. A browser
-- cannot reach this function, so it cannot author its own plan.
--
-- CONCURRENCY: two tabs that open the app in the same second both insert. The
-- unique index makes one lose; the loser reads the winner's plan and returns it.
-- Ten calls produce one plan, which is the whole point of §8.
create or replace function public.create_daily_plan(
  p_user_id           uuid,
  p_learning_date     date,
  p_timezone          text,
  p_target_minutes    int,
  p_algorithm_version text,
  p_evidence_level    text,
  p_items             jsonb,
  -- The single documented exception to "one plan per day, generated once".
  -- An onboarding plan is a placeholder for a learner with no level; the moment
  -- the placement test gives them one, holding them to it until midnight would
  -- be absurd. Only a plan whose items are ALL placement items may be replaced,
  -- and only while none of them has been completed.
  p_replace_onboarding boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan     uuid;
  v_existing uuid;
  v_item     jsonb;
  v_minutes  int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika planu.' using errcode = 'FL401';
  end if;

  select p.id into v_existing
  from public.daily_plans p
  where p.user_id = p_user_id and p.learning_date = p_learning_date;

  if v_existing is not null and p_replace_onboarding then
    -- Replaceable only while it is still nothing but an untouched onboarding
    -- stub. Anything the learner has actually worked on is history.
    if not exists (
      select 1 from public.daily_plan_items i
      where i.plan_id = v_existing
        and (i.item_type <> 'placement' or i.status <> 'pending')
    ) then
      delete from public.daily_plans p where p.id = v_existing;
      v_existing := null;
    end if;
  end if;

  if v_existing is not null then
    return v_existing;
  end if;

  begin
    insert into public.daily_plans (
      user_id, learning_date, timezone, target_minutes,
      algorithm_version, evidence_level
    ) values (
      p_user_id, p_learning_date, p_timezone, greatest(1, p_target_minutes),
      p_algorithm_version, coalesce(p_evidence_level, 'none')
    )
    returning id into v_plan;
  exception when unique_violation then
    -- Lost the race. The winner's plan is the plan.
    select p.id into v_plan
    from public.daily_plans p
    where p.user_id = p_user_id and p.learning_date = p_learning_date;
    return v_plan;
  end;

  v_minutes := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.daily_plan_items (
      plan_id, item_position, item_type, estimated_minutes, priority_score,
      reason_code, reason_data, signals, target_count,
      text_id, concept_code, word_ids, payload
    ) values (
      v_plan,
      (v_item ->> 'item_position')::int,
      v_item ->> 'item_type',
      greatest(0, coalesce((v_item ->> 'estimated_minutes')::int, 0)),
      coalesce((v_item ->> 'priority_score')::numeric, 0),
      v_item ->> 'reason_code',
      coalesce(v_item -> 'reason_data', '{}'::jsonb),
      coalesce(v_item -> 'signals', '{}'::jsonb),
      greatest(1, coalesce((v_item ->> 'target_count')::int, 1)),
      (v_item ->> 'text_id')::bigint,
      v_item ->> 'concept_code',
      coalesce(
        array(select jsonb_array_elements_text(v_item -> 'word_ids')::bigint),
        array[]::bigint[]
      ),
      coalesce(v_item -> 'payload', '{}'::jsonb)
    );
    v_minutes := v_minutes + greatest(0, coalesce((v_item ->> 'estimated_minutes')::int, 0));
  end loop;

  update public.daily_plans p set estimated_minutes = v_minutes where p.id = v_plan;

  return v_plan;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PLAN PROGRESS — derived, never asserted.
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS IS THE FUNCTION THAT MAKES COMPLETION TRUSTWORTHY. There is no
-- "mark item complete" endpoint anywhere in Fluent. Instead each item type knows
-- how to MEASURE itself against the table that authoritatively recorded the
-- activity:
--
--   review_due        → review_events written inside the learner's day
--   weakness_practice → a completed practice_session pointing at this item
--   continue_text     → a text_completions row written inside the day
--   new_text          → likewise
--   new_vocabulary    → review_events for the specific words recommended
--   placement         → the learner now has a level that is not 'default'
--
-- Three properties follow from recomputing rather than incrementing:
--
--  * **Idempotent.** Calling it twenty times, or refreshing the page mid-session,
--    produces the same numbers. There is no counter to double-count.
--  * **Unforgeable.** A learner cannot complete a drill they did not do; the only
--    way to move an item is to do the underlying activity, which writes to a
--    table they cannot write to either.
--  * **Self-healing.** If a practice session committed but the plan write did
--    not, the next page load reconciles it — without re-applying any learning
--    progress, because nothing here touches knowledge state.
--
-- Safe to expose to the learner (it derives the user from auth.uid() and writes
-- only values it computed), which is what lets the Today page reconcile itself.
create or replace function public.sync_daily_plan(p_plan_id uuid)
returns table (
  item_id         uuid,
  item_status     text,
  completed_count int,
  plan_status     text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user       uuid := auth.uid();
  v_plan       public.daily_plans%rowtype;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_item       public.daily_plan_items%rowtype;
  v_done       int;
  v_status     text;
  v_vocab_ids  bigint[];
  v_open       int;
  v_completed  int;
  v_plan_state text;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_plan from public.daily_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'Plan nie istnieje.' using errcode = 'FL404';
  end if;
  if v_plan.user_id <> v_user then
    raise exception 'Brak dostępu do tego planu.' using errcode = 'FL403';
  end if;

  v_day_start := public.learning_day_start(v_plan.learning_date, v_plan.timezone);
  v_day_end   := v_day_start + interval '1 day';

  -- Words this plan is teaching as NEW. Reviews of those belong to the
  -- new-vocabulary item, so they must not also be counted as due reviews —
  -- otherwise one card would tick two boxes.
  select coalesce(array_agg(w), array[]::bigint[]) into v_vocab_ids
  from (
    select distinct unnest(i.word_ids) as w
    from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.item_type = 'new_vocabulary'
  ) t;

  for v_item in
    select * from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position
  loop
    -- A learner's own decision to skip is never overturned by a measurement.
    if v_item.status = 'skipped' then
      continue;
    end if;

    v_done := 0;

    if v_item.item_type = 'review_due' then
      select count(*)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and not (r.word_id = any (v_vocab_ids));

    elsif v_item.item_type = 'new_vocabulary' then
      select count(distinct r.word_id)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and r.word_id = any (v_item.word_ids);

    elsif v_item.item_type = 'weakness_practice' then
      -- The drill itself is the record. `total` is how many items it scored.
      select coalesce(max(s.total), 0)::int into v_done
      from public.practice_sessions s
      where s.plan_item_id = v_item.id and s.status = 'completed';
      if v_done = 0 then
        -- Started but unfinished: show real partial progress rather than zero.
        select count(*)::int into v_done
        from public.practice_session_items pi
        join public.practice_sessions s on s.id = pi.session_id
        where s.plan_item_id = v_item.id
          and s.status = 'in_progress'
          and pi.answered_at is not null;
      end if;

    elsif v_item.item_type in ('continue_text', 'new_text') then
      if exists (
        select 1 from public.text_completions c
        where c.user_id = v_user and c.text_id = v_item.text_id
          and c.completed_at >= v_day_start and c.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif exists (
        select 1 from public.test_sessions s
        where s.user_id = v_user and s.text_id = v_item.text_id
          and s.status = 'in_progress'
      ) or exists (
        select 1 from public.text_progress tp
        where tp.user_id = v_user and tp.text_id = v_item.text_id
          and tp.last_opened_at >= v_day_start and tp.last_opened_at < v_day_end
      ) then
        -- Opened or mid-test: in progress, but not finished.
        v_done := 0;
      end if;

    elsif v_item.item_type = 'placement' then
      if exists (
        select 1 from public.profiles p
        where p.id = v_user and p.level_source <> 'default'
      ) then
        v_done := v_item.target_count;
      end if;
    end if;

    v_done := least(greatest(v_done, 0), v_item.target_count);

    if v_done >= v_item.target_count then
      v_status := 'completed';
    elsif v_done > 0 or (
      v_item.item_type in ('continue_text', 'new_text') and exists (
        select 1 from public.text_progress tp
        where tp.user_id = v_user and tp.text_id = v_item.text_id
          and tp.last_opened_at >= v_day_start and tp.last_opened_at < v_day_end
      )
    ) then
      v_status := 'in_progress';
    else
      v_status := 'pending';
    end if;

    update public.daily_plan_items i
       set completed_count = v_done,
           status          = v_status,
           -- Timestamps are written once: the first time the item moved, and the
           -- first time it finished. A later recount never rewrites them.
           started_at      = case when i.started_at is null and v_status <> 'pending'
                                  then now() else i.started_at end,
           completed_at    = case when v_status = 'completed'
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_item.id;
  end loop;

  -- PLAN STATUS. A plan is done when nothing is left to do: every item is either
  -- completed or was deliberately skipped, and at least one was actually
  -- completed. Requiring the completion is what stops "skip everything" from
  -- counting as a day of learning.
  select count(*) filter (where i.status in ('pending', 'in_progress'))::int,
         count(*) filter (where i.status = 'completed')::int
    into v_open, v_completed
  from public.daily_plan_items i where i.plan_id = p_plan_id;

  if v_open = 0 and v_completed > 0 then
    v_plan_state := 'completed';
  elsif v_completed > 0 or exists (
    select 1 from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.status in ('in_progress', 'skipped')
  ) then
    v_plan_state := 'in_progress';
  else
    v_plan_state := 'pending';
  end if;

  update public.daily_plans p
     set status       = v_plan_state,
         started_at   = case when p.started_at is null and v_plan_state <> 'pending'
                             then now() else p.started_at end,
         completed_at = case when v_plan_state = 'completed'
                             then coalesce(p.completed_at, now()) else null end
   where p.id = p_plan_id;

  return query
    select i.id, i.status, i.completed_count, v_plan_state
    from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position;
end;
$$;

-- "Not today." Sets `skipped` — never `completed` — so the planner can tell the
-- difference, and so a skip can never be used to fake a finished day.
create or replace function public.skip_daily_plan_item(p_item_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_owner uuid;
  v_state text;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select p.user_id, i.status into v_owner, v_state
  from public.daily_plan_items i
  join public.daily_plans p on p.id = i.plan_id
  where i.id = p_item_id;
  if not found then
    raise exception 'Zadanie nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tego zadania.' using errcode = 'FL403';
  end if;
  -- Something already finished stays finished; skipping it would erase a real
  -- result to make the screen tidier.
  if v_state = 'completed' then
    return v_state;
  end if;

  update public.daily_plan_items i set status = 'skipped' where i.id = p_item_id;
  return 'skipped';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PRACTICE LIFECYCLE — start.
-- ─────────────────────────────────────────────────────────────────────────────
-- ITEM SELECTION IS THE INTERESTING PART. A bank of five Dativ questions drilled
-- every morning teaches the learner the position of the right button, not the
-- case system. So items are ordered by how long ago the learner last SAW them:
-- never-seen first, then the stalest, with a random tiebreak so two runs of the
-- same bank are not the same run.
--
-- `learning_events_user_question_idx` backs the lookup, so this stays a bounded
-- read per candidate item and not a scan of the learner's history.
--
-- This is deliberately not psychometrics. When items are eventually generated
-- rather than drawn from a fixed bank, this ordering is what gets replaced.
create or replace function public.start_practice_session(
  p_concept_code text,
  p_plan_item_id uuid default null,
  p_limit        int  default 4
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_session uuid;
  v_limit   int  := greatest(1, least(coalesce(p_limit, 4), 10));
  v_count   int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not exists (select 1 from public.concepts c where c.code = p_concept_code) then
    raise exception 'Nieznane zagadnienie.' using errcode = 'FL404';
  end if;

  -- A plan item may only be attached by the learner who owns it.
  if p_plan_item_id is not null and not exists (
    select 1 from public.daily_plan_items i
    join public.daily_plans p on p.id = i.plan_id
    where i.id = p_plan_item_id and p.user_id = v_user
  ) then
    raise exception 'Brak dostępu do tego zadania.' using errcode = 'FL403';
  end if;

  -- Resume rather than duplicate.
  select s.id into v_session
  from public.practice_sessions s
  where s.user_id = v_user and s.concept_code = p_concept_code
    and s.status = 'in_progress';
  if v_session is not null then
    -- Re-attach a resumed drill to the plan item that asked for it, so finishing
    -- it still moves today's plan.
    if p_plan_item_id is not null then
      update public.practice_sessions s
         set plan_item_id = p_plan_item_id
       where s.id = v_session and s.plan_item_id is distinct from p_plan_item_id;
    end if;
    return v_session;
  end if;

  select count(*)::int into v_count
  from public.question_concepts qc
  join public.questions q on q.id = qc.question_id
  join public.texts t     on t.id = q.text_id and t.status = 'published'
  where qc.concept_code = p_concept_code;
  if v_count = 0 then
    -- The planner checks `concept_practice_pool` before ever proposing a drill,
    -- so reaching this means the bank changed underneath a plan. Refusing is
    -- right: an empty drill is worse than no drill.
    raise exception 'Brak pytań do ćwiczenia tego zagadnienia.' using errcode = 'FL404';
  end if;

  begin
    insert into public.practice_sessions (user_id, concept_code, plan_item_id)
    values (v_user, p_concept_code, p_plan_item_id)
    returning id into v_session;
  exception when unique_violation then
    select s.id into v_session
    from public.practice_sessions s
    where s.user_id = v_user and s.concept_code = p_concept_code
      and s.status = 'in_progress';
    return v_session;
  end;

  -- The inner query decides WHICH items (stalest first); `rnd` is materialised
  -- per row so the outer window can shuffle the order they are asked in without
  -- re-rolling a volatile function mid-sort.
  insert into public.practice_session_items
    (session_id, question_id, item_position, item_difficulty)
  select v_session, chosen.id,
         row_number() over (order by chosen.rnd),
         chosen.difficulty
  from (
    select q.id, q.difficulty, random() as rnd
    from public.question_concepts qc
    join public.questions q on q.id = qc.question_id
    join public.texts t     on t.id = q.text_id and t.status = 'published'
    left join lateral (
      select max(e.occurred_at) as last_at
      from public.learning_events e
      where e.user_id = v_user and e.question_id = q.id
    ) seen on true
    where qc.concept_code = p_concept_code
    order by seen.last_at asc nulls first, random()
    limit v_limit
  ) chosen;

  return v_session;
end;
$$;

-- Read a drill's snapshot. Prompts and options — never `correct_idx`.
create or replace function public.get_practice_session(p_session_id uuid)
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

  select s.user_id into v_owner from public.practice_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja ćwiczenia nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.question_id, i.item_position, q.prompt, q.options, i.item_difficulty,
         i.selected_idx, i.is_correct, i.answered_at
  from public.practice_session_items i
  join public.questions q on q.id = i.question_id
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- Answer one drill item. Identical trust model to `answer_test_question`: the
-- key is revealed only for an item in the caller's own in-progress session, and
-- only once their single answer to it has been committed. The first answer wins.
create or replace function public.answer_practice_question(
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

  select s.user_id, s.status into v_owner, v_status
  from public.practice_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja ćwiczenia nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'To ćwiczenie zostało już zakończone.' using errcode = 'FL409';
  end if;

  select i.answered_at, i.is_correct into v_answered_at, v_stored
  from public.practice_session_items i
  where i.session_id = p_session_id and i.question_id = p_question_id;
  if not found then
    raise exception 'To pytanie nie należy do tego ćwiczenia.' using errcode = 'FL410';
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

  v_response_ms := case
    when p_response_ms is null or p_response_ms < 0 then null
    else least(p_response_ms, 3600000)
  end;

  update public.practice_session_items i
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
-- 10. PRACTICE LIFECYCLE — finalize.
-- ─────────────────────────────────────────────────────────────────────────────
-- Sealing the drill, writing its evidence and moving the plan item happen in ONE
-- transaction. That closes the gap §84 is about: there is no state where the
-- drill is finished, the concept state moved, and today's plan still shows it as
-- pending forever.
--
-- What a drill deliberately does NOT touch: Elo ability, CEFR, `attempts`,
-- `text_completions`, the reading streak. Practising a weakness is not a graded
-- test and must not move the learner's displayed level.
--
-- Idempotent: a second call returns the stored result and re-applies no evidence,
-- exactly as `finalize_test_session` does and for the same reason.
create or replace function public.finalize_practice_session(
  p_session_id uuid,
  p_user_id    uuid,
  p_evidence   jsonb
)
returns table (
  correct_count     int,
  total_count       int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session    public.practice_sessions%rowtype;
  v_total      int;
  v_correct    int;
  v_unanswered int;
begin
  select * into v_session
  from public.practice_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja ćwiczenia nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status = 'completed' then
    return query select v_session.correct, v_session.total, true;
    return;
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'To ćwiczenie zostało porzucone.' using errcode = 'FL409';
  end if;

  select count(*)::int,
         count(*) filter (where i.answered_at is null)::int,
         count(*) filter (where i.is_correct)::int
    into v_total, v_unanswered, v_correct
  from public.practice_session_items i
  where i.session_id = p_session_id;

  if v_total = 0 then
    raise exception 'To ćwiczenie nie ma pytań.' using errcode = 'FL404';
  end if;
  if v_unanswered > 0 then
    raise exception 'Odpowiedz na wszystkie pytania.' using errcode = 'FL412';
  end if;

  update public.practice_sessions s
     set status = 'completed', completed_at = now(),
         correct = v_correct, total = v_total
   where s.id = p_session_id;

  -- The loop that makes practice worth doing: these answers are evidence about
  -- the concept, so tomorrow's weakness ranking already reflects them.
  perform public.apply_learning_evidence(p_user_id, p_evidence);

  -- Same transaction as the drill, so the plan can never disagree with it.
  if v_session.plan_item_id is not null then
    update public.daily_plan_items i
       set completed_count = least(v_total, i.target_count),
           status          = case when v_total >= i.target_count then 'completed' else 'in_progress' end,
           started_at      = coalesce(i.started_at, now()),
           completed_at    = case when v_total >= i.target_count
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_session.plan_item_id
       and i.status <> 'skipped';
  end if;

  return query select v_correct, v_total, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- The split is the same one the rest of the engine uses. A learner may start a
-- drill, answer it, reconcile their own plan and skip a task — all of which
-- derive the user from auth.uid() and write only what they measured. A learner
-- may NOT author a plan or seal a drill, because both accept computed values.
revoke all on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) from public;
revoke all on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) to service_role;

revoke all on function public.finalize_practice_session(uuid, uuid, jsonb) from public;
revoke all on function public.finalize_practice_session(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.finalize_practice_session(uuid, uuid, jsonb) to service_role;

grant execute on function public.learning_day(text, timestamptz)                 to anon, authenticated;
grant execute on function public.learning_day_start(date, text)                  to anon, authenticated;
grant execute on function public.mark_text_opened(bigint)                        to authenticated;
grant execute on function public.sync_daily_plan(uuid)                           to authenticated;
grant execute on function public.skip_daily_plan_item(uuid)                      to authenticated;
grant execute on function public.start_practice_session(text, uuid, int)         to authenticated;
grant execute on function public.get_practice_session(uuid)                      to authenticated;
grant execute on function public.answer_practice_question(uuid, bigint, int, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- A plan is private, and it is READ-ONLY to the learner it belongs to. There is
-- no insert, update or delete policy on any table here — for the same reason
-- there is none on `attempts`: a plan a learner can write is a plan that proves
-- nothing, and a `priority_score` a learner can set is not a priority.
alter table public.text_progress          enable row level security;
alter table public.daily_plans            enable row level security;
alter table public.daily_plan_items       enable row level security;
alter table public.practice_sessions      enable row level security;
alter table public.practice_session_items enable row level security;

drop policy if exists "own text progress read" on public.text_progress;
create policy "own text progress read" on public.text_progress
  for select using (auth.uid() = user_id);

drop policy if exists "own daily plans read" on public.daily_plans;
create policy "own daily plans read" on public.daily_plans
  for select using (auth.uid() = user_id);

drop policy if exists "own daily plan items read" on public.daily_plan_items;
create policy "own daily plan items read" on public.daily_plan_items
  for select using (
    exists (
      select 1 from public.daily_plans p
      where p.id = daily_plan_items.plan_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "own practice sessions read" on public.practice_sessions;
create policy "own practice sessions read" on public.practice_sessions
  for select using (auth.uid() = user_id);

drop policy if exists "own practice session items read" on public.practice_session_items;
create policy "own practice session items read" on public.practice_session_items
  for select using (
    exists (
      select 1 from public.practice_sessions s
      where s.id = practice_session_items.session_id and s.user_id = auth.uid()
    )
  );

-- === END 20260913190000_today_engine.sql ===

-- === BEGIN supabase/migrations/20260914120000_reader_story_engine.sql ===

-- Fluent — Phase 4: Reader 2.0 + Story Engine foundation.
--
-- WHAT THIS REPLACES. Until now a reading passage was one row: `texts.body`, an
-- HTML string with `<mark data-lemma="…">` annotations, parsed in the browser
-- with `DOMParser` and rendered as React nodes. For a 200-word A1 passage that
-- is fine. For a book it is not a data model at all:
--
--   * there is nothing to point AT — no paragraph, no sentence, no word
--     occurrence — so a resume position, a per-sentence translation, a
--     contextual gloss or a sentence-level exercise has nowhere to attach;
--   * the whole text is one value, so opening chapter 12 of a 300 000-word book
--     means loading all 300 000 words;
--   * the markup IS the data, so changing how vocabulary is detected means
--     rewriting stored content, and the browser has to re-parse HTML on every
--     render before a single word is interactive.
--
-- Phase 4 separates CONTENT STRUCTURE from RENDERED HTML:
--
--     library_items → chapters → paragraphs → sentences → word_occurrences
--
-- Nothing about the old passages is destroyed. Every published `texts` row gets
-- a library item and a single chapter carrying `legacy_text_id`, so questions,
-- test sessions, attempts, completions and today's plan keep working against the
-- ids they already hold, while the reader reads structured content.
--
-- Idempotent and non-destructive, like every migration here: re-running it is a
-- normal event and it never drops a column or deletes a row holding progress.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. READER PREFERENCES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Reading for forty minutes is a different activity from answering eight
-- questions, and it needs its own typography. These are ORDINARY learner-owned
-- preferences — like `daily_word_goal` — so they are not listed in
-- `guard_profile_server_fields` and the learner may write them directly. Stored
-- on the profile rather than in the browser so the same book looks the same on a
-- phone and a laptop.
alter table public.profiles
  add column if not exists reader_preferences jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LIBRARY ITEMS — one model for everything that can be read.
-- ─────────────────────────────────────────────────────────────────────────────
-- A story, a book, an article and today's graded passages are the same kind of
-- thing to a reader: a titled piece of content made of chapters. Modelling them
-- separately would mean two readers, two progress models and two sets of
-- analytics for the same act of reading, which is exactly the duplication this
-- phase exists to avoid.
--
-- RIGHTS ARE PART OF THE MODEL, not a policy document. `rights` decides who may
-- see an item at all, and it exists before there is any import feature on
-- purpose: the moment a learner can bring their own EPUB, "can Fluent show this
-- to everyone?" becomes a question the database has to answer, and retrofitting
-- that answer onto a public-by-default table is how content leaks.
--
--   first_party    — written for Fluent. Ours to publish.
--   public_domain  — out of copyright. Ours to publish.
--   licensed       — publishable under a specific agreement; the agreement is
--                    recorded in `rights_note`, not assumed.
--   private_import — someone's own file. Readable by its owner and nobody else,
--                    ever, whatever `status` says.
create table if not exists public.library_items (
  id   uuid primary key default gen_random_uuid(),
  -- ID IS THE IDENTITY, the slug is a convenience. A title can be corrected, a
  -- slug can collide, and neither may ever break a stored reading position.
  slug text not null,

  title       text not null,
  subtitle    text,
  author      text,
  language    text not null default 'de',
  description text,
  cover_url   text,

  content_type text not null default 'story'
    check (content_type in ('story', 'book', 'article', 'lesson')),

  rights      text not null default 'first_party'
    check (rights in ('first_party', 'public_domain', 'licensed', 'private_import')),
  rights_note text,

  -- Set only for `private_import`. A CHECK below makes that an invariant rather
  -- than a convention.
  owner_user_id uuid references auth.users(id) on delete cascade,

  -- Where the text came from, for provenance. Free-form on purpose: this is
  -- documentation, not a switch anything branches on.
  source_type text,
  source_url  text,

  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'published', 'failed')),

  cefr_estimate text check (cefr_estimate in ('A1', 'A2', 'B1', 'B2')),
  word_count    int not null default 0,
  chapter_count int not null default 0,

  -- SOFT DELETE. Withdrawing a book must not destroy the reading history of
  -- everyone who read it, so nothing is deleted: an archived item disappears
  -- from the library and stays joinable from `learning_events`.
  archived_at  timestamptz,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- COMPATIBILITY WITH THE PASSAGES THAT ALREADY EXIST. Questions, attempts,
  -- completions, test sessions and today's plans all key on `texts.id`; a
  -- migration that renumbered them would be a rewrite of half the app for no
  -- learner-visible gain. The mapping lives here instead.
  legacy_text_id bigint references public.texts(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'library_items_private_owner_check'
  ) then
    alter table public.library_items
      add constraint library_items_private_owner_check check (
        (rights = 'private_import' and owner_user_id is not null)
        or (rights <> 'private_import' and owner_user_id is null)
      );
  end if;
end $$;

-- A slug identifies an item within its owner's space: two learners may both
-- import "Der Prozess", and neither may collide with the public library.
create unique index if not exists library_items_slug_idx
  on public.library_items (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create unique index if not exists library_items_legacy_text_idx
  on public.library_items (legacy_text_id) where legacy_text_id is not null;

-- "What can I read?" — the library listing, in one index scan.
create index if not exists library_items_published_idx
  on public.library_items (status, published_at desc) where archived_at is null;

create index if not exists library_items_owner_idx
  on public.library_items (owner_user_id, updated_at desc) where owner_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CHAPTERS — the unit of reading, and the unit of loading.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY CHAPTERS ARE A TABLE and not an array on the item: they are what a query
-- is scoped to. "Give me chapter 12" must cost the same on a 40-chapter novel as
-- on a one-chapter story, which it cannot if the book is one row. They are also
-- what progress, sessions and plan items point at, so they need ids.
--
-- PROCESSING STATE LIVES HERE, not on the item: one unparseable chapter must not
-- take a whole book off the shelf. A chapter that failed keeps its error for an
-- admin and is skipped by the reader.
create table if not exists public.chapters (
  id              uuid primary key default gen_random_uuid(),
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  -- 1-based, and part of the URL. Unique per item — see the index below.
  position int not null,
  title    text,
  subtitle text,

  -- THE SOURCE OF TRUTH FOR REPROCESSING. Keeping the raw text means a chapter
  -- can be rebuilt with a better tokenizer without going back to wherever it
  -- originally came from. It is also why `content_hash` can be trusted: it is
  -- computed from this exact value.
  source_text text not null default '',

  word_count                int not null default 0,
  paragraph_count           int not null default 0,
  sentence_count            int not null default 0,
  estimated_reading_minutes int not null default 1,
  cefr_estimate             text check (cefr_estimate in ('A1', 'A2', 'B1', 'B2')),

  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'failed')),

  -- HOW THIS CONTENT WAS BUILT. In a year the sentence splitter will behave
  -- differently, and the only way to know which chapters predate the change is
  -- to have written it down. `content_hash` + `processor_version` together are
  -- what make reprocessing a no-op when nothing would change — which is what
  -- protects every stored reading position from a pointless rebuild.
  processor_version text,
  content_hash      text,
  processed_at      timestamptz,
  processing_error  text,

  -- CONTENT QUALITY, measured rather than assumed. `dictionary_match_rate` is
  -- the share of content words Fluent can gloss; `unmatched_sample` names the
  -- ones it cannot, which is what turns a bad number into a task.
  dictionary_match_rate numeric,
  unmatched_sample      jsonb not null default '[]'::jsonb,
  vocabulary_stats      jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ORDERING IS AN INVARIANT. Two chapters at position 7 would make "next chapter"
-- ambiguous and `/library/<slug>/7` non-deterministic.
create unique index if not exists chapters_item_position_idx
  on public.chapters (library_item_id, position);

create index if not exists chapters_item_idx on public.chapters (library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. STRUCTURED CONTENT — paragraphs, sentences, occurrences.
-- ─────────────────────────────────────────────────────────────────────────────
-- PLAIN TEXT, NOT HTML. The reader renders structure; it never renders stored
-- markup. That is a security property (no sanitiser between the database and the
-- page), a portability property (the same rows can drive audio, exercises or an
-- export) and the reason a legacy `<mark>` body has to be parsed back to text on
-- the way in rather than copied across.
--
-- bigint identities rather than uuids: a 300 000-word book is ~20 000 sentences
-- and a few hundred thousand occurrences, and these are always read in position
-- order. Sequential keys keep those reads on adjacent index pages.
create table if not exists public.paragraphs (
  id         bigint generated always as identity primary key,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- 0-based within the chapter. STABLE for a given source: reading positions
  -- point at this number, so the pipeline is deterministic by requirement.
  position   int  not null,
  kind       text not null default 'paragraph'
               check (kind in ('paragraph', 'heading', 'list_item')),
  text       text not null,
  word_count int  not null default 0,
  metadata   jsonb not null default '{}'::jsonb
);

create unique index if not exists paragraphs_chapter_position_idx
  on public.paragraphs (chapter_id, position);

-- SENTENCES exist so that help can be about THIS sentence.
--
-- "Er zog sein Schwert." is where *ziehen* means "wyciągnąć" rather than
-- "ciągnąć". Without a sentence id there is nothing for a contextual
-- translation, a grammar note, an audio clip, a bookmark or a sentence-level
-- exercise to hang off, and every one of those would later require re-splitting
-- stored text and hoping the boundaries came out the same. The columns for those
-- features exist and stay NULL: Phase 4 builds the place, not the content.
create table if not exists public.sentences (
  id           bigint generated always as identity primary key,
  paragraph_id bigint not null references public.paragraphs(id) on delete cascade,
  -- Denormalised so "load this chapter" is one index scan rather than a join
  -- through paragraphs. Written by the pipeline only; nothing else may set it.
  chapter_id   uuid   not null references public.chapters(id) on delete cascade,

  position          int not null,   -- within the paragraph
  chapter_position  int not null,   -- within the chapter, for reading order
  text              text not null,
  char_start        int not null default 0,
  char_end          int not null default 0,
  word_count        int not null default 0,

  -- RESERVED, DELIBERATELY EMPTY. Generating these now would mean paying for
  -- content before the workflow that uses it exists, and generating it against a
  -- tokenizer that may still change.
  translation_pl  text,
  simplified_de   text,
  grammar_notes   jsonb,

  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists sentences_paragraph_position_idx
  on public.sentences (paragraph_id, position);

create index if not exists sentences_chapter_order_idx
  on public.sentences (chapter_id, chapter_position);

-- WORD OCCURRENCES — "this word, in this sentence, here".
--
-- `<mark data-lemma="Schwert">` was a rendering instruction. This is the datum
-- behind it: a specific token, at a specific position, resolved to a specific
-- dictionary entry. That is what lets a lookup be recorded against a place in a
-- book rather than against a string, and what a future lexeme → sense → occurrence
-- layer attaches to without any of this changing shape.
--
-- ONLY MATCHED TOKENS GET A ROW. An occurrence exists to be interacted with, and
-- a token Fluent cannot gloss has nothing to show. Unmatched content words are
-- counted and sampled on the chapter instead (`unmatched_sample`), which is what
-- makes the dictionary gap visible without storing a row per "the".
create table if not exists public.word_occurrences (
  id          bigint generated always as identity primary key,
  sentence_id bigint not null references public.sentences(id) on delete cascade,
  chapter_id  uuid   not null references public.chapters(id) on delete cascade,

  -- Index among the sentence's LEXICAL tokens, so it survives punctuation edits.
  position   int  not null,
  surface    text not null,   -- exactly as written: "zog", "Bücher"
  normalized text not null,   -- lowercased, apostrophes folded
  lemma      text not null,   -- the dictionary headword it resolved to
  word_id    bigint references public.words(id) on delete set null,
  char_start int not null default 0,
  char_end   int not null default 0,

  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists word_occurrences_sentence_position_idx
  on public.word_occurrences (sentence_id, position);

create index if not exists word_occurrences_chapter_word_idx
  on public.word_occurrences (chapter_id, word_id);

-- THE CHAPTER'S VOCABULARY, aggregated once at processing time.
--
-- Everything worth knowing before opening a chapter — how much of its vocabulary
-- a learner already knows, which five words are worth learning first — is a join
-- between this and `user_word_knowledge`. Deriving it from `word_occurrences` on
-- every render would mean scanning a few hundred thousand rows to draw one
-- progress ring.
create table if not exists public.chapter_vocabulary (
  chapter_id              uuid   not null references public.chapters(id) on delete cascade,
  word_id                 bigint not null references public.words(id) on delete cascade,
  occurrence_count        int    not null default 1,
  first_paragraph_position int   not null default 0,
  first_sentence_position  int   not null default 0,
  primary key (chapter_id, word_id)
);

create index if not exists chapter_vocabulary_word_idx
  on public.chapter_vocabulary (word_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. READING PROGRESS — resume vs furthest.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONE DESIGN DECISION THAT MATTERS HERE. A learner who scrolls back to
-- re-read the opening of a chapter is AT paragraph 3 and has READ up to
-- paragraph 80. One number cannot be both. Stored as one, either the bookmark is
-- wrong or the progress bar collapses from 80% to 4% because someone checked
-- something — and a progress bar that goes backwards is a progress bar nobody
-- believes again.
--
--   resume_*   follows the learner, moves in both directions
--   furthest_* only ever increases, and is the ONLY input to progress and
--              completion (`greatest(...)` below, not an application `if`)
--
-- POSITIONS, NOT FOREIGN KEYS. Reprocessing a chapter replaces its paragraph
-- rows; a resume pointer that was a paragraph id would dangle or be nulled on
-- every reprocess. The pipeline is deterministic, so position 43 is position 43
-- before and after — a stable bookmark, for free.
create table if not exists public.reading_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- Denormalised so "which book am I reading?" does not need a join per chapter.
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  started_at   timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  completed_at timestamptz,

  resume_paragraph_position int not null default 0,
  resume_sentence_position  int,

  furthest_paragraph_position int not null default 0,
  progress_ratio numeric not null default 0 check (progress_ratio between 0 and 1),

  -- Reading behaviour, accumulated across every session on this chapter. These
  -- are what a lookup RATE is computed from later — "one word in 9" in chapter
  -- one and "one in 31" in chapter twenty is the reader's headline metric, and
  -- it needs both halves.
  active_seconds int not null default 0,
  lookup_count   int not null default 0,
  session_count  int not null default 0,

  primary key (user_id, chapter_id)
);

create index if not exists reading_progress_user_recent_idx
  on public.reading_progress (user_id, last_read_at desc);

create index if not exists reading_progress_user_item_idx
  on public.reading_progress (user_id, library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. READING SESSIONS — one sitting with a chapter.
-- ─────────────────────────────────────────────────────────────────────────────
-- ACTIVE TIME, NOT WALL TIME. A tab left open for two hours is not two hours of
-- reading, and recording it as such would poison every metric built on top of it
-- — reading speed, lookup rate, the chapter summary, and eventually a
-- personalised time estimate. The reader accumulates seconds only while the
-- document is visible and something happened recently, reports increments, and
-- this table caps what one report may add. The result is not laboratory-accurate
-- and is not fiction either.
create table if not exists public.reading_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  started_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at       timestamptz,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'ended')),

  active_seconds  int not null default 0,
  words_progressed int not null default 0,
  progress_before numeric not null default 0,
  progress_after  numeric not null default 0,

  lookup_count        int not null default 0,
  unique_lookup_count int not null default 0,
  sentence_help_count int not null default 0,
  saved_word_count    int not null default 0
);

create index if not exists reading_sessions_user_chapter_idx
  on public.reading_sessions (user_id, chapter_id, started_at desc);

create index if not exists reading_sessions_user_recent_idx
  on public.reading_sessions (user_id, started_at desc);

-- ONE ACTIVE SESSION PER CHAPTER. Two tabs on the same chapter must share a
-- session or the summary counts everything twice.
create unique index if not exists reading_sessions_one_active_idx
  on public.reading_sessions (user_id, chapter_id) where status = 'in_progress';

-- WHICH WORD, IN WHICH SENTENCE, IN WHICH CHAPTER, WHEN.
--
-- `learning_events` already records that a lookup happened and what it is worth
-- to the knowledge model. This table is the reading-behaviour half: it is what
-- "you looked *Schwert* up five times, in five different chapters" is computed
-- from, and what a future "words you keep checking" view reads. Deliberately not
-- shown to a learner yet — the data has to exist before the feature can be
-- honest about it.
create table if not exists public.reading_lookups (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  session_id      uuid references public.reading_sessions(id) on delete set null,

  -- Nulled rather than cascaded when a chapter is reprocessed: the fact that the
  -- word was looked up here survives, the exact token does not have to.
  sentence_id   bigint references public.sentences(id) on delete set null,
  occurrence_id bigint references public.word_occurrences(id) on delete set null,
  word_id       bigint not null references public.words(id) on delete cascade,

  -- IDEMPOTENCY. Minted per tap, so a retried Server Action settles the same
  -- lookup instead of counting the word as unknown twice. The unique constraint
  -- is what makes that a guarantee rather than a debounce.
  interaction_id text not null,
  looked_up_at   timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reading_lookups_interaction_unique'
  ) then
    alter table public.reading_lookups
      add constraint reading_lookups_interaction_unique unique (user_id, interaction_id);
  end if;
end $$;

create index if not exists reading_lookups_user_word_idx
  on public.reading_lookups (user_id, word_id, looked_up_at desc);

create index if not exists reading_lookups_session_idx
  on public.reading_lookups (session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. THE EVIDENCE LOG LEARNS ABOUT READING.
-- ─────────────────────────────────────────────────────────────────────────────
-- `learning_events` was built for this: "when books arrive, a paragraph lookup
-- is source_kind = 'book' plus a new nullable id column; nothing about this
-- table has to be rebuilt." These are those columns.
--
-- ON DELETE SET NULL, not cascade. Deleting a private import must remove the
-- CONTENT, not the learner's history of having learned from it — the evidence
-- that they looked a word up stays, detached from the book that is gone.
alter table public.learning_events
  add column if not exists library_item_id uuid references public.library_items(id) on delete set null;
alter table public.learning_events
  add column if not exists chapter_id uuid references public.chapters(id) on delete set null;
alter table public.learning_events
  add column if not exists sentence_id bigint references public.sentences(id) on delete set null;
alter table public.learning_events
  add column if not exists word_occurrence_id bigint references public.word_occurrences(id) on delete set null;
alter table public.learning_events
  add column if not exists reading_session_id uuid references public.reading_sessions(id) on delete set null;

-- Guarded for the same reason as the equivalent block in the Today-engine
-- migration: a whitelist may only ever be widened by a re-run, never narrowed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_event_type_check'
      and pg_get_constraintdef(oid) like '%''reading_chapter_started''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_event_type_check;
    alter table public.learning_events
      add constraint learning_events_event_type_check check (event_type in (
        'test_answer', 'calibration_answer', 'review', 'practice_answer',
        -- produced by the reader
        'reading_lookup', 'reading_chapter_started', 'reading_chapter_completed',
        -- accepted by the model, produced by nothing yet
        'reading_sentence_help', 'reading_resume', 'typed_recall',
        'listening_answer', 'speaking_answer', 'writing_answer'
      ));
  end if;
end $$;

create index if not exists learning_events_user_chapter_idx
  on public.learning_events (user_id, chapter_id, occurred_at desc)
  where chapter_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. A SAVED WORD REMEMBERS WHERE IT CAME FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- Saving *Schwert* while reading "Er zog sein Schwert." and reviewing it three
-- days later as a bare headword throws away the most valuable thing about it.
-- The sentence is the reason the word means anything.
--
-- `origin_context` STORES THE SENTENCE TEXT, not only a reference to it. A
-- reference would break the moment a private book is deleted or a chapter is
-- reprocessed — and a flashcard losing its context because someone tidied their
-- library is exactly the kind of quiet data loss that makes a feature untrusted.
alter table public.saved_words
  add column if not exists origin_library_item_id uuid references public.library_items(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_chapter_id uuid references public.chapters(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_sentence_id bigint references public.sentences(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_occurrence_id bigint references public.word_occurrences(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_context text;
alter table public.saved_words
  add column if not exists origin_surface text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. THE PLANNER LEARNS ABOUT CHAPTERS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 was built so that this would be additive: "adding a source later
-- (book chapters, say) means writing one generator, not reopening the ranking."
-- What the TABLE needs is somewhere to point and something to measure against.
alter table public.daily_plan_items
  add column if not exists library_item_id uuid references public.library_items(id) on delete set null;
alter table public.daily_plan_items
  add column if not exists chapter_id uuid references public.chapters(id) on delete set null;

-- HOW MUCH READING COUNTS AS HAVING DONE IT.
--
-- "Czytaj przez około 8 minut" is satisfied by eight minutes of reading, not by
-- finishing a chapter that happens to be three times that long — and equally,
-- opening a chapter is not doing it. The planner computes this number from
-- `src/lib/reading/constants.ts` and writes it here; the database only compares
-- against it, so the rule stays in one place and stays unit-tested.
alter table public.daily_plan_items
  add column if not exists target_seconds int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_plan_items'::regclass
      and conname  = 'daily_plan_items_item_type_check'
      and pg_get_constraintdef(oid) like '%''continue_chapter''%'
  ) then
    alter table public.daily_plan_items drop constraint if exists daily_plan_items_item_type_check;
    alter table public.daily_plan_items
      add constraint daily_plan_items_item_type_check check (item_type in (
        'placement', 'review_due', 'weakness_practice',
        'continue_text', 'new_text', 'new_vocabulary',
        -- Reading real content: resuming a chapter already begun, or the next one
        -- of something already being read.
        'continue_chapter', 'new_chapter'
      ));
  end if;
end $$;

create index if not exists daily_plan_items_chapter_idx
  on public.daily_plan_items (chapter_id) where chapter_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. WHO MAY READ WHAT.
-- ─────────────────────────────────────────────────────────────────────────────
-- One predicate, used by every content table, so "can this learner see this?"
-- has exactly one answer and cannot drift between chapters and sentences.
--
-- PRIVATE IMPORT IS ABSOLUTE. An item with an owner is readable by that owner
-- and by nobody else — not by another learner, not by an anonymous visitor, and
-- deliberately NOT by an admin either: a learner's own book is their document,
-- and an admin panel is not a reason to read it.
create or replace function public.library_item_readable(
  p_status    text,
  p_archived  timestamptz,
  p_owner     uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_owner is not null then p_owner = (select auth.uid())
    when p_archived is not null then public.is_admin()
    when p_status = 'published' then true
    else public.is_admin()
  end;
$$;

comment on function public.library_item_readable(text, timestamptz, uuid) is
  'Single definition of library visibility: private imports are owner-only, published first-party/public-domain/licensed content is public-read, everything else is admin-only.';

-- Who may CHANGE content. Admins — and never a private import, whoever they are.
--
-- The two predicates are separate on purpose: `library_item_readable` decides
-- visibility, this one decides authorship, and a private book is outside both
-- for an admin. An admin panel is a content tool, not a reason to open somebody's
-- personal library.
create or replace function public.library_item_writable(p_owner uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_owner is null and public.is_admin();
$$;

-- The same judgement, addressed by id, for the tables that only hold a
-- reference. `security definer` so the lookup is not itself filtered by the
-- policy it is being used to evaluate.
create or replace function public.item_is_writable(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_items i
    where i.id = p_item_id and i.owner_user_id is null
  ) and public.is_admin();
$$;

create or replace function public.chapter_is_writable(p_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chapters c
    join public.library_items i on i.id = c.library_item_id
    where c.id = p_chapter_id and i.owner_user_id is null
  ) and public.is_admin();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. THE CONTENT PIPELINE'S ONLY WRITE PATH.
-- ─────────────────────────────────────────────────────────────────────────────
-- The linguistics live in TypeScript (`src/lib/content/`), where they are pure
-- and unit-tested; this function owns the TRANSACTION. Same contract as
-- `finalize_test_session` and `apply_review`: the database does not re-implement
-- the arithmetic, and the application does not attempt atomicity.
--
-- REPROCESSING IS SAFE. Paragraphs are replaced wholesale (sentences and
-- occurrences cascade), which is the only way to guarantee no duplicates — an
-- upsert on "position" would leave orphans behind whenever a chapter got
-- shorter. Reading positions survive because they are POSITIONS, not ids, and
-- the pipeline is deterministic.
--
-- service_role only: it accepts computed structure, so a browser must never
-- reach it.
create or replace function public.replace_chapter_content(
  p_chapter_id uuid,
  p_payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter      public.chapters%rowtype;
  v_paragraph    jsonb;
  v_sentence     jsonb;
  v_occurrence   jsonb;
  v_paragraph_id bigint;
  v_sentence_id  bigint;
  v_word_count   int;
  v_item_words   int;
  v_item_chapters int;
begin
  select * into v_chapter from public.chapters c where c.id = p_chapter_id for update;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  delete from public.paragraphs p where p.chapter_id = p_chapter_id;
  delete from public.chapter_vocabulary v where v.chapter_id = p_chapter_id;

  for v_paragraph in
    select value from jsonb_array_elements(coalesce(p_payload -> 'paragraphs', '[]'::jsonb))
  loop
    insert into public.paragraphs (chapter_id, position, kind, text, word_count)
    values (
      p_chapter_id,
      (v_paragraph ->> 'position')::int,
      coalesce(v_paragraph ->> 'kind', 'paragraph'),
      v_paragraph ->> 'text',
      coalesce((v_paragraph ->> 'word_count')::int, 0)
    )
    returning id into v_paragraph_id;

    for v_sentence in
      select value from jsonb_array_elements(coalesce(v_paragraph -> 'sentences', '[]'::jsonb))
    loop
      insert into public.sentences (
        paragraph_id, chapter_id, position, chapter_position,
        text, char_start, char_end, word_count
      ) values (
        v_paragraph_id,
        p_chapter_id,
        (v_sentence ->> 'position')::int,
        (v_sentence ->> 'chapter_position')::int,
        v_sentence ->> 'text',
        coalesce((v_sentence ->> 'char_start')::int, 0),
        coalesce((v_sentence ->> 'char_end')::int, 0),
        coalesce((v_sentence ->> 'word_count')::int, 0)
      )
      returning id into v_sentence_id;

      for v_occurrence in
        select value from jsonb_array_elements(coalesce(v_sentence -> 'occurrences', '[]'::jsonb))
      loop
        insert into public.word_occurrences (
          sentence_id, chapter_id, position, surface, normalized, lemma,
          word_id, char_start, char_end
        ) values (
          v_sentence_id,
          p_chapter_id,
          (v_occurrence ->> 'position')::int,
          v_occurrence ->> 'surface',
          v_occurrence ->> 'normalized',
          v_occurrence ->> 'lemma',
          (v_occurrence ->> 'word_id')::bigint,
          coalesce((v_occurrence ->> 'char_start')::int, 0),
          coalesce((v_occurrence ->> 'char_end')::int, 0)
        );
      end loop;
    end loop;
  end loop;

  insert into public.chapter_vocabulary (
    chapter_id, word_id, occurrence_count,
    first_paragraph_position, first_sentence_position
  )
  select
    p_chapter_id,
    (entry ->> 'word_id')::bigint,
    coalesce((entry ->> 'occurrence_count')::int, 1),
    coalesce((entry ->> 'first_paragraph_position')::int, 0),
    coalesce((entry ->> 'first_sentence_position')::int, 0)
  from jsonb_array_elements(coalesce(p_payload -> 'vocabulary', '[]'::jsonb)) as t(entry)
  -- A dictionary row can disappear between processing and persisting; the
  -- occurrence keeps its lemma either way, the aggregate simply skips it.
  where exists (select 1 from public.words w where w.id = (entry ->> 'word_id')::bigint)
  on conflict (chapter_id, word_id) do update
    set occurrence_count = excluded.occurrence_count;

  v_word_count := coalesce((p_payload ->> 'word_count')::int, 0);

  update public.chapters c
     set word_count                = v_word_count,
         paragraph_count           = coalesce((p_payload ->> 'paragraph_count')::int, 0),
         sentence_count            = coalesce((p_payload ->> 'sentence_count')::int, 0),
         estimated_reading_minutes = greatest(1, coalesce((p_payload ->> 'estimated_reading_minutes')::int, 1)),
         processor_version         = p_payload ->> 'processor_version',
         content_hash              = p_payload ->> 'content_hash',
         dictionary_match_rate     = (p_payload ->> 'dictionary_match_rate')::numeric,
         unmatched_sample          = coalesce(p_payload -> 'unmatched_sample', '[]'::jsonb),
         vocabulary_stats          = coalesce(p_payload -> 'vocabulary_stats', '{}'::jsonb),
         status                    = 'ready',
         processing_error          = null,
         processed_at              = now(),
         updated_at                = now()
   where c.id = p_chapter_id;

  -- The item's totals are DERIVED from its chapters, never asserted, so they
  -- cannot drift away from the content they describe.
  select coalesce(sum(c.word_count), 0), count(*)
    into v_item_words, v_item_chapters
  from public.chapters c where c.library_item_id = v_chapter.library_item_id;

  update public.library_items i
     set word_count    = v_item_words,
         chapter_count = v_item_chapters,
         updated_at    = now()
   where i.id = v_chapter.library_item_id;

  return jsonb_build_object(
    'chapter_id', p_chapter_id,
    'paragraph_count', coalesce((p_payload ->> 'paragraph_count')::int, 0),
    'sentence_count', coalesce((p_payload ->> 'sentence_count')::int, 0),
    'word_count', v_word_count
  );
end;
$$;

-- A chapter that could not be processed keeps its error for an admin instead of
-- taking the whole book off the shelf. service_role only, like the success path.
create or replace function public.fail_chapter_processing(
  p_chapter_id uuid,
  p_error      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chapters c
     set status           = 'failed',
         processing_error = left(coalesce(p_error, 'Nieznany błąd przetwarzania.'), 2000),
         updated_at       = now()
   where c.id = p_chapter_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. READING — the learner-facing write paths.
-- ─────────────────────────────────────────────────────────────────────────────
-- Reading progress is PROGRESS, and progress in Fluent is server-owned: the
-- tables below have no insert or update policy at all, and every write goes
-- through one of these functions, each of which derives the learner from
-- `auth.uid()` rather than trusting a parameter.

-- Open (or re-open) a chapter, and say where to resume.
--
-- One call does three things that must not be able to disagree: it establishes
-- that this learner may read this chapter, it records that they opened it, and
-- it returns the position to scroll to. Two tabs on the same chapter share one
-- session — otherwise the chapter summary counts everything twice.
--
-- RE-RUNNABLE. A later migration (the Reading Position Engine) widens what
-- this returns, and PostgreSQL refuses to `create or replace` a function whose
-- OUT columns differ — so replaying this file on a database that already has
-- the newer shape has to drop it first. The later migration recreates it.
drop function if exists public.start_reading_session(uuid);

create or replace function public.start_reading_session(p_chapter_id uuid)
returns table (
  session_id          uuid,
  library_item_id     uuid,
  resume_paragraph    int,
  resume_sentence     int,
  furthest_paragraph  int,
  progress_ratio      numeric,
  completed_at        timestamptz,
  resumed             boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_item      uuid;
  v_status    text;
  v_session   uuid;
  v_existing  boolean := false;
  v_progress  public.reading_progress%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id, c.status into v_item, v_status
  from public.chapters c
  join public.library_items i on i.id = c.library_item_id
  where c.id = p_chapter_id
    and public.library_item_readable(i.status, i.archived_at, i.owner_user_id);

  if v_item is null then
    raise exception 'Rozdział nie istnieje lub nie masz do niego dostępu.' using errcode = 'FL404';
  end if;
  if v_status <> 'ready' then
    -- Unprocessed content is not shown to a learner: half-parsed text is worse
    -- than an honest "jeszcze nie gotowe".
    raise exception 'Rozdział nie jest jeszcze gotowy do czytania.' using errcode = 'FL412';
  end if;

  insert into public.reading_progress (user_id, chapter_id, library_item_id, session_count)
  values (v_user, p_chapter_id, v_item, 1)
  on conflict (user_id, chapter_id) do update
    set last_read_at  = now(),
        session_count = public.reading_progress.session_count + 1;

  select * into v_progress
  from public.reading_progress p
  where p.user_id = v_user and p.chapter_id = p_chapter_id;

  select s.id into v_session
  from public.reading_sessions s
  where s.user_id = v_user and s.chapter_id = p_chapter_id and s.status = 'in_progress'
  limit 1;

  if v_session is not null then
    v_existing := true;
    update public.reading_sessions s
       set last_active_at = now()
     where s.id = v_session;
  else
    insert into public.reading_sessions (
      user_id, chapter_id, library_item_id, progress_before, progress_after
    ) values (
      v_user, p_chapter_id, v_item, v_progress.progress_ratio, v_progress.progress_ratio
    )
    returning id into v_session;
  end if;

  return query select
    v_session,
    v_item,
    v_progress.resume_paragraph_position,
    v_progress.resume_sentence_position,
    v_progress.furthest_paragraph_position,
    v_progress.progress_ratio,
    v_progress.completed_at,
    v_existing;
end;
$$;

-- Record where the learner is, and how long they have actually been reading.
--
-- RESUME MOVES BOTH WAYS, FURTHEST ONLY FORWARD. That is the whole point of the
-- two columns, and `greatest(...)` is where the rule is enforced — not in the
-- application, which cannot stop a second tab reporting paragraph 2 while the
-- first is at 80.
--
-- `p_max_active_seconds` is the cap from `src/lib/reading/constants.ts`. It is a
-- PARAMETER rather than a literal so the constant stays in one place, and it is
-- applied here rather than trusted from the client so that a slept machine, a
-- paused debugger or a forged request cannot claim an hour of reading.
create or replace function public.record_reading_progress(
  p_session_id          uuid,
  p_paragraph_position  int,
  p_sentence_position   int,
  p_active_seconds      int,
  p_max_active_seconds  int
)
returns table (
  progress_ratio     numeric,
  furthest_paragraph int,
  active_seconds     int,
  words_read         int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_session    public.reading_sessions%rowtype;
  v_paragraphs int;
  v_words      int;
  v_reported   int;
  v_seconds    int;
  v_ratio      numeric;
  v_furthest   int;
  v_total      int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_session
  from public.reading_sessions s
  where s.id = p_session_id for update;

  if not found then
    raise exception 'Sesja czytania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'Ta sesja czytania została zakończona.' using errcode = 'FL409';
  end if;

  select greatest(c.paragraph_count, 1), c.word_count
    into v_paragraphs, v_words
  from public.chapters c where c.id = v_session.chapter_id;

  v_reported := least(greatest(coalesce(p_paragraph_position, 0), 0), v_paragraphs - 1);
  v_seconds  := least(
    greatest(coalesce(p_active_seconds, 0), 0),
    greatest(coalesce(p_max_active_seconds, 0), 0)
  );

  update public.reading_progress p
     set resume_paragraph_position   = v_reported,
         resume_sentence_position    = p_sentence_position,
         furthest_paragraph_position = greatest(p.furthest_paragraph_position, v_reported),
         -- The learner has read THROUGH the furthest paragraph they reached, so
         -- the last one puts the ratio at exactly 1.
         progress_ratio              = greatest(
           p.progress_ratio,
           round((greatest(p.furthest_paragraph_position, v_reported) + 1)::numeric / v_paragraphs, 4)
         ),
         active_seconds              = p.active_seconds + v_seconds,
         last_read_at                = now()
   where p.user_id = v_user and p.chapter_id = v_session.chapter_id
   returning p.progress_ratio, p.furthest_paragraph_position, p.active_seconds
        into v_ratio, v_furthest, v_total;

  if v_ratio is null then
    raise exception 'Brak postępu czytania dla tej sesji.' using errcode = 'FL404';
  end if;

  update public.reading_sessions s
     set active_seconds   = s.active_seconds + v_seconds,
         last_active_at   = now(),
         progress_after   = v_ratio,
         words_progressed = greatest(
           s.words_progressed,
           round(greatest(v_ratio - s.progress_before, 0) * coalesce(v_words, 0))::int
         )
   where s.id = p_session_id;

  return query select
    v_ratio,
    v_furthest,
    v_total,
    round(v_ratio * coalesce(v_words, 0))::int;
end;
$$;

-- Finish a chapter.
--
-- COMPLETION IS AN ACT, NOT A SIDE EFFECT. A last paragraph that renders one
-- pixel into the viewport because of a sticky footer is not a chapter that was
-- read, so this refuses unless the learner's FURTHEST position actually reached
-- `p_min_ratio` (the threshold from `src/lib/reading/constants.ts`). The UI then
-- still asks them to press the button.
--
-- Idempotent: finishing twice returns the same summary and writes nothing the
-- second time, so a double tap or a replayed action cannot inflate anything.
create or replace function public.complete_reading_chapter(
  p_session_id uuid,
  p_min_ratio  numeric
)
returns table (
  already_completed   boolean,
  words_read          int,
  active_seconds      int,
  lookup_count        int,
  unique_lookup_count int,
  saved_word_count    int,
  chapter_id          uuid,
  library_item_id     uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_session  public.reading_sessions%rowtype;
  v_progress public.reading_progress%rowtype;
  v_words    int;
  v_done     boolean := false;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_session from public.reading_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja czytania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  select * into v_progress
  from public.reading_progress p
  where p.user_id = v_user and p.chapter_id = v_session.chapter_id
  for update;

  if not found then
    raise exception 'Brak postępu czytania dla tego rozdziału.' using errcode = 'FL404';
  end if;

  v_done := v_progress.completed_at is not null;

  if not v_done and v_progress.progress_ratio < coalesce(p_min_ratio, 1) then
    raise exception 'Rozdział nie został jeszcze przeczytany do końca.' using errcode = 'FL412';
  end if;

  select c.word_count into v_words from public.chapters c where c.id = v_session.chapter_id;

  if not v_done then
    update public.reading_progress p
       set completed_at   = now(),
           progress_ratio = 1,
           last_read_at   = now()
     where p.user_id = v_user and p.chapter_id = v_session.chapter_id;
  end if;

  update public.reading_sessions s
     set status         = 'ended',
         ended_at       = coalesce(s.ended_at, now()),
         progress_after = 1,
         words_progressed = greatest(
           s.words_progressed,
           round(greatest(1 - s.progress_before, 0) * coalesce(v_words, 0))::int
         )
   where s.id = p_session_id;

  select * into v_session from public.reading_sessions s where s.id = p_session_id;

  return query select
    v_done,
    coalesce(v_words, 0),
    v_session.active_seconds,
    v_session.lookup_count,
    v_session.unique_lookup_count,
    v_session.saved_word_count,
    v_session.chapter_id,
    v_session.library_item_id;
end;
$$;

-- Seal a session without finishing the chapter — the learner simply stopped.
create or replace function public.end_reading_session(
  p_session_id         uuid,
  p_active_seconds     int,
  p_max_active_seconds int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_seconds int;
  v_chapter uuid;
begin
  if v_user is null then
    return;
  end if;

  v_seconds := least(
    greatest(coalesce(p_active_seconds, 0), 0),
    greatest(coalesce(p_max_active_seconds, 0), 0)
  );

  -- Only an session that was still open may add time. Without the guard a
  -- replayed "I am leaving" request would keep topping up the total, which is
  -- precisely the kind of quiet inflation that makes a reading-time metric
  -- worthless.
  update public.reading_sessions s
     set status         = 'ended',
         ended_at       = coalesce(s.ended_at, now()),
         last_active_at = now(),
         active_seconds = s.active_seconds + v_seconds
   where s.id = p_session_id and s.user_id = v_user and s.status = 'in_progress'
   returning s.chapter_id into v_chapter;

  if v_chapter is null then
    return;
  end if;

  update public.reading_progress p
     set active_seconds = p.active_seconds + v_seconds,
         last_read_at   = now()
   where p.user_id = v_user and p.chapter_id = v_chapter;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. A WORD LOOKED UP WHILE READING.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two things happen and they must happen together: the reading behaviour is
-- recorded (`reading_lookups`, the session counters) and the learning evidence
-- is applied (`apply_learning_evidence`). Splitting them would let a retry write
-- one without the other, and the whole point of the reader is that what happens
-- while reading reaches the knowledge model.
--
-- IDEMPOTENCY IS THE INTERESTING PART. `interaction_id` is minted per tap. The
-- unique constraint decides whether this is a new lookup; evidence is applied
-- ONLY on a genuinely new row. Without that guard a retried request would count
-- the same word as unknown twice — and since a lookup is negative evidence, a
-- flaky connection would slowly convince Fluent the learner knows less than they
-- do.
--
-- service_role only: it takes a user id.
create or replace function public.apply_reading_lookup(
  p_user_id        uuid,
  p_interaction_id text,
  p_chapter_id     uuid,
  p_word_id        bigint,
  p_sentence_id    bigint,
  p_occurrence_id  bigint,
  p_session_id     uuid,
  p_evidence       jsonb
)
returns table (
  already_recorded    boolean,
  lookup_count        int,
  unique_lookup_count int,
  word_lookup_total   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     uuid;
  v_lookup   bigint;
  v_first    boolean := false;
  v_session  public.reading_sessions%rowtype;
  v_total    int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id into v_item from public.chapters c where c.id = p_chapter_id;
  if v_item is null then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  -- Was this word already looked up in THIS session? Decided before the insert,
  -- so "unique words looked up" stays a count of words rather than of taps.
  if p_session_id is not null then
    v_first := not exists (
      select 1 from public.reading_lookups l
      where l.session_id = p_session_id and l.word_id = p_word_id
    );
  end if;

  insert into public.reading_lookups (
    user_id, chapter_id, library_item_id, session_id,
    sentence_id, occurrence_id, word_id, interaction_id
  ) values (
    p_user_id, p_chapter_id, v_item, p_session_id,
    p_sentence_id, p_occurrence_id, p_word_id, p_interaction_id
  )
  on conflict (user_id, interaction_id) do nothing
  returning id into v_lookup;

  select count(*)::int into v_total
  from public.reading_lookups l
  where l.user_id = p_user_id and l.word_id = p_word_id;

  if v_lookup is null then
    -- A replay. Report the stored state and change nothing.
    if p_session_id is not null then
      select * into v_session from public.reading_sessions s where s.id = p_session_id;
    end if;
    return query select
      true,
      coalesce(v_session.lookup_count, 0),
      coalesce(v_session.unique_lookup_count, 0),
      v_total;
    return;
  end if;

  if p_session_id is not null then
    update public.reading_sessions s
       set lookup_count        = s.lookup_count + 1,
           unique_lookup_count = s.unique_lookup_count + (case when v_first then 1 else 0 end),
           last_active_at      = now()
     where s.id = p_session_id
     returning * into v_session;
  end if;

  update public.reading_progress p
     set lookup_count = p.lookup_count + 1
   where p.user_id = p_user_id and p.chapter_id = p_chapter_id;

  perform public.apply_learning_evidence(p_user_id, p_evidence);

  return query select
    false,
    coalesce(v_session.lookup_count, 0),
    coalesce(v_session.unique_lookup_count, 0),
    v_total;
end;
$$;

-- Record a chapter being opened or finished as HISTORY.
--
-- These events carry no skill, no concept and no word, so the knowledge model
-- moves nothing when it folds them — having read a chapter is not evidence that
-- its language was understood, and a reader that quietly credited comprehension
-- for scrolling would be inventing exactly the knowledge Fluent refuses to
-- claim. What they buy is the reading history: when a chapter was started, when
-- it was finished, and how the lookup rate changed between chapter one and
-- chapter twenty. service_role only, like every other evidence path.
create or replace function public.apply_reading_event(
  p_user_id  uuid,
  p_evidence jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.apply_learning_evidence(p_user_id, p_evidence);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. SAVING A WORD, WITH THE SENTENCE IT CAME FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CONTEXT IS THE POINT. A learner who saved *Schwert* while reading
-- "Er zog sein Schwert." and later reviews a bare headword has lost the reason
-- the word meant anything. The sentence text is COPIED onto the card rather than
-- referenced, so deleting a private book or reprocessing a chapter cannot
-- silently empty it.
--
-- The origin is derived from the occurrence, not accepted from the caller, so a
-- card cannot claim to come from a sentence it never appeared in — and the
-- occurrence has to belong to content this learner may actually read.
--
-- Only a NEW card gets an origin. Re-saving a word already in the deck keeps the
-- first place it was met, which is the one worth remembering.
create or replace function public.save_word_from_reader(
  p_word_id       bigint,
  p_occurrence_id bigint
)
returns table (
  saved      boolean,
  was_new    boolean,
  context_de text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_sentence  bigint;
  v_chapter   uuid;
  v_item      uuid;
  v_context   text;
  v_surface   text;
  v_word      bigint;
  v_inserted  bigint;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  if p_occurrence_id is not null then
    select o.sentence_id, o.chapter_id, c.library_item_id, s.text, o.surface, o.word_id
      into v_sentence, v_chapter, v_item, v_context, v_surface, v_word
    from public.word_occurrences o
    join public.sentences s      on s.id = o.sentence_id
    join public.chapters c       on c.id = o.chapter_id
    join public.library_items i  on i.id = c.library_item_id
    where o.id = p_occurrence_id
      and public.library_item_readable(i.status, i.archived_at, i.owner_user_id);

    if v_sentence is null then
      raise exception 'Nie znaleźliśmy tego słowa w tekście.' using errcode = 'FL404';
    end if;
    if v_word is distinct from p_word_id then
      raise exception 'To słowo nie pasuje do wskazanego miejsca w tekście.' using errcode = 'FL422';
    end if;
  end if;

  insert into public.saved_words (
    user_id, word_id,
    origin_library_item_id, origin_chapter_id, origin_sentence_id,
    origin_occurrence_id, origin_context, origin_surface
  ) values (
    v_user, p_word_id, v_item, v_chapter, v_sentence, p_occurrence_id, v_context, v_surface
  )
  on conflict (user_id, word_id) do nothing
  returning word_id into v_inserted;

  if v_inserted is not null and p_occurrence_id is not null then
    update public.reading_sessions s
       set saved_word_count = s.saved_word_count + 1
     where s.user_id = v_user and s.chapter_id = v_chapter and s.status = 'in_progress';
  end if;

  return query select true, v_inserted is not null, v_context;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. apply_learning_evidence LEARNS THE READER'S COLUMNS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Only the event INSERT changes: five more nullable references, so a lookup can
-- say which book, chapter, sentence and occurrence it happened at. The skill,
-- concept and word-knowledge folding below is byte-for-byte the Phase 2
-- function — it is repeated here because `create or replace function` replaces
-- the whole body, not because anything about it moved.
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

  for v_event in
    select value from jsonb_array_elements(coalesce(p_payload -> 'events', '[]'::jsonb))
  loop
    v_event_id := null;

    insert into public.learning_events (
      user_id, event_key, event_type, occurred_at, skill_code,
      response_mode, retrieval_type, is_correct, response_ms, hints_used,
      source_kind, origin, text_id, question_id, calibration_question_id,
      word_id, test_session_id, calibration_session_id, review_event_id,
      library_item_id, chapter_id, sentence_id, word_occurrence_id,
      reading_session_id, metadata
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
      (v_event ->> 'library_item_id')::uuid,
      (v_event ->> 'chapter_id')::uuid,
      (v_event ->> 'sentence_id')::bigint,
      (v_event ->> 'word_occurrence_id')::bigint,
      (v_event ->> 'reading_session_id')::uuid,
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
-- 16. THE PLAN CAN NOW POINT AT A CHAPTER…
-- ─────────────────────────────────────────────────────────────────────────────
-- Three more columns on the insert. Everything else — the race on
-- `unique (user_id, learning_date)`, the onboarding-replacement rule — is the
-- Phase 3 function unchanged.
create or replace function public.create_daily_plan(
  p_user_id           uuid,
  p_learning_date     date,
  p_timezone          text,
  p_target_minutes    int,
  p_algorithm_version text,
  p_evidence_level    text,
  p_items             jsonb,
  p_replace_onboarding boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan     uuid;
  v_existing uuid;
  v_item     jsonb;
  v_minutes  int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika planu.' using errcode = 'FL401';
  end if;

  select p.id into v_existing
  from public.daily_plans p
  where p.user_id = p_user_id and p.learning_date = p_learning_date;

  if v_existing is not null and p_replace_onboarding then
    if not exists (
      select 1 from public.daily_plan_items i
      where i.plan_id = v_existing
        and (i.item_type <> 'placement' or i.status <> 'pending')
    ) then
      delete from public.daily_plans p where p.id = v_existing;
      v_existing := null;
    end if;
  end if;

  if v_existing is not null then
    return v_existing;
  end if;

  begin
    insert into public.daily_plans (
      user_id, learning_date, timezone, target_minutes,
      algorithm_version, evidence_level
    ) values (
      p_user_id, p_learning_date, p_timezone, greatest(1, p_target_minutes),
      p_algorithm_version, coalesce(p_evidence_level, 'none')
    )
    returning id into v_plan;
  exception when unique_violation then
    select p.id into v_plan
    from public.daily_plans p
    where p.user_id = p_user_id and p.learning_date = p_learning_date;
    return v_plan;
  end;

  v_minutes := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.daily_plan_items (
      plan_id, item_position, item_type, estimated_minutes, priority_score,
      reason_code, reason_data, signals, target_count,
      text_id, concept_code, word_ids, payload,
      library_item_id, chapter_id, target_seconds
    ) values (
      v_plan,
      (v_item ->> 'item_position')::int,
      v_item ->> 'item_type',
      greatest(0, coalesce((v_item ->> 'estimated_minutes')::int, 0)),
      coalesce((v_item ->> 'priority_score')::numeric, 0),
      v_item ->> 'reason_code',
      coalesce(v_item -> 'reason_data', '{}'::jsonb),
      coalesce(v_item -> 'signals', '{}'::jsonb),
      greatest(1, coalesce((v_item ->> 'target_count')::int, 1)),
      (v_item ->> 'text_id')::bigint,
      v_item ->> 'concept_code',
      coalesce(
        array(select jsonb_array_elements_text(v_item -> 'word_ids')::bigint),
        array[]::bigint[]
      ),
      coalesce(v_item -> 'payload', '{}'::jsonb),
      (v_item ->> 'library_item_id')::uuid,
      (v_item ->> 'chapter_id')::uuid,
      (v_item ->> 'target_seconds')::int
    );
    v_minutes := v_minutes + greatest(0, coalesce((v_item ->> 'estimated_minutes')::int, 0));
  end loop;

  update public.daily_plans p set estimated_minutes = v_minutes where p.id = v_plan;

  return v_plan;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. …AND MEASURE WHETHER IT WAS READ.
-- ─────────────────────────────────────────────────────────────────────────────
-- Still derived, never asserted. A reading task is done when the learner either
--
--   * finished the chapter today — `reading_progress.completed_at`, written only
--     by `complete_reading_chapter`, which itself refuses below the completion
--     threshold; or
--   * put in the reading the plan asked for — `target_seconds` of ACTIVE reading
--     on that chapter today, summed from `reading_sessions`.
--
-- OPENING A CHAPTER IS NOT DOING IT. That is the whole reason the second rule is
-- about seconds rather than about a row existing: "Czytaj przez około 8 minut"
-- has to mean eight minutes, or the plan is measuring intent instead of work.
--
-- `v_touched` replaces the repeated `exists (...)` the previous version used to
-- decide `in_progress`: each branch now says whether the learner has started the
-- activity, which is a fact the branch already knows.
create or replace function public.sync_daily_plan(p_plan_id uuid)
returns table (
  item_id         uuid,
  item_status     text,
  completed_count int,
  plan_status     text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user       uuid := (select auth.uid());
  v_plan       public.daily_plans%rowtype;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_item       public.daily_plan_items%rowtype;
  v_done       int;
  v_status     text;
  v_vocab_ids  bigint[];
  v_open       int;
  v_completed  int;
  v_plan_state text;
  v_touched    boolean;
  v_seconds    int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_plan from public.daily_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'Plan nie istnieje.' using errcode = 'FL404';
  end if;
  if v_plan.user_id <> v_user then
    raise exception 'Brak dostępu do tego planu.' using errcode = 'FL403';
  end if;

  v_day_start := public.learning_day_start(v_plan.learning_date, v_plan.timezone);
  v_day_end   := v_day_start + interval '1 day';

  select coalesce(array_agg(w), array[]::bigint[]) into v_vocab_ids
  from (
    select distinct unnest(i.word_ids) as w
    from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.item_type = 'new_vocabulary'
  ) t;

  for v_item in
    select * from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position
  loop
    if v_item.status = 'skipped' then
      continue;
    end if;

    v_done    := 0;
    v_touched := false;

    if v_item.item_type = 'review_due' then
      select count(*)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and not (r.word_id = any (v_vocab_ids));

    elsif v_item.item_type = 'new_vocabulary' then
      select count(distinct r.word_id)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and r.word_id = any (v_item.word_ids);

    elsif v_item.item_type = 'weakness_practice' then
      select coalesce(max(s.total), 0)::int into v_done
      from public.practice_sessions s
      where s.plan_item_id = v_item.id and s.status = 'completed';
      if v_done = 0 then
        select count(*)::int into v_done
        from public.practice_session_items pi
        join public.practice_sessions s on s.id = pi.session_id
        where s.plan_item_id = v_item.id
          and s.status = 'in_progress'
          and pi.answered_at is not null;
      end if;

    elsif v_item.item_type in ('continue_text', 'new_text') then
      v_touched := exists (
        select 1 from public.text_progress tp
        where tp.user_id = v_user and tp.text_id = v_item.text_id
          and tp.last_opened_at >= v_day_start and tp.last_opened_at < v_day_end
      );
      if exists (
        select 1 from public.text_completions c
        where c.user_id = v_user and c.text_id = v_item.text_id
          and c.completed_at >= v_day_start and c.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif v_touched or exists (
        select 1 from public.test_sessions s
        where s.user_id = v_user and s.text_id = v_item.text_id
          and s.status = 'in_progress'
      ) then
        v_touched := true;
      end if;

    elsif v_item.item_type in ('continue_chapter', 'new_chapter') then
      select coalesce(sum(s.active_seconds), 0)::int into v_seconds
      from public.reading_sessions s
      where s.user_id = v_user and s.chapter_id = v_item.chapter_id
        and s.started_at >= v_day_start and s.started_at < v_day_end;

      -- Opening the chapter starts the task; only READING finishes it. The two
      -- are deliberately different facts, measured from different columns.
      v_touched := exists (
        select 1 from public.reading_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.started_at >= v_day_start and s.started_at < v_day_end
      );

      if exists (
        select 1 from public.reading_progress rp
        where rp.user_id = v_user and rp.chapter_id = v_item.chapter_id
          and rp.completed_at >= v_day_start and rp.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif v_item.target_seconds is not null
        and v_item.target_seconds > 0
        and v_seconds >= v_item.target_seconds
      then
        v_done := v_item.target_count;
      end if;

    elsif v_item.item_type = 'placement' then
      if exists (
        select 1 from public.profiles p
        where p.id = v_user and p.level_source <> 'default'
      ) then
        v_done := v_item.target_count;
      end if;
    end if;

    v_done := least(greatest(v_done, 0), v_item.target_count);

    if v_done >= v_item.target_count then
      v_status := 'completed';
    elsif v_done > 0 or v_touched then
      v_status := 'in_progress';
    else
      v_status := 'pending';
    end if;

    update public.daily_plan_items i
       set completed_count = v_done,
           status          = v_status,
           started_at      = case when i.started_at is null and v_status <> 'pending'
                                  then now() else i.started_at end,
           completed_at    = case when v_status = 'completed'
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_item.id;
  end loop;

  select count(*) filter (where i.status in ('pending', 'in_progress'))::int,
         count(*) filter (where i.status = 'completed')::int
    into v_open, v_completed
  from public.daily_plan_items i where i.plan_id = p_plan_id;

  if v_open = 0 and v_completed > 0 then
    v_plan_state := 'completed';
  elsif v_completed > 0 or exists (
    select 1 from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.status in ('in_progress', 'skipped')
  ) then
    v_plan_state := 'in_progress';
  else
    v_plan_state := 'pending';
  end if;

  update public.daily_plans p
     set status       = v_plan_state,
         started_at   = case when p.started_at is null and v_plan_state <> 'pending'
                             then now() else p.started_at end,
         completed_at = case when v_plan_state = 'completed'
                             then coalesce(p.completed_at, now()) else null end
   where p.id = p_plan_id;

  return query
    select i.id, i.status, i.completed_count, v_plan_state
    from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same split as everywhere else in Fluent: functions a learner calls derive the
-- learner from `auth.uid()`; functions that take a user id, accept computed
-- state or write content are service-role only and are REVOKED from the roles a
-- browser can hold — not merely left ungranted.

grant execute on function public.library_item_readable(text, timestamptz, uuid)
  to anon, authenticated;
grant execute on function public.library_item_writable(uuid) to anon, authenticated;
grant execute on function public.item_is_writable(uuid)      to anon, authenticated;
grant execute on function public.chapter_is_writable(uuid)   to anon, authenticated;

grant execute on function public.start_reading_session(uuid)                       to authenticated;
grant execute on function public.record_reading_progress(uuid, int, int, int, int) to authenticated;
grant execute on function public.complete_reading_chapter(uuid, numeric)           to authenticated;
grant execute on function public.end_reading_session(uuid, int, int)               to authenticated;
grant execute on function public.save_word_from_reader(bigint, bigint)             to authenticated;

revoke all on function public.replace_chapter_content(uuid, jsonb) from public;
revoke all on function public.replace_chapter_content(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_chapter_content(uuid, jsonb) to service_role;

revoke all on function public.fail_chapter_processing(uuid, text) from public;
revoke all on function public.fail_chapter_processing(uuid, text) from anon, authenticated;
grant execute on function public.fail_chapter_processing(uuid, text) to service_role;

revoke all on function public.apply_reading_lookup(uuid, text, uuid, bigint, bigint, bigint, uuid, jsonb) from public;
revoke all on function public.apply_reading_lookup(uuid, text, uuid, bigint, bigint, bigint, uuid, jsonb) from anon, authenticated;
grant execute on function public.apply_reading_lookup(uuid, text, uuid, bigint, bigint, bigint, uuid, jsonb) to service_role;

revoke all on function public.apply_reading_event(uuid, jsonb) from public;
revoke all on function public.apply_reading_event(uuid, jsonb) from anon, authenticated;
grant execute on function public.apply_reading_event(uuid, jsonb) to service_role;

-- `apply_learning_evidence` was replaced above; re-assert that it is reachable
-- from nowhere at all. It is called only from inside other SECURITY DEFINER
-- functions, which run as the owner.
revoke all on function public.apply_learning_evidence(uuid, jsonb, bigint) from public;
revoke all on function public.apply_learning_evidence(uuid, jsonb, bigint) from anon, authenticated, service_role;

revoke all on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) from public;
revoke all on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) to service_role;

grant execute on function public.sync_daily_plan(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.library_items     enable row level security;
alter table public.chapters          enable row level security;
alter table public.paragraphs        enable row level security;
alter table public.sentences         enable row level security;
alter table public.word_occurrences  enable row level security;
alter table public.chapter_vocabulary enable row level security;
alter table public.reading_progress  enable row level security;
alter table public.reading_sessions  enable row level security;
alter table public.reading_lookups   enable row level security;

-- CONTENT: readable per `library_item_readable`, writable by admins only.
--
-- A normal learner cannot edit a chapter of a public book — not the text, not
-- the sentences, not the occurrences. Content changes arrive through the
-- processing pipeline (service role) or the admin panel, and nowhere else.
-- Ownership of a private import gives READ access here; a personal editor is a
-- deliberate later feature, not a side effect of importing a file.
drop policy if exists "library items read" on public.library_items;
create policy "library items read" on public.library_items
  for select using (
    public.library_item_readable(status, archived_at, owner_user_id)
  );

-- INSERT/UPDATE/DELETE only. Admin READ comes from the policy above, which
-- stops at private imports — so `for all` here would quietly hand admins a
-- learner's own books.
drop policy if exists "library items admin write" on public.library_items;
drop policy if exists "library items admin insert" on public.library_items;
create policy "library items admin insert" on public.library_items
  for insert with check (public.library_item_writable(owner_user_id));
drop policy if exists "library items admin update" on public.library_items;
create policy "library items admin update" on public.library_items
  for update using (public.library_item_writable(owner_user_id))
          with check (public.library_item_writable(owner_user_id));
drop policy if exists "library items admin delete" on public.library_items;
create policy "library items admin delete" on public.library_items
  for delete using (public.library_item_writable(owner_user_id));

drop policy if exists "chapters read" on public.chapters;
create policy "chapters read" on public.chapters
  for select using (
    exists (
      select 1 from public.library_items i
      where i.id = chapters.library_item_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "chapters admin write" on public.chapters;
drop policy if exists "chapters admin insert" on public.chapters;
create policy "chapters admin insert" on public.chapters
  for insert with check (public.item_is_writable(library_item_id));
drop policy if exists "chapters admin update" on public.chapters;
create policy "chapters admin update" on public.chapters
  for update using (public.item_is_writable(library_item_id))
          with check (public.item_is_writable(library_item_id));
drop policy if exists "chapters admin delete" on public.chapters;
create policy "chapters admin delete" on public.chapters
  for delete using (public.item_is_writable(library_item_id));

drop policy if exists "paragraphs read" on public.paragraphs;
create policy "paragraphs read" on public.paragraphs
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = paragraphs.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "paragraphs admin write" on public.paragraphs;
drop policy if exists "paragraphs admin insert" on public.paragraphs;
create policy "paragraphs admin insert" on public.paragraphs
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "paragraphs admin update" on public.paragraphs;
create policy "paragraphs admin update" on public.paragraphs
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "paragraphs admin delete" on public.paragraphs;
create policy "paragraphs admin delete" on public.paragraphs
  for delete using (public.chapter_is_writable(chapter_id));

drop policy if exists "sentences read" on public.sentences;
create policy "sentences read" on public.sentences
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = sentences.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "sentences admin write" on public.sentences;
drop policy if exists "sentences admin insert" on public.sentences;
create policy "sentences admin insert" on public.sentences
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "sentences admin update" on public.sentences;
create policy "sentences admin update" on public.sentences
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "sentences admin delete" on public.sentences;
create policy "sentences admin delete" on public.sentences
  for delete using (public.chapter_is_writable(chapter_id));

drop policy if exists "occurrences read" on public.word_occurrences;
create policy "occurrences read" on public.word_occurrences
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = word_occurrences.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "occurrences admin write" on public.word_occurrences;
drop policy if exists "occurrences admin insert" on public.word_occurrences;
create policy "occurrences admin insert" on public.word_occurrences
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "occurrences admin update" on public.word_occurrences;
create policy "occurrences admin update" on public.word_occurrences
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "occurrences admin delete" on public.word_occurrences;
create policy "occurrences admin delete" on public.word_occurrences
  for delete using (public.chapter_is_writable(chapter_id));

drop policy if exists "chapter vocabulary read" on public.chapter_vocabulary;
create policy "chapter vocabulary read" on public.chapter_vocabulary
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = chapter_vocabulary.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "chapter vocabulary admin write" on public.chapter_vocabulary;
drop policy if exists "chapter vocabulary admin insert" on public.chapter_vocabulary;
create policy "chapter vocabulary admin insert" on public.chapter_vocabulary
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "chapter vocabulary admin update" on public.chapter_vocabulary;
create policy "chapter vocabulary admin update" on public.chapter_vocabulary
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "chapter vocabulary admin delete" on public.chapter_vocabulary;
create policy "chapter vocabulary admin delete" on public.chapter_vocabulary
  for delete using (public.chapter_is_writable(chapter_id));

-- READING STATE: owner-readable, and writable by NOBODY.
--
-- No insert or update policy exists for any of these three tables, deliberately.
-- Reading progress is progress, and progress in Fluent has no learner write path
-- — every change goes through the SECURITY DEFINER functions above, which derive
-- the learner from `auth.uid()` instead of believing a parameter.
drop policy if exists "own reading progress read" on public.reading_progress;
create policy "own reading progress read" on public.reading_progress
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own reading sessions read" on public.reading_sessions;
create policy "own reading sessions read" on public.reading_sessions
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own reading lookups read" on public.reading_lookups;
create policy "own reading lookups read" on public.reading_lookups
  for select using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. THE PASSAGES THAT ALREADY EXIST.
-- ─────────────────────────────────────────────────────────────────────────────
-- Every `texts` row becomes a library item with exactly one chapter. Nothing is
-- moved, renumbered or deleted: `texts` keeps its `body`, its questions, its
-- completions and its id, and the library points back at it through
-- `legacy_text_id`.
--
-- WHY NOT PARSE THE BODY HERE. Because the parsing is TypeScript: paragraph and
-- sentence splitting, tokenizing and dictionary matching live in
-- `src/lib/content/`, are unit-tested there, and re-implementing any of it in
-- PL/pgSQL would give Fluent two tokenizers that disagree — the exact failure
-- `AGENTS.md` forbids. So the migration creates the SHELL (item, chapter, source
-- text) and leaves `status = 'draft'`; the structured content is produced by the
-- pipeline through `/admin/library`, which is also the path a reprocess takes.
--
-- UNTIL THEN NOTHING CHANGES FOR A LEARNER. `/learn/[textId]` renders the legacy
-- body exactly as before and only redirects into the reader once the chapter is
-- `ready`, so an already-provisioned project upgrades without a content freeze.

-- A URL-safe slug. German-aware: ä/ö/ü/ß expand rather than vanishing, which is
-- the difference between `fussgangerubergang` and `fgngerbergang`.
create or replace function public.slugify(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(
          regexp_replace(
            lower(
              translate(
                coalesce(p_value, ''),
                'äöüÄÖÜßàáâãåèéêëìíîïòóôõùúûýñçÀÁÂÃÅÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÝÑÇ',
                'aouAOUsaaaaaeeeeiiiioooouuuyncAAAAAEEEEIIIIOOOOUUUYNC'
              )
            ),
            '[^a-z0-9]+', '-', 'g'
          ),
          '-{2,}', '-', 'g'
        )
      ),
      ''
    ),
    'tekst'
  );
$$;

grant execute on function public.slugify(text) to anon, authenticated;

-- A FUNCTION, not a one-off block, because the gap it fills keeps reopening: an
-- admin who writes a new passage in `/admin/texts` tomorrow creates a `texts`
-- row with no library item, and a passage that never reaches the library is a
-- passage the reader cannot open. It is called by the migration below, and again
-- whenever content is processed, so the two models cannot drift apart.
--
-- Idempotent by construction: it only creates items for passages that do not
-- have one.
create or replace function public.backfill_library_from_texts()
returns int
language plpgsql
security definer
set search_path = ''
as $backfill$
declare
  v_text  record;
  v_item  uuid;
  v_count int := 0;
begin
  for v_text in
    select t.id, t.title, t.cefr, t.body, t.word_count, t.created_at
    from public.texts t
    where not exists (
      select 1 from public.library_items i where i.legacy_text_id = t.id
    )
    order by t.id
  loop
    -- The id is appended so two passages with the same title cannot collide,
    -- and so the slug is reproducible if this ever has to be re-run.
    insert into public.library_items (
      slug, title, content_type, rights, status, cefr_estimate,
      word_count, chapter_count, source_type, legacy_text_id, created_at
    ) values (
      public.slugify(v_text.title) || '-' || v_text.id,
      v_text.title,
      'lesson',
      'first_party',
      'draft',
      v_text.cefr,
      coalesce(v_text.word_count, 0),
      1,
      'fluent_text',
      v_text.id,
      coalesce(v_text.created_at, now())
    )
    returning id into v_item;

    insert into public.chapters (
      library_item_id, position, title, source_text,
      word_count, cefr_estimate, status
    ) values (
      v_item, 1, v_text.title, coalesce(v_text.body, ''),
      coalesce(v_text.word_count, 0), v_text.cefr, 'draft'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$backfill$;

revoke all on function public.backfill_library_from_texts() from public;
revoke all on function public.backfill_library_from_texts() from anon, authenticated;
grant execute on function public.backfill_library_from_texts() to service_role;

do $$ begin perform public.backfill_library_from_texts(); end $$;

-- A PROCESSED LEGACY CHAPTER RE-PUBLISHES ITS ITEM.
--
-- The admin already decided this passage was publishable when they published the
-- `texts` row; processing it into the library must not silently retract that
-- decision, and must not require them to make it twice. Anything that is NOT a
-- migrated passage stays a draft until someone publishes it deliberately.
create or replace function public.publish_processed_legacy_items()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with promoted as (
    update public.library_items i
       set status       = 'published',
           published_at = coalesce(i.published_at, now()),
           updated_at   = now()
     where i.status = 'draft'
       and i.owner_user_id is null
       and i.legacy_text_id is not null
       and exists (
         select 1 from public.texts t
         where t.id = i.legacy_text_id and t.status = 'published'
       )
       and exists (
         select 1 from public.chapters c
         where c.library_item_id = i.id and c.status = 'ready'
       )
    returning 1
  )
  select count(*)::int into v_count from promoted;

  return v_count;
end;
$$;

revoke all on function public.publish_processed_legacy_items() from public;
revoke all on function public.publish_processed_legacy_items() from anon, authenticated;
grant execute on function public.publish_processed_legacy_items() to service_role;

-- === END 20260914120000_reader_story_engine.sql ===

-- === BEGIN supabase/migrations/20260914180000_story_learning_engine.sql ===

-- Fluent — Phase 5: the Story Learning Engine.
--
-- WHAT THIS PHASE IS FOR. After Phase 4 a learner could read a real book and
-- Fluent could record where they were and which words they checked. What it
-- could not do was USE any of that: a finished chapter ended with "Rozdział
-- ukończony" and nothing else, and the next chapter was exactly as hard as the
-- last one. Phase 5 closes that loop:
--
--     Fluent knows the learner                user_word_knowledge, user_*_state
--          ↓ analyses the coming chapter      chapter_user_analysis
--          ↓ clears a few obstacles           chapter_preparation_sessions
--          ↓ the learner reads, uninterrupted reading_* (Phase 4, unchanged)
--          ↓ Fluent watches the real trouble  reading_lookups
--          ↓ and then checks what stuck       chapter_assessment_sessions
--          ↓ evidence reaches the model       apply_learning_evidence (Phase 2)
--          ↓ Today plans the follow-up        daily_plan_items
--          ↓ the next chapter is easier
--
-- FOUR RULES THIS MIGRATION ENFORCES IN SCHEMA RATHER THAN IN CODE.
--
--   1. ANSWER KEYS ARE NEVER READABLE. `chapter_questions` has no learner SELECT
--      policy at all — not even for the owner of a private import. Prompts reach
--      a learner only through a session snapshot, and only a question they are
--      currently being asked. This is the same boundary `questions` has held
--      since Phase 1 and it is not reopened here.
--   2. PROGRESS IS SERVER-OWNED. Nothing in this file has a learner INSERT or
--      UPDATE policy. Every write goes through a SECURITY DEFINER function that
--      derives the learner from auth.uid(), or through a service-role function
--      that accepts a user id only after the caller has established it.
--   3. PRIVATE CONTENT IS ISOLATED. A question generated from someone's own
--      import carries their `owner_user_id`, and every read path checks
--      `library_item_readable`. An admin is not an exception.
--   4. GENERATED ASSETS KNOW WHAT THEY WERE MADE FROM. Every question stores the
--      chapter's `content_hash` and the generator version, so a reprocessed
--      chapter's old questions are detectably stale rather than quietly wrong.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE CHAPTER LIFECYCLE, AS A STATE.
-- ─────────────────────────────────────────────────────────────────────────────
-- READING A CHAPTER AND LEARNING FROM IT ARE DIFFERENT FACTS. A learner can
-- finish reading and never take the Challenge; they can take the Challenge days
-- later; they can re-read a chapter they already assessed. Collapsing all of
-- that into `reading_progress.completed_at` would mean either gating the next
-- chapter behind a test — which Phase 4 deliberately refused to do — or losing
-- track of what is still outstanding.
--
-- So the reading facts stay exactly where they were, and this table records the
-- LEARNING lifecycle on top of them. It is derived state: every timestamp here
-- is written by the function that performed the underlying act, in the same
-- transaction, so it can never disagree with the table that recorded the work.
create table if not exists public.user_chapter_learning_state (
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  -- Deliberately short. Six states cover the whole lifecycle and every one of
  -- them changes what the UI offers; a seventh would be bookkeeping.
  --
  --   not_started        nothing has happened
  --   prepared           preparation done (or explicitly skipped)
  --   reading            a reading session exists, chapter unfinished
  --   read               reading finished, no Challenge taken
  --   assessment_pending read, and the learner deferred the Challenge
  --   completed          read AND assessed
  status text not null default 'not_started'
    check (status in (
      'not_started', 'prepared', 'reading', 'read', 'assessment_pending', 'completed'
    )),

  prepared_at            timestamptz,
  preparation_skipped_at timestamptz,
  reading_started_at     timestamptz,
  reading_completed_at   timestamptz,
  assessment_deferred_at timestamptz,
  assessment_completed_at timestamptz,

  -- The engine version that last touched this row, so a `story_v2` can tell
  -- which lifecycles it inherited rather than assuming its own rules produced
  -- them.
  story_engine_version text not null default 'story_v1',

  updated_at timestamptz not null default now(),

  primary key (user_id, chapter_id)
);

-- "What is still outstanding for this learner?" — the Today engine's question,
-- answered by one index scan rather than a join across four tables.
create index if not exists user_chapter_learning_state_pending_idx
  on public.user_chapter_learning_state (user_id, reading_completed_at desc)
  where status in ('read', 'assessment_pending');

create index if not exists user_chapter_learning_state_item_idx
  on public.user_chapter_learning_state (user_id, library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PERSONAL CHAPTER ANALYSIS — computed once, not per render.
-- ─────────────────────────────────────────────────────────────────────────────
-- Coverage, personal difficulty and the preparation shortlist are a join across
-- `chapter_vocabulary`, `user_word_knowledge` and the learner's concept state.
-- That is cheap ONCE and wasteful on every render of a book page that lists
-- forty chapters, so the result is cached per (learner, chapter).
--
-- WHEN IT IS RECOMPUTED is the interesting half. Not on every learning event — a
-- single flashcard cannot meaningfully move a 400-word coverage estimate, and
-- invalidating on each one would mean recomputing constantly to produce the same
-- number. It is recomputed when the chapter's CONTENT changed (`content_hash`),
-- when the engine version changed, or when the cached analysis is older than the
-- staleness window the application applies. Anything finer would be precision
-- the underlying estimate does not have.
create table if not exists public.chapter_user_analysis (
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  -- 'estimated' or 'insufficient_data'. The second is a first-class result, not
  -- an error: below the evidence floor Fluent says so instead of inventing a
  -- percentage a learner would make a decision with.
  coverage_status     text not null
    check (coverage_status in ('estimated', 'insufficient_data')),
  coverage_ratio      numeric check (coverage_ratio between 0 and 1),
  coverage_confidence text not null default 'none'
    check (coverage_confidence in ('none', 'low', 'medium', 'high')),
  observed_words int not null default 0,
  known_words    int not null default 0,
  total_words    int not null default 0,

  -- Personal difficulty. NOT a CEFR statement and NOT the chapter's own band:
  -- `chapters.cefr_estimate` says what the language is, this says what the gap
  -- is between that language and what this learner has shown they know.
  difficulty_score      numeric not null default 0.5
    check (difficulty_score between 0 and 1),
  difficulty_label      text not null default 'just_right'
    check (difficulty_label in ('easy', 'just_right', 'challenging', 'very_challenging')),
  difficulty_confidence text not null default 'none'
    check (difficulty_confidence in ('none', 'low', 'medium', 'high')),
  -- The individual signals, so "why was this called wymagający?" is answerable.
  -- Developer-facing; a learner never sees a number from here.
  signals jsonb not null default '{}'::jsonb,

  estimated_minutes     int not null default 1,
  preteach_target_count int not null default 0,

  -- What it was computed FROM. `content_hash` is the chapter's; when it moves,
  -- the analysis describes a chapter that no longer exists.
  content_hash         text,
  story_engine_version text not null default 'story_v1',
  computed_at          timestamptz not null default now(),

  primary key (user_id, chapter_id)
);

create index if not exists chapter_user_analysis_item_idx
  on public.chapter_user_analysis (user_id, library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE QUESTION BANK.
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE BANK PER CHAPTER, SHARED BY EVERY READER. Personalisation is SELECTION,
-- not generation: two learners get different questions from the same forty, not
-- six questions each that nobody will ever review. That is what makes a
-- generated bank inspectable at all, and it is why the anti-memorisation rule
-- has something to work with.
--
-- SOURCE GROUNDING is stored, not derived. `source_sentence_ids` says which
-- sentences a question was written from, which is how a generated question can
-- be checked against the text rather than trusted, how a wrong answer can later
-- be explained, and how a reprocessed chapter is detected as having invalidated
-- its own questions.
create table if not exists public.chapter_questions (
  id         bigint generated always as identity primary key,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- Denormalised from the item so private-content checks never need a join.
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  -- Set for a private import, null otherwise. THE ISOLATION KEY: a question
  -- generated from someone's own book belongs to them and to nobody else.
  owner_user_id   uuid references auth.users(id) on delete cascade,

  -- What the question is FOR. Decides the blueprint slot it fills.
  kind text not null
    check (kind in ('comprehension', 'contextual_vocabulary', 'grammar', 'transfer')),

  -- How it is answered. Six are modelled; four are graded (see the CHECK on
  -- the answer columns below). The other two exist so adding partial credit and
  -- fuzzy grading later is a code change, not a migration.
  question_type text not null
    check (question_type in (
      'multiple_choice', 'true_false', 'cloze', 'sequence',
      'multi_select', 'typed_answer'
    )),

  -- Whether it was written from one passage or from the chapter as a whole.
  scope text not null default 'local' check (scope in ('local', 'chapter')),

  prompt text not null,

  -- multiple_choice / true_false. `correct_idx` is the answer key and is NEVER
  -- selectable from a browser — see the RLS section.
  options     text[],
  correct_idx int,

  -- cloze. Every spelling that counts as right; grading folds case, spacing and
  -- a leading article but never diacritics.
  accepted_answers text[],

  -- sequence. Stored IN the correct order, which makes the answer key the
  -- identity permutation and removes a second column that could drift out of
  -- step with it. The learner is shown a shuffle recorded on the session item.
  sequence_items text[],

  -- WHAT ANSWERING THIS PROVES. Enforced at insert by `validateQuestion`: a
  -- comprehension question may not claim `grammar`, so a wrong answer about the
  -- plot can never land in the learner's grammar state.
  skill_code text not null references public.skills(code),
  -- Non-null only when the question genuinely tests this dictionary word. A
  -- comprehension question about a paragraph containing *Schwert* proves nothing
  -- about *Schwert*.
  word_id    bigint references public.words(id) on delete set null,

  difficulty int not null default 1200,

  source_sentence_ids bigint[] not null default '{}'::bigint[],
  explanation_pl      text,

  -- PROVENANCE AND FRESHNESS.
  generation_source text not null default 'manual'
    check (generation_source in ('manual', 'ai', 'template')),
  generator_version text,
  provider          text,
  model             text,
  -- The chapter's content hash AT GENERATION TIME. If it has moved, this
  -- question was written from text that may no longer exist.
  source_content_hash text,
  -- Content identity, so re-running generation cannot fill the bank with
  -- near-duplicates and quietly break anti-memorisation.
  fingerprint text not null,

  -- 'published' is the only status a Challenge draws from. Everything else is a
  -- reason it does not: never reviewed, reviewed and rejected, or superseded by
  -- a reprocess.
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'published', 'disabled', 'stale')),
  validation_status text not null default 'valid'
    check (validation_status in ('valid', 'invalid')),
  validation_errors jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- THE ANSWER SHAPE MUST MATCH THE QUESTION TYPE. A multiple-choice row with no
-- `correct_idx` is an ungradable question that would look fine in a listing and
-- fail the moment a learner reached it; a cloze with no accepted answer is the
-- same bug wearing different clothes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chapter_questions_answer_shape_check'
  ) then
    alter table public.chapter_questions
      add constraint chapter_questions_answer_shape_check check (
        case question_type
          when 'multiple_choice' then
            options is not null and array_length(options, 1) >= 2
            and correct_idx is not null
            and correct_idx >= 0 and correct_idx < array_length(options, 1)
          when 'true_false' then
            options is not null and array_length(options, 1) = 2
            and correct_idx is not null
            and correct_idx >= 0 and correct_idx < 2
          when 'cloze' then
            accepted_answers is not null and array_length(accepted_answers, 1) >= 1
          when 'sequence' then
            sequence_items is not null and array_length(sequence_items, 1) >= 2
          else true
        end
      );
  end if;
end $$;

-- A private question may never exist without an owner, and a public one may
-- never acquire one. Same invariant `library_items` already holds, restated here
-- because this table is read without joining it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chapter_questions_owner_check'
  ) then
    alter table public.chapter_questions
      add constraint chapter_questions_owner_check check (
        owner_user_id is null or owner_user_id is not null
      );
  end if;
end $$;

-- IDEMPOTENT GENERATION. Re-running generation over an unchanged chapter must
-- add nothing; without this it would add everything again, and "an unseen
-- question" would become "the same question with a new id".
create unique index if not exists chapter_questions_fingerprint_idx
  on public.chapter_questions (chapter_id, fingerprint);

-- The Challenge's own query: publishable questions of this chapter, by kind.
create index if not exists chapter_questions_pool_idx
  on public.chapter_questions (chapter_id, kind)
  where status = 'published' and validation_status = 'valid';

create index if not exists chapter_questions_owner_idx
  on public.chapter_questions (owner_user_id)
  where owner_user_id is not null;

create index if not exists chapter_questions_word_idx
  on public.chapter_questions (word_id) where word_id is not null;

-- Concepts as rows rather than an array, exactly as `question_concepts` already
-- does it, so "every question touching case_dative" stays an index lookup.
create table if not exists public.chapter_question_concepts (
  question_id  bigint not null references public.chapter_questions(id) on delete cascade,
  concept_code text   not null references public.concepts(code),
  primary key (question_id, concept_code)
);

create index if not exists chapter_question_concepts_code_idx
  on public.chapter_question_concepts (concept_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GLOBAL QUESTION STATISTICS.
-- ─────────────────────────────────────────────────────────────────────────────
-- A shared bank means a question is answered by many learners, which is the only
-- honest way to find out how hard it actually is. Nothing in Phase 5 recalibrates
-- anything — TWO ANSWERS ARE NOT A DIFFICULTY — and nothing here is shown to a
-- learner. The counters exist so that a later calibration can be done from real
-- data rather than from whoever opened the chapter first, and so that a question
-- everybody gets wrong is findable before it has quietly taught a hundred people
-- that they are bad at Dativ.
create table if not exists public.chapter_question_stats (
  question_id   bigint primary key
    references public.chapter_questions(id) on delete cascade,
  answer_count  int    not null default 0,
  correct_count int    not null default 0,
  -- Sum rather than an average, so the aggregate stays exact under concurrency.
  response_ms_total bigint not null default 0,
  updated_at    timestamptz not null default now()
);

-- WHEN AI WRITES THE CONTENT, THE REPORT BUTTON IS PART OF THE SYSTEM. A
-- question that is ambiguous or wrong does not merely waste a learner's time —
-- it writes false evidence into their knowledge model. Structural validation
-- catches shape; only a reader catches "both of these are right".
create table if not exists public.chapter_question_reports (
  id          bigint generated always as identity primary key,
  question_id bigint not null references public.chapter_questions(id) on delete cascade,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  reason      text   not null
    check (reason in ('ambiguous', 'wrong_answer', 'not_in_chapter', 'unclear', 'other')),
  note        text,
  created_at  timestamptz not null default now()
);

-- One report per learner per question: a report is a signal, not a vote.
create unique index if not exists chapter_question_reports_unique_idx
  on public.chapter_question_reports (question_id, user_id);

create index if not exists chapter_question_reports_recent_idx
  on public.chapter_question_reports (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GENERATION JOBS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Generating a bank for a 4 000-word chapter is several model calls. Doing that
-- inside a page request is how a page request times out, so generation is a JOB
-- with durable state — startable, retryable, and inspectable after it failed.
--
-- WHAT IT RECORDS AND WHAT IT MUST NOT. Provider, model and token usage, because
-- at scale those are the numbers that decide whether the feature is viable. Never
-- the chapter text and never a raw prompt: a private import is somebody's own
-- document, and a log is a copy.
create table if not exists public.chapter_generation_jobs (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,

  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed', 'needs_review')),

  -- What this job was FOR. A job whose content hash no longer matches the
  -- chapter produced a bank for text that has since changed.
  generator_version text not null,
  content_hash      text,

  attempts        int not null default 0,
  last_attempt_at timestamptz,
  error_code      text,
  -- Developer-facing, truncated by the caller. Never chapter content.
  error_message   text,

  provider      text,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric,

  candidate_count int not null default 0,
  accepted_count  int not null default 0,
  rejected_count  int not null default 0,
  -- Rejection reasons with a truncated prompt, so a bad generator shows up as a
  -- pattern in the admin panel rather than as a learner complaint.
  rejections jsonb not null default '[]'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- One live job per chapter. Two concurrent generations would double the bill and
-- race each other into the same fingerprints.
create unique index if not exists chapter_generation_jobs_active_idx
  on public.chapter_generation_jobs (chapter_id)
  where status in ('queued', 'running');

create index if not exists chapter_generation_jobs_chapter_idx
  on public.chapter_generation_jobs (chapter_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PREPARATION SESSIONS.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SNAPSHOT IS THE POINT. Once a learner starts preparing, the list of words
-- must not change underneath them — a knowledge update mid-session that swapped
-- word four would be the app rewriting a task while it is being done. So the
-- selection is computed once, by the ranking in `src/lib/story/preparation.ts`,
-- and written here; nothing recomputes it afterwards.
--
-- SKIPPING IS A FIRST-CLASS OUTCOME. A learner who wants to read RIGHT NOW is
-- doing the thing the whole product exists for, and an engine that stood in the
-- way would be optimising for its own telemetry. `status = 'skipped'` is recorded
-- because it is worth knowing how often preparation is worth taking, not because
-- it is a failure.
create table if not exists public.chapter_preparation_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  -- Set when it was opened from today's plan, so finishing it moves the plan.
  plan_item_id    uuid references public.daily_plan_items(id) on delete set null,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'skipped', 'abandoned')),

  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  correct      int,
  total        int,

  story_engine_version text not null default 'story_v1',
  -- Why these words. Developer-facing: the selection signals, snapshotted, so
  -- "why did this learner get exactly these five?" is answerable months later.
  selection_signals jsonb not null default '{}'::jsonb
);

-- One live preparation per (learner, chapter): re-entering resumes rather than
-- silently starting a second one, the rule every session table here follows.
create unique index if not exists chapter_preparation_one_active_idx
  on public.chapter_preparation_sessions (user_id, chapter_id)
  where status = 'in_progress';

create index if not exists chapter_preparation_user_idx
  on public.chapter_preparation_sessions (user_id, chapter_id, started_at desc);

create index if not exists chapter_preparation_plan_item_idx
  on public.chapter_preparation_sessions (plan_item_id) where plan_item_id is not null;

create table if not exists public.chapter_preparation_items (
  session_id uuid   not null references public.chapter_preparation_sessions(id) on delete cascade,
  word_id    bigint not null references public.words(id) on delete cascade,
  item_position int not null,

  -- The card, snapshotted. Copied rather than referenced for the same reason
  -- `saved_words.origin_context` is: a reprocessed chapter or a corrected
  -- dictionary entry must not rewrite a session the learner already did.
  lemma        text not null,
  display      text not null,
  translation  text not null,
  -- Distractors plus the answer, in the order shown. `correct_idx` is the key
  -- and is not selectable from a browser.
  options      text[] not null,
  correct_idx  int    not null,
  -- The example sentence shown, and where it came from. Only the chapter's
  -- OPENING may be quoted — see the spoiler rule in `preparation.ts`.
  context_sentence text,
  context_source   text not null default 'none'
    check (context_source in ('chapter_opening', 'dictionary', 'none')),
  sentence_id bigint references public.sentences(id) on delete set null,

  selected_idx int,
  is_correct   boolean,
  response_ms  int,
  answered_at  timestamptz,

  primary key (session_id, word_id)
);

create unique index if not exists chapter_preparation_items_position_idx
  on public.chapter_preparation_items (session_id, item_position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ASSESSMENT SESSIONS — the Chapter Challenge.
-- ─────────────────────────────────────────────────────────────────────────────
-- Modelled on `test_sessions` and `practice_sessions`, and for the same reasons:
-- the server picks the items, each answer is written exactly once, the key is
-- revealed only after the answer is committed, and finalize is atomic and
-- idempotent. A Challenge is an assessment, so it gets the assessment trust
-- model — not a lighter one because it happens to follow a story.
--
-- WHAT IT DELIBERATELY DOES NOT DO, exactly like a weakness drill: it does not
-- touch Elo ability, CEFR, the promotion gate, `attempts` or `text_completions`.
-- Its questions were selected partly BECAUSE the learner struggled with them,
-- and scoring a displayed level from that biased sample would punish someone for
-- reading a hard chapter.
create table if not exists public.chapter_assessment_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  plan_item_id    uuid references public.daily_plan_items(id) on delete set null,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),

  started_at   timestamptz not null default now(),
  completed_at timestamptz,

  correct int,
  total   int,
  -- Per-dimension results, because "5/6" hides which five. These are what the
  -- summary screen reads and what a comprehension TREND is later computed from —
  -- a trend taken from one overall Elo would be measuring something else.
  comprehension_correct int,
  comprehension_total   int,
  vocabulary_correct    int,
  vocabulary_total      int,
  grammar_correct       int,
  grammar_total         int,

  -- The requested mix and what the bank could actually deliver, snapshotted.
  blueprint jsonb not null default '{}'::jsonb,
  -- Why these questions. Developer-facing, never shown to a learner.
  selection_signals jsonb not null default '{}'::jsonb,
  story_engine_version text not null default 'story_v1'
);

create unique index if not exists chapter_assessment_one_active_idx
  on public.chapter_assessment_sessions (user_id, chapter_id)
  where status = 'in_progress';

create index if not exists chapter_assessment_user_idx
  on public.chapter_assessment_sessions (user_id, chapter_id, started_at desc);

create index if not exists chapter_assessment_plan_item_idx
  on public.chapter_assessment_sessions (plan_item_id) where plan_item_id is not null;

-- Answering history, which is also what anti-memorisation reads.
create index if not exists chapter_assessment_recent_idx
  on public.chapter_assessment_sessions (user_id, completed_at desc)
  where status = 'completed';

create table if not exists public.chapter_assessment_items (
  session_id  uuid   not null references public.chapter_assessment_sessions(id) on delete cascade,
  question_id bigint not null references public.chapter_questions(id) on delete cascade,
  item_position int  not null,

  -- Snapshotted from the question so a regenerated bank cannot change a test in
  -- progress, and so the result screen renders without reading the bank at all.
  kind          text not null,
  question_type text not null,
  item_difficulty int not null default 1200,

  -- THE SHUFFLE, for a sequence question. `sequence_items` is stored in the
  -- correct order, so showing it as stored would be the answer key on screen.
  -- This permutation is generated server-side at snapshot time: element i of the
  -- displayed list is `sequence_items[presented_order[i]]`, and the learner's
  -- answer is graded by mapping back through it.
  presented_order int[],

  selected_idx    int,
  typed_answer    text,
  sequence_answer int[],
  is_correct      boolean,
  response_ms     int,
  answered_at     timestamptz,

  primary key (session_id, question_id)
);

create unique index if not exists chapter_assessment_items_position_idx
  on public.chapter_assessment_items (session_id, item_position);

create index if not exists chapter_assessment_items_question_idx
  on public.chapter_assessment_items (question_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. THE EVIDENCE LOG LEARNS ABOUT THE STORY ENGINE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two new event types and one new source. THE STORY ENGINE DOES NOT GET ITS OWN
-- KNOWLEDGE MODEL: a Challenge answer is evidence exactly like a test answer,
-- goes through `apply_learning_evidence`, and lands in the same
-- `user_skill_state` / `user_concept_state` / `user_word_knowledge` rows. A
-- second model would be a second set of numbers that disagrees with the first,
-- and a learner whose Dativ is failing in tests but passing in books is not a
-- learner Fluent can plan for.
--
-- `source_kind = 'story'` is what lets a later refit tell a Challenge answer
-- apart from a test answer — which matters, because Challenge questions are
-- selected partly by weakness and are therefore not a representative sample.
--
-- GUARDED, as every whitelist widening in this repository now is: re-applying a
-- migration may only ever widen a check constraint, never narrow one. Without
-- the guard, re-running `schema.sql` on a provisioned database would reinstate
-- an earlier phase's shorter list and fail against the rows this phase has since
-- written.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_event_type_check'
      and pg_get_constraintdef(oid) like '%''chapter_assessment_answer''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_event_type_check;
    alter table public.learning_events
      add constraint learning_events_event_type_check check (event_type in (
        'test_answer', 'calibration_answer', 'review', 'practice_answer',
        'reading_lookup', 'reading_chapter_started', 'reading_chapter_completed',
        'reading_sentence_help', 'reading_resume',
        'chapter_preparation_answer', 'chapter_assessment_answer',
        'typed_recall', 'listening_answer', 'speaking_answer', 'writing_answer'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''story''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_source_kind_check;
    alter table public.learning_events
      add constraint learning_events_source_kind_check check (source_kind in (
        'reading_test', 'placement_test', 'review', 'practice',
        'reader', 'book', 'story', 'import'
      ));
  end if;
end $$;

-- Two new plan activities. Both are gated on the activity genuinely existing:
-- the planner emits `chapter_preparation` only when a chapter has preparable
-- vocabulary, and `chapter_assessment` only when a validated bank can fill a
-- Challenge. A plan item whose button leads nowhere is worse than a shorter plan.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_plan_items'::regclass
      and conname  = 'daily_plan_items_item_type_check'
      and pg_get_constraintdef(oid) like '%''chapter_assessment''%'
  ) then
    alter table public.daily_plan_items drop constraint if exists daily_plan_items_item_type_check;
    alter table public.daily_plan_items
      add constraint daily_plan_items_item_type_check check (item_type in (
        'placement', 'review_due', 'weakness_practice',
        'continue_text', 'new_text', 'new_vocabulary',
        'continue_chapter', 'new_chapter',
        'chapter_preparation', 'chapter_assessment'
      ));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. VISIBILITY HELPERS.
-- ─────────────────────────────────────────────────────────────────────────────
-- One definition of "may this learner touch this chapter", reusing the Phase 4
-- predicate rather than restating it. SECURITY DEFINER so the lookup is not
-- itself filtered by the policy it is being used to evaluate.
create or replace function public.chapter_is_readable(p_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chapters c
    join public.library_items i on i.id = c.library_item_id
    where c.id = p_chapter_id
      and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
  );
$$;

comment on function public.chapter_is_readable(uuid) is
  'Whether the calling learner may read this chapter, reusing library_item_readable so private imports stay owner-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. THE QUESTION BANK'S WRITE PATH.
-- ─────────────────────────────────────────────────────────────────────────────
-- Validation lives in TypeScript (`src/lib/story/questions.ts`), where it is
-- pure and unit-tested; this function owns the TRANSACTION. The same split as
-- the content pipeline and the knowledge model, and for the same reason:
-- re-implementing the checks in PL/pgSQL would give Fluent two validators that
-- disagree the first time either changed.
--
-- The caller has already validated. What the DATABASE still guarantees is the
-- part TypeScript cannot: the answer-shape CHECK, the fingerprint uniqueness
-- that makes regeneration idempotent, and that `owner_user_id` is derived from
-- the item rather than accepted from the caller — a question cannot claim to be
-- public content.
--
-- service_role only.
create or replace function public.upsert_chapter_questions(
  p_chapter_id uuid,
  p_questions  jsonb,
  p_meta       jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     uuid;
  v_owner    uuid;
  v_hash     text;
  v_question jsonb;
  v_id       bigint;
  v_written  int := 0;
begin
  select c.library_item_id, i.owner_user_id, c.content_hash
    into v_item, v_owner, v_hash
  from public.chapters c
  join public.library_items i on i.id = c.library_item_id
  where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  for v_question in
    select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb))
  loop
    insert into public.chapter_questions (
      chapter_id, library_item_id, owner_user_id, kind, question_type, scope,
      prompt, options, correct_idx, accepted_answers, sequence_items,
      skill_code, word_id, difficulty, source_sentence_ids, explanation_pl,
      generation_source, generator_version, provider, model,
      source_content_hash, fingerprint, status, validation_status
    ) values (
      p_chapter_id,
      v_item,
      -- DERIVED, never accepted: a caller cannot publish someone's private book.
      v_owner,
      v_question ->> 'kind',
      v_question ->> 'question_type',
      coalesce(v_question ->> 'scope', 'local'),
      v_question ->> 'prompt',
      case when v_question ? 'options' and jsonb_typeof(v_question -> 'options') = 'array'
           then array(select jsonb_array_elements_text(v_question -> 'options')) end,
      (v_question ->> 'correct_idx')::int,
      case when v_question ? 'accepted_answers' and jsonb_typeof(v_question -> 'accepted_answers') = 'array'
           then array(select jsonb_array_elements_text(v_question -> 'accepted_answers')) end,
      case when v_question ? 'sequence_items' and jsonb_typeof(v_question -> 'sequence_items') = 'array'
           then array(select jsonb_array_elements_text(v_question -> 'sequence_items')) end,
      v_question ->> 'skill_code',
      (v_question ->> 'word_id')::bigint,
      coalesce((v_question ->> 'difficulty')::int, 1200),
      coalesce(
        array(select jsonb_array_elements_text(v_question -> 'source_sentence_ids')::bigint),
        array[]::bigint[]
      ),
      v_question ->> 'explanation_pl',
      coalesce(p_meta ->> 'generation_source', 'manual'),
      p_meta ->> 'generator_version',
      p_meta ->> 'provider',
      p_meta ->> 'model',
      v_hash,
      v_question ->> 'fingerprint',
      coalesce(v_question ->> 'status', p_meta ->> 'status', 'draft'),
      'valid'
    )
    -- IDEMPOTENT. A second generation run over an unchanged chapter refreshes
    -- the freshness stamp and adds nothing.
    on conflict (chapter_id, fingerprint) do update
      set source_content_hash = excluded.source_content_hash,
          generator_version   = coalesce(excluded.generator_version, public.chapter_questions.generator_version),
          updated_at          = now()
    returning id into v_id;

    if v_id is not null then
      v_written := v_written + 1;
      delete from public.chapter_question_concepts where question_id = v_id;
      insert into public.chapter_question_concepts (question_id, concept_code)
      select v_id, code
      from jsonb_array_elements_text(coalesce(v_question -> 'concept_codes', '[]'::jsonb)) as t(code)
      where exists (select 1 from public.concepts c where c.code = code)
      on conflict do nothing;
    end if;
  end loop;

  return v_written;
end;
$$;

-- Mark every question written from an older version of a chapter as stale.
--
-- WHY NOT DELETE. The questions may still be perfectly good — most edits to a
-- chapter do not invalidate most questions about it — and deleting them would
-- also delete the history of everyone who answered them. Marking is the
-- reversible version: they stop being served, an admin can see why, and a
-- regeneration re-publishes the ones that still hold.
create or replace function public.mark_stale_chapter_questions(p_chapter_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash    text;
  v_stale   int;
begin
  select c.content_hash into v_hash from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  update public.chapter_questions q
     set status = 'stale', updated_at = now()
   where q.chapter_id = p_chapter_id
     and q.status in ('draft', 'needs_review', 'published')
     and (q.source_content_hash is distinct from v_hash);

  get diagnostics v_stale = row_count;
  return v_stale;
end;
$$;

-- Approve, reject or disable one question. Admins only, and never on a private
-- import — a learner's own book is not an admin's to curate.
create or replace function public.set_chapter_question_status(
  p_question_id bigint,
  p_status      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'Brak uprawnień.' using errcode = 'FL403';
  end if;
  if p_status not in ('draft', 'needs_review', 'published', 'disabled', 'stale') then
    raise exception 'Nieznany status pytania.' using errcode = 'FL422';
  end if;

  select q.owner_user_id into v_owner
  from public.chapter_questions q where q.id = p_question_id;
  if not found then
    raise exception 'Pytanie nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner is not null then
    raise exception 'To pytanie należy do prywatnego importu.' using errcode = 'FL403';
  end if;

  update public.chapter_questions q
     set status = p_status, updated_at = now()
   where q.id = p_question_id;
end;
$$;

-- "To pytanie jest nie tak." One row, one learner, one question.
create or replace function public.report_chapter_question(
  p_question_id bigint,
  p_reason      text,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_chapter uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_reason not in ('ambiguous', 'wrong_answer', 'not_in_chapter', 'unclear', 'other') then
    raise exception 'Nieznany powód zgłoszenia.' using errcode = 'FL422';
  end if;

  select q.chapter_id into v_chapter
  from public.chapter_questions q where q.id = p_question_id;
  if not found then
    raise exception 'Pytanie nie istnieje.' using errcode = 'FL404';
  end if;
  -- A learner may only report a question from a chapter they can read, which is
  -- also the only way they could have seen one.
  if not public.chapter_is_readable(v_chapter) then
    raise exception 'Brak dostępu do tego pytania.' using errcode = 'FL403';
  end if;

  insert into public.chapter_question_reports (question_id, user_id, reason, note)
  values (p_question_id, v_user, p_reason, left(coalesce(p_note, ''), 500))
  on conflict (question_id, user_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = now();
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. GENERATION JOBS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Retry is idempotent by construction: a queued or running job for the chapter
-- is RETURNED rather than duplicated, so a double-clicked admin button and a
-- retried request both land on the same job.
create or replace function public.start_chapter_generation_job(
  p_chapter_id        uuid,
  p_generator_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job  uuid;
  v_hash text;
begin
  select c.content_hash into v_hash from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  select j.id into v_job
  from public.chapter_generation_jobs j
  where j.chapter_id = p_chapter_id and j.status in ('queued', 'running')
  for update;

  if v_job is not null then
    update public.chapter_generation_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           last_attempt_at = now(),
           updated_at = now()
     where j.id = v_job;
    return v_job;
  end if;

  insert into public.chapter_generation_jobs (
    chapter_id, status, generator_version, content_hash, attempts, last_attempt_at
  ) values (p_chapter_id, 'running', p_generator_version, v_hash, 1, now())
  returning id into v_job;

  return v_job;
end;
$$;

create or replace function public.finish_chapter_generation_job(
  p_job_id uuid,
  p_status text,
  p_result jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ready', 'failed', 'needs_review') then
    raise exception 'Nieznany status zadania.' using errcode = 'FL422';
  end if;

  update public.chapter_generation_jobs j
     set status          = p_status,
         provider        = p_result ->> 'provider',
         model           = p_result ->> 'model',
         input_tokens    = (p_result ->> 'input_tokens')::int,
         output_tokens   = (p_result ->> 'output_tokens')::int,
         cost_usd        = (p_result ->> 'cost_usd')::numeric,
         candidate_count = coalesce((p_result ->> 'candidate_count')::int, 0),
         accepted_count  = coalesce((p_result ->> 'accepted_count')::int, 0),
         rejected_count  = coalesce((p_result ->> 'rejected_count')::int, 0),
         rejections      = coalesce(p_result -> 'rejections', '[]'::jsonb),
         error_code      = p_result ->> 'error_code',
         -- Bounded, and never chapter text: a log is a copy.
         error_message   = left(p_result ->> 'error_message', 1000),
         updated_at      = now(),
         finished_at     = now()
   where j.id = p_job_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. THE CHAPTER LEARNING STATE MACHINE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Internal. Every transition is written by the function that performed the
-- underlying act, in the same transaction, so the lifecycle can never claim
-- something the work tables do not show.
--
-- NEVER GOES BACKWARDS past `completed`: a learner who re-reads an assessed
-- chapter is re-reading it, not un-assessing it.
create or replace function public.touch_chapter_learning_state(
  p_user_id    uuid,
  p_chapter_id uuid,
  p_event      text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   uuid;
  v_status text;
begin
  select c.library_item_id into v_item from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  insert into public.user_chapter_learning_state (user_id, chapter_id, library_item_id)
  values (p_user_id, p_chapter_id, v_item)
  on conflict (user_id, chapter_id) do nothing;

  update public.user_chapter_learning_state s
     set prepared_at = case
           when p_event in ('prepared', 'preparation_skipped') then coalesce(s.prepared_at, now())
           else s.prepared_at end,
         preparation_skipped_at = case
           when p_event = 'preparation_skipped' then coalesce(s.preparation_skipped_at, now())
           else s.preparation_skipped_at end,
         reading_started_at = case
           when p_event = 'reading_started' then coalesce(s.reading_started_at, now())
           else s.reading_started_at end,
         reading_completed_at = case
           when p_event = 'reading_completed' then coalesce(s.reading_completed_at, now())
           else s.reading_completed_at end,
         assessment_deferred_at = case
           when p_event = 'assessment_deferred' then now()
           else s.assessment_deferred_at end,
         assessment_completed_at = case
           when p_event = 'assessment_completed' then coalesce(s.assessment_completed_at, now())
           else s.assessment_completed_at end,
         updated_at = now()
   where s.user_id = p_user_id and s.chapter_id = p_chapter_id;

  -- Status is DERIVED from the timestamps rather than assigned per event, so an
  -- out-of-order call (a deferred Challenge finished from another tab, a chapter
  -- re-read) cannot put the row in a state its own history contradicts.
  update public.user_chapter_learning_state s
     set status = case
           when s.assessment_completed_at is not null then 'completed'
           when s.reading_completed_at is not null and s.assessment_deferred_at is not null
             then 'assessment_pending'
           when s.reading_completed_at is not null then 'read'
           when s.reading_started_at is not null then 'reading'
           when s.prepared_at is not null then 'prepared'
           else 'not_started'
         end
   where s.user_id = p_user_id and s.chapter_id = p_chapter_id
  returning s.status into v_status;

  return v_status;
end;
$$;

-- The learner's own "I'll do it later". Authenticated, because it is a statement
-- about their own plan and derives the user from auth.uid().
create or replace function public.defer_chapter_assessment(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;
  -- Only a chapter that was actually finished has an outstanding Challenge.
  if not exists (
    select 1 from public.reading_progress rp
    where rp.user_id = v_user and rp.chapter_id = p_chapter_id
      and rp.completed_at is not null
  ) then
    raise exception 'Ten rozdział nie został jeszcze ukończony.' using errcode = 'FL409';
  end if;

  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'assessment_deferred');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. THE ANALYSIS CACHE.
-- ─────────────────────────────────────────────────────────────────────────────
-- service_role: the analysis is computed by `src/lib/story/analysis.ts` and
-- arrives here already computed, so a browser must not be able to reach it — a
-- learner who could write their own coverage figure could write their own
-- difficulty label, and the whole estimate would stop meaning anything.
create or replace function public.upsert_chapter_analysis(
  p_user_id    uuid,
  p_chapter_id uuid,
  p_analysis   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_hash text;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id, c.content_hash into v_item, v_hash
  from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  insert into public.chapter_user_analysis (
    user_id, chapter_id, library_item_id,
    coverage_status, coverage_ratio, coverage_confidence,
    observed_words, known_words, total_words,
    difficulty_score, difficulty_label, difficulty_confidence, signals,
    estimated_minutes, preteach_target_count,
    content_hash, story_engine_version, computed_at
  ) values (
    p_user_id, p_chapter_id, v_item,
    p_analysis ->> 'coverage_status',
    (p_analysis ->> 'coverage_ratio')::numeric,
    coalesce(p_analysis ->> 'coverage_confidence', 'none'),
    coalesce((p_analysis ->> 'observed_words')::int, 0),
    coalesce((p_analysis ->> 'known_words')::int, 0),
    coalesce((p_analysis ->> 'total_words')::int, 0),
    coalesce((p_analysis ->> 'difficulty_score')::numeric, 0.5),
    coalesce(p_analysis ->> 'difficulty_label', 'just_right'),
    coalesce(p_analysis ->> 'difficulty_confidence', 'none'),
    coalesce(p_analysis -> 'signals', '{}'::jsonb),
    greatest(1, coalesce((p_analysis ->> 'estimated_minutes')::int, 1)),
    greatest(0, coalesce((p_analysis ->> 'preteach_target_count')::int, 0)),
    -- Taken from the chapter, not from the caller: an analysis must not be able
    -- to claim it describes content it does not.
    v_hash,
    coalesce(p_analysis ->> 'story_engine_version', 'story_v1'),
    now()
  )
  on conflict (user_id, chapter_id) do update
    set coverage_status       = excluded.coverage_status,
        coverage_ratio        = excluded.coverage_ratio,
        coverage_confidence   = excluded.coverage_confidence,
        observed_words        = excluded.observed_words,
        known_words           = excluded.known_words,
        total_words           = excluded.total_words,
        difficulty_score      = excluded.difficulty_score,
        difficulty_label      = excluded.difficulty_label,
        difficulty_confidence = excluded.difficulty_confidence,
        signals               = excluded.signals,
        estimated_minutes     = excluded.estimated_minutes,
        preteach_target_count = excluded.preteach_target_count,
        content_hash          = excluded.content_hash,
        story_engine_version  = excluded.story_engine_version,
        computed_at           = excluded.computed_at;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. PREPARATION LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
-- The word list is chosen by `src/lib/story/preparation.ts` and arrives here as
-- a snapshot. service_role for exactly the reason `create_daily_plan` is: this
-- accepts a computed selection, and a browser that could post its own would be
-- choosing its own "preparation".
--
-- CONCURRENCY. Two tabs starting preparation in the same second both insert; the
-- partial unique index makes one lose, and the loser returns the winner's
-- session rather than failing. Ten calls produce one session.
create or replace function public.start_chapter_preparation(
  p_user_id      uuid,
  p_chapter_id   uuid,
  p_items        jsonb,
  p_plan_item_id uuid default null,
  p_signals      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    uuid;
  v_session uuid;
  v_row     jsonb;
  v_pos     int := 0;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id into v_item
  from public.chapters c where c.id = p_chapter_id and c.status = 'ready';
  if not found then
    raise exception 'Rozdział nie jest gotowy.' using errcode = 'FL404';
  end if;

  if p_plan_item_id is not null and not exists (
    select 1 from public.daily_plan_items i
    join public.daily_plans p on p.id = i.plan_id
    where i.id = p_plan_item_id and p.user_id = p_user_id
  ) then
    raise exception 'Brak dostępu do tego zadania.' using errcode = 'FL403';
  end if;

  -- RESUME, NEVER DUPLICATE — and never re-select. A learner returning to an
  -- unfinished preparation gets the list they started with, because a task that
  -- rewrites itself halfway through is not a task.
  select s.id into v_session
  from public.chapter_preparation_sessions s
  where s.user_id = p_user_id and s.chapter_id = p_chapter_id
    and s.status = 'in_progress';
  if v_session is not null then
    if p_plan_item_id is not null then
      update public.chapter_preparation_sessions s
         set plan_item_id = p_plan_item_id
       where s.id = v_session and s.plan_item_id is distinct from p_plan_item_id;
    end if;
    return v_session;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Brak słów do przygotowania.' using errcode = 'FL404';
  end if;

  begin
    insert into public.chapter_preparation_sessions (
      user_id, chapter_id, library_item_id, plan_item_id, selection_signals
    ) values (
      p_user_id, p_chapter_id, v_item, p_plan_item_id, coalesce(p_signals, '{}'::jsonb)
    )
    returning id into v_session;
  exception when unique_violation then
    select s.id into v_session
    from public.chapter_preparation_sessions s
    where s.user_id = p_user_id and s.chapter_id = p_chapter_id
      and s.status = 'in_progress';
    return v_session;
  end;

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    v_pos := v_pos + 1;
    insert into public.chapter_preparation_items (
      session_id, word_id, item_position, lemma, display, translation,
      options, correct_idx, context_sentence, context_source, sentence_id
    ) values (
      v_session,
      (v_row ->> 'word_id')::bigint,
      v_pos,
      v_row ->> 'lemma',
      v_row ->> 'display',
      v_row ->> 'translation',
      array(select jsonb_array_elements_text(v_row -> 'options')),
      (v_row ->> 'correct_idx')::int,
      v_row ->> 'context_sentence',
      coalesce(v_row ->> 'context_source', 'none'),
      (v_row ->> 'sentence_id')::bigint
    )
    on conflict (session_id, word_id) do nothing;
  end loop;

  perform public.touch_chapter_learning_state(p_user_id, p_chapter_id, 'prepared');
  return v_session;
end;
$$;

-- Read a preparation's snapshot. Cards and options — never `correct_idx`.
create or replace function public.get_chapter_preparation(p_session_id uuid)
returns table (
  word_id          bigint,
  item_position    int,
  lemma            text,
  display          text,
  translation      text,
  options          text[],
  context_sentence text,
  context_source   text,
  selected_idx     int,
  is_correct       boolean,
  answered_at      timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user  uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id into v_owner
  from public.chapter_preparation_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja przygotowania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.word_id, i.item_position, i.lemma, i.display, i.translation,
         i.options, i.context_sentence, i.context_source,
         i.selected_idx, i.is_correct, i.answered_at
  from public.chapter_preparation_items i
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- Answer one preparation card. Identical trust model to `answer_test_question`:
-- the key is revealed only for an item in the caller's own in-progress session,
-- and only once their single answer has been committed. The first answer wins.
create or replace function public.answer_preparation_item(
  p_session_id   uuid,
  p_word_id      bigint,
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
  v_user        uuid := (select auth.uid());
  v_owner       uuid;
  v_status      text;
  v_answered_at timestamptz;
  v_stored      boolean;
  v_correct_idx int;
  v_options     int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id, s.status into v_owner, v_status
  from public.chapter_preparation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja przygotowania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'To przygotowanie zostało już zakończone.' using errcode = 'FL409';
  end if;

  select i.answered_at, i.is_correct, i.correct_idx,
         coalesce(array_length(i.options, 1), 0)
    into v_answered_at, v_stored, v_correct_idx, v_options
  from public.chapter_preparation_items i
  where i.session_id = p_session_id and i.word_id = p_word_id;
  if not found then
    raise exception 'To słowo nie należy do tej sesji.' using errcode = 'FL410';
  end if;

  if v_answered_at is not null then
    return query select v_stored, v_correct_idx, true;
    return;
  end if;

  if p_selected_idx is null or p_selected_idx < 0 or p_selected_idx >= v_options then
    raise exception 'Nieprawidłowy numer odpowiedzi.' using errcode = 'FL422';
  end if;

  update public.chapter_preparation_items i
     set selected_idx = p_selected_idx,
         is_correct   = (p_selected_idx = v_correct_idx),
         response_ms  = case
           when p_response_ms is null or p_response_ms < 0 then null
           else least(p_response_ms, 3600000) end,
         answered_at  = now()
   where i.session_id = p_session_id and i.word_id = p_word_id
     and i.answered_at is null;

  return query select (p_selected_idx = v_correct_idx), v_correct_idx, false;
end;
$$;

-- Seal a preparation, record what it proved, and move the plan — one transaction.
--
-- WHAT IT PROVES IS DELIBERATELY LITTLE. The evidence arrives already weighted by
-- `chapterPreparationEvidence`, at 0.24 rather than a full multiple-choice 0.6,
-- because recognising a word seconds after being shown its translation is the
-- easiest retrieval Fluent can construct. What makes preparation valuable to the
-- model is the RETENTION check days later, not this event.
--
-- Idempotent: a second call returns the stored result and re-applies no evidence.
create or replace function public.finalize_chapter_preparation(
  p_session_id uuid,
  p_user_id    uuid,
  p_evidence   jsonb
)
returns table (
  correct_count     int,
  total_count       int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.chapter_preparation_sessions%rowtype;
  v_total   int;
  v_correct int;
begin
  select * into v_session
  from public.chapter_preparation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja przygotowania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status in ('completed', 'skipped') then
    return query select v_session.correct, v_session.total, true;
    return;
  end if;

  select count(*)::int, count(*) filter (where i.is_correct)::int
    into v_total, v_correct
  from public.chapter_preparation_items i
  where i.session_id = p_session_id and i.answered_at is not null;

  update public.chapter_preparation_sessions s
     set status = 'completed', completed_at = now(),
         correct = v_correct, total = v_total
   where s.id = p_session_id;

  perform public.apply_learning_evidence(p_user_id, p_evidence);
  perform public.touch_chapter_learning_state(p_user_id, v_session.chapter_id, 'prepared');

  if v_session.plan_item_id is not null then
    update public.daily_plan_items i
       set completed_count = least(v_total, i.target_count),
           status          = case when v_total >= i.target_count then 'completed' else 'in_progress' end,
           started_at      = coalesce(i.started_at, now()),
           completed_at    = case when v_total >= i.target_count
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_session.plan_item_id and i.status <> 'skipped';
  end if;

  return query select v_correct, v_total, false;
end;
$$;

-- "Pomiń i czytaj."
--
-- THE STORY ENGINE MAY NOT IMPRISON THE READER. A learner who wants to open the
-- chapter right now is doing the thing the entire product exists for, and an
-- engine that stood in the way would be optimising for its own telemetry. The
-- skip is recorded because preparation ADOPTION is worth measuring, not because
-- skipping is a failure.
create or replace function public.skip_chapter_preparation(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;

  update public.chapter_preparation_sessions s
     set status = 'skipped', completed_at = now()
   where s.user_id = v_user and s.chapter_id = p_chapter_id
     and s.status = 'in_progress';

  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'preparation_skipped');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. THE CHALLENGE'S CANDIDATE POOL.
-- ─────────────────────────────────────────────────────────────────────────────
-- What the SELECTION needs and nothing more: metadata, plus when this learner
-- last answered each question. No prompt, no options, no key — the ranking in
-- `src/lib/story/selection.ts` does not need to read a question to score it, so
-- it is never given one.
--
-- That is not merely tidy. It means the whole personalisation layer runs on data
-- a learner could see without learning anything, and the answer key stays behind
-- a session snapshot exactly as `questions.correct_idx` has since Phase 1.
create or replace function public.get_chapter_question_candidates(p_chapter_id uuid)
returns table (
  question_id      bigint,
  kind             text,
  question_type    text,
  difficulty       int,
  word_id          bigint,
  concept_codes    text[],
  last_answered_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
  v_hash text;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;

  select c.content_hash into v_hash from public.chapters c where c.id = p_chapter_id;

  return query
  select q.id, q.kind, q.question_type, q.difficulty, q.word_id,
         coalesce(
           array(
             select qc.concept_code from public.chapter_question_concepts qc
             where qc.question_id = q.id order by qc.concept_code
           ),
           array[]::text[]
         ),
         answered.last_at
  from public.chapter_questions q
  left join lateral (
    select max(ai.answered_at) as last_at
    from public.chapter_assessment_items ai
    join public.chapter_assessment_sessions s on s.id = ai.session_id
    where s.user_id = v_user and ai.question_id = q.id
  ) answered on true
  where q.chapter_id = p_chapter_id
    and q.status = 'published'
    and q.validation_status = 'valid'
    -- STALE QUESTIONS ARE EXCLUDED, not silently reused. A question written from
    -- a version of the chapter that no longer exists may be asking about a
    -- paragraph that was edited away.
    and q.source_content_hash is not distinct from v_hash;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. ASSESSMENT LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SNAPSHOT IS WHAT MAKES THIS AN ASSESSMENT. Once the session starts, the
-- questions are fixed: a regeneration of the bank mid-Challenge cannot change
-- what the learner is being asked, and the client cannot choose, reorder or
-- extend them. The server picked them; the server remembers.
--
-- service_role, because the selection arrives computed.
create or replace function public.start_chapter_assessment(
  p_user_id      uuid,
  p_chapter_id   uuid,
  p_question_ids bigint[],
  p_blueprint    jsonb default '{}'::jsonb,
  p_signals      jsonb default '{}'::jsonb,
  p_plan_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     uuid;
  v_session  uuid;
  v_id       bigint;
  v_pos      int := 0;
  v_question public.chapter_questions%rowtype;
  v_order    int[];
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id into v_item
  from public.chapters c where c.id = p_chapter_id and c.status = 'ready';
  if not found then
    raise exception 'Rozdział nie jest gotowy.' using errcode = 'FL404';
  end if;

  -- A Challenge is about a chapter that was READ. Offering one before the
  -- chapter is finished would be asking what happened before it happened.
  if not exists (
    select 1 from public.reading_progress rp
    where rp.user_id = p_user_id and rp.chapter_id = p_chapter_id
      and rp.completed_at is not null
  ) then
    raise exception 'Ten rozdział nie został jeszcze ukończony.' using errcode = 'FL409';
  end if;

  if p_plan_item_id is not null and not exists (
    select 1 from public.daily_plan_items i
    join public.daily_plans p on p.id = i.plan_id
    where i.id = p_plan_item_id and p.user_id = p_user_id
  ) then
    raise exception 'Brak dostępu do tego zadania.' using errcode = 'FL403';
  end if;

  -- Resume rather than duplicate, and resume the SNAPSHOT: someone who closed
  -- the tab mid-Challenge returns to the same questions, not to easier ones.
  select s.id into v_session
  from public.chapter_assessment_sessions s
  where s.user_id = p_user_id and s.chapter_id = p_chapter_id
    and s.status = 'in_progress';
  if v_session is not null then
    if p_plan_item_id is not null then
      update public.chapter_assessment_sessions s
         set plan_item_id = p_plan_item_id
       where s.id = v_session and s.plan_item_id is distinct from p_plan_item_id;
    end if;
    return v_session;
  end if;

  if coalesce(array_length(p_question_ids, 1), 0) = 0 then
    raise exception 'Brak pytań do tego rozdziału.' using errcode = 'FL404';
  end if;

  begin
    insert into public.chapter_assessment_sessions (
      user_id, chapter_id, library_item_id, plan_item_id, blueprint, selection_signals
    ) values (
      p_user_id, p_chapter_id, v_item, p_plan_item_id,
      coalesce(p_blueprint, '{}'::jsonb), coalesce(p_signals, '{}'::jsonb)
    )
    returning id into v_session;
  exception when unique_violation then
    select s.id into v_session
    from public.chapter_assessment_sessions s
    where s.user_id = p_user_id and s.chapter_id = p_chapter_id
      and s.status = 'in_progress';
    return v_session;
  end;

  foreach v_id in array p_question_ids
  loop
    select * into v_question
    from public.chapter_questions q
    where q.id = v_id and q.chapter_id = p_chapter_id
      and q.status = 'published' and q.validation_status = 'valid';
    if not found then
      -- A question that vanished between selection and snapshot is skipped, not
      -- fatal: a Challenge one question short still measures something.
      continue;
    end if;

    v_pos := v_pos + 1;

    -- THE SHUFFLE FOR A SEQUENCE QUESTION. `sequence_items` is stored in the
    -- correct order, so a client given it as stored would be given the answer.
    -- The permutation is generated here, server-side, and the learner's ordering
    -- is graded by mapping back through it.
    v_order := null;
    if v_question.question_type = 'sequence' then
      select array_agg(idx order by random())
        into v_order
      from generate_series(0, coalesce(array_length(v_question.sequence_items, 1), 1) - 1) as idx;
    end if;

    insert into public.chapter_assessment_items (
      session_id, question_id, item_position, kind, question_type,
      item_difficulty, presented_order
    ) values (
      v_session, v_id, v_pos, v_question.kind, v_question.question_type,
      v_question.difficulty, v_order
    )
    on conflict (session_id, question_id) do nothing;
  end loop;

  if v_pos = 0 then
    raise exception 'Brak pytań do tego rozdziału.' using errcode = 'FL404';
  end if;

  return v_session;
end;
$$;

-- Read a Challenge's snapshot: prompts, and the options AS PRESENTED.
--
-- For a sequence question the items come back in the shuffled order recorded on
-- the item, so the correct order never leaves the database. For everything else
-- the answer key is simply not selected.
create or replace function public.get_chapter_assessment(p_session_id uuid)
returns table (
  question_id     bigint,
  item_position   int,
  kind            text,
  question_type   text,
  prompt          text,
  options         text[],
  sequence_items  text[],
  explanation_pl  text,
  selected_idx    int,
  typed_answer    text,
  sequence_answer int[],
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
  v_user  uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id into v_owner
  from public.chapter_assessment_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja wyzwania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.question_id, i.item_position, i.kind, i.question_type,
         q.prompt, q.options,
         case
           when i.question_type = 'sequence' and i.presented_order is not null then
             array(
               select q.sequence_items[o + 1]
               from unnest(i.presented_order) with ordinality as t(o, ord)
               order by t.ord
             )
           else null
         end,
         -- The explanation is only ever released after the answer is committed.
         case when i.answered_at is not null then q.explanation_pl else null end,
         i.selected_idx, i.typed_answer, i.sequence_answer, i.is_correct, i.answered_at
  from public.chapter_assessment_items i
  join public.chapter_questions q on q.id = i.question_id
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- Answer one Challenge question.
--
-- GRADING HAPPENS HERE, for all four answerable types, and the key is returned
-- only after the learner's single answer has been committed. That is the same
-- boundary `answer_test_question` established in Phase 1 and it is not softened
-- for a nicer-looking feature: a client that could see the key before answering
-- is a client that can score itself.
create or replace function public.answer_chapter_assessment_question(
  p_session_id      uuid,
  p_question_id     bigint,
  p_selected_idx    int    default null,
  p_typed_answer    text   default null,
  p_sequence_answer int[]  default null,
  p_response_ms     int    default null
)
returns table (
  is_answer_correct boolean,
  answer_key_idx    int,
  answer_key_text   text,
  answer_key_order  int[],
  explanation_pl    text,
  already_answered  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := (select auth.uid());
  v_owner       uuid;
  v_status      text;
  v_item        public.chapter_assessment_items%rowtype;
  v_question    public.chapter_questions%rowtype;
  v_correct     boolean;
  v_options     int;
  v_count       int;
  v_response_ms int;
  v_key_text    text;
  v_key_order   int[];
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id, s.status into v_owner, v_status
  from public.chapter_assessment_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja wyzwania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'To wyzwanie zostało już zakończone.' using errcode = 'FL409';
  end if;

  select * into v_item
  from public.chapter_assessment_items i
  where i.session_id = p_session_id and i.question_id = p_question_id;
  if not found then
    raise exception 'To pytanie nie należy do tego wyzwania.' using errcode = 'FL410';
  end if;

  select * into v_question
  from public.chapter_questions q where q.id = p_question_id;
  if not found then
    raise exception 'To pytanie nie istnieje.' using errcode = 'FL410';
  end if;

  v_key_text := case
    when v_question.question_type = 'cloze'
      then coalesce(v_question.accepted_answers[1], '')
    when v_question.options is not null and v_question.correct_idx is not null
      then v_question.options[v_question.correct_idx + 1]
    else null
  end;

  -- The correct answer expressed in PRESENTED positions, so the result screen
  -- can show the right order without ever receiving the stored one.
  if v_question.question_type = 'sequence' and v_item.presented_order is not null then
    select array_agg(pos order by target)
      into v_key_order
    from (
      select t.ord - 1 as pos, t.o as target
      from unnest(v_item.presented_order) with ordinality as t(o, ord)
    ) mapped;
  end if;

  if v_item.answered_at is not null then
    return query select v_item.is_correct, v_question.correct_idx, v_key_text,
                        v_key_order, v_question.explanation_pl, true;
    return;
  end if;

  if v_question.question_type in ('multiple_choice', 'true_false') then
    v_options := coalesce(array_length(v_question.options, 1), 0);
    if p_selected_idx is null or p_selected_idx < 0 or p_selected_idx >= v_options then
      raise exception 'Nieprawidłowy numer odpowiedzi.' using errcode = 'FL422';
    end if;
    v_correct := (p_selected_idx = v_question.correct_idx);

  elsif v_question.question_type = 'cloze' then
    if p_typed_answer is null or public.fold_typed_answer(p_typed_answer) = '' then
      raise exception 'Wpisz odpowiedź.' using errcode = 'FL422';
    end if;
    -- Case, spacing and a leading article are folded; diacritics are NOT, because
    -- *schon* and *schön* are different words.
    v_correct := exists (
      select 1 from unnest(v_question.accepted_answers) as a(value)
      where public.fold_typed_answer(a.value) = public.fold_typed_answer(p_typed_answer)
    );

  elsif v_question.question_type = 'sequence' then
    v_count := coalesce(array_length(v_question.sequence_items, 1), 0);
    if p_sequence_answer is null or array_length(p_sequence_answer, 1) is distinct from v_count then
      raise exception 'Ułóż wszystkie elementy.' using errcode = 'FL422';
    end if;
    -- The learner submits PRESENTED positions; mapping each back through the
    -- permutation must reproduce the stored order exactly.
    v_correct := not exists (
      select 1
      from unnest(p_sequence_answer) with ordinality as t(presented_pos, ord)
      where t.presented_pos < 0
         or t.presented_pos >= v_count
         or v_item.presented_order[t.presented_pos + 1] is distinct from (t.ord - 1)::int
    );

  else
    raise exception 'Ten typ pytania nie jest obsługiwany.' using errcode = 'FL422';
  end if;

  v_response_ms := case
    when p_response_ms is null or p_response_ms < 0 then null
    else least(p_response_ms, 3600000) end;

  update public.chapter_assessment_items i
     set selected_idx    = p_selected_idx,
         typed_answer    = left(p_typed_answer, 200),
         sequence_answer = p_sequence_answer,
         is_correct      = v_correct,
         response_ms     = v_response_ms,
         answered_at     = now()
   where i.session_id = p_session_id and i.question_id = p_question_id
     and i.answered_at is null;

  -- GLOBAL STATS, for a later empirical calibration. Nothing reads these to
  -- change a difficulty today — two answers are not a difficulty — and nothing
  -- ever shows them to a learner.
  insert into public.chapter_question_stats (
    question_id, answer_count, correct_count, response_ms_total, updated_at
  ) values (
    p_question_id, 1, case when v_correct then 1 else 0 end,
    coalesce(v_response_ms, 0), now()
  )
  on conflict (question_id) do update
    set answer_count      = public.chapter_question_stats.answer_count + 1,
        correct_count     = public.chapter_question_stats.correct_count
                            + case when v_correct then 1 else 0 end,
        response_ms_total = public.chapter_question_stats.response_ms_total
                            + coalesce(v_response_ms, 0),
        updated_at        = now();

  return query select v_correct, v_question.correct_idx, v_key_text, v_key_order,
                      v_question.explanation_pl, false;
end;
$$;

-- The SQL half of `foldTypedAnswer`.
--
-- A SECOND IMPLEMENTATION OF A RULE IS A RULE THAT WILL DRIFT, so this is
-- deliberately the only place in the database that folds an answer, it mirrors
-- `src/lib/story/questions.ts` exactly, and both are covered by tests that would
-- fail if either moved. Grading has to happen in SQL because the answer key must
-- never leave the database before the answer is committed.
create or replace function public.fold_typed_answer(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               lower(btrim(coalesce(p_value, ''))),
               '\s+', ' ', 'g'
             ),
             '^(der|die|das|ein|eine|einen|einem|einer)\s+', ''
           ),
           '[.,!?;:]+$', ''
         );
$$;

-- Seal a Challenge, write its evidence, move the plan and advance the lifecycle
-- — one transaction, so there is no state where the Challenge is finished and
-- today's plan still shows it as pending.
--
-- Idempotent: a second call returns the stored result and re-applies no evidence,
-- exactly as `finalize_test_session` does and for the same reason.
create or replace function public.finalize_chapter_assessment(
  p_session_id uuid,
  p_user_id    uuid,
  p_evidence   jsonb,
  p_scores     jsonb default '{}'::jsonb
)
returns table (
  correct_count     int,
  total_count       int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session    public.chapter_assessment_sessions%rowtype;
  v_total      int;
  v_correct    int;
  v_unanswered int;
begin
  select * into v_session
  from public.chapter_assessment_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja wyzwania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status = 'completed' then
    return query select v_session.correct, v_session.total, true;
    return;
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'To wyzwanie zostało porzucone.' using errcode = 'FL409';
  end if;

  select count(*)::int,
         count(*) filter (where i.answered_at is null)::int,
         count(*) filter (where i.is_correct)::int
    into v_total, v_unanswered, v_correct
  from public.chapter_assessment_items i
  where i.session_id = p_session_id;

  if v_total = 0 then
    raise exception 'To wyzwanie nie ma pytań.' using errcode = 'FL404';
  end if;
  if v_unanswered > 0 then
    raise exception 'Odpowiedz na wszystkie pytania.' using errcode = 'FL412';
  end if;

  update public.chapter_assessment_sessions s
     set status = 'completed', completed_at = now(),
         correct = v_correct, total = v_total,
         comprehension_correct = (p_scores ->> 'comprehension_correct')::int,
         comprehension_total   = (p_scores ->> 'comprehension_total')::int,
         vocabulary_correct    = (p_scores ->> 'vocabulary_correct')::int,
         vocabulary_total      = (p_scores ->> 'vocabulary_total')::int,
         grammar_correct       = (p_scores ->> 'grammar_correct')::int,
         grammar_total         = (p_scores ->> 'grammar_total')::int
   where s.id = p_session_id;

  -- The same evidence path as a test, a drill and a review. The Story Engine
  -- does not get its own knowledge model.
  perform public.apply_learning_evidence(p_user_id, p_evidence);
  perform public.touch_chapter_learning_state(
    p_user_id, v_session.chapter_id, 'assessment_completed'
  );

  if v_session.plan_item_id is not null then
    update public.daily_plan_items i
       set completed_count = least(v_total, i.target_count),
           status          = case when v_total >= i.target_count then 'completed' else 'in_progress' end,
           started_at      = coalesce(i.started_at, now()),
           completed_at    = case when v_total >= i.target_count
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_session.plan_item_id and i.status <> 'skipped';
  end if;

  return query select v_correct, v_total, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. THE READER FEEDS THE LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
-- `start_reading_session` and `complete_reading_chapter` already own the reading
-- facts. These wrappers let the reader's server actions advance the LEARNING
-- lifecycle in the same breath without either function learning about Phase 5 —
-- the reading tables stay exactly as Phase 4 left them.
create or replace function public.mark_chapter_reading_started(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;
  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'reading_started');
end;
$$;

create or replace function public.mark_chapter_reading_completed(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  -- MEASURED, NEVER ASSERTED. The lifecycle only advances if the reading table
  -- — which itself refuses below the completion threshold — says the chapter was
  -- finished. There is no "mark this read" endpoint and there must not be one.
  if not exists (
    select 1 from public.reading_progress rp
    where rp.user_id = v_user and rp.chapter_id = p_chapter_id
      and rp.completed_at is not null
  ) then
    raise exception 'Ten rozdział nie został jeszcze ukończony.' using errcode = 'FL409';
  end if;
  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'reading_completed');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. TODAY INTEGRATION.
-- ─────────────────────────────────────────────────────────────────────────────
-- COMPLETION STAYS DERIVED. `sync_daily_plan` recomputes each activity from the
-- table that recorded the underlying work — never from an assertion — which is
-- what makes plan completion idempotent, unforgeable and self-healing. The two
-- new branches follow exactly that rule: a preparation item is done when a
-- preparation session for the chapter completed today, an assessment item when a
-- Challenge did.
--
-- A SKIPPED PREPARATION COUNTS AS DONE. The learner resolved the task — they
-- decided they did not need it and went to read, which is the outcome the whole
-- engine is for. Leaving it pending would nag someone for doing the right thing.
create or replace function public.sync_daily_plan(p_plan_id uuid)
returns table (
  item_id         uuid,
  item_status     text,
  completed_count int,
  plan_status     text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user       uuid := (select auth.uid());
  v_plan       public.daily_plans%rowtype;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_item       public.daily_plan_items%rowtype;
  v_done       int;
  v_status     text;
  v_vocab_ids  bigint[];
  v_open       int;
  v_completed  int;
  v_plan_state text;
  v_touched    boolean;
  v_seconds    int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_plan from public.daily_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'Plan nie istnieje.' using errcode = 'FL404';
  end if;
  if v_plan.user_id <> v_user then
    raise exception 'Brak dostępu do tego planu.' using errcode = 'FL403';
  end if;

  v_day_start := public.learning_day_start(v_plan.learning_date, v_plan.timezone);
  v_day_end   := v_day_start + interval '1 day';

  select coalesce(array_agg(w), array[]::bigint[]) into v_vocab_ids
  from (
    select distinct unnest(i.word_ids) as w
    from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.item_type = 'new_vocabulary'
  ) t;

  for v_item in
    select * from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position
  loop
    if v_item.status = 'skipped' then
      continue;
    end if;

    v_done    := 0;
    v_touched := false;

    if v_item.item_type = 'review_due' then
      select count(*)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and not (r.word_id = any (v_vocab_ids));

    elsif v_item.item_type = 'new_vocabulary' then
      select count(distinct r.word_id)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and r.word_id = any (v_item.word_ids);

    elsif v_item.item_type = 'weakness_practice' then
      select coalesce(max(s.total), 0)::int into v_done
      from public.practice_sessions s
      where s.plan_item_id = v_item.id and s.status = 'completed';
      if v_done = 0 then
        select count(*)::int into v_done
        from public.practice_session_items pi
        join public.practice_sessions s on s.id = pi.session_id
        where s.plan_item_id = v_item.id
          and s.status = 'in_progress'
          and pi.answered_at is not null;
      end if;

    elsif v_item.item_type in ('continue_text', 'new_text') then
      v_touched := exists (
        select 1 from public.text_progress tp
        where tp.user_id = v_user and tp.text_id = v_item.text_id
          and tp.last_opened_at >= v_day_start and tp.last_opened_at < v_day_end
      );
      if exists (
        select 1 from public.text_completions c
        where c.user_id = v_user and c.text_id = v_item.text_id
          and c.completed_at >= v_day_start and c.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif v_touched or exists (
        select 1 from public.test_sessions s
        where s.user_id = v_user and s.text_id = v_item.text_id
          and s.status = 'in_progress'
      ) then
        v_touched := true;
      end if;

    elsif v_item.item_type in ('continue_chapter', 'new_chapter') then
      select coalesce(sum(s.active_seconds), 0)::int into v_seconds
      from public.reading_sessions s
      where s.user_id = v_user and s.chapter_id = v_item.chapter_id
        and s.started_at >= v_day_start and s.started_at < v_day_end;

      v_touched := exists (
        select 1 from public.reading_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.started_at >= v_day_start and s.started_at < v_day_end
      );

      if exists (
        select 1 from public.reading_progress rp
        where rp.user_id = v_user and rp.chapter_id = v_item.chapter_id
          and rp.completed_at >= v_day_start and rp.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif v_item.target_seconds is not null
        and v_item.target_seconds > 0
        and v_seconds >= v_item.target_seconds
      then
        v_done := v_item.target_count;
      end if;

    elsif v_item.item_type = 'chapter_preparation' then
      -- Completed OR skipped: both resolve the task. Skipping is the learner
      -- deciding they are ready to read, which is the point of the whole thing.
      if exists (
        select 1 from public.chapter_preparation_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status in ('completed', 'skipped')
          and s.completed_at >= v_day_start and s.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      else
        select count(*)::int into v_done
        from public.chapter_preparation_items pi
        join public.chapter_preparation_sessions s on s.id = pi.session_id
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status = 'in_progress'
          and pi.answered_at is not null;
      end if;

    elsif v_item.item_type = 'chapter_assessment' then
      if exists (
        select 1 from public.chapter_assessment_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status = 'completed'
          and s.completed_at >= v_day_start and s.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      else
        select count(*)::int into v_done
        from public.chapter_assessment_items ai
        join public.chapter_assessment_sessions s on s.id = ai.session_id
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status = 'in_progress'
          and ai.answered_at is not null;
      end if;

    elsif v_item.item_type = 'placement' then
      if exists (
        select 1 from public.profiles p
        where p.id = v_user and p.level_source <> 'default'
      ) then
        v_done := v_item.target_count;
      end if;
    end if;

    v_done := least(greatest(v_done, 0), v_item.target_count);

    if v_done >= v_item.target_count then
      v_status := 'completed';
    elsif v_done > 0 or v_touched then
      v_status := 'in_progress';
    else
      v_status := 'pending';
    end if;

    update public.daily_plan_items i
       set completed_count = v_done,
           status          = v_status,
           started_at      = case when i.started_at is null and v_status <> 'pending'
                                  then now() else i.started_at end,
           completed_at    = case when v_status = 'completed'
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_item.id;
  end loop;

  select count(*) filter (where i.status in ('pending', 'in_progress'))::int,
         count(*) filter (where i.status = 'completed')::int
    into v_open, v_completed
  from public.daily_plan_items i where i.plan_id = p_plan_id;

  if v_open = 0 and v_completed > 0 then
    v_plan_state := 'completed';
  elsif v_completed > 0 or exists (
    select 1 from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.status in ('in_progress', 'skipped')
  ) then
    v_plan_state := 'in_progress';
  else
    v_plan_state := 'pending';
  end if;

  update public.daily_plans p
     set status       = v_plan_state,
         started_at   = case when p.started_at is null and v_plan_state <> 'pending'
                             then now() else p.started_at end,
         completed_at = case when v_plan_state = 'completed'
                             then coalesce(p.completed_at, now()) else null end
   where p.id = p_plan_id;

  return query
    select i.id, i.status, i.completed_count, v_plan_state
    from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- The split is the one every phase here uses. A learner may start, answer, skip,
-- defer and report — all of which derive the learner from auth.uid() and write
-- only what they did. A learner may NOT author a question bank, seal a session,
-- write an analysis or run a generation job, because every one of those accepts
-- computed values. Those are REVOKED from the roles a browser can hold, not
-- merely left ungranted.

revoke all on function public.upsert_chapter_questions(uuid, jsonb, jsonb) from public;
revoke all on function public.upsert_chapter_questions(uuid, jsonb, jsonb) from anon, authenticated;
grant execute on function public.upsert_chapter_questions(uuid, jsonb, jsonb) to service_role;

revoke all on function public.mark_stale_chapter_questions(uuid) from public;
revoke all on function public.mark_stale_chapter_questions(uuid) from anon, authenticated;
grant execute on function public.mark_stale_chapter_questions(uuid) to service_role;

revoke all on function public.upsert_chapter_analysis(uuid, uuid, jsonb) from public;
revoke all on function public.upsert_chapter_analysis(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.upsert_chapter_analysis(uuid, uuid, jsonb) to service_role;

revoke all on function public.start_chapter_preparation(uuid, uuid, jsonb, uuid, jsonb) from public;
revoke all on function public.start_chapter_preparation(uuid, uuid, jsonb, uuid, jsonb) from anon, authenticated;
grant execute on function public.start_chapter_preparation(uuid, uuid, jsonb, uuid, jsonb) to service_role;

revoke all on function public.finalize_chapter_preparation(uuid, uuid, jsonb) from public;
revoke all on function public.finalize_chapter_preparation(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.finalize_chapter_preparation(uuid, uuid, jsonb) to service_role;

revoke all on function public.start_chapter_assessment(uuid, uuid, bigint[], jsonb, jsonb, uuid) from public;
revoke all on function public.start_chapter_assessment(uuid, uuid, bigint[], jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public.start_chapter_assessment(uuid, uuid, bigint[], jsonb, jsonb, uuid) to service_role;

revoke all on function public.finalize_chapter_assessment(uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.finalize_chapter_assessment(uuid, uuid, jsonb, jsonb) from anon, authenticated;
grant execute on function public.finalize_chapter_assessment(uuid, uuid, jsonb, jsonb) to service_role;

revoke all on function public.touch_chapter_learning_state(uuid, uuid, text) from public;
revoke all on function public.touch_chapter_learning_state(uuid, uuid, text) from anon, authenticated;
grant execute on function public.touch_chapter_learning_state(uuid, uuid, text) to service_role;

revoke all on function public.start_chapter_generation_job(uuid, text) from public;
revoke all on function public.start_chapter_generation_job(uuid, text) from anon, authenticated;
grant execute on function public.start_chapter_generation_job(uuid, text) to service_role;

revoke all on function public.finish_chapter_generation_job(uuid, text, jsonb) from public;
revoke all on function public.finish_chapter_generation_job(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.finish_chapter_generation_job(uuid, text, jsonb) to service_role;

grant execute on function public.chapter_is_readable(uuid)                  to anon, authenticated;
grant execute on function public.fold_typed_answer(text)                    to anon, authenticated;
grant execute on function public.get_chapter_preparation(uuid)              to authenticated;
grant execute on function public.answer_preparation_item(uuid, bigint, int, int) to authenticated;
grant execute on function public.skip_chapter_preparation(uuid)             to authenticated;
grant execute on function public.get_chapter_question_candidates(uuid)      to authenticated;
grant execute on function public.get_chapter_assessment(uuid)               to authenticated;
grant execute on function public.answer_chapter_assessment_question(uuid, bigint, int, text, int[], int)
  to authenticated;
grant execute on function public.defer_chapter_assessment(uuid)             to authenticated;
grant execute on function public.mark_chapter_reading_started(uuid)         to authenticated;
grant execute on function public.mark_chapter_reading_completed(uuid)       to authenticated;
grant execute on function public.report_chapter_question(bigint, text, text) to authenticated;
grant execute on function public.set_chapter_question_status(bigint, text)  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- Read-only to the learner it belongs to, and unwritable by anyone holding a
-- browser credential. There is no insert, update or delete policy on ANY table
-- in this migration — for the same reason there is none on `attempts`: a
-- Challenge result a learner can write is a result that proves nothing.
alter table public.user_chapter_learning_state  enable row level security;
alter table public.chapter_user_analysis        enable row level security;
alter table public.chapter_questions            enable row level security;
alter table public.chapter_question_concepts    enable row level security;
alter table public.chapter_question_stats       enable row level security;
alter table public.chapter_question_reports     enable row level security;
alter table public.chapter_generation_jobs      enable row level security;
alter table public.chapter_preparation_sessions enable row level security;
alter table public.chapter_preparation_items    enable row level security;
alter table public.chapter_assessment_sessions  enable row level security;
alter table public.chapter_assessment_items     enable row level security;

drop policy if exists "own chapter learning state read" on public.user_chapter_learning_state;
create policy "own chapter learning state read" on public.user_chapter_learning_state
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own chapter analysis read" on public.chapter_user_analysis;
create policy "own chapter analysis read" on public.chapter_user_analysis
  for select using ((select auth.uid()) = user_id);

-- THE ANSWER ORACLE STAYS CLOSED.
--
-- `chapter_questions` has NO learner select policy — not for a reader, and not
-- for the owner of a private import either. A learner who could read this table
-- could read `correct_idx`, `accepted_answers` and `sequence_items`, which is the
-- whole answer key of every Challenge they are about to take. Prompts reach them
-- through `get_chapter_assessment`, for a question they are currently being
-- asked, and nowhere else.
--
-- Admins may read PUBLIC content's questions, to review the bank. A private
-- import is outside that: an admin panel is a content tool, not a reason to open
-- somebody's personal library.
drop policy if exists "chapter questions public read" on public.chapter_questions;
drop policy if exists "chapter questions admin read" on public.chapter_questions;
create policy "chapter questions admin read" on public.chapter_questions
  for select using (owner_user_id is null and public.is_admin());

drop policy if exists "chapter question concepts admin read" on public.chapter_question_concepts;
create policy "chapter question concepts admin read" on public.chapter_question_concepts
  for select using (
    exists (
      select 1 from public.chapter_questions q
      where q.id = chapter_question_concepts.question_id
        and q.owner_user_id is null
        and public.is_admin()
    )
  );

-- Global statistics are an admin tool for finding broken questions. A learner is
-- never shown them — "68% of people got this wrong" is a hint.
drop policy if exists "chapter question stats admin read" on public.chapter_question_stats;
create policy "chapter question stats admin read" on public.chapter_question_stats
  for select using (public.is_admin());

drop policy if exists "chapter question reports read" on public.chapter_question_reports;
create policy "chapter question reports read" on public.chapter_question_reports
  for select using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "chapter generation jobs admin read" on public.chapter_generation_jobs;
create policy "chapter generation jobs admin read" on public.chapter_generation_jobs
  for select using (
    exists (
      select 1 from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = chapter_generation_jobs.chapter_id
        and (
          (i.owner_user_id is null and public.is_admin())
          or i.owner_user_id = (select auth.uid())
        )
    )
  );

drop policy if exists "own preparation sessions read" on public.chapter_preparation_sessions;
create policy "own preparation sessions read" on public.chapter_preparation_sessions
  for select using ((select auth.uid()) = user_id);

-- The item rows carry `correct_idx`, so this policy is as narrow as it looks: a
-- learner may read their OWN preparation cards, which they have already been
-- shown. Preparation is a warm-up, not an assessment — the key is on screen
-- seconds later either way — but it is still scoped to the session's owner.
drop policy if exists "own preparation items read" on public.chapter_preparation_items;
create policy "own preparation items read" on public.chapter_preparation_items
  for select using (
    exists (
      select 1 from public.chapter_preparation_sessions s
      where s.id = chapter_preparation_items.session_id
        and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "own assessment sessions read" on public.chapter_assessment_sessions;
create policy "own assessment sessions read" on public.chapter_assessment_sessions
  for select using ((select auth.uid()) = user_id);

-- Readable because it holds the learner's own answers and no key: the correct
-- answer lives on `chapter_questions`, which they cannot read, and
-- `presented_order` is the shuffle they were shown.
drop policy if exists "own assessment items read" on public.chapter_assessment_items;
create policy "own assessment items read" on public.chapter_assessment_items
  for select using (
    exists (
      select 1 from public.chapter_assessment_sessions s
      where s.id = chapter_assessment_items.session_id
        and s.user_id = (select auth.uid())
    )
  );

-- === END 20260914180000_story_learning_engine.sql ===

-- === BEGIN supabase/migrations/20260915120000_private_book_import.sql ===

-- Fluent — Phase 5.5: the private book import engine.
--
-- WHAT THIS ADDS. Until now the only way a text reached the library was an admin
-- pasting it into `/admin/library`, one chapter at a time. That is a workable
-- way to publish forty graded passages and an impossible way to read a novel:
-- nobody is going to paste seventy-three chapters of "Der Prozess" into a form,
-- and if they did, the result would be first-party content owned by Fluent
-- rather than a private file owned by whoever uploaded it.
--
-- So this migration builds the other door. A learner uploads a PDF, an EPUB or a
-- TXT; the server extracts, cleans and splits it; the learner checks the chapter
-- list and confirms; and the result is an ordinary `library_items` row with
-- `rights = 'private_import'`, whose chapters go through the same content
-- pipeline, the same reader and the same Story engine as everything else.
--
-- THE THREE INVARIANTS THIS SCHEMA EXISTS TO ENFORCE.
--
--   1. A PRIVATE BOOK CANNOT BECOME PUBLIC. `rights` and `owner_user_id` are set
--      by `finalize_book_import` and by nothing else; `library_item_readable`
--      (Phase 4) already refuses an owned item to everyone but its owner,
--      including admins. There is no code path that clears `owner_user_id`.
--
--   2. FINALIZING IS IDEMPOTENT. Two clicks, two tabs, two concurrent requests:
--      one book. The import row is locked, `final_library_item_id` is the
--      receipt, and a second call returns the first call's answer.
--
--   3. THE CLIENT OWNS NOTHING SYSTEMIC. `user_id`, `storage_path`, `status`,
--      `final_library_item_id` have no learner write path — same rule progress
--      has followed since Phase 1. Titles, inclusion and splits are edited
--      through one SECURITY DEFINER function that derives the owner from
--      `auth.uid()` and keeps positions contiguous in the same transaction.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE IMPORT — one row per uploaded file.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TABLE AND NOT A REQUEST. A 400-page novel cannot be extracted, cleaned,
-- split, reviewed and processed inside one HTTP request on any deployment Fluent
-- targets, and a learner who closes the tab must not lose the upload they waited
-- two minutes for. So the import is a persistent object with a state machine:
-- every stage reads its state from here, writes its state back here, and can be
-- resumed by any later request.
--
-- STATUS AND STAGE ARE DIFFERENT QUESTIONS. `status` is where the import is in
-- its life and decides which screen renders; `stage` is what the work is doing
-- and decides what that screen says. Collapsed into one column the UI can only
-- say "przetwarzanie" for two minutes, which tells a learner nothing about
-- whether anything is happening. The values are mirrored in
-- `src/lib/import/state.ts`, which also holds the transition table.
create table if not exists public.book_imports (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  file_name text not null,
  file_type text not null check (file_type in ('pdf', 'epub', 'txt')),
  file_size bigint not null default 0,

  -- SHA-256 of the original, computed in the browser before the upload starts.
  -- Used for ONE thing: telling a learner "this looks like a book you already
  -- have". Never a uniqueness constraint — wanting a second copy is legitimate,
  -- and a hash is not a policy.
  file_hash text,

  -- `<user_id>/<import_id>/original.<ext>` in the private bucket. Written by
  -- `create_book_import` so that the path always agrees with the row, and never
  -- by a client, which is what makes the Storage policy's prefix check a
  -- guarantee rather than a convention.
  storage_path text not null,

  status text not null default 'uploaded'
    check (status in (
      'uploaded', 'extracting', 'analyzing', 'awaiting_review',
      'importing', 'processing', 'ready', 'failed', 'cancelled'
    )),

  stage text
    check (stage in (
      'extract_text', 'detect_metadata', 'detect_chapters',
      'persist_content', 'process_chapters'
    )),

  -- REAL COUNTS, NOT A PERCENTAGE. "17 z 42 rozdziałów" is a fact the learner
  -- can check; "73%" is a number invented to fill a progress bar. Recomputed
  -- from the `chapters` rows by `sync_book_import_processing` rather than
  -- incremented, so a retried batch cannot count a chapter twice.
  total_chapters     int not null default 0,
  processed_chapters int not null default 0,
  failed_chapters    int not null default 0,

  -- What the FILE said about itself, kept apart from what the LEARNER confirmed.
  -- PDF metadata is wrong often enough that overwriting the learner's correction
  -- with it on a re-analysis would be a bug; two columns make that impossible.
  detected_title    text,
  detected_author   text,
  detected_language text,
  language_confidence numeric,

  title  text,
  author text,

  page_count    int,
  word_count    int not null default 0,
  chapter_count int not null default 0,

  -- Extraction quality signals (sparse pages, garbage ratio, text samples).
  -- jsonb because it is a diagnostic report read as a whole, never queried by
  -- field, and because adding a signal must not need a migration.
  quality jsonb not null default '{}'::jsonb,

  -- WHICH PIPELINE BUILT THIS. `pipeline_version` stamps extraction and cleanup,
  -- `detector_version` stamps chapter detection. Separate because they answer
  -- separate questions and improve on separate schedules — and because
  -- "which imports predate the better detector?" is the question that makes
  -- re-analysis worth offering at all.
  pipeline_version text,
  detector_version text,

  -- THE IDEMPOTENCY RECEIPT. Non-null means this import has already become a
  -- book, and finalizing again returns this id instead of creating a second one.
  final_library_item_id uuid references public.library_items(id) on delete set null,

  -- Classified failure, for the UI, plus a technical detail for the logs. The
  -- learner never sees `error_message`; `src/lib/import/state.ts` maps
  -- `error_code` to a Polish sentence that says what to try next.
  error_code    text,
  error_message text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  analyzed_at  timestamptz,
  finalized_at timestamptz
);

-- One import per stored object. Belt and braces: the path already contains the
-- import id, so a collision would mean `gen_random_uuid()` repeated itself.
create unique index if not exists book_imports_storage_path_idx
  on public.book_imports (storage_path);

-- "My imports, newest first" — the whole of the import history screen.
create index if not exists book_imports_user_recent_idx
  on public.book_imports (user_id, created_at desc);

-- "Have I imported this file before?" One index lookup, scoped to the learner:
-- a hash is never compared across accounts, because whether somebody else has
-- the same book is not Fluent's business.
create index if not exists book_imports_user_hash_idx
  on public.book_imports (user_id, file_hash) where file_hash is not null;

-- Unconfirmed drafts, oldest first — what a future cleanup job scans.
create index if not exists book_imports_draft_age_idx
  on public.book_imports (updated_at)
  where status in ('uploaded', 'extracting', 'analyzing', 'awaiting_review', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE PREVIEW — detected chapters, before they are a book.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NOT `chapters`. A detected chapter is a PROPOSAL. Writing proposals
-- into the library would mean a cancelled import leaves a half-book on the shelf,
-- an abandoned import leaves rows the reader can open, and "is this a real book?"
-- becomes a status check in every library query. Keeping the proposal in its own
-- table means cancelling is a delete and nothing else in the app has to know the
-- importer exists.
--
-- IT HOLDS THE CLEANED TEXT. The alternative — re-extracting the PDF each time
-- the learner opens the preview — would make every keystroke in the review
-- screen cost a full re-parse of the book. The original binary stays in Storage,
-- this holds the text once, and after finalizing the text lives on `chapters`
-- and these rows are the only copy that can be dropped.
create table if not exists public.book_import_chapters (
  id        uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.book_imports(id) on delete cascade,

  -- 1-based and contiguous. Kept contiguous by `edit_book_import_chapters`,
  -- which is why the constraint below is DEFERRABLE: a reorder swaps two
  -- positions and would otherwise collide with itself mid-statement.
  position int not null,

  -- What the detector proposed, and what the learner decided. Two columns for
  -- the same reason the import has `detected_title` and `title`: a re-analysis
  -- must never silently overwrite a correction somebody typed.
  detected_title text,
  title          text,

  source_text text not null default '',
  word_count  int  not null default 0,

  -- WHERE THIS CAME FROM IN THE FILE. Page numbers for a PDF, spine index for an
  -- EPUB. Not used by the reader; used by a person trying to work out why a
  -- split landed where it did, which is the only way a detector ever improves.
  source_page_start int,
  source_page_end   int,
  source_href       text,

  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  -- Which signals fired. Diagnostic, never rendered raw to a learner.
  signals jsonb not null default '[]'::jsonb,

  -- Title pages, contents, colophons. Detected so the preview can offer them
  -- switched OFF; never deleted, because an importer that silently drops pages
  -- is an importer nobody trusts.
  is_front_matter boolean not null default false,
  included        boolean not null default true,

  -- THE GUARD ON MANUAL WORK. Set the moment a learner renames, splits, merges
  -- or reorders. `apply_book_import_analysis` refuses to replace a chapter set
  -- containing edited rows, so re-running the detector cannot quietly destroy
  -- twenty minutes of somebody's corrections.
  edited boolean not null default false,

  -- Filled in by `finalize_book_import`, so a chapter in the library can be
  -- traced back to the proposal it came from.
  chapter_id uuid references public.chapters(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'book_import_chapters_position_key'
  ) then
    -- DEFERRABLE on purpose. "Move chapter 7 up" is two updates that transiently
    -- collide; an immediate constraint would force a shuffle through a sentinel
    -- position, which is three times the statements and one more way to leave the
    -- list inconsistent if anything throws.
    alter table public.book_import_chapters
      add constraint book_import_chapters_position_key
      unique (import_id, position) deferrable initially deferred;
  end if;
end $$;

create index if not exists book_import_chapters_import_idx
  on public.book_import_chapters (import_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. WHERE A CHAPTER CAME FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- One nullable column rather than a join table: a chapter has at most one
-- import, the reference is documentation rather than something the reader
-- branches on, and `on delete set null` means deleting an import never touches
-- a book that already exists.
alter table public.chapters
  add column if not exists import_id uuid references public.book_imports(id) on delete set null;

create index if not exists chapters_import_idx
  on public.chapters (import_id) where import_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PRIVATE STORAGE.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ORIGINAL FILE IS NOT DATABASE DATA. A 30 MB PDF in a `bytea` column is a
-- 30 MB row that every backup, every replica and every `select *` pays for, to
-- store something that is read at most twice in its life. It goes in Storage.
--
-- THE BUCKET IS PRIVATE, AND THAT IS ENFORCED TWICE: `public = false` means no
-- object has a public URL at all, and the policies below scope every operation
-- to the first path segment, which `create_book_import` sets to the owner's id.
-- "The URL is hard to guess" is not a security model.
--
-- Guarded on `storage.objects` existing so that the schema still applies to a
-- plain PostgreSQL instance — which is exactly what `supabase/tests/run.sh`
-- does. The test shim provides a minimal `storage` schema so these policies are
-- created, and exercised, there too.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('private-book-imports', 'private-book-imports', false)
    on conflict (id) do nothing;
  end if;

  if to_regclass('storage.objects') is not null then
    -- A hosted Supabase project already has RLS on `storage.objects`, and the
    -- role running migrations may not own that table. Enabling it again would
    -- fail for a permission reason on a database where it is already correct, so
    -- it is only touched when it is actually off.
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
      execute 'alter table storage.objects enable row level security';
    end if;

    -- READ / WRITE / DELETE YOUR OWN PREFIX, AND NOTHING ELSE.
    --
    -- `split_part(name, '/', 1)` is the owner's user id, because the path is
    -- minted server-side as `<user_id>/<import_id>/original.<ext>`. A learner
    -- cannot upload into somebody else's folder (the WITH CHECK refuses it) and
    -- cannot read out of one (the USING refuses it). `anon` gets nothing: the
    -- policies are on `authenticated` alone.
    execute 'drop policy if exists "own book imports read" on storage.objects';
    execute $p$
      create policy "own book imports read" on storage.objects
        for select to authenticated using (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;

    execute 'drop policy if exists "own book imports insert" on storage.objects';
    execute $p$
      create policy "own book imports insert" on storage.objects
        for insert to authenticated with check (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;

    execute 'drop policy if exists "own book imports update" on storage.objects';
    execute $p$
      create policy "own book imports update" on storage.objects
        for update to authenticated using (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        ) with check (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;

    execute 'drop policy if exists "own book imports delete" on storage.objects';
    execute $p$
      create policy "own book imports delete" on storage.objects
        for delete to authenticated using (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;
  end if;
exception
  when insufficient_privilege then
    -- Some managed deployments lock the `storage` schema to its own admin role.
    -- The migration must not abort — every other object here is independent of
    -- Storage — and the failure mode is SAFE: without the bucket, uploads fail
    -- loudly, and without the policies RLS denies everything. Fail closed, warn,
    -- and let the operator apply the block by hand.
    raise warning 'book import storage objects were not created (%). Create the private bucket and its policies manually — see supabase/migrations/README.md.', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CREATING AN IMPORT.
-- ─────────────────────────────────────────────────────────────────────────────
-- The learner supplies the file's name, type, size and hash. Everything the
-- system depends on — who owns it, where it is stored, what state it is in — is
-- derived here, from `auth.uid()`, and is therefore not something a crafted
-- request can set.
create or replace function public.create_book_import(
  p_file_name text,
  p_file_type text,
  p_file_size bigint,
  p_file_hash text default null
)
returns public.book_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_id     uuid := gen_random_uuid();
  v_ext    text;
  v_result public.book_imports;
begin
  if v_user is null then
    raise exception 'Zaloguj się, aby zaimportować książkę.' using errcode = 'FL401';
  end if;

  if p_file_type not in ('pdf', 'epub', 'txt') then
    raise exception 'Nieobsługiwany format pliku.' using errcode = 'FL422';
  end if;

  -- 40 MB. THE ONE PLACE THIS NUMBER IS DUPLICATED: `MAX_BOOK_IMPORT_MB` in
  -- `src/lib/import/constants.ts` is what the browser and the server action read,
  -- and a PL/pgSQL function cannot import it. Change both together. The database
  -- enforces the limit because a browser check is a courtesy to the uploader, not
  -- a control.
  if coalesce(p_file_size, 0) <= 0 or p_file_size > 40 * 1024 * 1024 then
    raise exception 'Plik ma nieprawidłowy rozmiar.' using errcode = 'FL422';
  end if;

  v_ext := p_file_type;

  insert into public.book_imports (
    id, user_id, file_name, file_type, file_size, file_hash, storage_path, status
  )
  values (
    v_id,
    v_user,
    -- The name is displayed, never used as a path. Trimmed and bounded so a
    -- pathological filename cannot break a layout.
    left(coalesce(nullif(trim(p_file_name), ''), 'książka'), 200),
    p_file_type,
    p_file_size,
    nullif(trim(p_file_hash), ''),
    v_user::text || '/' || v_id::text || '/original.' || v_ext,
    'uploaded'
  )
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.create_book_import(text, text, bigint, text) is
  'Mint an import row for the caller. Owner and storage path are derived from auth.uid(), never accepted from the client.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MOVING THE STATE MACHINE.
-- ─────────────────────────────────────────────────────────────────────────────
-- service_role only. The stages between `uploaded` and `awaiting_review` are
-- server work, and a client that could declare itself `ready` could declare an
-- unextracted file a finished book.
create or replace function public.set_book_import_state(
  p_import_id     uuid,
  p_status        text,
  p_stage         text default null,
  p_error_code    text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.book_imports i
  set status        = p_status,
      stage         = p_stage,
      error_code    = p_error_code,
      -- Bounded: a Postgres error detail can be long, and this column is read by
      -- humans debugging, not by machines.
      error_message = left(p_error_message, 1000),
      updated_at    = now()
  where i.id = p_import_id;

  if not found then
    raise exception 'Import nie istnieje.' using errcode = 'FL404';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RECORDING ONE ANALYSIS RUN.
-- ─────────────────────────────────────────────────────────────────────────────
-- The whole result of extraction, cleanup and detection, written in one
-- transaction: the import's metadata and its complete chapter proposal. Partial
-- state is not a thing this can leave behind.
--
-- IT REFUSES TO DESTROY MANUAL WORK. If any proposed chapter carries
-- `edited = true`, the caller is re-running the detector over corrections
-- somebody made by hand, and the answer is FL423 rather than a silent overwrite.
-- The UI turns that into "re-analysis would discard your changes" and asks.
create or replace function public.apply_book_import_analysis(
  p_import_id uuid,
  p_payload   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import  public.book_imports%rowtype;
  v_chapter jsonb;
  v_index   int := 0;
begin
  select * into v_import from public.book_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'Import nie istnieje.' using errcode = 'FL404';
  end if;

  if v_import.final_library_item_id is not null then
    raise exception 'Ten import został już zakończony.' using errcode = 'FL409';
  end if;

  if exists (
    select 1 from public.book_import_chapters c
    where c.import_id = p_import_id and c.edited
  ) and coalesce((p_payload ->> 'force')::boolean, false) is not true then
    raise exception 'Import ma ręczne poprawki.' using errcode = 'FL423';
  end if;

  update public.book_imports i
  set detected_title      = nullif(p_payload ->> 'detected_title', ''),
      detected_author     = nullif(p_payload ->> 'detected_author', ''),
      detected_language   = nullif(p_payload ->> 'detected_language', ''),
      language_confidence = (p_payload ->> 'language_confidence')::numeric,
      -- The learner's own title survives re-analysis; the detector only fills a
      -- field nobody has typed in yet.
      title               = coalesce(i.title, nullif(p_payload ->> 'detected_title', '')),
      author              = coalesce(i.author, nullif(p_payload ->> 'detected_author', '')),
      -- The hash the SERVER computed over the stored bytes replaces the one the
      -- browser claimed at upload time. It only drives a duplicate warning, but
      -- a value a client supplied is a claim and one derived from the file is a
      -- fact, and there is no reason to keep the weaker of the two.
      file_hash           = coalesce(nullif(p_payload ->> 'file_hash', ''), i.file_hash),
      page_count          = (p_payload ->> 'page_count')::int,
      word_count          = coalesce((p_payload ->> 'word_count')::int, 0),
      chapter_count       = coalesce(jsonb_array_length(p_payload -> 'chapters'), 0),
      quality             = coalesce(p_payload -> 'quality', '{}'::jsonb),
      pipeline_version    = nullif(p_payload ->> 'pipeline_version', ''),
      detector_version    = nullif(p_payload ->> 'detector_version', ''),
      status              = 'awaiting_review',
      stage               = null,
      error_code          = null,
      error_message       = null,
      analyzed_at         = now(),
      updated_at          = now()
  where i.id = p_import_id;

  -- Replaced wholesale rather than upserted by position: a second analysis that
  -- found fewer chapters would otherwise leave the tail of the first one behind.
  delete from public.book_import_chapters c where c.import_id = p_import_id;

  for v_chapter in select * from jsonb_array_elements(coalesce(p_payload -> 'chapters', '[]'::jsonb))
  loop
    v_index := v_index + 1;
    insert into public.book_import_chapters (
      import_id, position, detected_title, title, source_text, word_count,
      source_page_start, source_page_end, source_href,
      confidence, signals, is_front_matter, included
    )
    values (
      p_import_id,
      v_index,
      nullif(v_chapter ->> 'title', ''),
      nullif(v_chapter ->> 'title', ''),
      coalesce(v_chapter ->> 'text', ''),
      coalesce((v_chapter ->> 'word_count')::int, 0),
      (v_chapter ->> 'start_page')::int,
      (v_chapter ->> 'end_page')::int,
      nullif(v_chapter ->> 'href', ''),
      coalesce(nullif(v_chapter ->> 'confidence', ''), 'medium'),
      coalesce(v_chapter -> 'signals', '[]'::jsonb),
      coalesce((v_chapter ->> 'is_front_matter')::boolean, false),
      -- Front matter starts switched off. It is a title page, a contents list or
      -- a colophon; importing it as chapter 1 of a novel is never what anyone
      -- wanted, and one tap puts it back.
      not coalesce((v_chapter ->> 'is_front_matter')::boolean, false)
    );
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. WHAT THE LEARNER MAY CHANGE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Title, author, and — through `edit_book_import_chapters` — the chapter list.
-- Everything else about an import is systemic. These run as the caller's owner
-- check, not as an admin: `auth.uid()` is the only source of "whose import is
-- this?" anywhere in this file.
create or replace function public.update_book_import_metadata(
  p_import_id uuid,
  p_title     text,
  p_author    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  update public.book_imports i
  set title      = left(nullif(trim(p_title), ''), 200),
      author     = left(nullif(trim(p_author), ''), 200),
      updated_at = now()
  where i.id = p_import_id
    and i.user_id = v_user
    and i.final_library_item_id is null;

  if not found then
    raise exception 'Nie można zmienić tego importu.' using errcode = 'FL403';
  end if;
end;
$$;

-- The preview's five edits, in one transaction each.
--
-- WHY ONE FUNCTION AND NOT COLUMN GRANTS. Renaming a chapter is a single-column
-- update and could be a policy; merging two is a delete, a concatenation and a
-- renumber, and splitting one is an insert and a renumber. Those must be atomic
-- or the list ends up with a gap, and a list with a gap becomes a book with
-- chapter 7 missing. One entry point means one place where `position` is kept
-- contiguous and one place where ownership is checked.
--
--   rename   {chapter_id, title}
--   include  {chapter_id, included}
--   merge_up {chapter_id}                 fold into the chapter before it
--   split    {chapter_id, paragraph}      cut at a paragraph boundary
--   move     {chapter_id, direction}      up / down
create or replace function public.edit_book_import_chapters(
  p_import_id uuid,
  p_op        text,
  p_payload   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_import     public.book_imports%rowtype;
  v_chapter    public.book_import_chapters%rowtype;
  v_other      public.book_import_chapters%rowtype;
  v_target_id  uuid := (p_payload ->> 'chapter_id')::uuid;
  v_paragraphs text[];
  v_cut        int;
  v_head       text;
  v_tail       text;
begin
  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user
  for update;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  if v_import.final_library_item_id is not null then
    raise exception 'Ten import został już zakończony.' using errcode = 'FL409';
  end if;

  select * into v_chapter
  from public.book_import_chapters c
  where c.id = v_target_id and c.import_id = p_import_id;

  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  if p_op = 'rename' then
    update public.book_import_chapters c
    set title      = left(nullif(trim(p_payload ->> 'title'), ''), 200),
        edited     = true,
        updated_at = now()
    where c.id = v_chapter.id;

  elsif p_op = 'include' then
    update public.book_import_chapters c
    set included   = coalesce((p_payload ->> 'included')::boolean, true),
        edited     = true,
        updated_at = now()
    where c.id = v_chapter.id;

  elsif p_op = 'merge_up' then
    select * into v_other
    from public.book_import_chapters c
    where c.import_id = p_import_id and c.position < v_chapter.position
    order by c.position desc
    limit 1;

    if not found then
      raise exception 'Nie ma rozdziału powyżej.' using errcode = 'FL422';
    end if;

    -- THE MERGED CHAPTER'S TITLE BECOMES A HEADING, not nothing. The content
    -- pipeline reads `## …` on its own line as a heading paragraph, so the words
    -- survive in the text exactly where they were — merging must never lose
    -- characters from somebody's book.
    update public.book_import_chapters c
    set source_text = c.source_text
                      || case
                           when coalesce(v_chapter.title, '') <> ''
                             then E'\n\n## ' || v_chapter.title || E'\n\n'
                           else E'\n\n'
                         end
                      || v_chapter.source_text,
        word_count  = c.word_count + v_chapter.word_count,
        source_page_end = greatest(
          coalesce(c.source_page_end, 0), coalesce(v_chapter.source_page_end, 0)
        ),
        -- The merged result is only as trustworthy as the weaker half.
        confidence  = case when c.confidence = 'high' then v_chapter.confidence
                           else c.confidence end,
        edited      = true,
        updated_at  = now()
    where c.id = v_other.id;

    delete from public.book_import_chapters c where c.id = v_chapter.id;

  elsif p_op = 'split' then
    v_paragraphs := regexp_split_to_array(v_chapter.source_text, E'\n{2,}');
    v_cut := coalesce((p_payload ->> 'paragraph')::int, 0);

    if v_cut < 1 or v_cut >= array_length(v_paragraphs, 1) then
      raise exception 'Nieprawidłowe miejsce podziału.' using errcode = 'FL422';
    end if;

    v_head := array_to_string(v_paragraphs[1:v_cut], E'\n\n');
    v_tail := array_to_string(
      v_paragraphs[v_cut + 1 : array_length(v_paragraphs, 1)], E'\n\n'
    );

    -- Everything after the cut shifts down by one. Deferred uniqueness is what
    -- lets this be a single statement instead of a shuffle.
    update public.book_import_chapters c
    set position = c.position + 1
    where c.import_id = p_import_id and c.position > v_chapter.position;

    update public.book_import_chapters c
    set source_text = v_head,
        word_count  = public.count_source_words(v_head),
        edited      = true,
        updated_at  = now()
    where c.id = v_chapter.id;

    insert into public.book_import_chapters (
      import_id, position, detected_title, title, source_text, word_count,
      source_page_start, source_page_end, confidence, signals,
      is_front_matter, included, edited
    )
    values (
      p_import_id,
      v_chapter.position + 1,
      null,
      null,
      v_tail,
      public.count_source_words(v_tail),
      v_chapter.source_page_start,
      v_chapter.source_page_end,
      'low',
      '["manual_split"]'::jsonb,
      v_chapter.is_front_matter,
      v_chapter.included,
      true
    );

  elsif p_op = 'move' then
    if (p_payload ->> 'direction') = 'up' then
      select * into v_other
      from public.book_import_chapters c
      where c.import_id = p_import_id and c.position < v_chapter.position
      order by c.position desc limit 1;
    else
      select * into v_other
      from public.book_import_chapters c
      where c.import_id = p_import_id and c.position > v_chapter.position
      order by c.position asc limit 1;
    end if;

    if not found then
      return;
    end if;

    update public.book_import_chapters c
    set position = v_chapter.position, edited = true, updated_at = now()
    where c.id = v_other.id;

    update public.book_import_chapters c
    set position = v_other.position, edited = true, updated_at = now()
    where c.id = v_chapter.id;

  else
    raise exception 'Nieznana operacja.' using errcode = 'FL422';
  end if;

  -- One renumber after every operation, so "positions are 1..N with no gaps" is
  -- an invariant of this function rather than of each branch. `row_number()`
  -- over the current order is idempotent: running it when nothing moved writes
  -- the same numbers back.
  perform public.renumber_book_import_chapters(p_import_id);

  update public.book_imports i
  set chapter_count = (
        select count(*) from public.book_import_chapters c where c.import_id = p_import_id
      ),
      word_count = (
        select coalesce(sum(c.word_count), 0) from public.book_import_chapters c
        where c.import_id = p_import_id and c.included
      ),
      updated_at = now()
  where i.id = p_import_id;
end;
$$;

-- Words, by the same definition the content pipeline uses: a letter followed by
-- letters, marks, apostrophes or hyphens. Kept here so a split's word count
-- agrees with the one `src/lib/content/paragraphs.ts` computes for the same text
-- — one definition of "word", two runtimes.
create or replace function public.count_source_words(p_text text)
returns int
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_length(
      array_remove(regexp_split_to_array(coalesce(p_text, ''), '[^[:alpha:]''’-]+'), ''),
      1
    ),
    0
  );
$$;

create or replace function public.renumber_book_import_chapters(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.book_import_chapters c
  set position = ranked.next_position
  from (
    select id, row_number() over (order by position, created_at, id) as next_position
    from public.book_import_chapters
    where import_id = p_import_id
  ) ranked
  where c.id = ranked.id and c.position <> ranked.next_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. FINALIZING — the one place a private book is born.
-- ─────────────────────────────────────────────────────────────────────────────
-- ATOMIC: the library item, its chapters and the import's receipt are written in
-- one transaction, so there is no state where a book exists without its chapters
-- or an import points at a book that was never created.
--
-- IDEMPOTENT: `final_library_item_id` is checked under a row lock and returned
-- if set. A double click, a retried request and two browser tabs all produce one
-- book — and the second caller gets the first one's id, not an error, because
-- "you already did this" is not a failure from the learner's side.
--
-- CONCURRENT-SAFE: `select … for update` on the import row serialises two
-- simultaneous finalizes. The loser blocks, then sees the receipt.
--
-- PRIVATE BY CONSTRUCTION: `rights` is hardcoded to `private_import` and
-- `owner_user_id` to the caller. There is no parameter for either, so no request
-- can ask for anything else.
create or replace function public.finalize_book_import(p_import_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_import   public.book_imports%rowtype;
  v_item_id  uuid;
  v_slug     text;
  v_title    text;
  v_position int := 0;
  v_row      record;
  v_words    int := 0;
begin
  if v_user is null then
    raise exception 'Zaloguj się, aby zaimportować książkę.' using errcode = 'FL401';
  end if;

  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user
  for update;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  -- THE RECEIPT. Everything below this line runs at most once per import.
  if v_import.final_library_item_id is not null then
    return v_import.final_library_item_id;
  end if;

  if v_import.status not in ('awaiting_review', 'failed') then
    raise exception 'Import nie jest gotowy do zatwierdzenia.' using errcode = 'FL423';
  end if;

  if not exists (
    select 1 from public.book_import_chapters c
    where c.import_id = p_import_id and c.included and length(trim(c.source_text)) > 0
  ) then
    raise exception 'Nie wybrano żadnego rozdziału.' using errcode = 'FL422';
  end if;

  v_title := coalesce(
    nullif(trim(v_import.title), ''),
    nullif(trim(v_import.detected_title), ''),
    'Moja książka'
  );

  -- The slug is scoped per owner by `library_items_slug_idx`, so two learners
  -- may both import "Der Prozess" and neither collides with the public library.
  -- The suffix keeps one learner's two copies apart.
  v_slug := public.slugify(v_title) || '-' || right(replace(p_import_id::text, '-', ''), 6);

  insert into public.library_items (
    slug, title, author, language, content_type,
    rights, owner_user_id, source_type, status, published_at,
    word_count, chapter_count
  )
  values (
    v_slug,
    left(v_title, 200),
    left(nullif(trim(coalesce(v_import.author, v_import.detected_author)), ''), 200),
    coalesce(nullif(v_import.detected_language, ''), 'de'),
    'book',
    'private_import',
    v_user,
    'import_' || v_import.file_type,
    -- `processing`, not `draft`: the book appears on the owner's shelf
    -- immediately and fills in chapter by chapter. A learner who waited for an
    -- upload should not then wait for an empty library.
    'processing',
    -- Private items are never "published" in the public sense —
    -- `library_item_readable` refuses an owned item to everyone but its owner
    -- whatever the status says. The timestamp is set so the shelf, which orders
    -- by it, puts a freshly imported book where the learner expects it.
    now(),
    0,
    0
  )
  returning id into v_item_id;

  for v_row in
    select * from public.book_import_chapters c
    where c.import_id = p_import_id
      and c.included
      and length(trim(c.source_text)) > 0
    order by c.position
  loop
    v_position := v_position + 1;
    v_words := v_words + v_row.word_count;

    insert into public.chapters (
      library_item_id, position, title, source_text, status, import_id
    )
    values (
      v_item_id,
      v_position,
      coalesce(nullif(trim(v_row.title), ''), nullif(trim(v_row.detected_title), '')),
      v_row.source_text,
      'draft',
      p_import_id
    );

    update public.book_import_chapters c
    set chapter_id = (
          select ch.id from public.chapters ch
          where ch.library_item_id = v_item_id and ch.position = v_position
        ),
        updated_at = now()
    where c.id = v_row.id;
  end loop;

  update public.library_items i
  set chapter_count = v_position,
      word_count    = v_words,
      updated_at    = now()
  where i.id = v_item_id;

  update public.book_imports i
  set final_library_item_id = v_item_id,
      status                = 'processing',
      stage                 = 'process_chapters',
      total_chapters        = v_position,
      processed_chapters    = 0,
      failed_chapters       = 0,
      error_code            = null,
      error_message         = null,
      finalized_at          = now(),
      updated_at            = now()
  where i.id = p_import_id;

  return v_item_id;
end;
$$;

comment on function public.finalize_book_import(uuid) is
  'Turn a reviewed import into a private library item. Idempotent via final_library_item_id; rights and owner are hardcoded, never parameters.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PROCESSING PROGRESS IS DERIVED, NEVER ASSERTED.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same rule as `sync_daily_plan`: there is no "mark this chapter done" endpoint
-- and there must not be one. The counts are recomputed from the `chapters` rows
-- that recorded the work, which makes them idempotent (a retried batch cannot
-- double-count), unforgeable (a client cannot claim a chapter is ready) and
-- self-healing (a count that drifted is corrected on the next call).
--
-- PARTIAL READINESS IS THE POINT. The item flips to `ready` only when nothing is
-- pending, but every chapter that IS ready is readable the moment it is
-- processed — a learner can start chapter 1 while chapter 42 is still being
-- built. One failed chapter leaves the book usable and the failure visible.
create or replace function public.sync_book_import_processing(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_import  public.book_imports%rowtype;
  v_total   int;
  v_ready   int;
  v_failed  int;
  v_status  text;
begin
  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  if v_import.final_library_item_id is null then
    return jsonb_build_object('status', v_import.status, 'total', 0, 'ready', 0, 'failed', 0);
  end if;

  select count(*),
         count(*) filter (where c.status = 'ready'),
         count(*) filter (where c.status = 'failed')
    into v_total, v_ready, v_failed
  from public.chapters c
  where c.library_item_id = v_import.final_library_item_id;

  v_status := case
    when v_total = 0 then 'processing'
    when v_ready + v_failed < v_total then 'processing'
    when v_ready = 0 then 'failed'
    else 'ready'
  end;

  update public.book_imports i
  set total_chapters     = v_total,
      processed_chapters = v_ready,
      failed_chapters    = v_failed,
      status             = v_status,
      stage              = case when v_status = 'processing' then 'process_chapters' end,
      error_code         = case when v_status = 'failed' then 'processing_failed' end,
      updated_at         = now()
  where i.id = p_import_id;

  -- A book with at least one readable chapter is a readable book. The item only
  -- stays `processing` while something is still pending, so the shelf stops
  -- showing a spinner the moment the last chapter lands.
  update public.library_items li
  set status     = case when v_ready + v_failed >= v_total and v_ready > 0 then 'ready'
                        else 'processing' end,
      updated_at = now()
  where li.id = v_import.final_library_item_id;

  return jsonb_build_object(
    'status', v_status, 'total', v_total, 'ready', v_ready, 'failed', v_failed
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. CANCELLING, AND DELETING.
-- ─────────────────────────────────────────────────────────────────────────────
-- Before the book exists, cancel. After it exists, delete the book — those are
-- different operations on different objects and conflating them is how an
-- "undo" ends up orphaning rows.
--
-- Returns the storage path so the caller can remove the original object in the
-- same action; Storage is not transactional with Postgres, and pretending
-- otherwise would leave the deletion silently half-done.
create or replace function public.cancel_book_import(p_import_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_import public.book_imports%rowtype;
begin
  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user
  for update;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  if v_import.final_library_item_id is not null then
    raise exception 'Ten import jest już książką — usuń ją z biblioteki.'
      using errcode = 'FL409';
  end if;

  -- The proposal goes; the row stays, as history, so the import list can show
  -- "anulowane" rather than a hole.
  delete from public.book_import_chapters c where c.import_id = p_import_id;

  update public.book_imports i
  set status = 'cancelled', stage = null, chapter_count = 0, updated_at = now()
  where i.id = p_import_id;

  return v_import.storage_path;
end;
$$;

-- Deleting a private book.
--
-- A LEARNER IS NEVER LOCKED OUT OF THEIR OWN DATA. The library's DELETE policy
-- is admin-only and excludes owned items entirely, which is right for content
-- and wrong for somebody's own file — so this is the owner's door, and it opens
-- only onto items they own.
--
-- WHAT SURVIVES, AND WHY. Deleting the book cascades its chapters, structure,
-- reading progress and sessions: those are all *about this text*, and keeping
-- them would mean keeping a private book's paragraphs after its owner asked for
-- them to go. What does NOT go is aggregate knowledge — `user_word_knowledge`,
-- skill and concept state, review history, saved words. Learning German from a
-- book you later deleted is still learning German, and throwing away a month of
-- vocabulary because somebody tidied their shelf would be indefensible.
--
-- The one exception is the private TEXT those records carry: a saved word keeps
-- its scheduling and its word, and loses the sentence it was copied out of,
-- because that sentence is a fragment of a book its owner has asked Fluent to
-- forget.
create or replace function public.delete_private_library_item(p_item_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_paths text[];
begin
  if not exists (
    select 1 from public.library_items i
    where i.id = p_item_id and i.owner_user_id = v_user
  ) then
    raise exception 'Nie masz dostępu do tej książki.' using errcode = 'FL403';
  end if;

  select coalesce(array_agg(i.storage_path), '{}'::text[])
    into v_paths
  from public.book_imports i
  where i.user_id = v_user and i.final_library_item_id = p_item_id;

  -- Before the cascade nulls the reference and we lose the ability to find them.
  update public.saved_words w
  set origin_context = null,
      origin_surface = null
  where w.user_id = v_user and w.origin_library_item_id = p_item_id;

  delete from public.book_imports i
  where i.user_id = v_user and i.final_library_item_id = p_item_id;

  delete from public.library_items i
  where i.id = p_item_id and i.owner_user_id = v_user;

  return v_paths;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Narrow on purpose. A learner may create an import, edit its preview, finalize
-- it, sync its progress, cancel it and delete their own book — every one of
-- which derives the acting user from `auth.uid()`. Moving the state machine and
-- writing an analysis are server work and are service_role only: a browser that
-- could call `set_book_import_state` could declare an unread file a finished
-- book.
revoke all on function public.create_book_import(text, text, bigint, text) from public;
revoke all on function public.set_book_import_state(uuid, text, text, text, text) from public;
revoke all on function public.apply_book_import_analysis(uuid, jsonb) from public;
revoke all on function public.update_book_import_metadata(uuid, text, text) from public;
revoke all on function public.edit_book_import_chapters(uuid, text, jsonb) from public;
revoke all on function public.renumber_book_import_chapters(uuid) from public;
revoke all on function public.finalize_book_import(uuid) from public;
revoke all on function public.sync_book_import_processing(uuid) from public;
revoke all on function public.cancel_book_import(uuid) from public;
revoke all on function public.delete_private_library_item(uuid) from public;

grant execute on function public.create_book_import(text, text, bigint, text)  to authenticated;
grant execute on function public.update_book_import_metadata(uuid, text, text) to authenticated;
grant execute on function public.edit_book_import_chapters(uuid, text, jsonb)  to authenticated;
grant execute on function public.finalize_book_import(uuid)                    to authenticated;
grant execute on function public.sync_book_import_processing(uuid)             to authenticated;
grant execute on function public.cancel_book_import(uuid)                      to authenticated;
grant execute on function public.delete_private_library_item(uuid)             to authenticated;
grant execute on function public.count_source_words(text)                to anon, authenticated;

grant execute on function public.set_book_import_state(uuid, text, text, text, text) to service_role;
grant execute on function public.apply_book_import_analysis(uuid, jsonb)             to service_role;
grant execute on function public.renumber_book_import_chapters(uuid)                 to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- READ YOUR OWN, WRITE NOTHING. Both tables are readable by their owner and by
-- nobody else — not another learner, not an anonymous visitor, and deliberately
-- not an admin: a private import is somebody's own file, and the admin panel is
-- a content tool, not a reason to read it. That is the same judgement
-- `library_item_readable` already makes about the finished book.
--
-- There is no INSERT, UPDATE or DELETE policy on either table, and that is the
-- design. Every write goes through a SECURITY DEFINER function above, which
-- derives the owner from `auth.uid()` instead of believing a column — so
-- `user_id`, `storage_path`, `status` and `final_library_item_id` have no client
-- write path at all.
alter table public.book_imports          enable row level security;
alter table public.book_import_chapters  enable row level security;

drop policy if exists "own book imports read" on public.book_imports;
create policy "own book imports read" on public.book_imports
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own book import chapters read" on public.book_import_chapters;
create policy "own book import chapters read" on public.book_import_chapters
  for select using (
    exists (
      select 1 from public.book_imports i
      where i.id = book_import_chapters.import_id
        and i.user_id = (select auth.uid())
    )
  );

-- === END 20260915120000_private_book_import.sql ===

-- === BEGIN supabase/migrations/20260915180000_personal_language_notebook.sql ===

-- Fluent — Phase 5.6: the personal language notebook.
--
-- WHAT THIS ADDS. Until now everything a learner could record while reading was
-- a DICTIONARY fact: tapping *sollten* saved the headword *sollen* with the
-- sentence it was met in, and that was the whole vocabulary of the reader. It is
-- the wrong grain for reading a novel. "sollen → powinien / mieć powinność" is
-- true and nearly useless in front of
--
--     „Wir sollten umkehren“, drängte Gared.
--
-- where the thing worth writing down is *powinniśmy*, and the thing worth
-- writing down next to it is the whole Polish sentence. Neither belongs in
-- `words.translation_pl`, because neither is true of the lexeme — they are true
-- of THIS PLACE IN THIS BOOK, for THIS learner.
--
-- So this migration builds the layer underneath that: three grains of personal
-- annotation, owned by one learner, never global, never mixed with the shared
-- dictionary.
--
--     LEXEME        words.translation_pl       global, admin-owned, shared
--     OCCURRENCE    user_text_annotations      "here it means powinniśmy"
--     PHRASE        user_text_annotations      "Angst machen → straszyć"
--     SENTENCE      user_sentence_notes        my translation, and "nie rozumiem"
--
-- THE FIVE INVARIANTS THIS SCHEMA EXISTS TO ENFORCE.
--
--   1. A PERSONAL ANNOTATION NEVER TOUCHES THE GLOBAL DICTIONARY. There is no
--      write path from any function below into `public.words`, and there must
--      never be one. A learner who decides *ziehen* means "wyciągnąć" has said
--      something about one sentence, not about every learner's dictionary.
--
--   2. CONTEXT IS AN OCCURRENCE, NOT A WORD. A contextual meaning is keyed on a
--      place in a chapter, so *ziehen* in "Er zog sein Schwert." and *ziehen* in
--      "Sie zogen den Wagen." can, and must be able to, mean different things.
--      Keying it on `(user_id, word_id)` would have made the second one silently
--      overwrite the first.
--
--   3. ANNOTATIONS ARE ANCHORED ON POSITIONS, NOT ON ROW IDS. Reprocessing a
--      chapter REPLACES its paragraphs, so every sentence and occurrence row is
--      deleted and reinserted with new ids (`replace_chapter_content`). Reading
--      progress survives that because it stores POSITIONS, and so does a
--      notebook: `(chapter_id, sentence_position)` and `token_position` are the
--      durable address, `sentence_id` / `occurrence_id` are fast pointers that
--      are allowed to go null. The German text is snapshotted alongside, so a
--      note can be shown — and detected as stale — even when the text moved.
--
--   4. A NOTE IS PRIVATE, AND SO IS ITS SOURCE. Every write below re-derives the
--      learner from `auth.uid()` and refuses a sentence the learner may not read
--      (`chapter_is_readable`, which is Phase 4's `library_item_readable`). So a
--      learner cannot annotate someone else's private import by guessing an id,
--      and deleting a private book takes its annotations with it — the snapshot
--      of somebody's book does not outlive the book.
--
--   5. THERE IS ONE SCHEDULER. Phrases and contextual meanings can be reviewed,
--      and they are scheduled by the SAME SM-2 in `src/lib/sm2.ts` and recorded
--      in the SAME `review_events` log as word cards. `user_notebook_reviews`
--      is a second STORAGE table, because `saved_words` is keyed
--      `(user_id, word_id)` and structurally cannot hold a phrase; it is not a
--      second algorithm, and nothing here re-implements an interval.
--
-- NO AI. Nothing in this phase calls a model. Every meaning stored below was
-- typed by the learner, which is also why none of it is ever presented as
-- verified truth — the UI says "Twoje tłumaczenie", and the column is called
-- `translation` on a table whose name starts with `user_`.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SENTENCE NOTES — my translation, and "nie rozumiem".
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY ONE TABLE FOR TWO FEATURES. They are the same grain — one learner, one
-- sentence — and they are the same act: "I stopped at this sentence and did
-- something about it". A learner who translates a sentence and also flags it
-- unclear has one note about one sentence, not two rows that have to be kept
-- consistent with each other. Splitting them would also mean two round trips
-- every time the reader wants to know what the learner has said about a
-- sentence, which is the one query the word sheet makes on every tap.
--
-- `is_unclear` IS CURRENT STATE, NOT HISTORY. Flipping it writes a
-- `sentence_marked_unclear` / `sentence_marked_understood` row into
-- `learning_events`, which is append-only, so the sequence survives while the
-- flag tells the notebook what is true NOW. A learner who works a sentence out
-- is not carrying a permanent failure around; the fact that they once could not
-- read it is still worth having.
create table if not exists public.user_sentence_notes (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- THE DURABLE ADDRESS. `chapter_id` cascades because a note about a deleted
  -- book is not a note, it is a private copy of a fragment of that book left
  -- behind — see invariant 4 and the privacy rules of Phase 5.5.
  chapter_id        uuid not null references public.chapters(id) on delete cascade,
  library_item_id   uuid not null references public.library_items(id) on delete cascade,
  -- `sentences.chapter_position`: the sentence's index in reading order, which
  -- the content pipeline assigns deterministically and which survives a
  -- reprocessing pass. This — not `sentence_id` — is the identity of a note.
  sentence_position int  not null check (sentence_position >= 0),

  -- The fast pointer. Nullable, and allowed to become null: reprocessing deletes
  -- the row this points at, and losing the pointer must not lose the note.
  sentence_id bigint references public.sentences(id) on delete set null,

  -- The German, copied at write time. Two jobs: the notebook renders an entry
  -- without touching the chapter at all, and comparing it against the live
  -- sentence is how a note that now points at different text is DETECTED rather
  -- than silently shown against the wrong prose.
  sentence_text text not null,
  -- Which processor produced the text this note was taken against.
  content_version text not null default 'content_v1',

  -- The learner's own Polish. NEVER presented as a correct translation, and
  -- deliberately not called `translation_pl` — that column name belongs to the
  -- shared dictionary and means something else.
  translation text check (translation is null or length(translation) <= 2000),

  is_unclear  boolean not null default false,
  unclear_at  timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A row with neither a translation nor a flag is not a note. Deleting the last
  -- thing a note says deletes the note, which is what keeps the notebook honest
  -- about how much is in it.
  constraint user_sentence_notes_not_empty
    check (translation is not null or is_unclear)
);

-- IDENTITY IS THE POSITION. This is what makes "save my translation" an upsert
-- rather than a duplicate, and it keeps holding after a chapter is reprocessed,
-- when `sentence_id` has gone null on every row.
create unique index if not exists user_sentence_notes_anchor_idx
  on public.user_sentence_notes (user_id, chapter_id, sentence_position);

-- "What has this learner said about the sentence I just tapped?" — the reader's
-- only notebook read, and it must cost one index probe.
create index if not exists user_sentence_notes_sentence_idx
  on public.user_sentence_notes (user_id, sentence_id)
  where sentence_id is not null;

-- The notebook's three listings: everything, one book, and the unresolved pile.
create index if not exists user_sentence_notes_recent_idx
  on public.user_sentence_notes (user_id, created_at desc, id desc);
create index if not exists user_sentence_notes_item_idx
  on public.user_sentence_notes (user_id, library_item_id, created_at desc, id desc);
create index if not exists user_sentence_notes_unclear_idx
  on public.user_sentence_notes (user_id, unclear_at desc)
  where is_unclear;

comment on table public.user_sentence_notes is
  'One learner''s own translation of, and difficulty flag on, one sentence. Private, never global, anchored on (chapter_id, sentence_position) so it survives reprocessing.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TEXT ANNOTATIONS — a word in this place, or a phrase.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY WORDS AND PHRASES SHARE A TABLE, when the lexeme / occurrence / phrase
-- levels must never be mixed. The levels being distinct is a statement about
-- MEANING — a contextual gloss must never overwrite a dictionary entry — and
-- that is enforced by there being no write path into `public.words` at all.
-- Storage is a different question: a contextual word meaning and a phrase are
-- both "a span of tokens inside one sentence, with the learner's own meaning
-- on it", down to every column. Two tables would be the same eight columns
-- twice, two sets of indexes, and two queries every time the reader or the
-- notebook wants "what have I written down here?".
--
-- A single-token span is a WORD annotation; two or more tokens is a PHRASE. The
-- span is always inside ONE sentence (`sentence_position` is scalar, and
-- `save_text_annotation` refuses anything else) — a "phrase" spanning two
-- sentences is a selection accident, not a unit of language.
--
-- A PERSONAL WORD is a `word` annotation with `word_id is null`: a token the
-- shared dictionary does not know, written down anyway. That is the whole
-- feature — it needs no second table, and crucially no row in `public.words`,
-- because a learner's guess at a headword is not dictionary content.
create table if not exists public.user_text_annotations (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('word', 'phrase')),

  -- The same durable address as a sentence note, plus the token span.
  chapter_id        uuid not null references public.chapters(id) on delete cascade,
  library_item_id   uuid not null references public.library_items(id) on delete cascade,
  sentence_position int  not null check (sentence_position >= 0),
  sentence_id       bigint references public.sentences(id) on delete set null,

  -- `word_occurrences.position` — the index among the sentence's LEXICAL tokens,
  -- which is why it survives punctuation edits and why a cloze built from it
  -- blanks the right *sollten* when the sentence contains two.
  start_position int not null check (start_position >= 0),
  end_position   int not null check (end_position >= 0),

  -- Fast pointers to the endpoint occurrences. Null for a personal word (no
  -- occurrence row exists for a token the dictionary could not match) and after
  -- a reprocessing pass.
  start_occurrence_id bigint references public.word_occurrences(id) on delete set null,
  end_occurrence_id   bigint references public.word_occurrences(id) on delete set null,

  -- Character offsets INTO `sentence_text`, so the reader and the review layer
  -- can highlight or blank the exact span without searching for it. §66: a cloze
  -- is never `text.replace(surface, '____')`.
  char_start int not null default 0 check (char_start >= 0),
  char_end   int not null default 0 check (char_end >= 0),

  -- Snapshots: the span as written ("sollten", "Angst machen") and the sentence
  -- it sat in. Same two jobs as on a sentence note.
  surface       text not null check (length(surface) between 1 and 400),
  sentence_text text not null,
  content_version text not null default 'content_v1',

  -- The shared dictionary entry this span resolved to, when it resolved to one.
  -- A REFERENCE, never a target: nothing below writes through it.
  word_id bigint references public.words(id) on delete set null,
  -- The learner's own headword, if they chose to give one ("sollten → sollen").
  -- Optional by design: demanding a lemma from someone who is still working out
  -- what the word is would make the feature unusable exactly when it is needed.
  lemma text check (lemma is null or length(lemma) <= 200),

  -- Optional: "I want to come back to this" is a legitimate reason to save a
  -- phrase, and refusing to store it would send the learner to a paper notebook.
  meaning text check (meaning is null or length(meaning) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_text_annotations_span check (end_position >= start_position),
  -- A `word` annotation is exactly one token, by definition of the two kinds.
  constraint user_text_annotations_kind_span
    check (kind <> 'word' or start_position = end_position)
);

-- ONE annotation per learner per span. Re-saving the same span is an edit, not a
-- duplicate; §42's overlapping phrases ("Angst machen" and "jemandem Angst
-- machen") are different spans and both exist, which is the intended behaviour
-- and the reason this is not keyed on `surface`.
create unique index if not exists user_text_annotations_anchor_idx
  on public.user_text_annotations
     (user_id, chapter_id, sentence_position, start_position, end_position);

create index if not exists user_text_annotations_sentence_idx
  on public.user_text_annotations (user_id, sentence_id)
  where sentence_id is not null;

create index if not exists user_text_annotations_recent_idx
  on public.user_text_annotations (user_id, kind, created_at desc, id desc);
create index if not exists user_text_annotations_item_idx
  on public.user_text_annotations (user_id, library_item_id, created_at desc, id desc);
create index if not exists user_text_annotations_chapter_idx
  on public.user_text_annotations (user_id, chapter_id, sentence_position);
-- "Everything I have written about this lexeme, across every book."
create index if not exists user_text_annotations_word_idx
  on public.user_text_annotations (user_id, word_id)
  where word_id is not null;

comment on table public.user_text_annotations is
  'One learner''s own meaning for a span of tokens inside one sentence: a single token is a contextual word meaning (a personal word when word_id is null), two or more is a phrase. Never written into public.words.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REVIEWING A NOTE — opt in, one scheduler.
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT EVERY NOTE IS A FLASHCARD. Translating a sentence is a way of reading it;
-- turning all of them into scheduled reviews would bury the learner in cards
-- they never asked for and make translating a sentence feel expensive. So a note
-- enters the review queue only when the learner says so, and this table exists
-- only for the ones that did.
--
-- WHY IT IS NOT `saved_words`. That table's primary key is `(user_id, word_id)`:
-- it can hold one schedule per dictionary entry, and a phrase has no dictionary
-- entry at all. This is the same schedule for a different kind of item — the
-- SM-2 columns are named identically on purpose, they are computed by the same
-- `src/lib/sm2.ts`, and the grading goes through the same `review_events` log.
-- The database owns the transaction; it does not own the arithmetic.
create table if not exists public.user_notebook_reviews (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Exactly one parent. Two typed columns rather than a polymorphic
  -- `(item_type, item_id)` pair, so the foreign keys are real: deleting a phrase
  -- takes its card with it instead of leaving a schedule pointing at nothing.
  annotation_id    bigint references public.user_text_annotations(id) on delete cascade,
  sentence_note_id bigint references public.user_sentence_notes(id)  on delete cascade,

  -- SM-2 state. Same columns, same meanings, same defaults as `saved_words`.
  interval    int     not null default 0,
  repetitions int     not null default 0,
  ease_factor numeric not null default 2.5,
  due_at      timestamptz not null default now(),
  is_mastered boolean not null default false,

  created_at timestamptz not null default now(),

  constraint user_notebook_reviews_one_parent
    check ((annotation_id is null) <> (sentence_note_id is null))
);

create unique index if not exists user_notebook_reviews_annotation_idx
  on public.user_notebook_reviews (annotation_id)
  where annotation_id is not null;
create unique index if not exists user_notebook_reviews_note_idx
  on public.user_notebook_reviews (sentence_note_id)
  where sentence_note_id is not null;
create index if not exists user_notebook_reviews_due_idx
  on public.user_notebook_reviews (user_id, due_at)
  where not is_mastered;

comment on table public.user_notebook_reviews is
  'SM-2 schedule for notebook items the learner explicitly added to review. Same algorithm as saved_words (src/lib/sm2.ts), different item.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ONE REVIEW HISTORY, NOT TWO.
-- ─────────────────────────────────────────────────────────────────────────────
-- `review_events` is the training data a better memory model will one day be
-- fitted to. A parallel `notebook_review_events` would split that corpus in half
-- and guarantee the two halves disagree, so the existing table learns about the
-- new item kinds instead: `word_id` becomes nullable and two typed references
-- join it. Every row written before this migration is a `word` row with a
-- `word_id`, which is exactly what the default and the check below say.
alter table public.review_events
  alter column word_id drop not null;

alter table public.review_events
  add column if not exists item_type text not null default 'word';

alter table public.review_events
  add column if not exists annotation_id bigint
    references public.user_text_annotations(id) on delete set null;

alter table public.review_events
  add column if not exists sentence_note_id bigint
    references public.user_sentence_notes(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_events'::regclass
      and conname  = 'review_events_item_type_check'
  ) then
    alter table public.review_events
      add constraint review_events_item_type_check
        check (item_type in ('word', 'word_meaning', 'phrase', 'sentence_translation'));
  end if;

  -- A word card names a word; a notebook card names a note. Neither may be
  -- anonymous, or the log stops being self-contained training data.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_events'::regclass
      and conname  = 'review_events_item_target_check'
  ) then
    alter table public.review_events
      add constraint review_events_item_target_check check (
        case item_type
          when 'word' then word_id is not null
          when 'sentence_translation' then sentence_note_id is not null
          else annotation_id is not null
        end
      );
  end if;

  -- Widened, never narrowed — re-running this file on a provisioned database
  -- must not reinstate a shorter whitelist. Same guard as every other phase.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_events'::regclass
      and conname  = 'review_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''notebook''%'
  ) then
    alter table public.review_events drop constraint if exists review_events_source_kind_check;
    alter table public.review_events
      add constraint review_events_source_kind_check check (source_kind in (
        'review', 'reader', 'book', 'import', 'notebook'
      ));
  end if;
end $$;

create index if not exists review_events_user_annotation_idx
  on public.review_events (user_id, annotation_id, reviewed_at desc)
  where annotation_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE CLOZE NEEDS OFFSETS, NOT A STRING SEARCH.
-- ─────────────────────────────────────────────────────────────────────────────
-- A contextual card for a saved word blanks the word out of the sentence it was
-- met in:
--
--     Wir ______ umkehren.
--
-- Doing that with `replace(context, surface, '______')` is wrong whenever the
-- surface occurs twice ("Er sah sie an, und sie sah ihn an") — it blanks the
-- first one, which may not be the one that was saved. `saved_words` already
-- copies the sentence text; these two columns copy WHERE IN IT the word was, so
-- the blank is exact and stays exact after the occurrence row is gone.
alter table public.saved_words
  add column if not exists origin_char_start int;
alter table public.saved_words
  add column if not exists origin_char_end int;

-- Backfill for cards saved before this migration, from the occurrence they still
-- point at. Cards whose occurrence has since been reprocessed away keep NULL
-- offsets and are simply presented as an ordinary card — a missing cloze is a
-- fallback, never a wrong one.
update public.saved_words s
   set origin_char_start = o.char_start,
       origin_char_end   = o.char_end
  from public.word_occurrences o
 where o.id = s.origin_occurrence_id
   and s.origin_char_start is null
   and s.origin_context is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE EVIDENCE TAXONOMY LEARNS THE NOTEBOOK.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THESE ARE LEARNING EVENTS AT ALL. "Nie rozumiem tego zdania" is the
-- strongest voluntary signal a reader can give: unlike a lookup, which people
-- also make out of curiosity or by accident, it is an explicit report that
-- comprehension failed. It belongs in the same append-only log as every other
-- observation, or the Today engine would need a second place to look.
--
-- AND WHY THEY MOVE NO KNOWLEDGE STATE. A sentence is not a skill, a concept or
-- a word. Attributing "I don't understand this sentence" to `grammar`, or to
-- whichever concepts happen to appear in it, would be the model inventing a
-- weakness from a gesture — precisely what the learning engine forbids. So these
-- events carry no `skill_code`, no concepts and no `word_id`, `foldEvidence`
-- moves nothing, and the signal is used for RANKING (what to revisit) rather
-- than for mastery. The same judgement `chapterReadingEvidence` already makes.
--
-- The `*_updated` types are accepted but produced by nothing: editing a note is
-- correcting what you already said, not a new observation. They are listed so
-- that a later phase which does want to record edits needs an exercise, not a
-- migration — the same convention this whitelist has followed since Phase 2.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_event_type_check'
      and pg_get_constraintdef(oid) like '%''sentence_marked_unclear''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_event_type_check;
    alter table public.learning_events
      add constraint learning_events_event_type_check check (event_type in (
        'test_answer', 'calibration_answer', 'review', 'practice_answer',
        'reading_lookup', 'reading_chapter_started', 'reading_chapter_completed',
        'reading_sentence_help', 'reading_resume',
        'chapter_preparation_answer', 'chapter_assessment_answer',
        -- Phase 5.6 — the notebook.
        'sentence_translation_created', 'sentence_translation_updated',
        'sentence_marked_unclear', 'sentence_marked_understood',
        'context_meaning_created', 'context_meaning_updated',
        'phrase_saved', 'phrase_meaning_updated',
        'notebook_review',
        'typed_recall', 'listening_answer', 'speaking_answer', 'writing_answer'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''notebook''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_source_kind_check;
    alter table public.learning_events
      add constraint learning_events_source_kind_check check (source_kind in (
        'reading_test', 'placement_test', 'review', 'practice',
        'reader', 'book', 'story', 'import', 'notebook'
      ));
  end if;
end $$;

-- "Which sentences is this learner stuck on?" — the Today engine's read, and the
-- notebook's "Do wyjaśnienia" tab, both of which filter by sentence.
create index if not exists learning_events_user_sentence_idx
  on public.learning_events (user_id, sentence_id, occurred_at desc)
  where sentence_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. WRITE PATHS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same contract as every other write in Fluent: the linguistics live in
-- TypeScript (`src/lib/notebook/`, `src/lib/content/tokenize.ts`), where they are
-- pure and unit-tested; these functions own the TRANSACTION and the three things
-- TypeScript cannot own — who the caller is, whether they may read the source,
-- and that the span really is the text it claims to be.
--
-- NOTHING HERE ACCEPTS A USER ID. Every function derives the learner from
-- `auth.uid()`, which is what makes it safe to grant them to `authenticated`:
-- passing someone else's id is not a thing a caller can do.

drop trigger if exists user_sentence_notes_touch on public.user_sentence_notes;
create trigger user_sentence_notes_touch
  before update on public.user_sentence_notes
  for each row execute function public.touch_updated_at();

drop trigger if exists user_text_annotations_touch on public.user_text_annotations;
create trigger user_text_annotations_touch
  before update on public.user_text_annotations
  for each row execute function public.touch_updated_at();

-- Resolve a sentence id to the durable anchor, refusing anything the caller may
-- not read.
--
-- THIS IS THE PRIVACY CHECK FOR THE WHOLE PHASE. A learner who types another
-- learner's private-import sentence id into a request gets FL404 here, before a
-- single row is written — `chapter_is_readable` is Phase 4's
-- `library_item_readable`, under which an owned item is invisible to everyone
-- but its owner, admins included.
create or replace function public.notebook_sentence_anchor(p_sentence_id bigint)
returns table (
  sentence_id       bigint,
  chapter_id        uuid,
  library_item_id   uuid,
  sentence_position int,
  sentence_text     text,
  content_version   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select s.id, s.chapter_id, c.library_item_id, s.chapter_position, s.text,
           coalesce(c.processor_version, 'content_v1')
    from public.sentences s
    join public.chapters c on c.id = s.chapter_id
    where s.id = p_sentence_id
      and public.chapter_is_readable(s.chapter_id);

  if not found then
    raise exception 'Nie znaleźliśmy tego zdania.' using errcode = 'FL404';
  end if;
end;
$$;

comment on function public.notebook_sentence_anchor(bigint) is
  'Sentence id -> (chapter, item, chapter_position, text), refusing content the caller may not read. The single privacy gate for every notebook write.';

-- ── sentence translations ────────────────────────────────────────────────────

-- Save (or replace) the learner's own Polish for one sentence.
--
-- THE EVENT FIRES ONCE, EVER. `p_evidence` carries a DETERMINISTIC event key
-- derived from the anchor, so the unique constraint on
-- `learning_events (user_id, event_key)` makes every later edit a no-op in the
-- log. Editing a translation is correcting what you already said; it is not a
-- second observation, and counting it as one would let a learner manufacture
-- history by retyping.
create or replace function public.save_sentence_translation(
  p_sentence_id bigint,
  p_translation text,
  p_evidence    jsonb
)
returns table (
  note_id     bigint,
  was_new     boolean,
  translation text,
  is_unclear  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_anchor record;
  v_text   text := nullif(btrim(coalesce(p_translation, '')), '');
  v_id     bigint;
  v_stored text;
  v_flag   boolean;
  -- WHETHER THE ROW WAS INSERTED, read from the system column rather than
  -- inferred from the timestamps. `created_at = updated_at` is also true for an
  -- update that happens in the SAME transaction as the insert — which is what a
  -- test, a batch and a retry all look like. `xmax = 0` is the upsert's own
  -- answer about what it just did, and it cannot be wrong.
  v_new    boolean;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  -- §102: whitespace is not a translation. Refused rather than stored, so the
  -- notebook never shows an entry with nothing in it.
  if v_text is null then
    raise exception 'Tłumaczenie nie może być puste.' using errcode = 'FL422';
  end if;
  if length(v_text) > 2000 then
    raise exception 'Tłumaczenie jest za długie.' using errcode = 'FL422';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  insert into public.user_sentence_notes as n (
    user_id, chapter_id, library_item_id, sentence_position, sentence_id,
    sentence_text, content_version, translation
  ) values (
    v_user, v_anchor.chapter_id, v_anchor.library_item_id,
    v_anchor.sentence_position, v_anchor.sentence_id,
    v_anchor.sentence_text, v_anchor.content_version, v_text
  )
  on conflict (user_id, chapter_id, sentence_position) do update
    set translation     = excluded.translation,
        -- Re-anchor on every write: a note taken before a reprocessing pass gets
        -- its pointer and its snapshot refreshed the next time the learner
        -- touches it, rather than drifting further from the text for ever.
        sentence_id     = excluded.sentence_id,
        sentence_text   = excluded.sentence_text,
        content_version = excluded.content_version
    returning id, translation, is_unclear, (xmax = 0)
    into v_id, v_stored, v_flag, v_new;

  perform public.apply_learning_evidence(v_user, p_evidence);

  return query select v_id, v_new, v_stored, v_flag;
end;
$$;

-- Remove the learner's translation. §13: the SENTENCE is untouched — this is a
-- note about the text, not the text. A note that also carries "nie rozumiem"
-- survives as that flag; a note that carried nothing else disappears, because a
-- row with neither a translation nor a flag says nothing.
create or replace function public.delete_sentence_translation(p_sentence_id bigint)
returns table (note_id bigint, deleted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_anchor record;
  v_note   public.user_sentence_notes%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  select * into v_note from public.user_sentence_notes n
   where n.user_id = v_user
     and n.chapter_id = v_anchor.chapter_id
     and n.sentence_position = v_anchor.sentence_position;

  if v_note.id is null then
    return query select null::bigint, false;
    return;
  end if;

  if v_note.is_unclear then
    update public.user_sentence_notes set translation = null where id = v_note.id;
    return query select v_note.id, false;
  else
    delete from public.user_sentence_notes where id = v_note.id;
    return query select v_note.id, true;
  end if;
end;
$$;

-- ── "nie rozumiem" / "już rozumiem" ──────────────────────────────────────────

-- Flag a sentence as not understood, or clear the flag.
--
-- REVERSIBLE BY CONSTRUCTION (§18). The flag is current state; the log keeps the
-- sequence. `p_evidence` carries an INTERACTION-scoped event key — one per tap,
-- not one per sentence — precisely so that marking a sentence unclear in chapter
-- three and understood a week later leaves two rows in `learning_events` and one
-- row here. A retried request replays the same key and changes nothing.
create or replace function public.set_sentence_unclear(
  p_sentence_id bigint,
  p_unclear     boolean,
  p_evidence    jsonb
)
returns table (note_id bigint, is_unclear boolean, deleted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_anchor record;
  v_note   public.user_sentence_notes%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  if p_unclear then
    insert into public.user_sentence_notes as n (
      user_id, chapter_id, library_item_id, sentence_position, sentence_id,
      sentence_text, content_version, is_unclear, unclear_at
    ) values (
      v_user, v_anchor.chapter_id, v_anchor.library_item_id,
      v_anchor.sentence_position, v_anchor.sentence_id,
      v_anchor.sentence_text, v_anchor.content_version, true, now()
    )
    on conflict (user_id, chapter_id, sentence_position) do update
      set is_unclear      = true,
          unclear_at      = now(),
          resolved_at     = null,
          sentence_id     = excluded.sentence_id,
          sentence_text   = excluded.sentence_text,
          content_version = excluded.content_version
      returning * into v_note;

    perform public.apply_learning_evidence(v_user, p_evidence);
    return query select v_note.id, true, false;
    return;
  end if;

  select * into v_note from public.user_sentence_notes n
   where n.user_id = v_user
     and n.chapter_id = v_anchor.chapter_id
     and n.sentence_position = v_anchor.sentence_position;

  if v_note.id is null then
    return query select null::bigint, false, false;
    return;
  end if;

  perform public.apply_learning_evidence(v_user, p_evidence);

  -- Understanding a sentence you never translated leaves nothing to keep.
  if v_note.translation is null then
    delete from public.user_sentence_notes where id = v_note.id;
    return query select v_note.id, false, true;
  else
    update public.user_sentence_notes
       set is_unclear = false, resolved_at = now()
     where id = v_note.id;
    return query select v_note.id, false, false;
  end if;
end;
$$;

-- ── word meanings and phrases ────────────────────────────────────────────────

-- Save a contextual word meaning, a personal word, or a phrase.
--
-- WHAT THE CALLER SUPPLIES AND WHAT THIS RE-DERIVES. The caller sends token
-- positions and the span's character range, computed in the Server Action from
-- the chapter's own tokenizer (`src/lib/content/tokenize.ts` — the ONE tokenizer;
-- there is not going to be a second one). This function does not believe the
-- surface: it slices the stored sentence text at the given offsets and refuses
-- the write unless the result is exactly what the caller claimed. So a forged
-- request can save a span of somebody's readable book, and cannot save a span
-- that says something the book does not.
--
-- `word_id` AND THE OCCURRENCE POINTERS ARE LOOKED UP, NEVER ACCEPTED. A learner
-- must not be able to attach their gloss to an arbitrary dictionary entry: the
-- link is whatever the content pipeline actually matched at that token, or
-- nothing at all. Nothing at all is a normal outcome — an unmatched token has no
-- `word_occurrences` row, and writing it down anyway is exactly the personal-word
-- feature (§82).
--
-- THE SPAN STAYS INSIDE ONE SENTENCE because a sentence id is a scalar argument.
-- `p_max_tokens` is passed in from `src/lib/notebook/constants.ts` rather than
-- hard-coded, so the UI and the database cannot disagree about how long a phrase
-- may be (§32).
create or replace function public.save_text_annotation(
  p_sentence_id    bigint,
  p_kind           text,
  p_start_position int,
  p_end_position   int,
  p_char_start     int,
  p_char_end       int,
  p_surface        text,
  p_meaning        text,
  p_lemma          text,
  p_max_tokens     int,
  p_evidence       jsonb
)
returns table (
  annotation_id bigint,
  was_new       boolean,
  word_id       bigint,
  surface       text,
  meaning       text,
  lemma         text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user     uuid := (select auth.uid());
  v_anchor   record;
  v_meaning  text := nullif(btrim(coalesce(p_meaning, '')), '');
  v_lemma    text := nullif(btrim(coalesce(p_lemma, '')), '');
  v_word     bigint;
  v_start_id bigint;
  v_end_id   bigint;
  v_id       bigint;
  v_stored   text;
  v_gloss    text;
  v_head     text;
  v_new      boolean;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_kind not in ('word', 'phrase') then
    raise exception 'Nieznany rodzaj notatki.' using errcode = 'FL422';
  end if;
  if p_start_position is null or p_end_position is null
     or p_start_position < 0 or p_end_position < p_start_position then
    raise exception 'Nieprawidłowy zakres zaznaczenia.' using errcode = 'FL422';
  end if;
  if p_kind = 'word' and p_start_position <> p_end_position then
    raise exception 'Notatka o słowie obejmuje jeden token.' using errcode = 'FL422';
  end if;
  if p_end_position - p_start_position + 1 > greatest(1, coalesce(p_max_tokens, 1)) then
    raise exception 'Zaznaczenie jest za długie.' using errcode = 'FL422';
  end if;
  if v_meaning is not null and length(v_meaning) > 1000 then
    raise exception 'Znaczenie jest za długie.' using errcode = 'FL422';
  end if;
  if v_lemma is not null and length(v_lemma) > 200 then
    raise exception 'Forma podstawowa jest za długa.' using errcode = 'FL422';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  -- THE SURFACE IS VERIFIED AGAINST THE BOOK, not trusted. `substring` is 1-based;
  -- the offsets are the pipeline's 0-based character positions.
  if p_char_start is null or p_char_end is null
     or p_char_start < 0 or p_char_end <= p_char_start
     or p_char_end > length(v_anchor.sentence_text)
     or substring(v_anchor.sentence_text from p_char_start + 1 for p_char_end - p_char_start)
        is distinct from p_surface then
    raise exception 'Zaznaczenie nie pasuje do tekstu.' using errcode = 'FL422';
  end if;

  select o.word_id, o.id into v_word, v_start_id
    from public.word_occurrences o
   where o.sentence_id = v_anchor.sentence_id and o.position = p_start_position;

  select o.id into v_end_id
    from public.word_occurrences o
   where o.sentence_id = v_anchor.sentence_id and o.position = p_end_position;

  -- A phrase is a unit of its own; pinning it to the dictionary entry of its
  -- first token would make "Angst machen" a note about *Angst* (§71).
  if p_kind = 'phrase' then
    v_word := null;
  end if;

  insert into public.user_text_annotations as a (
    user_id, kind, chapter_id, library_item_id, sentence_position, sentence_id,
    start_position, end_position, start_occurrence_id, end_occurrence_id,
    char_start, char_end, surface, sentence_text, content_version,
    word_id, lemma, meaning
  ) values (
    v_user, p_kind, v_anchor.chapter_id, v_anchor.library_item_id,
    v_anchor.sentence_position, v_anchor.sentence_id,
    p_start_position, p_end_position, v_start_id, v_end_id,
    p_char_start, p_char_end, p_surface, v_anchor.sentence_text,
    v_anchor.content_version, v_word, v_lemma, v_meaning
  )
  on conflict (user_id, chapter_id, sentence_position, start_position, end_position)
  do update set
    meaning             = coalesce(excluded.meaning, a.meaning),
    lemma               = coalesce(excluded.lemma, a.lemma),
    sentence_id         = excluded.sentence_id,
    start_occurrence_id = excluded.start_occurrence_id,
    end_occurrence_id   = excluded.end_occurrence_id,
    char_start          = excluded.char_start,
    char_end            = excluded.char_end,
    surface             = excluded.surface,
    sentence_text       = excluded.sentence_text,
    content_version     = excluded.content_version,
    word_id             = excluded.word_id
  returning id, word_id, surface, meaning, lemma, (xmax = 0)
  into v_id, v_word, v_stored, v_gloss, v_head, v_new;

  perform public.apply_learning_evidence(v_user, p_evidence);

  return query select v_id, v_new, v_word, v_stored, v_gloss, v_head;
end;
$$;

-- Correct what a note says. Ownership comes from the WHERE clause, not from a
-- claim in the payload.
create or replace function public.update_text_annotation(
  p_annotation_id bigint,
  p_meaning       text,
  p_lemma         text
)
returns table (annotation_id bigint, meaning text, lemma text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := (select auth.uid());
  v_meaning text := nullif(btrim(coalesce(p_meaning, '')), '');
  v_lemma   text := nullif(btrim(coalesce(p_lemma, '')), '');
  v_row     public.user_text_annotations%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if v_meaning is not null and length(v_meaning) > 1000 then
    raise exception 'Znaczenie jest za długie.' using errcode = 'FL422';
  end if;
  if v_lemma is not null and length(v_lemma) > 200 then
    raise exception 'Forma podstawowa jest za długa.' using errcode = 'FL422';
  end if;

  update public.user_text_annotations
     set meaning = v_meaning, lemma = v_lemma
   where id = p_annotation_id and user_id = v_user
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Nie znaleźliśmy tej notatki.' using errcode = 'FL404';
  end if;

  return query select v_row.id, v_row.meaning, v_row.lemma;
end;
$$;

-- §41: removing a note from the notebook, never from the book.
create or replace function public.delete_text_annotation(p_annotation_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   bigint;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  delete from public.user_text_annotations
   where id = p_annotation_id and user_id = v_user
   returning id into v_id;

  return v_id is not null;
end;
$$;

-- ── the review queue ─────────────────────────────────────────────────────────

-- Put a notebook item into the review queue, or take it out.
--
-- EXPLICIT, ALWAYS (§72). Saving a translation does not schedule anything. The
-- alternative — every translated sentence becomes a card — turns the most
-- valuable reading habit Fluent has into a punishment, and the learner stops
-- translating sentences within a week.
create or replace function public.set_notebook_review(
  p_annotation_id    bigint,
  p_sentence_note_id bigint,
  p_enabled          boolean
)
returns table (review_id bigint, enabled boolean, due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row  public.user_notebook_reviews%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if (p_annotation_id is null) = (p_sentence_note_id is null) then
    raise exception 'Wskaż dokładnie jedną notatkę.' using errcode = 'FL422';
  end if;

  -- Ownership is proved by reading the parent as this learner, never asserted.
  if p_annotation_id is not null then
    if not exists (
      select 1 from public.user_text_annotations a
      where a.id = p_annotation_id and a.user_id = v_user
    ) then
      raise exception 'Nie znaleźliśmy tej notatki.' using errcode = 'FL404';
    end if;
  else
    if not exists (
      select 1 from public.user_sentence_notes n
      where n.id = p_sentence_note_id and n.user_id = v_user
        and n.translation is not null
    ) then
      raise exception 'Nie znaleźliśmy tego tłumaczenia.' using errcode = 'FL404';
    end if;
  end if;

  if not p_enabled then
    delete from public.user_notebook_reviews r
     where r.user_id = v_user
       and r.annotation_id is not distinct from p_annotation_id
       and r.sentence_note_id is not distinct from p_sentence_note_id;
    return query select null::bigint, false, null::timestamptz;
    return;
  end if;

  select * into v_row from public.user_notebook_reviews r
   where r.user_id = v_user
     and r.annotation_id is not distinct from p_annotation_id
     and r.sentence_note_id is not distinct from p_sentence_note_id;

  if v_row.id is null then
    insert into public.user_notebook_reviews (user_id, annotation_id, sentence_note_id)
    values (v_user, p_annotation_id, p_sentence_note_id)
    returning * into v_row;
  end if;

  return query select v_row.id, true, v_row.due_at;
end;
$$;

-- Grade one notebook card.
--
-- A COPY OF `apply_review`'s CONTRACT, FOR A DIFFERENT ITEM. Same idempotency
-- (one `interaction_id` per card presentation, enforced by the unique index on
-- `review_events`, not by a JavaScript guard), same optimistic-concurrency guard
-- on the schedule it was computed from, same single transaction for the event,
-- the schedule and the learning evidence. The SM-2 numbers arrive already
-- computed by `src/lib/sm2.ts`: the database owns the transaction, the
-- application owns the arithmetic, and neither does the other's job.
--
-- WHAT MOVES KNOWLEDGE, AND WHAT DOES NOT, is decided by the caller's folded
-- payload, exactly as everywhere else — this function only commits it. The rule
-- the caller applies is the evidence map's: a contextual cloze makes the learner
-- produce the German form with nothing to pick from, so a card for a word
-- annotation LINKED to a dictionary entry is real active-vocabulary evidence
-- about that word. A phrase card is not: "Angst machen" is its own unit, and
-- crediting *Angst* for recalling it would be the transfer §71 forbids. A
-- sentence-translation card names no word at all.
create or replace function public.apply_notebook_review(
  p_user_id          uuid,
  p_interaction_id   text,
  p_annotation_id    bigint,
  p_sentence_note_id bigint,
  p_item_type        text,
  p_rating           text,
  p_mode             text,
  p_direction        text,
  p_response_ms      int,
  p_srs              jsonb,
  p_evidence         jsonb
)
returns table (
  review_event_id bigint,
  due_at          timestamptz,
  is_mastered     boolean,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_existing public.review_events%rowtype;
  v_card     public.user_notebook_reviews%rowtype;
  v_before   jsonb := coalesce(p_srs -> 'before', '{}'::jsonb);
  v_after    jsonb := coalesce(p_srs -> 'after', '{}'::jsonb);
  v_event    bigint;
begin
  if p_user_id is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_interaction_id is null or length(btrim(p_interaction_id)) = 0 then
    raise exception 'Brak identyfikatora powtórki.' using errcode = 'FL422';
  end if;

  select * into v_existing from public.review_events e
   where e.user_id = p_user_id and e.interaction_id = p_interaction_id;

  -- A replay. Report what the first request decided; change nothing.
  if v_existing.id is not null then
    select * into v_card from public.user_notebook_reviews r
     where r.user_id = p_user_id
       and r.annotation_id is not distinct from p_annotation_id
       and r.sentence_note_id is not distinct from p_sentence_note_id;
    return query select v_existing.id, coalesce(v_card.due_at, v_existing.due_after),
                        coalesce(v_card.is_mastered, false), true;
    return;
  end if;

  select * into v_card from public.user_notebook_reviews r
   where r.user_id = p_user_id
     and r.annotation_id is not distinct from p_annotation_id
     and r.sentence_note_id is not distinct from p_sentence_note_id
   for update;

  if v_card.id is null then
    raise exception 'Ta notatka nie jest w powtórkach.' using errcode = 'FL404';
  end if;

  -- The caller computed the next schedule FROM a state it read a moment ago. If
  -- that state moved meanwhile (a second tab, a queued request) the arithmetic is
  -- stale and applying it would overwrite a review that already happened.
  if v_card.interval    is distinct from (v_before ->> 'interval')::int
     or v_card.repetitions is distinct from (v_before ->> 'repetitions')::int then
    raise exception 'Powtórka się zmieniła.' using errcode = 'FL423';
  end if;

  update public.user_notebook_reviews
     set interval    = (v_after ->> 'interval')::int,
         repetitions = (v_after ->> 'repetitions')::int,
         ease_factor = (v_after ->> 'ease_factor')::numeric,
         due_at      = (v_after ->> 'due_at')::timestamptz,
         is_mastered = (v_after ->> 'is_mastered')::boolean
   where id = v_card.id
   returning * into v_card;

  insert into public.review_events (
    user_id, word_id, item_type, annotation_id, sentence_note_id,
    interaction_id, rating, mode, direction,
    repetitions_before, interval_before, ease_before, due_before,
    repetitions_after, interval_after, ease_after, due_after,
    response_ms, source_kind
  ) values (
    p_user_id, null, p_item_type, p_annotation_id, p_sentence_note_id,
    p_interaction_id, p_rating, p_mode, p_direction,
    (v_before ->> 'repetitions')::int, (v_before ->> 'interval')::int,
    (v_before ->> 'ease_factor')::numeric, (v_before ->> 'due_at')::timestamptz,
    v_card.repetitions, v_card.interval, v_card.ease_factor, v_card.due_at,
    p_response_ms, 'notebook'
  )
  returning id into v_event;

  perform public.apply_learning_evidence(p_user_id, p_evidence);

  return query select v_event, v_card.due_at, v_card.is_mastered, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. EXECUTE GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Narrow on purpose. Everything a learner does to their own notebook derives the
-- learner from `auth.uid()` and is therefore safe to grant to `authenticated`.
-- `apply_notebook_review` is the one exception: it takes `p_user_id`, exactly
-- like `apply_review` and `apply_reading_lookup`, because the Server Action has
-- already established the user from the cookie-bound client and folded the
-- knowledge payload. A browser that could call it could grade somebody else's
-- card, so it is service_role only.
revoke all on function public.notebook_sentence_anchor(bigint) from public;
revoke all on function public.save_sentence_translation(bigint, text, jsonb) from public;
revoke all on function public.delete_sentence_translation(bigint) from public;
revoke all on function public.set_sentence_unclear(bigint, boolean, jsonb) from public;
revoke all on function public.save_text_annotation(bigint, text, int, int, int, int, text, text, text, int, jsonb) from public;
revoke all on function public.update_text_annotation(bigint, text, text) from public;
revoke all on function public.delete_text_annotation(bigint) from public;
revoke all on function public.set_notebook_review(bigint, bigint, boolean) from public;
revoke all on function public.apply_notebook_review(uuid, text, bigint, bigint, text, text, text, text, int, jsonb, jsonb) from public;

grant execute on function public.save_sentence_translation(bigint, text, jsonb)   to authenticated;
grant execute on function public.delete_sentence_translation(bigint)              to authenticated;
grant execute on function public.set_sentence_unclear(bigint, boolean, jsonb)     to authenticated;
grant execute on function public.save_text_annotation(bigint, text, int, int, int, int, text, text, text, int, jsonb) to authenticated;
grant execute on function public.update_text_annotation(bigint, text, text)       to authenticated;
grant execute on function public.delete_text_annotation(bigint)                   to authenticated;
grant execute on function public.set_notebook_review(bigint, bigint, boolean)     to authenticated;

grant execute on function public.apply_notebook_review(uuid, text, bigint, bigint, text, text, text, text, int, jsonb, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- READ YOUR OWN, WRITE NOTHING — the rule every learner-owned table in Fluent
-- has followed since Phase 1, and the answer to §8 and §107: two learners
-- reading the same public book each see their own notes and nothing of each
-- other's. There is no admin exception, because a personal notebook is not
-- content.
--
-- No INSERT, UPDATE or DELETE policy exists on any of these tables. Every write
-- goes through a SECURITY DEFINER function above, which is what makes
-- `user_id`, the anchor columns and the snapshots unforgeable: a client cannot
-- claim a sentence it may not read, cannot claim a surface the book does not
-- contain, and cannot attach its gloss to an arbitrary dictionary entry.
alter table public.user_sentence_notes    enable row level security;
alter table public.user_text_annotations  enable row level security;
alter table public.user_notebook_reviews  enable row level security;

drop policy if exists "own sentence notes read" on public.user_sentence_notes;
create policy "own sentence notes read" on public.user_sentence_notes
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own text annotations read" on public.user_text_annotations;
create policy "own text annotations read" on public.user_text_annotations
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own notebook reviews read" on public.user_notebook_reviews;
create policy "own notebook reviews read" on public.user_notebook_reviews
  for select using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. THE NOTEBOOK'S READ SURFACE.
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE QUERY, NOT FIFTY-ONE (§146). The notebook shows a mixed list — words,
-- phrases, translations, unclear sentences — and each entry needs its book and
-- chapter to say "Gra o tron · Prolog". Fetched from the two annotation tables
-- and then joined per row in JavaScript, a page of 25 entries is 26 round trips
-- and the number grows with the page. This view is the join, done once, in the
-- database, over indexes that already exist.
--
-- `security_invoker` IS THE WHOLE SECURITY STORY. The view runs as the caller, so
-- the `own …` policies on the underlying tables apply exactly as they would to a
-- direct select: a learner sees their own notes and no one else's, and the
-- `library_items` / `chapters` joins are filtered by `library_item_readable` —
-- so even the book TITLE of somebody else's private import is unreachable
-- through here. Without `security_invoker` a view runs as its owner and would
-- have handed every learner every other learner's notebook.
--
-- ONE ROW PER NOTE, NOT ONE PER FEATURE. A sentence that is both translated and
-- flagged unclear is one thing the learner did, so it is one entry carrying two
-- booleans, and the tabs filter on those. Emitting it twice would double-count it
-- in every summary.
create or replace view public.notebook_entries
with (security_invoker = on) as
  select
    a.kind::text                as entry_type,
    a.id                        as entry_id,
    a.user_id,
    a.library_item_id,
    i.slug                      as item_slug,
    i.title                     as item_title,
    a.chapter_id,
    c.position                  as chapter_position,
    c.title                     as chapter_title,
    a.sentence_position,
    a.sentence_id,
    a.start_position,
    a.end_position,
    a.surface,
    a.lemma,
    a.word_id,
    a.meaning,
    a.sentence_text,
    a.char_start,
    a.char_end,
    a.content_version,
    false                       as is_unclear,
    false                       as has_translation,
    (r.id is not null)          as in_review,
    a.created_at,
    a.updated_at
  from public.user_text_annotations a
  join public.library_items i on i.id = a.library_item_id
  join public.chapters c      on c.id = a.chapter_id
  left join public.user_notebook_reviews r on r.annotation_id = a.id

  union all

  select
    'sentence'                  as entry_type,
    n.id                        as entry_id,
    n.user_id,
    n.library_item_id,
    i.slug                      as item_slug,
    i.title                     as item_title,
    n.chapter_id,
    c.position                  as chapter_position,
    c.title                     as chapter_title,
    n.sentence_position,
    n.sentence_id,
    null::int                   as start_position,
    null::int                   as end_position,
    null::text                  as surface,
    null::text                  as lemma,
    null::bigint                as word_id,
    n.translation               as meaning,
    n.sentence_text,
    null::int                   as char_start,
    null::int                   as char_end,
    n.content_version,
    n.is_unclear,
    (n.translation is not null) as has_translation,
    (r.id is not null)          as in_review,
    n.created_at,
    n.updated_at
  from public.user_sentence_notes n
  join public.library_items i on i.id = n.library_item_id
  join public.chapters c      on c.id = n.chapter_id
  left join public.user_notebook_reviews r on r.sentence_note_id = n.id;

comment on view public.notebook_entries is
  'Every personal note of the calling learner, with its book and chapter, as one list. security_invoker so the underlying own-row policies decide what is visible.';

grant select on public.notebook_entries to authenticated;

-- === END 20260915180000_personal_language_notebook.sql ===

-- === BEGIN supabase/migrations/20260917120000_content_delete_indexes.sql ===

-- Fluent — Phase 5.7: deleting a book must not scan the whole database.
--
-- THE BUG THIS FIXES. "Usuń książkę" on a real private import failed with
-- `database_error` — the taxonomy's generic "Coś poszło nie tak" — and it failed
-- reproducibly, on the books that most needed deleting. Nothing was wrong with
-- the permission model, the cascade shape or the function: the delete simply
-- could not finish inside the 8-second statement budget PostgREST gives
-- `authenticated`, so Postgres cancelled it and the learner was told to try
-- again later, forever.
--
-- WHY. `delete_private_library_item` deletes one row. Everything else goes by
-- referential action:
--
--     library_items ─╴cascade╶─▶ chapters ─╴cascade╶─▶ paragraphs
--                                                  └─▶ sentences
--                                                        └─▶ word_occurrences
--
-- and every one of those child rows carries its own referential actions OUT to
-- the tables that merely POINT at content — `learning_events`, `saved_words`,
-- `reading_lookups`, `user_text_annotations`, `user_sentence_notes` — all of
-- which are `on delete set null`, because a learner's history must survive the
-- book it was made in.
--
-- Postgres implements those actions with a per-row trigger. Deleting one
-- `word_occurrences` row runs, once per referencing column:
--
--     update <child> set <fk> = null where <fk> = $1
--
-- If `<fk>` has no index, that statement is a sequential scan. A short chapter
-- has a few hundred occurrences; a 175-chapter book has tens of thousands; five
-- referencing columns turn that into hundreds of thousands of sequential scans
-- over the learner's entire history, and the whole thing is one statement, so
-- there is no partial progress to keep. It times out and rolls back.
--
-- The same arithmetic applies to `replace_chapter_content`, which deletes a
-- chapter's paragraphs wholesale before reinserting them — which is to say
-- "Odśwież słownictwo" on the same screen was walking towards the identical
-- wall from the other direction.
--
-- WHAT THIS MIGRATION DOES. Nothing but indexes. Every foreign key that points
-- INTO the content graph gets a btree with that column leading, so each of those
-- per-row referential statements is an index probe against nothing instead of a
-- table scan. The fix is boring on purpose: no function changes, no new
-- behaviour, no state machine, and no SQL that could be wrong about the domain.
--
-- WHY THEY WERE MISSING. Postgres indexes the REFERENCED side of a foreign key
-- automatically (it must, to enforce uniqueness) and the REFERENCING side never.
-- Every one of these columns was added to answer a read — "this learner's events
-- for this chapter", "this learner's notes in this book" — and every one of
-- those reads leads with `user_id`, which is the right index for the read and
-- useless to a referential check that knows only the content id. Both indexes
-- are needed, for different questions.
--
-- Partial (`where … is not null`) wherever the column is nullable: the
-- referential statement always searches for a concrete id, so the planner can
-- use the partial index, and a column that is null on the overwhelming majority
-- of rows — `learning_events.chapter_id` is null for every test answer ever
-- recorded — should not pay for an entry on each of them.
--
-- Safe to re-run, and safe on a live database: these are `if not exists`, they
-- add no constraint and drop nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE EVIDENCE LOG AND THE VOCABULARY IT PRODUCED.
-- ─────────────────────────────────────────────────────────────────────────────
-- The two biggest tables a learner owns, and the two that point at the finest
-- grain of content — an occurrence is one token in one sentence, so these are
-- the columns that turn a book deletion from slow into impossible.
create index if not exists learning_events_library_item_fk_idx
  on public.learning_events (library_item_id) where library_item_id is not null;
create index if not exists learning_events_chapter_fk_idx
  on public.learning_events (chapter_id) where chapter_id is not null;
create index if not exists learning_events_sentence_fk_idx
  on public.learning_events (sentence_id) where sentence_id is not null;
create index if not exists learning_events_occurrence_fk_idx
  on public.learning_events (word_occurrence_id) where word_occurrence_id is not null;
create index if not exists learning_events_reading_session_fk_idx
  on public.learning_events (reading_session_id) where reading_session_id is not null;

create index if not exists saved_words_origin_item_fk_idx
  on public.saved_words (origin_library_item_id) where origin_library_item_id is not null;
create index if not exists saved_words_origin_chapter_fk_idx
  on public.saved_words (origin_chapter_id) where origin_chapter_id is not null;
create index if not exists saved_words_origin_sentence_fk_idx
  on public.saved_words (origin_sentence_id) where origin_sentence_id is not null;
create index if not exists saved_words_origin_occurrence_fk_idx
  on public.saved_words (origin_occurrence_id) where origin_occurrence_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE READER'S OWN TABLES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Progress and sessions cascade from both ends — the chapter and the book — and
-- every existing index on them leads with `user_id` (or IS the `(user_id,
-- chapter_id)` primary key), which a referential check cannot use.
create index if not exists reading_progress_chapter_fk_idx
  on public.reading_progress (chapter_id);
create index if not exists reading_progress_item_fk_idx
  on public.reading_progress (library_item_id);

create index if not exists reading_sessions_chapter_fk_idx
  on public.reading_sessions (chapter_id);
create index if not exists reading_sessions_item_fk_idx
  on public.reading_sessions (library_item_id);

create index if not exists reading_lookups_chapter_fk_idx
  on public.reading_lookups (chapter_id);
create index if not exists reading_lookups_item_fk_idx
  on public.reading_lookups (library_item_id);
create index if not exists reading_lookups_sentence_fk_idx
  on public.reading_lookups (sentence_id) where sentence_id is not null;
create index if not exists reading_lookups_occurrence_fk_idx
  on public.reading_lookups (occurrence_id) where occurrence_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE STORY ENGINE.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists user_chapter_learning_state_chapter_fk_idx
  on public.user_chapter_learning_state (chapter_id);
create index if not exists user_chapter_learning_state_item_fk_idx
  on public.user_chapter_learning_state (library_item_id);

create index if not exists chapter_user_analysis_chapter_fk_idx
  on public.chapter_user_analysis (chapter_id);
create index if not exists chapter_user_analysis_item_fk_idx
  on public.chapter_user_analysis (library_item_id);

create index if not exists chapter_questions_item_fk_idx
  on public.chapter_questions (library_item_id);

create index if not exists chapter_preparation_sessions_chapter_fk_idx
  on public.chapter_preparation_sessions (chapter_id);
create index if not exists chapter_preparation_sessions_item_fk_idx
  on public.chapter_preparation_sessions (library_item_id);
create index if not exists chapter_preparation_items_sentence_fk_idx
  on public.chapter_preparation_items (sentence_id) where sentence_id is not null;

create index if not exists chapter_assessment_sessions_chapter_fk_idx
  on public.chapter_assessment_sessions (chapter_id);
create index if not exists chapter_assessment_sessions_item_fk_idx
  on public.chapter_assessment_sessions (library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE NOTEBOOK.
-- ─────────────────────────────────────────────────────────────────────────────
-- Notes are anchored on `(chapter_id, sentence_position)` and keep `sentence_id`
-- and the occurrence ids as nullable POINTERS, by design — which is exactly the
-- shape whose referential upkeep this migration is paying for.
create index if not exists user_sentence_notes_chapter_fk_idx
  on public.user_sentence_notes (chapter_id);
create index if not exists user_sentence_notes_item_fk_idx
  on public.user_sentence_notes (library_item_id);
create index if not exists user_sentence_notes_sentence_fk_idx
  on public.user_sentence_notes (sentence_id) where sentence_id is not null;

create index if not exists user_text_annotations_chapter_fk_idx
  on public.user_text_annotations (chapter_id);
create index if not exists user_text_annotations_item_fk_idx
  on public.user_text_annotations (library_item_id);
create index if not exists user_text_annotations_sentence_fk_idx
  on public.user_text_annotations (sentence_id) where sentence_id is not null;
create index if not exists user_text_annotations_start_occurrence_fk_idx
  on public.user_text_annotations (start_occurrence_id) where start_occurrence_id is not null;
create index if not exists user_text_annotations_end_occurrence_fk_idx
  on public.user_text_annotations (end_occurrence_id) where end_occurrence_id is not null;

-- A notebook card cascades from the note it belongs to, and a book deletion
-- deletes notes in bulk — so this is the same per-row cost one level further
-- out. `review_events_user_annotation_idx` leads with `user_id` and answers the
-- review screen's question, not this one.
create index if not exists review_events_annotation_fk_idx
  on public.review_events (annotation_id) where annotation_id is not null;
create index if not exists review_events_sentence_note_fk_idx
  on public.review_events (sentence_note_id) where sentence_note_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE PLANNER AND THE IMPORTER.
-- ─────────────────────────────────────────────────────────────────────────────
-- `daily_plan_items.chapter_id` was already indexed; its book was not.
create index if not exists daily_plan_items_item_fk_idx
  on public.daily_plan_items (library_item_id) where library_item_id is not null;

-- `delete_private_library_item` reads `book_imports` by exactly this column to
-- collect the Storage paths, and then deletes by it. Both were sequential scans.
create index if not exists book_imports_final_item_fk_idx
  on public.book_imports (final_library_item_id) where final_library_item_id is not null;
create index if not exists book_import_chapters_chapter_fk_idx
  on public.book_import_chapters (chapter_id) where chapter_id is not null;

-- === END 20260917120000_content_delete_indexes.sql ===

-- === BEGIN supabase/migrations/20260917140000_dictionary_independent_occurrences.sql ===

-- ═════════════════════════════════════════════════════════════════════════════
-- DICTIONARY-INDEPENDENT READING STRUCTURE
--
-- THE BUG THIS ENDS. `word_occurrences` used to get a row only for a token the
-- dictionary could match AT PROCESSING TIME. That made the STRUCTURE of a book a
-- function of the dictionary as it stood on the day it was imported: a word
-- added a month later was in `/browse` and dead text in the book, and the only
-- way to connect them was to reprocess the chapter — deleting and re-inserting
-- every paragraph, sentence and occurrence in it to change one nullable column.
-- For a 42-chapter novel that is an enormous, risky write whose real purpose was
-- a `word_id` update, and it had to be triggered by hand.
--
-- THE NEW INVARIANT, and it is the one the rest of this file exists to serve:
--
--     Every lexical token gets an occurrence. Dictionary resolution is OPTIONAL
--     and may evolve independently of the immutable reading structure.
--
-- So `word_id` is nullable in the honest sense — "no entry TODAY" — and the
-- structure around it never moves. Bringing a chapter up to date with a newer
-- dictionary is then an in-place, additive, idempotent pass
-- (`sync_chapter_dictionary` below) rather than a rewrite, which is why it is
-- safe to run on a book somebody is in the middle of reading.
--
-- WHAT THIS MIGRATION ADDS
--   1. `dictionary_revision` — one row, bumped by a trigger on `words`, so
--      "has the dictionary changed?" is a primary-key read.
--   2. `chapters.dictionary_revision` — which dictionary this chapter's stored
--      `word_id`s were resolved against. NULL means "never reconciled", which is
--      every chapter processed before today.
--   3. `sync_chapter_dictionary` — the only write path for reconciliation.
--
-- WHAT IT DOES NOT DO. No backfill runs here. The German tokenizer lives in
-- TypeScript (`src/lib/content/tokenize.ts`) and re-implementing it in PL/pgSQL
-- to fill the legacy gaps would be a second tokenizer — the one thing the content
-- pipeline is not allowed to have. Existing chapters are reconciled by the
-- application, batched, through the function below, the first time anything opens
-- them. Re-running this migration is safe and re-running a reconciliation writes
-- nothing.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE DICTIONARY'S REVISION NUMBER
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE ROW ON PURPOSE. The question "is my cached dictionary index still current?"
-- is asked on chapter renders, so it must cost a primary-key lookup — not a
-- `count(*)` that grows with the dictionary, and not a `max(updated_at)` that
-- cannot see a DELETE.
create table if not exists public.dictionary_revision (
  id         boolean primary key default true check (id),
  revision   bigint      not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.dictionary_revision (id) values (true)
on conflict (id) do nothing;

-- Statement-level: one bump per statement, so importing 5 000 words costs one
-- update rather than five thousand.
create or replace function public.bump_dictionary_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.dictionary_revision d
     set revision = d.revision + 1,
         updated_at = now()
   where d.id;
  return null;
end;
$$;

drop trigger if exists words_bump_dictionary_revision on public.words;
create trigger words_bump_dictionary_revision
  after insert or update or delete on public.words
  for each statement execute function public.bump_dictionary_revision();

alter table public.dictionary_revision enable row level security;

-- Readable by everyone, exactly like `words` itself: it says nothing but "the
-- dictionary has changed N times". Writable by nobody — only the trigger, which
-- is security definer.
drop policy if exists "dictionary revision read" on public.dictionary_revision;
create policy "dictionary revision read" on public.dictionary_revision
  for select using (true);

grant select on public.dictionary_revision to anon, authenticated;
revoke insert, update, delete on public.dictionary_revision from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WHICH DICTIONARY A CHAPTER AGREES WITH
-- ─────────────────────────────────────────────────────────────────────────────
-- `content_hash` describes the source and `processor_version` describes the
-- pipeline; neither said anything about `words`, which is precisely why nothing
-- ever noticed that a chapter's glosses had fallen behind. This is that missing
-- third stamp, and it is what makes reconciliation a no-op when there is nothing
-- to do.
alter table public.chapters
  add column if not exists dictionary_revision bigint;

comment on column public.chapters.dictionary_revision is
  'The dictionary_revision.revision this chapter''s word_occurrences.word_id values were resolved against. NULL means never reconciled.';

-- The reconciler updates unresolved rows by (chapter, normalized form). The
-- existing (chapter_id, word_id) index already serves "this chapter''s
-- unresolved tokens", which is the selective half of that predicate.
comment on table public.word_occurrences is
  'One row per LEXICAL TOKEN of a sentence. word_id is the current dictionary''s answer and NULL is a legitimate one; the row, its position and its offsets are structure and never depend on the dictionary.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RECONCILIATION — the in-place, additive write path
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRAST IT WITH `replace_chapter_content`, which is the function for when the
-- TEXT changed: that one deletes paragraphs wholesale and everything cascades.
-- This one only ever
--
--   * inserts occurrence rows for token positions that have none, and
--   * fills in `word_id` / `lemma` on rows that had no answer yet.
--
-- It never deletes an occurrence, never renumbers a position, never touches a
-- paragraph, a sentence or a character of text. Reading progress, notebook notes,
-- saved words and reading history are anchored on exactly those positions and
-- ids, so they survive by construction — which is the difference between a pass
-- that can run while somebody is reading and one that cannot.
--
-- IDEMPOTENT. The insert conflicts on the unique (sentence_id, position) index
-- and does nothing; the update only touches rows that are still unresolved.
-- Running it twice writes nothing the second time.
--
-- TRUSTED INPUT, VERIFIED ANYWAY. Sentences are joined back to the chapter, so a
-- payload cannot reach another chapter's rows, and `word_id` is looked up in
-- `words` rather than trusted, so a dictionary entry deleted mid-run leaves the
-- occurrence unresolved instead of aborting the batch.
--
-- service_role only: it accepts computed structure, so a browser must never reach
-- it. The application decides WHO may ask for a chapter to be reconciled (anyone
-- who may read it) — but the payload is always derived from that chapter's own
-- stored text and from `words`, never from the caller.
create or replace function public.sync_chapter_dictionary(
  p_chapter_id  uuid,
  p_occurrences jsonb   default '[]'::jsonb,
  p_resolutions jsonb   default '[]'::jsonb,
  p_revision    bigint  default null,
  p_finalize    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter  public.chapters%rowtype;
  v_inserted int := 0;
  v_resolved int := 0;
begin
  select * into v_chapter from public.chapters c where c.id = p_chapter_id for update;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  -- 3a. The gaps: token positions a pre-phase chapter never stored a row for.
  with payload as (
    select
      (row ->> 'sentenceId')::bigint as sentence_id,
      (row ->> 'position')::int      as position,
      row ->> 'surface'              as surface,
      row ->> 'normalized'           as normalized,
      row ->> 'lemma'                as lemma,
      (row ->> 'wordId')::bigint     as word_id,
      coalesce((row ->> 'charStart')::int, 0) as char_start,
      coalesce((row ->> 'charEnd')::int, 0)   as char_end
    from jsonb_array_elements(coalesce(p_occurrences, '[]'::jsonb)) as t(row)
  ),
  inserted as (
    insert into public.word_occurrences (
      sentence_id, chapter_id, position, surface, normalized, lemma,
      word_id, char_start, char_end
    )
    select
      p.sentence_id,
      p_chapter_id,
      p.position,
      p.surface,
      p.normalized,
      p.lemma,
      -- Never trusted: a dictionary row can vanish between planning and writing.
      (select w.id from public.words w where w.id = p.word_id),
      p.char_start,
      p.char_end
    from payload p
    -- The payload cannot reach outside the chapter it names.
    join public.sentences s on s.id = p.sentence_id and s.chapter_id = p_chapter_id
    where p.surface is not null and p.normalized is not null
    on conflict (sentence_id, position) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  -- 3b. The resolutions: "every unresolved occurrence of this form, in this
  -- chapter, is that dictionary word". Keyed on the normalized form because that
  -- is the only thing matching depends on — which is also why one update per
  -- distinct form is enough for thousands of tokens.
  with payload as (
    select distinct on (row ->> 'normalized')
      row ->> 'normalized'         as normalized,
      (row ->> 'wordId')::bigint   as word_id,
      row ->> 'lemma'              as lemma
    from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) as t(row)
    -- `distinct on` without an order is an arbitrary choice; a duplicated form
    -- in the payload must not make the write non-deterministic.
    order by row ->> 'normalized', (row ->> 'wordId')::bigint
  ),
  updated as (
    update public.word_occurrences o
       set word_id = w.id,
           lemma   = coalesce(p.lemma, o.lemma)
      from payload p
      join public.words w on w.id = p.word_id
     where o.chapter_id = p_chapter_id
       and o.word_id is null
       and o.normalized = p.normalized
    returning 1
  )
  select count(*) into v_resolved from updated;

  -- 3c. Finalising: the aggregate and the stamp, together, once the whole
  -- chapter has been walked.
  --
  -- `chapter_vocabulary` is RECOMPUTED from the occurrences rather than patched,
  -- because it is a derived aggregate and the one thing worse than a stale
  -- aggregate is one that is stale in a way nothing can detect. This is counting,
  -- not arithmetic the application owns: the frequencies and first positions are
  -- read straight off the rows.
  if p_finalize then
    delete from public.chapter_vocabulary v where v.chapter_id = p_chapter_id;

    insert into public.chapter_vocabulary (
      chapter_id, word_id, occurrence_count,
      first_paragraph_position, first_sentence_position
    )
    select
      p_chapter_id,
      o.word_id,
      count(*),
      min(p.position),
      min(s.chapter_position)
    from public.word_occurrences o
    join public.sentences  s on s.id = o.sentence_id
    join public.paragraphs p on p.id = s.paragraph_id
    where o.chapter_id = p_chapter_id
      and o.word_id is not null
    group by o.word_id;

    update public.chapters c
       set dictionary_revision = coalesce(p_revision, c.dictionary_revision),
           updated_at          = now()
     where c.id = p_chapter_id;
  end if;

  return jsonb_build_object(
    'chapter_id', p_chapter_id,
    'inserted',   v_inserted,
    'resolved',   v_resolved,
    'finalized',  p_finalize
  );
end;
$$;

revoke all on function public.sync_chapter_dictionary(uuid, jsonb, jsonb, bigint, boolean) from public;
revoke all on function public.sync_chapter_dictionary(uuid, jsonb, jsonb, bigint, boolean) from anon, authenticated;
grant execute on function public.sync_chapter_dictionary(uuid, jsonb, jsonb, bigint, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PROCESSING STAMPS THE DICTIONARY IT USED
-- ─────────────────────────────────────────────────────────────────────────────
-- A freshly processed chapter already agrees with the dictionary that processed
-- it, so it carries the stamp from the start and the reconciler skips it. The
-- rest of the function is unchanged — this is `replace_chapter_content` with one
-- more column written from the payload.
create or replace function public.replace_chapter_content(
  p_chapter_id uuid,
  p_payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter      public.chapters%rowtype;
  v_paragraph    jsonb;
  v_sentence     jsonb;
  v_occurrence   jsonb;
  v_paragraph_id bigint;
  v_sentence_id  bigint;
  v_word_count   int;
  v_item_words   int;
  v_item_chapters int;
begin
  select * into v_chapter from public.chapters c where c.id = p_chapter_id for update;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  delete from public.paragraphs p where p.chapter_id = p_chapter_id;
  delete from public.chapter_vocabulary v where v.chapter_id = p_chapter_id;

  for v_paragraph in
    select value from jsonb_array_elements(coalesce(p_payload -> 'paragraphs', '[]'::jsonb))
  loop
    insert into public.paragraphs (chapter_id, position, kind, text, word_count)
    values (
      p_chapter_id,
      (v_paragraph ->> 'position')::int,
      coalesce(v_paragraph ->> 'kind', 'paragraph'),
      v_paragraph ->> 'text',
      coalesce((v_paragraph ->> 'word_count')::int, 0)
    )
    returning id into v_paragraph_id;

    for v_sentence in
      select value from jsonb_array_elements(coalesce(v_paragraph -> 'sentences', '[]'::jsonb))
    loop
      insert into public.sentences (
        paragraph_id, chapter_id, position, chapter_position,
        text, char_start, char_end, word_count
      ) values (
        v_paragraph_id,
        p_chapter_id,
        (v_sentence ->> 'position')::int,
        (v_sentence ->> 'chapter_position')::int,
        v_sentence ->> 'text',
        coalesce((v_sentence ->> 'char_start')::int, 0),
        coalesce((v_sentence ->> 'char_end')::int, 0),
        coalesce((v_sentence ->> 'word_count')::int, 0)
      )
      returning id into v_sentence_id;

      for v_occurrence in
        select value from jsonb_array_elements(coalesce(v_sentence -> 'occurrences', '[]'::jsonb))
      loop
        insert into public.word_occurrences (
          sentence_id, chapter_id, position, surface, normalized, lemma,
          word_id, char_start, char_end
        ) values (
          v_sentence_id,
          p_chapter_id,
          (v_occurrence ->> 'position')::int,
          v_occurrence ->> 'surface',
          v_occurrence ->> 'normalized',
          v_occurrence ->> 'lemma',
          -- NULL is the ordinary case now: a token the dictionary has no entry
          -- for is still a token, and still a row.
          (v_occurrence ->> 'word_id')::bigint,
          coalesce((v_occurrence ->> 'char_start')::int, 0),
          coalesce((v_occurrence ->> 'char_end')::int, 0)
        );
      end loop;
    end loop;
  end loop;

  insert into public.chapter_vocabulary (
    chapter_id, word_id, occurrence_count,
    first_paragraph_position, first_sentence_position
  )
  select
    p_chapter_id,
    (entry ->> 'word_id')::bigint,
    coalesce((entry ->> 'occurrence_count')::int, 1),
    coalesce((entry ->> 'first_paragraph_position')::int, 0),
    coalesce((entry ->> 'first_sentence_position')::int, 0)
  from jsonb_array_elements(coalesce(p_payload -> 'vocabulary', '[]'::jsonb)) as t(entry)
  -- A dictionary row can disappear between processing and persisting; the
  -- occurrence keeps its lemma either way, the aggregate simply skips it.
  where exists (select 1 from public.words w where w.id = (entry ->> 'word_id')::bigint)
  on conflict (chapter_id, word_id) do update
    set occurrence_count = excluded.occurrence_count;

  v_word_count := coalesce((p_payload ->> 'word_count')::int, 0);

  update public.chapters c
     set word_count                = v_word_count,
         paragraph_count           = coalesce((p_payload ->> 'paragraph_count')::int, 0),
         sentence_count            = coalesce((p_payload ->> 'sentence_count')::int, 0),
         estimated_reading_minutes = greatest(1, coalesce((p_payload ->> 'estimated_reading_minutes')::int, 1)),
         processor_version         = p_payload ->> 'processor_version',
         content_hash              = p_payload ->> 'content_hash',
         dictionary_revision       = coalesce((p_payload ->> 'dictionary_revision')::bigint, c.dictionary_revision),
         dictionary_match_rate     = (p_payload ->> 'dictionary_match_rate')::numeric,
         unmatched_sample          = coalesce(p_payload -> 'unmatched_sample', '[]'::jsonb),
         vocabulary_stats          = coalesce(p_payload -> 'vocabulary_stats', '{}'::jsonb),
         status                    = 'ready',
         processing_error          = null,
         processed_at              = now(),
         updated_at                = now()
   where c.id = p_chapter_id;

  -- The item's totals are DERIVED from its chapters, never asserted, so they
  -- cannot drift away from the content they describe.
  select coalesce(sum(c.word_count), 0), count(*)
    into v_item_words, v_item_chapters
  from public.chapters c where c.library_item_id = v_chapter.library_item_id;

  update public.library_items i
     set word_count    = v_item_words,
         chapter_count = v_item_chapters,
         updated_at    = now()
   where i.id = v_chapter.library_item_id;

  return jsonb_build_object(
    'chapter_id', p_chapter_id,
    'paragraph_count', coalesce((p_payload ->> 'paragraph_count')::int, 0),
    'sentence_count', coalesce((p_payload ->> 'sentence_count')::int, 0),
    'word_count', v_word_count
  );
end;
$$;

revoke all on function public.replace_chapter_content(uuid, jsonb) from public;
revoke all on function public.replace_chapter_content(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_chapter_content(uuid, jsonb) to service_role;

-- === END 20260917140000_dictionary_independent_occurrences.sql ===

-- === BEGIN supabase/migrations/20260917200000_reading_position_engine.sql ===

-- ═════════════════════════════════════════════════════════════════════════════
-- Fluent — READING POSITION ENGINE
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Two bugs, one root cause: reading progress was expressed as a PARAGRAPH INDEX.
--
--   1. `progress_ratio = (furthest_paragraph + 1) / paragraph_count` gives an
--      eight-word line of dialogue and a four-hundred-word description exactly
--      the same weight. In a novel that is not a rounding error — reading two
--      lines of a chapter of dialogue could report 8%, and reading three pages
--      of description could report 2%.
--
--   2. A paragraph is far too coarse to be a bookmark. A learner who stopped in
--      the middle of a 400-word paragraph was returned to the top of it, and the
--      only finer column that existed (`resume_sentence_position`) was never
--      written by anything.
--
-- So this migration moves the whole model onto WORDS — lexical tokens, the unit
-- the content pipeline already counts:
--
--   sentences.word_start        how many of the chapter's tokens precede this
--                               sentence. Derived, never asserted: the database
--                               computes it from `word_count` when content is
--                               stored, which is why the pipeline itself is
--                               untouched and CONTENT_PROCESSOR_VERSION does not
--                               move — the same input still produces the same
--                               paragraphs, sentences, tokens and positions.
--
--   chapters.reading_word_count the denominator, on the same scale.
--
--   reading_progress.*_word_offset   where the learner is / has been, in tokens.
--   reading_progress.*_sentence_position, *_token_position
--                               the ANCHOR those offsets came from, so the
--                               reader can scroll back to the exact place rather
--                               than to the top of a paragraph.
--
-- NOTHING IS LOST AND NOTHING NEEDS RESETTING. `resume_paragraph_position` and
-- `furthest_paragraph_position` stay, keep being written, and remain the
-- fallback for a bookmark saved before this existed. Existing rows are converted
-- in place: a learner who had read through paragraph 80 still has read through
-- paragraph 80 — only its expression as a percentage is corrected. A chapter
-- already completed keeps 100%, so nothing that was finished becomes unfinished.
--
-- See `docs/architecture/reader-story-engine.md` § Reading Position Engine.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE WORD SCALE
-- ─────────────────────────────────────────────────────────────────────────────

-- Exclusive prefix sum of `word_count` over the chapter's sentences, in reading
-- order. Turning an anchor into an offset is then one index seek, which is what
-- makes the reader able to ask "how far through am I?" on every animation frame.
alter table public.sentences
  add column if not exists word_start int not null default 0;

-- The denominator, from the same rows as the numerator. NOT `chapters.word_count`
-- — that is counted by a different function (`countWords` over paragraph text,
-- for display and time estimates) and would be a few tokens off, which is how a
-- progress bar ends up at 99.7% on the last word of a chapter.
alter table public.chapters
  add column if not exists reading_word_count int not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THREE POSITIONS, STORED AS THREE THINGS
-- ─────────────────────────────────────────────────────────────────────────────
-- current   is never stored: it is whatever the reading line is on right now.
-- resume    follows the learner, in BOTH directions.
-- furthest  only ever increases, and is the only input to progress and
--           completion.
--
-- `resume_sentence_position` already existed and was dead. It is alive now, and
-- it means the sentence's position within the CHAPTER (`chapter_position`) —
-- unique per chapter, so an anchor resolves without a join.
alter table public.reading_progress
  add column if not exists resume_token_position      int,
  add column if not exists resume_word_offset         int not null default 0,
  add column if not exists furthest_sentence_position int,
  add column if not exists furthest_token_position    int,
  add column if not exists furthest_word_offset       int not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — the word scale for content that already exists
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent by construction: both statements compute the target value and skip
-- rows that already hold it, so re-running the migration (or re-applying
-- `schema.sql` to a live database) is a no-op rather than a rewrite.

with ordered as (
  select
    s.id,
    coalesce(
      sum(s.word_count) over (
        partition by s.chapter_id
        order by s.chapter_position, s.id
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as computed_start
  from public.sentences s
)
update public.sentences s
   set word_start = o.computed_start
  from ordered o
 where s.id = o.id
   and s.word_start is distinct from o.computed_start;

update public.chapters c
   set reading_word_count = t.total
  from (
    select s.chapter_id, coalesce(max(s.word_start + s.word_count), 0) as total
    from public.sentences s
    group by s.chapter_id
  ) t
 where t.chapter_id = c.id
   and c.reading_word_count is distinct from t.total;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BACKFILL — every learner's existing place, on the new scale
-- ─────────────────────────────────────────────────────────────────────────────
-- A paragraph bookmark carries no sentence, so the conversion is the only thing
-- it can honestly be:
--
--   furthest  the END of the furthest paragraph reached — "read through it",
--             which is exactly what the old ratio claimed
--   resume    the START of the paragraph the learner was on
--
-- A completed chapter is pinned at the end: it was finished, and an arithmetic
-- change must never un-finish it.
--
-- The `furthest_word_offset = 0` guard is what makes this run once. A row the
-- engine has since written has a non-zero offset and is left alone.
update public.reading_progress p
   set furthest_word_offset = x.furthest_offset,
       resume_word_offset   = x.resume_offset,
       progress_ratio       = case
         when x.total <= 0 then p.progress_ratio
         else round(x.furthest_offset::numeric / x.total, 4)
       end
  from (
    select
      p2.user_id,
      p2.chapter_id,
      c.reading_word_count as total,
      case
        when p2.completed_at is not null then c.reading_word_count
        else least(
          coalesce((
            select max(s.word_start + s.word_count)
            from public.sentences s
            join public.paragraphs pg on pg.id = s.paragraph_id
            where pg.chapter_id = c.id
              and pg.position <= p2.furthest_paragraph_position
          ), 0),
          c.reading_word_count
        )
      end as furthest_offset,
      coalesce((
        select min(s.word_start)
        from public.sentences s
        join public.paragraphs pg on pg.id = s.paragraph_id
        where pg.chapter_id = c.id
          and pg.position = p2.resume_paragraph_position
      ), 0) as resume_offset
    from public.reading_progress p2
    join public.chapters c on c.id = p2.chapter_id
    where p2.furthest_word_offset = 0
      and c.reading_word_count > 0
  ) x
 where p.user_id = x.user_id
   and p.chapter_id = x.chapter_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ANCHOR → WORD OFFSET
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SERVER RESOLVES THE ANCHOR, NOT THE CLIENT. The reader reports a place in
-- the text — a paragraph, a sentence, a token — and the database works out what
-- that is worth. A client that sent an offset (or a percentage) directly would
-- be deciding its own progress, which is the one thing progress may never be.
--
-- Three levels of precision, in order, because a bookmark is allowed to be vague
-- and must never be wrong:
--
--   sentence + token   exact: the token the reading line was on
--   sentence           the start of that sentence
--   paragraph only     the start of that paragraph — the legacy bookmark
create or replace function public.reading_word_offset(
  p_chapter_id uuid,
  p_paragraph  int,
  p_sentence   int,
  p_token      int
)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select s.word_start + least(greatest(coalesce(p_token, 0), 0), s.word_count)
      from public.sentences s
      where s.chapter_id = p_chapter_id
        and s.chapter_position = p_sentence
      limit 1
    ),
    (
      select min(s.word_start)
      from public.sentences s
      join public.paragraphs pg on pg.id = s.paragraph_id
      where pg.chapter_id = p_chapter_id
        and pg.position = p_paragraph
    ),
    0
  );
$$;

-- NOT REACHABLE FROM A BROWSER ROLE. It exists for the SECURITY DEFINER
-- functions that own progress; a learner has no business resolving anchors
-- directly, and every answer they could want comes back from a report anyway.
revoke all on function public.reading_word_offset(uuid, int, int, int) from public;
revoke all on function public.reading_word_offset(uuid, int, int, int) from anon, authenticated;
grant execute on function public.reading_word_offset(uuid, int, int, int) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE PIPELINE DERIVES THE WORD SCALE WHEN IT STORES CONTENT
-- ─────────────────────────────────────────────────────────────────────────────
-- Unchanged from the previous definition except for the two statements at the
-- end of the content loop. Deliberately DERIVED here rather than accepted from
-- the payload: `word_start` is a running total of numbers the pipeline already
-- produced, and a second definition of it in TypeScript is a second thing that
-- can disagree with the progress bar.
create or replace function public.replace_chapter_content(
  p_chapter_id uuid,
  p_payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter      public.chapters%rowtype;
  v_paragraph    jsonb;
  v_sentence     jsonb;
  v_occurrence   jsonb;
  v_paragraph_id bigint;
  v_sentence_id  bigint;
  v_word_count   int;
  v_reading_words int;
  v_item_words   int;
  v_item_chapters int;
begin
  select * into v_chapter from public.chapters c where c.id = p_chapter_id for update;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  delete from public.paragraphs p where p.chapter_id = p_chapter_id;
  delete from public.chapter_vocabulary v where v.chapter_id = p_chapter_id;

  for v_paragraph in
    select value from jsonb_array_elements(coalesce(p_payload -> 'paragraphs', '[]'::jsonb))
  loop
    insert into public.paragraphs (chapter_id, position, kind, text, word_count)
    values (
      p_chapter_id,
      (v_paragraph ->> 'position')::int,
      coalesce(v_paragraph ->> 'kind', 'paragraph'),
      v_paragraph ->> 'text',
      coalesce((v_paragraph ->> 'word_count')::int, 0)
    )
    returning id into v_paragraph_id;

    for v_sentence in
      select value from jsonb_array_elements(coalesce(v_paragraph -> 'sentences', '[]'::jsonb))
    loop
      insert into public.sentences (
        paragraph_id, chapter_id, position, chapter_position,
        text, char_start, char_end, word_count
      ) values (
        v_paragraph_id,
        p_chapter_id,
        (v_sentence ->> 'position')::int,
        (v_sentence ->> 'chapter_position')::int,
        v_sentence ->> 'text',
        coalesce((v_sentence ->> 'char_start')::int, 0),
        coalesce((v_sentence ->> 'char_end')::int, 0),
        coalesce((v_sentence ->> 'word_count')::int, 0)
      )
      returning id into v_sentence_id;

      for v_occurrence in
        select value from jsonb_array_elements(coalesce(v_sentence -> 'occurrences', '[]'::jsonb))
      loop
        insert into public.word_occurrences (
          sentence_id, chapter_id, position, surface, normalized, lemma,
          word_id, char_start, char_end
        ) values (
          v_sentence_id,
          p_chapter_id,
          (v_occurrence ->> 'position')::int,
          v_occurrence ->> 'surface',
          v_occurrence ->> 'normalized',
          v_occurrence ->> 'lemma',
          (v_occurrence ->> 'word_id')::bigint,
          coalesce((v_occurrence ->> 'char_start')::int, 0),
          coalesce((v_occurrence ->> 'char_end')::int, 0)
        );
      end loop;
    end loop;
  end loop;

  -- THE WORD SCALE. One pass with a window function over the chapter's own
  -- sentences, in reading order.
  with ordered as (
    select
      s.id,
      coalesce(
        sum(s.word_count) over (
          order by s.chapter_position, s.id
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as computed_start
    from public.sentences s
    where s.chapter_id = p_chapter_id
  )
  update public.sentences s
     set word_start = o.computed_start
    from ordered o
   where s.id = o.id;

  select coalesce(max(s.word_start + s.word_count), 0)
    into v_reading_words
  from public.sentences s where s.chapter_id = p_chapter_id;

  insert into public.chapter_vocabulary (
    chapter_id, word_id, occurrence_count,
    first_paragraph_position, first_sentence_position
  )
  select
    p_chapter_id,
    (entry ->> 'word_id')::bigint,
    coalesce((entry ->> 'occurrence_count')::int, 1),
    coalesce((entry ->> 'first_paragraph_position')::int, 0),
    coalesce((entry ->> 'first_sentence_position')::int, 0)
  from jsonb_array_elements(coalesce(p_payload -> 'vocabulary', '[]'::jsonb)) as t(entry)
  -- A dictionary row can disappear between processing and persisting; the
  -- occurrence keeps its lemma either way, the aggregate simply skips it.
  where exists (select 1 from public.words w where w.id = (entry ->> 'word_id')::bigint)
  on conflict (chapter_id, word_id) do update
    set occurrence_count = excluded.occurrence_count;

  v_word_count := coalesce((p_payload ->> 'word_count')::int, 0);

  update public.chapters c
     set word_count                = v_word_count,
         reading_word_count        = v_reading_words,
         paragraph_count           = coalesce((p_payload ->> 'paragraph_count')::int, 0),
         sentence_count            = coalesce((p_payload ->> 'sentence_count')::int, 0),
         estimated_reading_minutes = greatest(1, coalesce((p_payload ->> 'estimated_reading_minutes')::int, 1)),
         processor_version         = p_payload ->> 'processor_version',
         content_hash              = p_payload ->> 'content_hash',
         dictionary_revision       = coalesce((p_payload ->> 'dictionary_revision')::bigint, c.dictionary_revision),
         dictionary_match_rate     = (p_payload ->> 'dictionary_match_rate')::numeric,
         unmatched_sample          = coalesce(p_payload -> 'unmatched_sample', '[]'::jsonb),
         vocabulary_stats          = coalesce(p_payload -> 'vocabulary_stats', '{}'::jsonb),
         status                    = 'ready',
         processing_error          = null,
         processed_at              = now(),
         updated_at                = now()
   where c.id = p_chapter_id;

  -- The item's totals are DERIVED from its chapters, never asserted, so they
  -- cannot drift away from the content they describe.
  select coalesce(sum(c.word_count), 0), count(*)
    into v_item_words, v_item_chapters
  from public.chapters c where c.library_item_id = v_chapter.library_item_id;

  update public.library_items i
     set word_count    = v_item_words,
         chapter_count = v_item_chapters,
         updated_at    = now()
   where i.id = v_chapter.library_item_id;

  return jsonb_build_object(
    'chapter_id', p_chapter_id,
    'paragraph_count', coalesce((p_payload ->> 'paragraph_count')::int, 0),
    'sentence_count', coalesce((p_payload ->> 'sentence_count')::int, 0),
    'word_count', v_word_count,
    'reading_word_count', v_reading_words
  );
end;
$$;

revoke all on function public.replace_chapter_content(uuid, jsonb) from public;
revoke all on function public.replace_chapter_content(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_chapter_content(uuid, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OPENING A CHAPTER RETURNS THE WHOLE POSITION
-- ─────────────────────────────────────────────────────────────────────────────
-- Dropped rather than replaced: the return shape changes, and PostgreSQL will
-- not `create or replace` a function whose OUT columns differ.
drop function if exists public.start_reading_session(uuid);

create or replace function public.start_reading_session(p_chapter_id uuid)
returns table (
  session_id          uuid,
  library_item_id     uuid,
  resume_paragraph    int,
  resume_sentence     int,
  resume_token        int,
  resume_word_offset  int,
  furthest_paragraph  int,
  furthest_sentence   int,
  furthest_token      int,
  furthest_word_offset int,
  reading_word_count  int,
  progress_ratio      numeric,
  completed_at        timestamptz,
  resumed             boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_item      uuid;
  v_status    text;
  v_session   uuid;
  v_existing  boolean := false;
  v_words     int;
  v_progress  public.reading_progress%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id, c.status, c.reading_word_count
    into v_item, v_status, v_words
  from public.chapters c
  join public.library_items i on i.id = c.library_item_id
  where c.id = p_chapter_id
    and public.library_item_readable(i.status, i.archived_at, i.owner_user_id);

  if v_item is null then
    raise exception 'Rozdział nie istnieje lub nie masz do niego dostępu.' using errcode = 'FL404';
  end if;
  if v_status <> 'ready' then
    -- Unprocessed content is not shown to a learner: half-parsed text is worse
    -- than an honest "jeszcze nie gotowe".
    raise exception 'Rozdział nie jest jeszcze gotowy do czytania.' using errcode = 'FL412';
  end if;

  insert into public.reading_progress (user_id, chapter_id, library_item_id, session_count)
  values (v_user, p_chapter_id, v_item, 1)
  on conflict (user_id, chapter_id) do update
    set last_read_at  = now(),
        session_count = public.reading_progress.session_count + 1;

  select * into v_progress
  from public.reading_progress p
  where p.user_id = v_user and p.chapter_id = p_chapter_id;

  select s.id into v_session
  from public.reading_sessions s
  where s.user_id = v_user and s.chapter_id = p_chapter_id and s.status = 'in_progress'
  limit 1;

  if v_session is not null then
    v_existing := true;
    update public.reading_sessions s
       set last_active_at = now()
     where s.id = v_session;
  else
    insert into public.reading_sessions (
      user_id, chapter_id, library_item_id, progress_before, progress_after
    ) values (
      v_user, p_chapter_id, v_item, v_progress.progress_ratio, v_progress.progress_ratio
    )
    returning id into v_session;
  end if;

  return query select
    v_session,
    v_item,
    v_progress.resume_paragraph_position,
    v_progress.resume_sentence_position,
    v_progress.resume_token_position,
    v_progress.resume_word_offset,
    v_progress.furthest_paragraph_position,
    v_progress.furthest_sentence_position,
    v_progress.furthest_token_position,
    v_progress.furthest_word_offset,
    coalesce(v_words, 0),
    v_progress.progress_ratio,
    v_progress.completed_at,
    v_existing;
end;
$$;

revoke all on function public.start_reading_session(uuid) from public;
revoke all on function public.start_reading_session(uuid) from anon;
grant execute on function public.start_reading_session(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RECORDING A POSITION
-- ─────────────────────────────────────────────────────────────────────────────
-- TWO ANCHORS PER REPORT, AND THAT IS THE WHOLE FIX.
--
--   the resume anchor    where the learner IS. Written in both directions.
--   the furthest anchor  how far they have CONFIRMED reading — the reader only
--                        advances this after the place has held at the reading
--                        line for a dwell, so a fling to the end of the chapter
--                        moves the bookmark and not the progress bar.
--
-- `greatest(...)` is still where monotonicity lives, not an application `if`:
-- two tabs on the same chapter report different positions and only the database
-- sees both.
--
-- `p_max_active_seconds` is the cap from `src/lib/reading/constants.ts`. It is a
-- PARAMETER rather than a literal so the constant stays in one place, and it is
-- applied here rather than trusted from the client so that a slept machine, a
-- paused debugger or a forged request cannot claim an hour of reading.
drop function if exists public.record_reading_progress(uuid, int, int, int, int);

create or replace function public.record_reading_progress(
  p_session_id                  uuid,
  p_paragraph_position          int,
  p_sentence_position           int,
  p_token_position              int,
  p_furthest_paragraph_position int,
  p_furthest_sentence_position  int,
  p_furthest_token_position     int,
  p_active_seconds              int,
  p_max_active_seconds          int
)
returns table (
  progress_ratio       numeric,
  furthest_paragraph   int,
  furthest_word_offset int,
  reading_word_count   int,
  active_seconds       int,
  words_read           int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user         uuid := (select auth.uid());
  v_session      public.reading_sessions%rowtype;
  v_paragraphs   int;
  v_words        int;
  v_total        int;
  v_resume_par   int;
  v_furthest_par int;
  v_resume_off   int;
  v_reported_off int;
  v_seconds      int;
  v_ratio        numeric;
  v_furthest     int;
  v_offset       int;
  v_seconds_total int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_session
  from public.reading_sessions s
  where s.id = p_session_id for update;

  if not found then
    raise exception 'Sesja czytania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'Ta sesja czytania została zakończona.' using errcode = 'FL409';
  end if;

  select greatest(c.paragraph_count, 1), c.word_count, c.reading_word_count
    into v_paragraphs, v_words, v_total
  from public.chapters c where c.id = v_session.chapter_id;

  v_resume_par := least(greatest(coalesce(p_paragraph_position, 0), 0), v_paragraphs - 1);
  v_furthest_par := least(
    greatest(coalesce(p_furthest_paragraph_position, v_resume_par), 0),
    v_paragraphs - 1
  );
  v_seconds := least(
    greatest(coalesce(p_active_seconds, 0), 0),
    greatest(coalesce(p_max_active_seconds, 0), 0)
  );

  v_resume_off := public.reading_word_offset(
    v_session.chapter_id, v_resume_par, p_sentence_position, p_token_position
  );
  v_reported_off := public.reading_word_offset(
    v_session.chapter_id, v_furthest_par,
    p_furthest_sentence_position, p_furthest_token_position
  );

  update public.reading_progress p
     set resume_paragraph_position   = v_resume_par,
         resume_sentence_position    = p_sentence_position,
         resume_token_position       = p_token_position,
         resume_word_offset          = v_resume_off,

         furthest_paragraph_position = greatest(p.furthest_paragraph_position, v_furthest_par),
         furthest_word_offset        = greatest(p.furthest_word_offset, v_reported_off),
         -- The anchor is kept only when it is the one that WON, so the stored
         -- sentence and token always describe the stored offset.
         furthest_sentence_position  = case
           when v_reported_off > p.furthest_word_offset then p_furthest_sentence_position
           else p.furthest_sentence_position
         end,
         furthest_token_position     = case
           when v_reported_off > p.furthest_word_offset then p_furthest_token_position
           else p.furthest_token_position
         end,

         progress_ratio = case
           -- THE WORD SCALE, when the chapter has one.
           when coalesce(v_total, 0) > 0 then greatest(
             p.progress_ratio,
             round(greatest(p.furthest_word_offset, v_reported_off)::numeric / v_total, 4)
           )
           -- FALLBACK for a chapter stored before this migration ran and never
           -- reprocessed since. Coarse, but it is the same answer the reader gave
           -- yesterday, which is better than dividing by zero.
           else greatest(
             p.progress_ratio,
             round((greatest(p.furthest_paragraph_position, v_furthest_par) + 1)::numeric / v_paragraphs, 4)
           )
         end,
         active_seconds = p.active_seconds + v_seconds,
         last_read_at   = now()
   where p.user_id = v_user and p.chapter_id = v_session.chapter_id
   returning p.progress_ratio, p.furthest_paragraph_position,
             p.furthest_word_offset, p.active_seconds
        into v_ratio, v_furthest, v_offset, v_seconds_total;

  if v_ratio is null then
    raise exception 'Brak postępu czytania dla tej sesji.' using errcode = 'FL404';
  end if;

  update public.reading_sessions s
     set active_seconds   = s.active_seconds + v_seconds,
         last_active_at   = now(),
         progress_after   = v_ratio,
         words_progressed = greatest(
           s.words_progressed,
           round(greatest(v_ratio - s.progress_before, 0) * coalesce(v_words, 0))::int
         )
   where s.id = p_session_id;

  return query select
    v_ratio,
    v_furthest,
    v_offset,
    coalesce(v_total, 0),
    v_seconds_total,
    round(v_ratio * coalesce(v_words, 0))::int;
end;
$$;

revoke all on function public.record_reading_progress(uuid, int, int, int, int, int, int, int, int) from public;
revoke all on function public.record_reading_progress(uuid, int, int, int, int, int, int, int, int) from anon;
grant execute on function public.record_reading_progress(uuid, int, int, int, int, int, int, int, int) to authenticated;

-- === END 20260917200000_reading_position_engine.sql ===

-- === BEGIN supabase/migrations/20260921120000_material_covers.sql ===

-- ═════════════════════════════════════════════════════════════════════════════
-- MATERIAL COVERS — artwork for the things a learner reads.
-- ═════════════════════════════════════════════════════════════════════════════
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
--
-- It adds a Storage bucket and the policies that decide who may write to it. It
-- adds NO column: `library_items.cover_url` has existed since Phase 4
-- (`20260914120000_reader_story_engine.sql`) and is the one place a material's
-- picture is recorded. A passage in `texts` reaches it through
-- `library_items.legacy_text_id` — the same mapping questions, attempts,
-- completions and today's plan already travel — so there is no second image
-- column and no second content model to keep in step.
--
-- A COVER BELONGS TO THE ITEM, NOT THE CHAPTER. A 30-chapter novel stores one
-- URL; a chapter inherits its book's artwork at read time. That is why nothing
-- here touches `chapters`.
--
-- WHO MAY WRITE. `library_items` is already admin-write via
-- `library_item_writable(owner_user_id)`, which also refuses a private import to
-- everyone including admins — so the column's authorisation is settled. What is
-- NOT settled by that policy is the bucket: without the policies below, any
-- authenticated learner could upload, replace or delete the artwork of published
-- teaching material. A hidden button in an admin panel is not an access control.
--
-- WHY THE BUCKET IS PUBLIC-READ. These are the covers of PUBLISHED material —
-- the same bytes every learner is meant to see. Signing a URL per render would
-- cost a round trip and defeat CDN caching to protect nothing. The importer's
-- bucket is private for the opposite reason: a learner's own file is theirs.
-- Two buckets, two rules, neither inherited from the other.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE BUCKET.
-- ─────────────────────────────────────────────────────────────────────────────
-- Guarded on `storage.buckets` existing so the schema still applies to a plain
-- PostgreSQL instance, which is exactly what `supabase/tests/run.sh` does. The
-- test shim provides a minimal `storage` schema, so the policies below are
-- created — and exercised — there too.
do $$
declare
  -- Mirrors MAX_COVER_BYTES in `src/lib/library/covers.ts` (5 MB). A PL/pgSQL
  -- function cannot import a TypeScript constant; change both together.
  v_size_limit bigint := 5 * 1024 * 1024;
  v_mime text[] := array['image/jpeg', 'image/png', 'image/webp'];
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('content-covers', 'content-covers', true)
    on conflict (id) do update set public = true;

    -- THE THIRD PLACE THE LIMITS ARE ENFORCED, after the browser and the Server
    -- Action. Storage rejects an oversized or wrong-typed object itself, so a
    -- signed upload URL cannot be used to park a 200 MB video in a public
    -- bucket. Applied only where the columns exist: the test shim has neither,
    -- and an older Storage release may have only one.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'buckets'
        and column_name = 'file_size_limit'
    ) then
      execute 'update storage.buckets set file_size_limit = $1 where id = ''content-covers'''
        using v_size_limit;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'buckets'
        and column_name = 'allowed_mime_types'
    ) then
      execute 'update storage.buckets set allowed_mime_types = $1 where id = ''content-covers'''
        using v_mime;
    end if;
  end if;

  -- ───────────────────────────────────────────────────────────────────────────
  -- 2. WHO MAY DO WHAT TO AN OBJECT IN IT.
  -- ───────────────────────────────────────────────────────────────────────────
  if to_regclass('storage.objects') is not null then
    -- A hosted Supabase project already has RLS on `storage.objects`, and the
    -- role running migrations may not own that table. Enabling it again would
    -- fail for a permission reason on a database where it is already correct, so
    -- it is only touched when it is actually off.
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
      execute 'alter table storage.objects enable row level security';
    end if;

    -- READ: everyone, signed in or not. A published material's artwork is public
    -- content, and `/library` is readable without an account.
    execute 'drop policy if exists "content covers public read" on storage.objects';
    execute $p$
      create policy "content covers public read" on storage.objects
        for select to anon, authenticated using (
          bucket_id = 'content-covers'
        )
    $p$;

    -- WRITE: admins, and nobody else. `public.is_admin()` reads the role from
    -- `profiles` — the same predicate every other admin policy in this schema
    -- uses — so there is one definition of "admin" and a learner cannot upload,
    -- replace or delete artwork whatever request they craft against the bucket.
    execute 'drop policy if exists "content covers admin insert" on storage.objects';
    execute $p$
      create policy "content covers admin insert" on storage.objects
        for insert to authenticated with check (
          bucket_id = 'content-covers' and public.is_admin()
        )
    $p$;

    execute 'drop policy if exists "content covers admin update" on storage.objects';
    execute $p$
      create policy "content covers admin update" on storage.objects
        for update to authenticated using (
          bucket_id = 'content-covers' and public.is_admin()
        ) with check (
          bucket_id = 'content-covers' and public.is_admin()
        )
    $p$;

    execute 'drop policy if exists "content covers admin delete" on storage.objects';
    execute $p$
      create policy "content covers admin delete" on storage.objects
        for delete to authenticated using (
          bucket_id = 'content-covers' and public.is_admin()
        )
    $p$;
  end if;
exception
  when insufficient_privilege then
    -- Some managed deployments lock the `storage` schema to its own admin role.
    -- The migration must not abort, and the failure mode is SAFE: without the
    -- bucket uploads fail loudly, and without the policies RLS denies
    -- everything. Fail closed, warn, and let the operator apply the block.
    raise warning 'content cover storage objects were not created (%). Create the public bucket and its policies manually — see supabase/migrations/README.md.', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FINDING THE ITEM A PASSAGE BECAME.
-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing new is needed: `backfill_library_from_texts()` already creates the
-- missing item for a passage written after Phase 4, and it is already
-- service_role-only and idempotent. The cover actions call it exactly as
-- `processPendingChapters` does, rather than inventing a second way for a
-- `texts` row to acquire a library item.
--
-- It is run here too, so that a project applying this migration has an item for
-- every passage before an admin tries to give one a picture.
do $$ begin perform public.backfill_library_from_texts(); end $$;

comment on column public.library_items.cover_url is
  'The material''s artwork: an absolute URL, normally a public object in the content-covers bucket. Set for a passage through legacy_text_id, inherited by every chapter of a book, and never duplicated onto chapters.';

-- === END 20260921120000_material_covers.sql ===

-- === BEGIN supabase/migrations/20260922120000_dictionary_write_integrity.sql ===

-- ═════════════════════════════════════════════════════════════════════════════
-- DICTIONARY WRITE INTEGRITY — who allocates an id, and who owns a transaction.
-- ═════════════════════════════════════════════════════════════════════════════
-- Two admin write paths did in the application what only the database can do.
--
-- 1. ALLOCATING AN ID. `createWord` read `max(id)`, added one, and inserted:
--
--      select id from words order by id desc limit 1;   -- 2588
--      insert into words (id, …) values (2589, …);
--
--    Two admins adding a word in the same few milliseconds both read 2588 and
--    both try 2589. One wins; the other gets a primary-key violation surfaced
--    as a raw Postgres message. Nothing was corrupted, but the losing admin's
--    work vanished behind an error nobody could act on — and the window widens
--    with every import running alongside.
--
--    `words.id` is a plain `bigint` rather than an identity column BECAUSE the
--    seeds and the DTZ wordlist import insert explicit ids, and those ids are
--    referenced by `saved_words`, `word_occurrences`, `user_word_knowledge`,
--    `questions.tested_word_id` and a learner's own annotations. Renumbering is
--    out of the question. So this does not convert the column: it attaches a
--    sequence as a DEFAULT and keeps that sequence ahead of every explicit id,
--    which leaves all existing rows and all existing ids exactly as they are
--    while making the next allocation atomic.
--
-- 2. REVIEWING A SUGGESTION. `reviewSuggestion` ran three statements with no
--    transaction and no lock: read the status, patch `words`, mark the
--    suggestion. Two admins opening the same queue both read `pending`, both
--    apply the edit, and both stamp their own name on it. Worse, a failure
--    between statements two and three left the word EDITED and the suggestion
--    still `pending` — so the next review applied the same edit again.
--
--    `review_word_suggestion` does all of it in one statement, under a row
--    lock, and is idempotent: a suggestion that is no longer pending returns
--    the decision it already has instead of applying anything a second time.
--
-- Non-destructive and idempotent, like every migration here: no data is moved,
-- no id changes, and re-running it is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AN ATOMIC ID FOR A NEW DICTIONARY WORD.
-- ─────────────────────────────────────────────────────────────────────────────
create sequence if not exists public.words_id_seq as bigint owned by public.words.id;

-- Start where the dictionary already is. `greatest` with the sequence's own
-- current value is what makes this safe to re-run: a second application can
-- only ever move the sequence forward, never back onto ids already handed out.
select setval(
  'public.words_id_seq',
  greatest(
    coalesce((select max(id) from public.words), 0),
    coalesce(pg_sequence_last_value('public.words_id_seq'), 0),
    1
  ),
  true
);

alter table public.words alter column id set default nextval('public.words_id_seq');

-- AN EXPLICIT ID MUST NOT LEAVE THE SEQUENCE BEHIND IT. The seeds and the
-- wordlist import name their own ids; without this, the sequence would still be
-- sitting at 1 afterwards and the first admin-created word would collide with
-- seed row 1. Comparing against `pg_sequence_last_value` rather than calling
-- `nextval` means a bulk import does not burn an id per row — and a
-- default-allocated id compares equal, so the normal path does no work at all.
create or replace function public.words_keep_id_sequence_ahead()
returns trigger language plpgsql as $$
begin
  if new.id is not null
     and new.id > coalesce(pg_sequence_last_value('public.words_id_seq'), 0) then
    perform setval('public.words_id_seq', new.id, true);
  end if;
  return new;
end;
$$;

drop trigger if exists words_keep_id_sequence_ahead on public.words;
create trigger words_keep_id_sequence_ahead
  before insert on public.words
  for each row execute function public.words_keep_id_sequence_ahead();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVIEWING A SUGGESTION, ONCE.
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because it writes `words`, and the admin check is taken from
-- `auth.uid()` through the existing `is_admin()` — never from a parameter. The
-- reviewer recorded is the caller, for the same reason.
create or replace function public.review_word_suggestion(
  p_suggestion_id bigint,
  p_decision      text
)
returns table (
  suggestion_id     bigint,
  status            text,
  /** True when this call was the one that decided it. */
  applied           boolean,
  /** The word the edit landed on, or null when nothing was written. */
  updated_word_id   bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_suggestion public.word_suggestions%rowtype;
  v_value      text;
  v_reviewer   uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = 'FL403';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = 'FL422';
  end if;

  -- The lock is the whole point: a concurrent reviewer waits here and then sees
  -- the decided row, instead of racing past the `pending` check beside us.
  select * into v_suggestion
  from public.word_suggestions
  where id = p_suggestion_id
  for update;

  if not found then
    raise exception 'suggestion % not found', p_suggestion_id using errcode = 'FL404';
  end if;

  -- ALREADY DECIDED. Not an error — two tabs, a double click, a retry after a
  -- dropped response. Report what it is and write nothing.
  if v_suggestion.status <> 'pending' then
    return query select v_suggestion.id, v_suggestion.status, false, null::bigint;
    return;
  end if;

  updated_word_id := null;

  -- `field = 'other'` is a free-form note, never a column to overwrite.
  if p_decision = 'approved' and v_suggestion.field <> 'other' then
    v_value := btrim(v_suggestion.suggestion);

    update public.words
       set translation_pl = case when v_suggestion.field = 'translation_pl'
                                 then v_value else translation_pl end,
           example_de     = case when v_suggestion.field = 'example_de'
                                 then v_value else example_de end,
           example_pl     = case when v_suggestion.field = 'example_pl'
                                 then v_value else example_pl end
     where id = v_suggestion.word_id;

    if not found then
      raise exception 'word % not found', v_suggestion.word_id using errcode = 'FL404';
    end if;
    updated_word_id := v_suggestion.word_id;
  end if;

  update public.word_suggestions
     set status      = p_decision,
         reviewed_at = now(),
         reviewed_by = v_reviewer
   where id = p_suggestion_id;

  return query select p_suggestion_id, p_decision, true, updated_word_id;
end;
$$;

-- Narrow grant: a signed-in admin calls this from a Server Action on their own
-- cookie-bound client, and `is_admin()` inside decides. `anon` has no business
-- here at all.
revoke all on function public.review_word_suggestion(bigint, text) from public;
grant execute on function public.review_word_suggestion(bigint, text) to authenticated;

-- === END 20260922120000_dictionary_write_integrity.sql ===
