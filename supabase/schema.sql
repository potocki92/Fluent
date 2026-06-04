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
create index if not exists words_lemma_trgm on public.words
  using gin (lower(lemma) gin_trgm_ops);

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
-- `questions_public` view; grading goes through the `grade_question` /
-- `grade_test` SECURITY DEFINER functions below.
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
-- grading happens in the `grade_calibration` SECURITY DEFINER function.
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
  streak_days     int     not null default 0,
  last_active     date,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
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

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS for already-provisioned databases. The CREATE statements above are
-- skipped when a table already exists, so bring older installs up to date here.
-- Each step is guarded and safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────
-- options jsonb -> text[]. The conversion is wrapped in a helper function
-- because Postgres forbids a subquery directly inside an ALTER COLUMN ... USING
-- transform expression. The helper is dropped again once the migration is done.
-- The public views are dropped first because they depend on `options`; they are
-- recreated further down by the `create or replace view` statements.
drop view if exists public.questions_public;
drop view if exists public.calibration_questions_public;
create or replace function public.jsonb_to_text_array(j jsonb)
returns text[] language sql immutable as $$
  select array(select jsonb_array_elements_text(j));
$$;
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'questions'
        and column_name = 'options') = 'jsonb' then
    alter table public.questions
      alter column options type text[]
      using public.jsonb_to_text_array(options);
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'calibration_questions'
        and column_name = 'options') = 'jsonb' then
    alter table public.calibration_questions
      alter column options type text[]
      using public.jsonb_to_text_array(options);
  end if;
end $$;
drop function if exists public.jsonb_to_text_array(jsonb);
-- response time on attempts
alter table public.attempts add column if not exists response_ms int;

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

-- STREAK UPDATE FUNCTION (called by submit_answer)
create or replace function public.update_streak(p_user_id uuid)
returns void language plpgsql security definer as $$
declare v_last date; v_streak int;
begin
  select last_active, streak_days into v_last, v_streak
  from public.profiles where id = p_user_id for update;
  if v_last = current_date then return; end if;
  -- `>=` rather than `=` so a clock/timezone rollover still counts as a
  -- continued streak instead of silently resetting it.
  if v_last >= current_date - 1 then v_streak := v_streak + 1;
  else v_streak := 1; end if;
  update public.profiles
    set streak_days = v_streak, last_active = current_date
    where id = p_user_id;
end; $$;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- GRADING FUNCTIONS — the ONLY code allowed to read `correct_idx`. They run as
-- `security definer`, so even though learners have no SELECT on the underlying
-- tables they can still have an answer graded without ever seeing the key.
-- ─────────────────────────────────────────────────────────────────────────────
-- Single comprehension question. Returns the key too, because the client only
-- ever asks one question at a time and reveals the answer after committing.
create or replace function public.grade_question(p_question_id bigint, p_selected_idx int)
returns table (is_correct boolean, correct_idx int)
language sql security definer stable as $$
  select (p_selected_idx = q.correct_idx), q.correct_idx
  from public.questions q where q.id = p_question_id;
$$;

-- Single calibration item — also returns the item's Elo difficulty for folding
-- the answer into the running estimate.
create or replace function public.grade_calibration(p_question_id bigint, p_selected_idx int)
returns table (is_correct boolean, correct_idx int, difficulty int)
language sql security definer stable as $$
  select (p_selected_idx = c.correct_idx), c.correct_idx, c.difficulty
  from public.calibration_questions c where c.id = p_question_id;
$$;

-- A whole completed test, graded in one call. Deliberately does NOT return
-- `correct_idx` for the batch — only per-question correctness and difficulty —
-- so it can't be abused to dump the answer key for a text.
create or replace function public.grade_test(
  p_text_id bigint, p_question_ids bigint[], p_selected_idxs int[]
)
returns table (question_id bigint, is_correct boolean, difficulty int)
language sql security definer stable as $$
  select q.id, (q.correct_idx = a.sel), q.difficulty
  from unnest(p_question_ids, p_selected_idxs) as a(qid, sel)
  join public.questions q on q.id = a.qid and q.text_id = p_text_id;
$$;

grant execute on function public.grade_question(bigint, int)        to authenticated;
grant execute on function public.grade_calibration(bigint, int)     to authenticated;
grant execute on function public.grade_test(bigint, bigint[], int[]) to authenticated;

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
alter table public.saved_words           enable row level security;

drop policy if exists "words public read" on public.words;
create policy "words public read" on public.words for select using (true);

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

drop policy if exists "own attempts read" on public.attempts;
create policy "own attempts read"   on public.attempts
  for select using (auth.uid() = user_id);
drop policy if exists "own attempts insert" on public.attempts;
create policy "own attempts insert" on public.attempts
  for insert with check (auth.uid() = user_id);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC VIEWS — the answer-free read surface for learners. These are owned by
-- the schema owner and so bypass the (deliberately absent) SELECT policy on the
-- base tables, exposing every column EXCEPT `correct_idx`. Supabase's linter
-- flags these as "Security Definer View"; that is the intended behaviour here.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.questions_public as
  select q.id, q.text_id, q.prompt, q.options, q.difficulty, q.created_at
  from public.questions q
  join public.texts t on t.id = q.text_id
  where t.status = 'published';

create or replace view public.calibration_questions_public as
  select id, prompt, options, difficulty, cefr, skill, created_at
  from public.calibration_questions;

grant select on public.questions_public             to anon, authenticated;
grant select on public.calibration_questions_public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — starter calibration item bank (Polish prompts, German vocab/grammar)
-- spanning A1–B2 so the adaptive level test works out of the box. The answer is
-- always option index 0; shuffle in the admin panel later if desired. Only
-- seeded when the bank is empty, so re-running the script never duplicates it.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.calibration_questions) then
    insert into public.calibration_questions (prompt, options, correct_idx, difficulty, cefr, skill) values
      ('Jak po niemiecku „dziękuję"?', array['Danke','Bitte','Tschüss','Hallo'], 0, 1080, 'A1', 'vocab'),
      ('Co znaczy „das Haus"?', array['dom','kot','stół','pies'], 0, 1100, 'A1', 'vocab'),
      ('Uzupełnij: Ich ___ Anna.', array['bin','ist','sind','bist'], 0, 1120, 'A1', 'grammar'),
      ('Jak po niemiecku „woda"?', array['das Wasser','das Brot','der Apfel','die Milch'], 0, 1140, 'A1', 'vocab'),
      ('Co znaczy „einkaufen"?', array['robić zakupy','gotować','spać','biegać'], 0, 1280, 'A2', 'vocab'),
      ('Co znaczy „der Bahnhof"?', array['dworzec','lotnisko','sklep','szpital'], 0, 1260, 'A2', 'vocab'),
      ('Jaki rodzajnik: ___ Sonne?', array['die','der','das','den'], 0, 1300, 'A2', 'grammar'),
      ('Uzupełnij: Gestern ___ ich ins Kino gegangen.', array['bin','habe','war','bist'], 0, 1320, 'A2', 'grammar'),
      ('Co znaczy „die Umwelt"?', array['środowisko','umowa','sąsiedztwo','podróż'], 0, 1500, 'B1', 'vocab'),
      ('Co znaczy „sich bewerben"?', array['ubiegać się (o pracę)','martwić się','cieszyć się','spóźnić się'], 0, 1480, 'B1', 'vocab'),
      ('Uzupełnij: Wenn ich Zeit ___, würde ich reisen.', array['hätte','habe','hatte','haben'], 0, 1520, 'B1', 'grammar'),
      ('Wybierz poprawne: Der Film, ___ ich gesehen habe, war gut.', array['den','der','dem','das'], 0, 1540, 'B1', 'grammar'),
      ('Co znaczy „der Vorschlag"?', array['propozycja','przewaga','uprzedzenie','postęp'], 0, 1680, 'B2', 'vocab'),
      ('Co znaczy „nachhaltig"?', array['zrównoważony','następny','niedbały','głośny'], 0, 1700, 'B2', 'vocab'),
      ('Uzupełnij: Er tat so, als ___ er nichts gehört.', array['hätte','hat','habe','würde'], 0, 1720, 'B2', 'grammar'),
      ('Wybierz formę grzeczną: „___ Sie mir bitte helfen?"', array['Könnten','Kannst','Könnt','Konntest'], 0, 1660, 'B2', 'grammar');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOTSTRAP FIRST ADMIN — run once after deploy, replacing the uuid with the
-- target user's id from auth.users.
-- ─────────────────────────────────────────────────────────────────────────────
-- update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
