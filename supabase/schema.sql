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
  created_at  timestamptz default now()
);

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

-- PROFILES (one per auth user, holds Elo ability)
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  ability         numeric not null default 1200,
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

-- ROW LEVEL SECURITY
alter table public.words       enable row level security;
alter table public.texts       enable row level security;
alter table public.questions   enable row level security;
alter table public.profiles    enable row level security;
alter table public.attempts    enable row level security;
alter table public.saved_words enable row level security;

create policy "words public read"     on public.words     for select using (true);
create policy "texts public read"     on public.texts     for select using (true);
-- questions: return all fields EXCEPT correct_idx goes via Server Action only
create policy "questions public read" on public.questions for select using (true);

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
