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
do $$
begin
  alter table public.learning_events drop constraint if exists learning_events_event_type_check;
  alter table public.learning_events
    add constraint learning_events_event_type_check check (event_type in (
      'test_answer', 'calibration_answer', 'review', 'practice_answer',
      'reading_lookup', 'reading_sentence_help', 'typed_recall',
      'listening_answer', 'speaking_answer', 'writing_answer'
    ));

  alter table public.learning_events drop constraint if exists learning_events_source_kind_check;
  alter table public.learning_events
    add constraint learning_events_source_kind_check check (source_kind in (
      'reading_test', 'placement_test', 'review', 'practice', 'reader', 'book', 'import'
    ));
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
