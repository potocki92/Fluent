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
