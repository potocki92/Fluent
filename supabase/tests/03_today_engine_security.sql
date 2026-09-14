-- Fluent — Today engine: security, idempotency, timezone and derived completion.
--
-- The planner's arithmetic is unit-tested in TypeScript
-- (`src/lib/learning/planner/*.test.ts`). What CANNOT be tested there is
-- everything this file asserts: that a learner cannot author their own plan or
-- forge a completed one, that ten calls on the same day produce one plan, that
-- the day boundary is the LEARNER's and not the server's, that finishing a drill
-- moves the plan inside the same transaction, and that reconciling the plan
-- twice changes nothing the second time.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use ids in the 7xxx range so they cannot collide with the suites that
-- run before this one against the same database.

\set ON_ERROR_STOP on

\set USER_A '''55555555-5555-5555-5555-555555555555'''
\set USER_B '''66666666-6666-6666-6666-666666666666'''

\echo '── T0. today-engine fixtures ───────────────────────────────────────────'

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'e@example.test'),
  ('66666666-6666-6666-6666-666666666666', 'f@example.test');

-- A published passage with grammar questions tagged to a real concept: the case
-- weakness practice exists for.
insert into public.texts (id, title, cefr, body, difficulty, status)
  overriding system value
  values (7900, 'Dativ passage', 'A2', '<p>Ich fahre mit dem Bus.</p>', 1300, 'published');

-- …and a DRAFT passage, to prove the practice pool never draws from unpublished
-- content.
insert into public.texts (id, title, cefr, body, difficulty, status)
  overriding system value
  values (7901, 'Draft passage', 'A2', '<p>Entwurf</p>', 1300, 'draft');

insert into public.questions (id, text_id, prompt, options, correct_idx, difficulty, skill_code)
  overriding system value values
  (7910, 7900, 'Ich fahre mit ___ Bus.',  array['der','dem','den','das'], 1, 1300, 'grammar'),
  (7911, 7900, 'Ich helfe ___ Mann.',     array['der','dem','den','das'], 1, 1300, 'grammar'),
  (7912, 7900, 'Er gibt ___ Kind ein Buch.', array['der','dem','den','das'], 1, 1300, 'grammar'),
  (7913, 7901, 'Draft question',          array['a','b','c','d'],         0, 1300, 'grammar');

insert into public.question_concepts (question_id, concept_code) values
  (7910, 'adjective_ending'),
  (7911, 'adjective_ending'),
  (7912, 'adjective_ending'),
  (7913, 'adjective_ending');

\echo '── T1. the learning day is the LEARNER''s day, not the server''s ────────'

do $$
declare
  v_instant timestamptz := '2026-09-13T23:30:00Z';
begin
  -- 23:30 UTC on the 13th is already the 14th in Warsaw. A plan keyed on
  -- `current_date` in a UTC database would hand a Warsaw learner yesterday's
  -- plan — and, because one plan per learning day is a UNIQUE constraint, make
  -- today's impossible to create at all.
  if public.learning_day('Europe/Warsaw', v_instant) <> date '2026-09-14' then
    raise exception 'FAIL: learning_day ignored the learner timezone (got %)',
      public.learning_day('Europe/Warsaw', v_instant);
  end if;
  if public.learning_day('UTC', v_instant) <> date '2026-09-13' then
    raise exception 'FAIL: learning_day is wrong for UTC';
  end if;
  -- The other side of the boundary.
  if public.learning_day('America/New_York', '2026-09-14T00:30:00Z') <> date '2026-09-13' then
    raise exception 'FAIL: learning_day is wrong west of UTC';
  end if;
  -- An unusable zone falls back instead of raising: a plan on the wrong day
  -- boundary is a far smaller failure than a home screen that 500s.
  if public.learning_day('Mars/Olympus_Mons', v_instant) <> date '2026-09-13' then
    raise exception 'FAIL: learning_day did not fall back to UTC';
  end if;

  -- The day window used to scope "did this happen today?".
  if public.learning_day_start(date '2026-09-14', 'Europe/Warsaw')
     <> '2026-09-13T22:00:00Z'::timestamptz then
    raise exception 'FAIL: learning_day_start is not the learner midnight';
  end if;
end $$;

-- A timezone the database cannot resolve must never reach the column.
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false); end $switch$;

do $$
begin
  begin
    update public.profiles set timezone = 'Mars/Olympus_Mons'
     where id = '55555555-5555-5555-5555-555555555555';
    raise exception 'FAIL: an unresolvable timezone was accepted';
  exception when sqlstate 'FL422' then null;
  end;

  -- A real one is a normal preference, like display_name.
  update public.profiles set timezone = 'Europe/Warsaw', daily_learning_minutes = 15
   where id = '55555555-5555-5555-5555-555555555555';
  if not found then
    raise exception 'FAIL: a learner could not set their own learning preferences';
  end if;

  -- …and the range is enforced.
  begin
    update public.profiles set daily_learning_minutes = 600
     where id = '55555555-5555-5555-5555-555555555555';
    raise exception 'FAIL: an absurd daily budget was accepted';
  exception when check_violation then null;
  end;
end $$;

\echo '── T2. a learner cannot author a plan or set their own priorities ──────'

do $$
declare v_plan uuid;
begin
  -- A plan a learner can write is a plan that proves nothing.
  begin
    insert into public.daily_plans
      (user_id, learning_date, timezone, target_minutes, algorithm_version)
    values ('55555555-5555-5555-5555-555555555555', current_date, 'UTC', 15, 'forged');
    raise exception 'FAIL: a learner could insert their own daily plan';
  exception when insufficient_privilege then null;
  end;

  -- Plan generation is trusted logic: EXECUTE is revoked from the browser roles.
  begin
    perform public.create_daily_plan(
      '55555555-5555-5555-5555-555555555555', current_date, 'UTC', 15,
      'forged_v1', 'high', '[]'::jsonb, false
    );
    raise exception 'FAIL: a learner could call create_daily_plan';
  exception when insufficient_privilege then null;
  end;

  -- Sealing a drill accepts computed evidence, so it is service-role only too.
  begin
    perform public.finalize_practice_session(
      gen_random_uuid(), '55555555-5555-5555-5555-555555555555', '{}'::jsonb
    );
    raise exception 'FAIL: a learner could call finalize_practice_session';
  exception when insufficient_privilege then null;
  end;

  -- Drills and their items are likewise not learner-writable.
  begin
    insert into public.practice_sessions (user_id, concept_code, status, correct, total)
    values ('55555555-5555-5555-5555-555555555555', 'adjective_ending', 'completed', 5, 5);
    raise exception 'FAIL: a learner could forge a completed practice session';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  if has_function_privilege('authenticated',
       'public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean)', 'execute')
  or has_function_privilege('anon',
       'public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean)', 'execute') then
    raise exception 'FAIL: create_daily_plan is executable by a client role';
  end if;
  if not has_function_privilege('service_role',
       'public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean)', 'execute') then
    raise exception 'FAIL: create_daily_plan is not executable by service_role';
  end if;
  if has_function_privilege('authenticated',
       'public.finalize_practice_session(uuid, uuid, jsonb)', 'execute') then
    raise exception 'FAIL: finalize_practice_session is executable by a client role';
  end if;

  -- The learner-callable half derives its user from auth.uid(), so it is safe
  -- to expose — and the Today page depends on being able to reconcile itself.
  if not has_function_privilege('authenticated', 'public.sync_daily_plan(uuid)', 'execute') then
    raise exception 'FAIL: sync_daily_plan is not callable by a learner';
  end if;
  if not has_function_privilege('authenticated', 'public.start_practice_session(text, uuid, int)', 'execute') then
    raise exception 'FAIL: start_practice_session is not callable by a learner';
  end if;
end $$;

\echo '── T3. one plan per learning day, however many times it is asked for ───'

set role service_role;
do $$
declare
  v_first  uuid;
  v_again  uuid;
  v_count  int;
  v_items  jsonb := jsonb_build_array(
    jsonb_build_object(
      'item_position', 1, 'item_type', 'review_due', 'estimated_minutes', 3,
      'priority_score', 0.9, 'reason_code', 'overdue_reviews',
      'reason_data', jsonb_build_object('count', 8), 'target_count', 8
    ),
    jsonb_build_object(
      'item_position', 2, 'item_type', 'weakness_practice', 'estimated_minutes', 3,
      'priority_score', 0.7, 'reason_code', 'recurring_mistakes',
      'reason_data', jsonb_build_object('count', 3, 'outOf', 5),
      'target_count', 3, 'concept_code', 'adjective_ending'
    )
  );
begin
  v_first := public.create_daily_plan(
    '55555555-5555-5555-5555-555555555555', date '2026-09-14', 'Europe/Warsaw',
    15, 'planner_v1', 'medium', v_items, false
  );

  -- Ten calls, one plan. This is the guarantee a JavaScript "does it exist?"
  -- check cannot give, because two concurrent callers both pass it.
  for i in 1..9 loop
    v_again := public.create_daily_plan(
      '55555555-5555-5555-5555-555555555555', date '2026-09-14', 'Europe/Warsaw',
      15, 'planner_v1', 'medium', v_items, false
    );
    if v_again <> v_first then
      raise exception 'FAIL: a second plan was created for the same learning day';
    end if;
  end loop;

  select count(*) into v_count from public.daily_plans
  where user_id = '55555555-5555-5555-5555-555555555555';
  if v_count <> 1 then
    raise exception 'FAIL: % plans exist for one learner-day', v_count;
  end if;

  select count(*) into v_count from public.daily_plan_items i
  join public.daily_plans p on p.id = i.plan_id
  where p.id = v_first;
  if v_count <> 2 then
    raise exception 'FAIL: the plan should hold 2 items, got %', v_count;
  end if;

  -- Estimated minutes are summed from the items, not taken on trust.
  if (select estimated_minutes from public.daily_plans where id = v_first) <> 6 then
    raise exception 'FAIL: estimated_minutes was not derived from the items';
  end if;

  -- A different learning day IS a different plan.
  perform public.create_daily_plan(
    '55555555-5555-5555-5555-555555555555', date '2026-09-15', 'Europe/Warsaw',
    15, 'planner_v1', 'medium', v_items, false
  );
  select count(*) into v_count from public.daily_plans
  where user_id = '55555555-5555-5555-5555-555555555555';
  if v_count <> 2 then
    raise exception 'FAIL: a new learning day did not get its own plan';
  end if;
end $$;

\echo '── T4. the onboarding exception, and nothing beyond it ─────────────────'

do $$
declare
  v_stub    uuid;
  v_rebuilt uuid;
  v_real    uuid;
  v_placement jsonb := jsonb_build_array(jsonb_build_object(
    'item_position', 1, 'item_type', 'placement', 'estimated_minutes', 5,
    'priority_score', 3, 'reason_code', 'no_level_yet', 'target_count', 1
  ));
  v_full jsonb := jsonb_build_array(jsonb_build_object(
    'item_position', 1, 'item_type', 'review_due', 'estimated_minutes', 3,
    'priority_score', 0.9, 'reason_code', 'overdue_reviews', 'target_count', 6
  ));
begin
  v_stub := public.create_daily_plan(
    '66666666-6666-6666-6666-666666666666', date '2026-09-14', 'UTC',
    10, 'planner_v1', 'none', v_placement, false
  );

  -- An UNTOUCHED placement-only plan may be replaced once the learner has a
  -- level: holding them to a stub until midnight would be absurd.
  v_rebuilt := public.create_daily_plan(
    '66666666-6666-6666-6666-666666666666', date '2026-09-14', 'UTC',
    10, 'planner_v1', 'low', v_full, true
  );
  if v_rebuilt = v_stub then
    raise exception 'FAIL: the onboarding stub was not replaced';
  end if;
  if (select item_type from public.daily_plan_items where plan_id = v_rebuilt)
     <> 'review_due' then
    raise exception 'FAIL: the rebuilt plan kept the onboarding item';
  end if;

  -- …and a REAL plan is never replaceable, flag or no flag. This is the rule
  -- that keeps a plan stable across a day instead of reshuffling on refresh.
  v_real := public.create_daily_plan(
    '66666666-6666-6666-6666-666666666666', date '2026-09-14', 'UTC',
    10, 'planner_v1', 'high', v_placement, true
  );
  if v_real <> v_rebuilt then
    raise exception 'FAIL: a real plan was rebuilt mid-day';
  end if;
  if (select item_type from public.daily_plan_items where plan_id = v_real)
     <> 'review_due' then
    raise exception 'FAIL: a real plan''s items were overwritten';
  end if;
end $$;

\echo '── T5. user A cannot see or touch user B''s plan ────────────────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false); end $switch$;

do $$
declare
  v_other uuid;
  v_count int;
begin
  select count(*) into v_count from public.daily_plans
  where user_id = '66666666-6666-6666-6666-666666666666';
  if v_count <> 0 then
    raise exception 'FAIL: user A can read user B''s plans';
  end if;

  -- Items are visible only through a plan the caller owns. A owns two plans of
  -- two items each; B's plan is invisible, items and all.
  select count(*) into v_count from public.daily_plan_items;
  if v_count <> 4 then
    raise exception 'FAIL: plan items are not scoped to their owner (saw % rows)', v_count;
  end if;

  -- Reconciling someone else's plan is refused by ownership, not by obscurity.
  reset role;
  select id into v_other from public.daily_plans
  where user_id = '66666666-6666-6666-6666-666666666666' limit 1;
  set role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false);

  begin
    perform public.sync_daily_plan(v_other);
    raise exception 'FAIL: user A could reconcile user B''s plan';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

\echo '── T6. plan progress is measured, never asserted ───────────────────────'

do $$
declare
  v_plan   uuid;
  v_item   uuid;
  v_status text;
begin
  select p.id into v_plan from public.daily_plans p
  where p.user_id = '55555555-5555-5555-5555-555555555555'
    and p.learning_date = date '2026-09-14';

  select i.id into v_item from public.daily_plan_items i
  where i.plan_id = v_plan and i.item_type = 'weakness_practice';

  -- There is no "mark complete" write path anywhere in Fluent, and a learner
  -- cannot make one by updating the row.
  begin
    update public.daily_plan_items set status = 'completed', completed_count = 99
     where id = v_item;
    if found then
      raise exception 'FAIL: a learner could mark a plan item complete';
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.daily_plan_items set priority_score = 999999 where id = v_item;
    if found then
      raise exception 'FAIL: a learner could set their own priority score';
    end if;
  exception when insufficient_privilege then null;
  end;

  -- Reconciling finds nothing done, because nothing was done.
  perform public.sync_daily_plan(v_plan);
  select i.status into v_status from public.daily_plan_items i where i.id = v_item;
  if v_status <> 'pending' then
    raise exception 'FAIL: an untouched item reported as %', v_status;
  end if;
  if (select status from public.daily_plans where id = v_plan) <> 'pending' then
    raise exception 'FAIL: an untouched plan did not report as pending';
  end if;
end $$;

\echo '── T7. a drill: the server picks the items, the key costs the attempt ──'

do $$
declare
  v_plan    uuid;
  v_item    uuid;
  v_session uuid;
  v_again   uuid;
  v_count   int;
  v_row     record;
begin
  select p.id into v_plan from public.daily_plans p
  where p.user_id = '55555555-5555-5555-5555-555555555555'
    and p.learning_date = date '2026-09-14';
  select i.id into v_item from public.daily_plan_items i
  where i.plan_id = v_plan and i.item_type = 'weakness_practice';

  v_session := public.start_practice_session('adjective_ending', v_item, 3);

  -- Re-entering resumes rather than starting a competing drill.
  v_again := public.start_practice_session('adjective_ending', v_item, 3);
  if v_again <> v_session then
    raise exception 'FAIL: re-entering a drill created a second session';
  end if;

  select count(*) into v_count from public.practice_session_items
  where session_id = v_session;
  if v_count <> 3 then
    raise exception 'FAIL: the drill should hold 3 items, got %', v_count;
  end if;

  -- Only published content is drilled — the draft passage's question must not
  -- be in the pool.
  if exists (
    select 1 from public.practice_session_items where session_id = v_session
      and question_id = 7913
  ) then
    raise exception 'FAIL: a drill drew a question from an unpublished text';
  end if;

  -- The answer key is revealed only once the answer is committed.
  select * into v_row from public.answer_practice_question(v_session, 7910, 0, 1200);
  if v_row.already_answered then
    raise exception 'FAIL: a fresh item reported as already answered';
  end if;
  if v_row.is_answer_correct then
    raise exception 'FAIL: index 0 is not the key for 7910';
  end if;
  if v_row.answer_key_idx <> 1 then
    raise exception 'FAIL: the revealed key is wrong';
  end if;

  -- A retry with the RIGHT answer does not overwrite the wrong one.
  select * into v_row from public.answer_practice_question(v_session, 7910, 1, 900);
  if not v_row.already_answered then
    raise exception 'FAIL: a second answer was not recognised as a replay';
  end if;
  if v_row.is_answer_correct then
    raise exception 'FAIL: a replay overwrote a committed wrong answer';
  end if;

  -- An item outside the drill cannot be answered into it.
  begin
    perform public.answer_practice_question(v_session, 7913, 0, 100);
    raise exception 'FAIL: a foreign question was answerable into the drill';
  exception when sqlstate 'FL410' then null;
  end;

  -- Partial progress is real progress: the plan shows 1 of 3 and no more.
  perform public.sync_daily_plan(v_plan);
  if (select completed_count from public.daily_plan_items where id = v_item) <> 1 then
    raise exception 'FAIL: partial drill progress was not reflected';
  end if;
  if (select status from public.daily_plan_items where id = v_item) <> 'in_progress' then
    raise exception 'FAIL: a half-done drill did not report as in progress';
  end if;
end $$;

\echo '── T8. finishing a drill moves the plan, exactly once ──────────────────'

do $$
declare
  v_plan    uuid;
  v_item    uuid;
  v_session uuid;
  v_row     record;
  v_events  int;
begin
  select p.id into v_plan from public.daily_plans p
  where p.user_id = '55555555-5555-5555-5555-555555555555'
    and p.learning_date = date '2026-09-14';
  select i.id into v_item from public.daily_plan_items i
  where i.plan_id = v_plan and i.item_type = 'weakness_practice';
  select s.id into v_session from public.practice_sessions s
  where s.plan_item_id = v_item and s.status = 'in_progress';

  -- An unfinished drill cannot be sealed.
  reset role;
  set role service_role;
  begin
    perform public.finalize_practice_session(
      v_session, '55555555-5555-5555-5555-555555555555', '{}'::jsonb);
    raise exception 'FAIL: an unfinished drill was sealed';
  exception when sqlstate 'FL412' then null;
  end;

  set role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false);
  perform public.answer_practice_question(v_session, 7911, 1, 800);
  perform public.answer_practice_question(v_session, 7912, 1, 800);

  reset role;
  set role service_role;
  select * into v_row from public.finalize_practice_session(
    v_session,
    '55555555-5555-5555-5555-555555555555',
    jsonb_build_object(
      'events', jsonb_build_array(jsonb_build_object(
        'event_key', 'practice:' || v_session || ':7910',
        'event_type', 'practice_answer',
        'occurred_at', now(),
        'skill_code', 'grammar',
        'response_mode', 'multiple_choice',
        'retrieval_type', 'recognition',
        'is_correct', false,
        'source_kind', 'practice',
        'question_id', 7910,
        'text_id', 7900,
        'concepts', jsonb_build_array('adjective_ending')
      )),
      'skills', '[]'::jsonb,
      'concepts', jsonb_build_array(jsonb_build_object(
        'concept_code', 'adjective_ending', 'expected_version', 0,
        'score', 0.4, 'confidence', 0.5, 'evidence_weight', 1.8,
        'success_weight', 1.2, 'evidence_count', 3, 'successful_evidence', 2,
        'failed_evidence', 1, 'source_kinds', jsonb_build_array('practice'),
        'first_evidence_at', now(), 'last_evidence_at', now(),
        'last_failure_at', now()
      )),
      'words', '[]'::jsonb
    )
  );
  if v_row.already_finalized then
    raise exception 'FAIL: a fresh drill reported as already sealed';
  end if;
  if v_row.total_count <> 3 or v_row.correct_count <> 2 then
    raise exception 'FAIL: the drill scored %/% instead of 2/3',
      v_row.correct_count, v_row.total_count;
  end if;

  -- The plan moved inside the drill's own transaction — there is no window in
  -- which the drill is finished and the plan still says pending.
  if (select status from public.daily_plan_items where id = v_item) <> 'completed' then
    raise exception 'FAIL: finishing the drill did not complete the plan item';
  end if;

  -- Evidence reached the knowledge model, which is what makes practising worth
  -- anything: tomorrow's weakness ranking already knows about this.
  select count(*) into v_events from public.learning_events
  where user_id = '55555555-5555-5555-5555-555555555555'
    and event_type = 'practice_answer';
  if v_events <> 1 then
    raise exception 'FAIL: % practice events written, expected 1', v_events;
  end if;
  if not exists (
    select 1 from public.user_concept_state
    where user_id = '55555555-5555-5555-5555-555555555555'
      and concept_code = 'adjective_ending'
  ) then
    raise exception 'FAIL: the drill did not update concept knowledge';
  end if;

  -- Sealing twice writes nothing and re-applies no evidence.
  select * into v_row from public.finalize_practice_session(
    v_session, '55555555-5555-5555-5555-555555555555', '{}'::jsonb);
  if not v_row.already_finalized then
    raise exception 'FAIL: a replayed finalize was not recognised';
  end if;
  select count(*) into v_events from public.learning_events
  where user_id = '55555555-5555-5555-5555-555555555555'
    and event_type = 'practice_answer';
  if v_events <> 1 then
    raise exception 'FAIL: a replayed finalize duplicated evidence (% rows)', v_events;
  end if;

  -- A drill belonging to someone else cannot be sealed for them.
  begin
    perform public.finalize_practice_session(
      v_session, '66666666-6666-6666-6666-666666666666', '{}'::jsonb);
    raise exception 'FAIL: a drill was sealed for the wrong user';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

\echo '── T9. reconciling is idempotent, and a skip is not a completion ───────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false); end $switch$;

do $$
declare
  v_plan       uuid;
  v_item       uuid;
  v_review     uuid;
  v_completed  timestamptz;
  v_again      timestamptz;
  v_status     text;
begin
  select p.id into v_plan from public.daily_plans p
  where p.user_id = '55555555-5555-5555-5555-555555555555'
    and p.learning_date = date '2026-09-14';
  select i.id into v_item from public.daily_plan_items i
  where i.plan_id = v_plan and i.item_type = 'weakness_practice';
  select i.id into v_review from public.daily_plan_items i
  where i.plan_id = v_plan and i.item_type = 'review_due';

  -- Refreshing the page cannot double-count anything, because reconciliation
  -- RECOMPUTES rather than increments.
  perform public.sync_daily_plan(v_plan);
  select completed_at into v_completed from public.daily_plan_items where id = v_item;
  perform public.sync_daily_plan(v_plan);
  perform public.sync_daily_plan(v_plan);
  select completed_at into v_again from public.daily_plan_items where id = v_item;
  if v_completed is distinct from v_again then
    raise exception 'FAIL: reconciling twice rewrote the completion timestamp';
  end if;
  if (select completed_count from public.daily_plan_items where id = v_item) <> 3 then
    raise exception 'FAIL: reconciling twice changed the count';
  end if;

  -- The plan is not finished while a real activity is outstanding.
  if (select status from public.daily_plans where id = v_plan) = 'completed' then
    raise exception 'FAIL: the plan completed with an outstanding item';
  end if;

  -- Skipping resolves an activity without achieving it.
  v_status := public.skip_daily_plan_item(v_review);
  if v_status <> 'skipped' then
    raise exception 'FAIL: skip returned %', v_status;
  end if;

  -- A skip survives reconciliation: a measurement must not overrule a decision.
  perform public.sync_daily_plan(v_plan);
  if (select status from public.daily_plan_items where id = v_review) <> 'skipped' then
    raise exception 'FAIL: reconciliation overwrote a skipped item';
  end if;

  -- Nothing is left pending and something was genuinely completed, so the day
  -- is done. A day where everything was skipped would NOT be.
  if (select status from public.daily_plans where id = v_plan) <> 'completed' then
    raise exception 'FAIL: the plan did not complete once nothing was left to do';
  end if;

  -- Skipping cannot erase a finished activity to tidy the screen.
  if public.skip_daily_plan_item(v_item) <> 'completed' then
    raise exception 'FAIL: skip did not refuse a completed item';
  end if;
  if (select status from public.daily_plan_items where id = v_item) <> 'completed' then
    raise exception 'FAIL: a completed item was downgraded to skipped';
  end if;

  -- …and never on someone else's plan.
  begin
    perform public.skip_daily_plan_item(
      (select i.id from public.daily_plan_items i
       join public.daily_plans p on p.id = i.plan_id
       where p.user_id = '66666666-6666-6666-6666-666666666666' limit 1));
    raise exception 'FAIL: user A could skip an item on user B''s plan';
  exception
    when sqlstate 'FL403' then null;
    -- RLS hides B's rows from A entirely, so the lookup may simply find nothing.
    when sqlstate 'FL404' then null;
  end;
end $$;

\echo '── T10. an all-skipped day is not a day of learning ────────────────────'

reset role;
set role service_role;
do $$
declare
  v_plan uuid;
begin
  v_plan := public.create_daily_plan(
    '55555555-5555-5555-5555-555555555555', date '2026-09-16', 'Europe/Warsaw',
    10, 'planner_v1', 'medium',
    jsonb_build_array(jsonb_build_object(
      'item_position', 1, 'item_type', 'new_vocabulary', 'estimated_minutes', 2,
      'priority_score', 0.4, 'reason_code', 'new_words', 'target_count', 4,
      'word_ids', jsonb_build_array(8001, 8002),
      'payload', jsonb_build_object('preview', jsonb_build_array('das Schwert'))
    )), false
  );

  -- The recommended words are SNAPSHOTTED on the item: completion is measured
  -- against these ids, and yesterday's plan must still name them tomorrow.
  if (select word_ids from public.daily_plan_items where plan_id = v_plan)
     <> array[8001, 8002]::bigint[] then
    raise exception 'FAIL: the recommended word ids were not snapshotted';
  end if;
  if (select payload -> 'preview' ->> 0 from public.daily_plan_items where plan_id = v_plan)
     <> 'das Schwert' then
    raise exception 'FAIL: the display snapshot was not stored';
  end if;

  set role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false);

  perform public.skip_daily_plan_item(
    (select id from public.daily_plan_items where plan_id = v_plan));
  perform public.sync_daily_plan(v_plan);

  if (select status from public.daily_plans where id = v_plan) = 'completed' then
    raise exception 'FAIL: skipping everything counted as a completed day';
  end if;
end $$;

\echo '── T11. reading state, and the practice content pool ───────────────────'

reset role;
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false); end $switch$;

do $$
declare v_count int;
begin
  -- The "continue what you started" signal is recorded for the CALLER only.
  perform public.mark_text_opened(7900);
  perform public.mark_text_opened(7900);
  select open_count into v_count from public.text_progress
  where user_id = '55555555-5555-5555-5555-555555555555' and text_id = 7900;
  if v_count <> 2 then
    raise exception 'FAIL: reopening a passage did not advance open_count (got %)', v_count;
  end if;

  -- An unpublished passage is not readable, so it is not openable either.
  begin
    perform public.mark_text_opened(7901);
    raise exception 'FAIL: a draft passage could be marked as opened';
  exception when sqlstate 'FL404' then null;
  end;

  -- …and it is not learner-writable directly.
  begin
    insert into public.text_progress (user_id, text_id)
    values ('66666666-6666-6666-6666-666666666666', 7900);
    raise exception 'FAIL: a learner could forge reading progress';
  exception when insufficient_privilege then null;
  end;

  -- Content coverage: only published questions count, which is what stops the
  -- planner proposing a drill it cannot actually run.
  select question_count into v_count from public.concept_practice_pool
  where concept_code = 'adjective_ending';
  if v_count <> 3 then
    raise exception 'FAIL: the practice pool counted % questions, expected 3', v_count;
  end if;

  -- A concept with no items produces no row at all, so the planner skips it.
  if exists (
    select 1 from public.concept_practice_pool where concept_code = 'relative_clause'
  ) then
    raise exception 'FAIL: a concept with no questions appears in the practice pool';
  end if;

  -- Starting a drill for it is refused rather than opening an empty screen.
  begin
    perform public.start_practice_session('relative_clause', null, 4);
    raise exception 'FAIL: a drill opened for a concept with no questions';
  exception when sqlstate 'FL404' then null;
  end;
end $$;

reset role;

\echo ''
\echo '✔ all today-engine checks passed'
