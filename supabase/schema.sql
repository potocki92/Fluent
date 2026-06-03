-- Fluent — Supabase schema.
-- Run in Supabase Studio > SQL Editor (or `supabase db push`).

-- ENABLE EXTENSIONS
create extension if not exists pg_trgm;

-- WORDS (DTZ dictionary, 2588 entries)
create table public.words (
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
create index words_cefr_idx   on public.words(cefr);
create index words_type_idx   on public.words(word_type);
create index words_lemma_trgm on public.words
  using gin (lower(lemma) gin_trgm_ops);

-- TEXTS (reading passages)
create table public.texts (
  id          bigint generated always as identity primary key,
  title       text not null,
  cefr        text not null check (cefr in ('A1','A2','B1','B2')),
  body        text not null,   -- HTML string, links to word lemmas via <mark data-lemma="X">
  word_count  int,
  difficulty  int not null default 1200,  -- Elo of the text itself
  status      text not null default 'draft' check (status in ('draft','published')),
  created_at  timestamptz default now()
);
create index texts_status_idx on public.texts(status);

-- QUESTIONS (comprehension questions per text)
-- correct_idx is NEVER returned to client directly —
-- only returned by the submit_answer server action.
create table public.questions (
  id          bigint generated always as identity primary key,
  text_id     bigint not null references public.texts(id) on delete cascade,
  prompt      text not null,
  options     jsonb not null,   -- ["option A", "option B", "option C", "option D"]
  correct_idx int  not null,
  difficulty  int  not null default 1200,
  created_at  timestamptz default now()
);
create index questions_text_idx on public.questions(text_id);

-- CALIBRATION QUESTIONS (standalone placement-test item bank, not tied to a text)
-- Used by the adaptive level test. As with `questions`, `correct_idx` is only
-- read by the grade-calibration Server Action, never selected on the client.
create table public.calibration_questions (
  id          bigint generated always as identity primary key,
  prompt      text not null,
  options     jsonb not null,   -- ["option A", "option B", "option C", "option D"]
  correct_idx int  not null,
  difficulty  int  not null,    -- Elo difficulty of the item
  cefr        text not null check (cefr in ('A1','A2','B1','B2')),
  skill       text check (skill in ('vocab','grammar')),
  created_at  timestamptz default now()
);
create index calibration_difficulty_idx
  on public.calibration_questions(difficulty);

-- PROFILES (one per auth user, holds Elo ability)
create table public.profiles (
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
create table public.attempts (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  question_id     bigint not null references public.questions(id) on delete cascade,
  text_id         bigint not null references public.texts(id) on delete cascade,
  is_correct      boolean not null,
  ability_before  numeric not null,
  ability_after   numeric not null,
  created_at      timestamptz default now()
);
create index attempts_user_idx on public.attempts(user_id, created_at desc);

-- SAVED WORDS with SRS data
create table public.saved_words (
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
create index saved_due_idx on public.saved_words(user_id, due_at);

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
  if v_last = current_date - 1 then v_streak := v_streak + 1;
  else v_streak := 1; end if;
  update public.profiles
    set streak_days = v_streak, last_active = current_date
    where id = p_user_id;
end; $$;

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
alter table public.saved_words           enable row level security;

create policy "words public read"     on public.words     for select using (true);
-- calibration questions: readable by everyone (the client only ever selects the
-- non-answer columns); grading happens server-side via the Server Action.
create policy "calibration public read" on public.calibration_questions
  for select using (true);
create policy "calibration admin insert" on public.calibration_questions
  for insert with check (public.is_admin());
create policy "calibration admin update" on public.calibration_questions
  for update using (public.is_admin()) with check (public.is_admin());
create policy "calibration admin delete" on public.calibration_questions
  for delete using (public.is_admin());
-- texts: learners read only published passages; admins also read drafts.
create policy "texts published read" on public.texts
  for select using (status = 'published' or public.is_admin());
-- questions: return all fields EXCEPT correct_idx goes via Server Action only
create policy "questions public read" on public.questions for select using (true);

-- ADMIN WRITES (texts + questions). Reads stay public per the policies above;
-- only admins may insert/update/delete content.
create policy "texts admin insert" on public.texts
  for insert with check (public.is_admin());
create policy "texts admin update" on public.texts
  for update using (public.is_admin()) with check (public.is_admin());
create policy "texts admin delete" on public.texts
  for delete using (public.is_admin());

create policy "questions admin insert" on public.questions
  for insert with check (public.is_admin());
create policy "questions admin update" on public.questions
  for update using (public.is_admin()) with check (public.is_admin());
create policy "questions admin delete" on public.questions
  for delete using (public.is_admin());

create policy "own profile read"   on public.profiles
  for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles
  for update using (auth.uid() = id);

create policy "own attempts read"   on public.attempts
  for select using (auth.uid() = user_id);
create policy "own attempts insert" on public.attempts
  for insert with check (auth.uid() = user_id);

create policy "own saved read"   on public.saved_words
  for select using (auth.uid() = user_id);
create policy "own saved write"  on public.saved_words
  for insert with check (auth.uid() = user_id);
create policy "own saved delete" on public.saved_words
  for delete using (auth.uid() = user_id);
create policy "own saved update" on public.saved_words
  for update using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — starter calibration item bank (Polish prompts, German vocab/grammar)
-- spanning A1–B2 so the adaptive level test works out of the box. The answer is
-- always option index 0; shuffle in the admin panel later if desired.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.calibration_questions (prompt, options, correct_idx, difficulty, cefr, skill) values
  ('Jak po niemiecku „dziękuję"?', '["Danke","Bitte","Tschüss","Hallo"]', 0, 1080, 'A1', 'vocab'),
  ('Co znaczy „das Haus"?', '["dom","kot","stół","pies"]', 0, 1100, 'A1', 'vocab'),
  ('Uzupełnij: Ich ___ Anna.', '["bin","ist","sind","bist"]', 0, 1120, 'A1', 'grammar'),
  ('Jak po niemiecku „woda"?', '["das Wasser","das Brot","der Apfel","die Milch"]', 0, 1140, 'A1', 'vocab'),
  ('Co znaczy „einkaufen"?', '["robić zakupy","gotować","spać","biegać"]', 0, 1280, 'A2', 'vocab'),
  ('Co znaczy „der Bahnhof"?', '["dworzec","lotnisko","sklep","szpital"]', 0, 1260, 'A2', 'vocab'),
  ('Jaki rodzajnik: ___ Sonne?', '["die","der","das","den"]', 0, 1300, 'A2', 'grammar'),
  ('Uzupełnij: Gestern ___ ich ins Kino gegangen.', '["bin","habe","war","bist"]', 0, 1320, 'A2', 'grammar'),
  ('Co znaczy „die Umwelt"?', '["środowisko","umowa","sąsiedztwo","podróż"]', 0, 1500, 'B1', 'vocab'),
  ('Co znaczy „sich bewerben"?', '["ubiegać się (o pracę)","martwić się","cieszyć się","spóźnić się"]', 0, 1480, 'B1', 'vocab'),
  ('Uzupełnij: Wenn ich Zeit ___, würde ich reisen.', '["hätte","habe","hatte","haben"]', 0, 1520, 'B1', 'grammar'),
  ('Wybierz poprawne: Der Film, ___ ich gesehen habe, war gut.', '["den","der","dem","das"]', 0, 1540, 'B1', 'grammar'),
  ('Co znaczy „der Vorschlag"?', '["propozycja","przewaga","uprzedzenie","postęp"]', 0, 1680, 'B2', 'vocab'),
  ('Co znaczy „nachhaltig"?', '["zrównoważony","następny","niedbały","głośny"]', 0, 1700, 'B2', 'vocab'),
  ('Uzupełnij: Er tat so, als ___ er nichts gehört.', '["hätte","hat","habe","würde"]', 0, 1720, 'B2', 'grammar'),
  ('Wybierz formę grzeczną: „___ Sie mir bitte helfen?"', '["Könnten","Kannst","Könnt","Konntest"]', 0, 1660, 'B2', 'grammar');

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — run these on an already-provisioned database (the statements above
-- describe the full target schema for fresh installs). Safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────
-- alter table public.profiles
--   add column if not exists role text not null default 'user'
--   check (role in ('user','admin'));
-- alter table public.texts
--   add column if not exists status text not null default 'draft'
--   check (status in ('draft','published'));
-- create index if not exists texts_status_idx on public.texts(status);
--
-- (then create the is_admin() / prevent_role_change() functions, the
--  profiles_no_role_change trigger, and re-create the texts/questions policies
--  shown above; drop the old "texts public read" policy first.)
-- drop policy if exists "texts public read" on public.texts;

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOTSTRAP FIRST ADMIN — run once after deploy, replacing the uuid with the
-- target user's id from auth.users.
-- ─────────────────────────────────────────────────────────────────────────────
-- update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
