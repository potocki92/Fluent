-- Fluent — database security + test-session lifecycle tests.
--
-- These are the invariants the application cannot enforce on its own: they hold
-- because of RLS, constraints, row locks and EXECUTE grants, so they are tested
-- where they live. Run with supabase/tests/run.sh (see the README next to it).
--
-- Every check raises on failure, so `psql -v ON_ERROR_STOP=1` fails the run.

\set ON_ERROR_STOP on

\echo '── fixtures ────────────────────────────────────────────────────────────'

-- Two learners and one published text with three questions. Answer keys are
-- 0 / 1 / 2 so a "always pick index 0" client scores exactly 1/3.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.test');

insert into public.texts (id, title, cefr, body, difficulty, status)
  overriding system value
  values (9001, 'Test passage', 'A1', '<p>Hallo</p>', 1200, 'published');

insert into public.questions (id, text_id, prompt, options, correct_idx, difficulty)
  overriding system value values
  (9101, 9001, 'Q1', array['a','b','c','d'], 0, 1200),
  (9102, 9001, 'Q2', array['a','b','c','d'], 1, 1200),
  (9103, 9001, 'Q3', array['a','b','c','d'], 2, 1200);

-- A question on a different text, used to prove a session cannot be widened.
insert into public.texts (id, title, cefr, body, difficulty, status)
  overriding system value
  values (9002, 'Other passage', 'A1', '<p>Anderes</p>', 1200, 'published');
insert into public.questions (id, text_id, prompt, options, correct_idx, difficulty)
  overriding system value
  values (9201, 9002, 'Foreign Q', array['a','b','c','d'], 3, 1200);

\echo '── 1. a learner cannot read the answer key ─────────────────────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false); end $switch$;

do $$
declare v_count int;
begin
  select count(*) into v_count from public.questions;
  if v_count <> 0 then
    raise exception 'FAIL: questions are directly readable by a learner (% rows)', v_count;
  end if;

  select count(*) into v_count from public.questions_public where text_id = 9001;
  if v_count <> 3 then
    raise exception 'FAIL: questions_public should expose 3 answer-free rows, got %', v_count;
  end if;
end $$;

-- The old answer oracle must be gone, not merely unused.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('grade_question', 'grade_test', 'grade_calibration',
                        'update_streak')
  ) then
    raise exception 'FAIL: a removed grading/streak function still exists';
  end if;
end $$;

-- Every SECURITY DEFINER function must pin search_path.
reset role;
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
      where c like 'search_path=%'
    );
  if v_bad is not null then
    raise exception 'FAIL: SECURITY DEFINER without search_path: %', v_bad;
  end if;
end $$;

-- Finalization must be unreachable from the browser-facing roles.
do $$
begin
  if has_function_privilege('authenticated',
       'public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean)',
       'execute')
  or has_function_privilege('anon',
       'public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean)',
       'execute') then
    raise exception 'FAIL: finalize_test_session is executable by a client role';
  end if;
  if not has_function_privilege('service_role',
       'public.finalize_test_session(uuid, uuid, numeric, numeric, numeric, text, int, boolean)',
       'execute') then
    raise exception 'FAIL: finalize_test_session is not executable by service_role';
  end if;
  if has_function_privilege('authenticated', 'public.apply_daily_streak(uuid)', 'execute') then
    raise exception 'FAIL: apply_daily_streak is executable by a client role';
  end if;
end $$;

\echo '── 2. progress tables are read-only for their owner ────────────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false); end $switch$;

do $$
begin
  begin
    insert into public.attempts
      (user_id, question_id, text_id, is_correct, ability_before, ability_after)
    values ('11111111-1111-1111-1111-111111111111', 9101, 9001, true, 1900, 1900);
    raise exception 'FAIL: a learner could forge an attempts row';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.text_completions (user_id, text_id, passed, correct, total)
    values ('11111111-1111-1111-1111-111111111111', 9001, true, 3, 3);
    raise exception 'FAIL: a learner could forge a text_completions row';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set ability = 1900
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: a learner could set their own ability';
  exception when sqlstate 'FL403' then null;
  end;

  begin
    update public.profiles set streak_days = 365
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: a learner could set their own streak';
  exception when sqlstate 'FL403' then null;
  end;

  begin
    update public.profiles set answered = 9999
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: a learner could set their own answer count';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

-- …while the genuinely user-editable fields still work.
update public.profiles
   set display_name = 'Ala', daily_word_goal = 30
 where id = '11111111-1111-1111-1111-111111111111';

do $$
declare v_goal int;
begin
  select daily_word_goal into v_goal from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  if v_goal <> 30 then
    raise exception 'FAIL: a learner can no longer edit their own daily goal';
  end if;
end $$;

\echo '── 3. session start is server-authoritative ────────────────────────────'

do $$
declare
  v_session uuid;
  v_again   uuid;
  v_items   int;
begin
  v_session := public.start_test_session(9001);

  select count(*) into v_items
  from public.test_session_items where session_id = v_session;
  if v_items <> 3 then
    raise exception 'FAIL: session snapshot has % items, expected 3', v_items;
  end if;

  -- Re-entering resumes rather than opening a second session.
  v_again := public.start_test_session(9001);
  if v_again <> v_session then
    raise exception 'FAIL: start_test_session did not resume the open session';
  end if;

  select count(*) into v_items from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111'
     and text_id = 9001 and status = 'in_progress';
  if v_items <> 1 then
    raise exception 'FAIL: % concurrent in-progress sessions', v_items;
  end if;

  -- The snapshot may not be reached through a question of another text.
  begin
    perform public.answer_test_question(v_session, 9201, 3, 1000);
    raise exception 'FAIL: a foreign question could be answered into the session';
  exception when sqlstate 'FL410' then null;
  end;
end $$;

\echo '── 4. user B cannot touch user A''s session ────────────────────────────'

do $$
declare v_session uuid;
begin
  select id into v_session from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111' and status = 'in_progress';
  perform set_config('request.jwt.claims',
                     '{"sub":"22222222-2222-2222-2222-222222222222"}', false);

  if exists (select 1 from public.test_sessions where id = v_session) then
    raise exception 'FAIL: user B can read user A''s session row';
  end if;
  if exists (select 1 from public.test_session_items where session_id = v_session) then
    raise exception 'FAIL: user B can read user A''s session items';
  end if;

  begin
    perform public.get_test_session(v_session);
    raise exception 'FAIL: user B could read user A''s session through the RPC';
  exception when sqlstate 'FL403' then null;
  end;

  begin
    perform public.answer_test_question(v_session, 9101, 0, 1000);
    raise exception 'FAIL: user B could answer into user A''s session';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

\echo '── 5. one answer per session item, whatever the client retries ─────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false); end $switch$;

do $$
declare
  v_session uuid;
  v_first   record;
  v_retry   record;
  v_stored  int;
begin
  select id into v_session from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111' and status = 'in_progress';

  -- Q1's key is 0; answer it wrong on purpose.
  select * into v_first
  from public.answer_test_question(v_session, 9101, 3, 4200);
  if v_first.is_answer_correct or v_first.answer_key_idx <> 0 or v_first.already_answered then
    raise exception 'FAIL: unexpected first grading %', v_first;
  end if;

  -- Case 1/2: double tap and request retry, this time with the RIGHT answer.
  -- The first answer must stand.
  select * into v_retry
  from public.answer_test_question(v_session, 9101, 0, 4200);
  if not v_retry.already_answered then
    raise exception 'FAIL: a repeated answer was not detected as already answered';
  end if;
  if v_retry.is_answer_correct then
    raise exception 'FAIL: a retry overwrote the stored answer';
  end if;

  select selected_idx into v_stored from public.test_session_items
   where session_id = v_session and question_id = 9101;
  if v_stored <> 3 then
    raise exception 'FAIL: stored answer changed to %', v_stored;
  end if;

  -- Sanity-check the response-time guard: negatives and absurd values never
  -- reach the column.
  perform public.answer_test_question(v_session, 9102, 1, -5);
  if (select response_ms from public.test_session_items
       where session_id = v_session and question_id = 9102) is not null then
    raise exception 'FAIL: a negative response time was stored';
  end if;

  -- Finalizing an incomplete session is refused.
  perform set_config('request.jwt.claims', '', false);
end $$;

set role service_role;

do $$
declare v_session uuid;
begin
  select id into v_session from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111' and status = 'in_progress';
  begin
    perform public.finalize_test_session(
      v_session, '11111111-1111-1111-1111-111111111111', 1000, 1050, 300, 'A1', 0, true);
    raise exception 'FAIL: an incomplete session could be finalized';
  exception when sqlstate 'FL412' then null;
  end;
end $$;

\echo '── 6. finalize is atomic and idempotent ────────────────────────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false); end $switch$;
do $$
declare v_session uuid;
begin
  select id into v_session from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111' and status = 'in_progress';
  perform public.answer_test_question(v_session, 9103, 2, 3000);  -- correct
end $$;

reset role;
set role service_role;

do $$
declare
  v_session  uuid;
  v_first    record;
  v_second   record;
  v_attempts int;
  v_answered int;
  v_streak   int;
  v_before   numeric;
begin
  select id, ability_before into v_session, v_before from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111' and status = 'in_progress';

  select * into v_first from public.finalize_test_session(
    v_session, '11111111-1111-1111-1111-111111111111',
    v_before, v_before + 40, 300, 'A1', 0, true);

  -- 2 of 3 correct (Q1 was answered wrong, Q2 and Q3 right).
  if v_first.correct_count <> 2 or v_first.total_count <> 3 then
    raise exception 'FAIL: score counted as %/%', v_first.correct_count, v_first.total_count;
  end if;
  if v_first.already_finalized then
    raise exception 'FAIL: a first finalize reported itself as a replay';
  end if;

  select count(*) into v_attempts from public.attempts where test_session_id = v_session;
  if v_attempts <> 3 then
    raise exception 'FAIL: % attempts written, expected 3', v_attempts;
  end if;
  if not exists (select 1 from public.text_completions
                 where user_id = '11111111-1111-1111-1111-111111111111'
                   and text_id = 9001 and test_session_id = v_session) then
    raise exception 'FAIL: no completion row linked to the session';
  end if;

  select answered, streak_days into v_answered, v_streak from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  if v_answered <> 3 then
    raise exception 'FAIL: answered is % after one 3-question test', v_answered;
  end if;
  if v_streak <> 1 then
    raise exception 'FAIL: streak is % after one test', v_streak;
  end if;
  if (select ability from public.profiles
       where id = '11111111-1111-1111-1111-111111111111') <> v_before + 40 then
    raise exception 'FAIL: ability was not applied';
  end if;

  -- Case 3/4: a concurrent second finalize, or a refresh of the results page.
  select * into v_second from public.finalize_test_session(
    v_session, '11111111-1111-1111-1111-111111111111',
    v_before, v_before + 999, 300, 'B2', 3, true);

  if not v_second.already_finalized then
    raise exception 'FAIL: the second finalize was not recognised as a replay';
  end if;
  if v_second.correct_count <> 2 or v_second.ability_end <> v_before + 40 then
    raise exception 'FAIL: the replay did not return the stored result';
  end if;

  select count(*) into v_attempts from public.attempts where test_session_id = v_session;
  if v_attempts <> 3 then
    raise exception 'FAIL: the replay added attempts (now %)', v_attempts;
  end if;
  select answered, streak_days into v_answered, v_streak from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  if v_answered <> 3 or v_streak <> 1 then
    raise exception 'FAIL: the replay moved progress (answered=%, streak=%)', v_answered, v_streak;
  end if;
  if (select ability from public.profiles
       where id = '11111111-1111-1111-1111-111111111111') <> v_before + 40 then
    raise exception 'FAIL: the replay moved the ability';
  end if;
end $$;

-- A rating computed from a stale profile read is refused rather than applied.
do $$
declare v_session uuid;
begin
  set role authenticated;
  perform set_config('request.jwt.claims',
                     '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
  v_session := public.start_test_session(9002);
  perform public.answer_test_question(v_session, 9201, 3, 1000);
  set role service_role;
  begin
    perform public.finalize_test_session(
      v_session, '11111111-1111-1111-1111-111111111111', 1, 1500, 300, 'B1', 0, true);
    raise exception 'FAIL: a stale ability_before was accepted';
  exception when sqlstate 'FL423' then null;
  end;
end $$;

-- A session belonging to someone else is refused even for the service role.
do $$
declare v_session uuid;
begin
  select id into v_session from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111' and text_id = 9002;
  begin
    perform public.finalize_test_session(
      v_session, '22222222-2222-2222-2222-222222222222', 1000, 1100, 300, 'A1', 0, true);
    raise exception 'FAIL: a session was finalized for the wrong user';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

\echo '── 7. a retake opens a new session and overwrites the completion ───────'

reset role;
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false); end $switch$;

do $$
declare
  v_session uuid;
  v_old     uuid;
begin
  select test_session_id into v_old from public.text_completions
   where user_id = '11111111-1111-1111-1111-111111111111' and text_id = 9001;

  v_session := public.start_test_session(9001);
  if v_session = v_old then
    raise exception 'FAIL: a retake reused the completed session';
  end if;
  perform public.answer_test_question(v_session, 9101, 0, 1000);
  perform public.answer_test_question(v_session, 9102, 1, 1000);
  perform public.answer_test_question(v_session, 9103, 2, 1000);
end $$;

reset role;
set role service_role;

do $$
declare
  v_session uuid;
  v_before  numeric;
  v_result  record;
begin
  select id, ability_before into v_session, v_before from public.test_sessions
   where user_id = '11111111-1111-1111-1111-111111111111'
     and text_id = 9001 and status = 'in_progress';

  select * into v_result from public.finalize_test_session(
    v_session, '11111111-1111-1111-1111-111111111111',
    v_before, v_before + 15, 290, 'A1', 0, true);

  if v_result.correct_count <> 3 then
    raise exception 'FAIL: retake scored %/3', v_result.correct_count;
  end if;
  if (select correct from public.text_completions
       where user_id = '11111111-1111-1111-1111-111111111111' and text_id = 9001) <> 3 then
    raise exception 'FAIL: the completion row was not overwritten by the retake';
  end if;
  if (select answered from public.profiles
       where id = '11111111-1111-1111-1111-111111111111') <> 6 then
    raise exception 'FAIL: answered did not advance by the retake''s item count';
  end if;
  if (select streak_days from public.profiles
       where id = '11111111-1111-1111-1111-111111111111') <> 1 then
    raise exception 'FAIL: a second test the same day bumped the streak again';
  end if;
end $$;

\echo '── 8. calibration is replayed from stored answers ──────────────────────'

reset role;
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false); end $switch$;

do $$
declare
  v_session uuid;
  v_item    record;
  v_answers int;
  v_qid     bigint;
begin
  v_session := public.start_calibration_session();

  -- The item bank is read through the answer-free view, exactly as the client
  -- does; the base table has no select policy for learners.
  for v_qid in
    select id from public.calibration_questions_public order by difficulty limit 3
  loop
    perform public.answer_calibration_question(v_session, v_qid, 0, 2000);
  end loop;

  select count(*) into v_answers
  from public.get_calibration_session_answers(v_session);
  if v_answers <> 3 then
    raise exception 'FAIL: % replayable answers, expected 3', v_answers;
  end if;

  -- Positions must be dense and ordered, so a replay reproduces the original
  -- adaptive sequence exactly.
  if exists (
    select 1 from public.get_calibration_session_answers(v_session) a
    where a.item_position not between 1 and 3
  ) then
    raise exception 'FAIL: calibration item positions are not 1..3';
  end if;

  -- Re-answering an item is a no-op, as with the reading test.
  select * into v_item from public.answer_calibration_question(v_session, v_qid, 1, 2000);
  if not v_item.already_answered then
    raise exception 'FAIL: a calibration item could be answered twice';
  end if;
end $$;

reset role;
set role service_role;

do $$
declare
  v_session uuid;
  v_first   record;
  v_second  record;
begin
  select id into v_session from public.calibration_sessions
   where user_id = '22222222-2222-2222-2222-222222222222' and status = 'in_progress';

  select * into v_first from public.finalize_calibration_session(
    v_session, '22222222-2222-2222-2222-222222222222', 1320, 150, 'A2');
  if v_first.already_finalized or v_first.item_count <> 3 then
    raise exception 'FAIL: unexpected calibration finalize %', v_first;
  end if;
  if (select level_source from public.profiles
       where id = '22222222-2222-2222-2222-222222222222') <> 'placement' then
    raise exception 'FAIL: level_source was not marked as placement';
  end if;

  select * into v_second from public.finalize_calibration_session(
    v_session, '22222222-2222-2222-2222-222222222222', 1999, 50, 'B2');
  if not v_second.already_finalized then
    raise exception 'FAIL: calibration finalize is not idempotent';
  end if;
  if (select ability from public.profiles
       where id = '22222222-2222-2222-2222-222222222222') <> 1320 then
    raise exception 'FAIL: a replayed calibration finalize moved the ability';
  end if;
end $$;

\echo '── 9. manual level is allowed, clamped and labelled ────────────────────'

reset role;
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false); end $switch$;

do $$
declare v_row record;
begin
  select * into v_row from public.set_manual_level(99999, 10);
  if v_row.ability <> 2000 then
    raise exception 'FAIL: manual ability was not clamped (got %)', v_row.ability;
  end if;
  if v_row.rd <> 50 then
    raise exception 'FAIL: manual rd was not clamped (got %)', v_row.rd;
  end if;
  if (select level_source from public.profiles
       where id = '22222222-2222-2222-2222-222222222222') <> 'manual' then
    raise exception 'FAIL: a manual level was not labelled as manual';
  end if;
end $$;

\echo '── 10. word-review counter only ever touches the caller ────────────────'

do $$
declare v_a int; v_b int;
begin
  perform public.bump_word_review();
  perform public.bump_word_review();

  select words_reviewed_today into v_b from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  select words_reviewed_today into v_a from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';

  if v_b <> 2 then
    raise exception 'FAIL: caller''s review count is %', v_b;
  end if;
  if v_a <> 0 then
    raise exception 'FAIL: another user''s review count moved to %', v_a;
  end if;
end $$;

reset role;
\echo ''
\echo '✔ all database security checks passed'
