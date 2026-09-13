-- Fluent — learning engine: security, idempotency and atomicity.
--
-- The knowledge model's arithmetic is unit-tested in TypeScript
-- (`src/lib/learning/*.test.ts`). What CANNOT be tested there is everything this
-- file asserts: that a learner cannot author their own evidence, cannot set
-- their own mastery, cannot read anyone else's, that one interaction produces
-- exactly one event however many times it is submitted, and that a failure
-- halfway through a review leaves nothing behind.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures here use ids in the 8xxx range so they cannot collide with
-- 01_test_session_security.sql, which runs first against the same database.

\set ON_ERROR_STOP on

\echo '── L0. learning fixtures ───────────────────────────────────────────────'

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'c@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'd@example.test');

insert into public.words (id, lemma, display, word_type, translation_pl, cefr) values
  (8001, 'Schwert', 'das Schwert', 'noun', 'miecz', 'B1'),
  (8002, 'gehen',   'gehen',       'verb', 'iść',   'A1');

-- A grammar question with real concept tags — the case the weakness model is for.
insert into public.texts (id, title, cefr, body, difficulty, status)
  overriding system value
  values (8900, 'Grammar passage', 'A2', '<p>Ich fahre mit dem Bus.</p>', 1300, 'published');

insert into public.questions (id, text_id, prompt, options, correct_idx, difficulty, skill_code)
  overriding system value values
  (8901, 8900, 'Ich fahre mit ___ Bus.', array['der','dem','den','das'], 1, 1300, 'grammar'),
  (8902, 8900, 'O czym jest tekst?',     array['a','b','c','d'],         0, 1300, 'reading_comprehension');

insert into public.question_concepts (question_id, concept_code) values
  (8901, 'preposition_case'),
  (8901, 'case_dative');

\echo '── L1. catalogs are readable, learner state is not writable ────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false); end $switch$;

do $$
declare v_count int;
begin
  -- The catalogs are public reference data; the UI needs the Polish labels.
  select count(*) into v_count from public.skills;
  if v_count < 8 then
    raise exception 'FAIL: the skill catalog is not readable (% rows)', v_count;
  end if;
  select count(*) into v_count from public.concepts where code = 'preposition_case';
  if v_count <> 1 then
    raise exception 'FAIL: the concept catalog is not readable';
  end if;

  -- …but not editable. A learner who can rewrite the taxonomy can rewrite what
  -- their own weaknesses are called.
  begin
    insert into public.skills (code, label_pl, description) values ('cheating', 'x', 'y');
    raise exception 'FAIL: a learner could add a skill to the catalog';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.concepts set label_pl = 'x' where code = 'preposition_case';
    if found then
      raise exception 'FAIL: a learner could rewrite the concept catalog';
    end if;
  exception when insufficient_privilege then null;
  end;
end $$;

\echo '── L2. a learner cannot forge evidence or set their own mastery ────────'

do $$
begin
  -- Evidence a learner can author is not evidence.
  begin
    insert into public.learning_events
      (user_id, event_key, event_type, response_mode, retrieval_type, source_kind, is_correct)
    values ('33333333-3333-3333-3333-333333333333', 'forged', 'test_answer',
            'typed', 'free_production', 'reading_test', true);
    raise exception 'FAIL: a learner could forge a learning event';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.review_events
      (user_id, word_id, interaction_id, rating, mode, direction,
       repetitions_after, interval_after, ease_after, due_after)
    values ('33333333-3333-3333-3333-333333333333', 8001, 'forged', 'easy',
            'flashcard', 'de_to_pl', 99, 999, 2.5, now());
    raise exception 'FAIL: a learner could forge a review event';
  exception when insufficient_privilege then null;
  end;

  -- A mastery score someone can set is not a measurement.
  begin
    insert into public.user_skill_state (user_id, skill_code, score, confidence)
    values ('33333333-3333-3333-3333-333333333333', 'speaking', 1, 1);
    raise exception 'FAIL: a learner could set their own skill mastery';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_concept_state (user_id, concept_code, score, confidence)
    values ('33333333-3333-3333-3333-333333333333', 'case_dative', 1, 1);
    raise exception 'FAIL: a learner could set their own concept mastery';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_word_knowledge (user_id, word_id, active_score, active_confidence)
    values ('33333333-3333-3333-3333-333333333333', 8001, 1, 1);
    raise exception 'FAIL: a learner could set their own word knowledge';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nothing that writes evidence may be reachable from a browser-facing role.
reset role;
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.apply_learning_evidence(uuid, jsonb, bigint)',
    'public.apply_review(uuid, text, bigint, text, text, text, int, jsonb, jsonb)',
    'public.apply_word_review_counter(uuid)'
  ] loop
    if has_function_privilege('authenticated', v_signature, 'execute')
    or has_function_privilege('anon', v_signature, 'execute') then
      raise exception 'FAIL: % is executable by a client role', v_signature;
    end if;
  end loop;

  -- apply_review takes a user id, so even the service role boundary matters:
  -- it must be reachable there and nowhere else.
  if not has_function_privilege('service_role',
       'public.apply_review(uuid, text, bigint, text, text, text, int, jsonb, jsonb)', 'execute') then
    raise exception 'FAIL: apply_review is not executable by service_role';
  end if;
  -- The internal helper is not an API even for the service role.
  if has_function_privilege('service_role',
       'public.apply_learning_evidence(uuid, jsonb, bigint)', 'execute') then
    raise exception 'FAIL: apply_learning_evidence is exposed to service_role';
  end if;

  -- Every SECURITY DEFINER function added here must pin search_path, as the
  -- test-session migration established.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('apply_learning_evidence', 'apply_review',
                        'apply_word_review_counter', 'bump_word_review')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
        where c like 'search_path=%'
      )
  ) then
    raise exception 'FAIL: a learning-engine function does not pin search_path';
  end if;
end $$;

\echo '── L3. a graded review is one atomic, idempotent interaction ───────────'

set role service_role;

do $$
declare
  v_first  record;
  v_second record;
  v_events int;
begin
  -- A brand-new word: no saved_words row yet, so `exists` is false.
  select * into v_first from public.apply_review(
    '33333333-3333-3333-3333-333333333333', 'int-1', 8001, 'good', 'flashcard', 'de_to_pl', 2500,
    '{"before":{"exists":false},
      "after":{"interval":1,"repetitions":1,"ease_factor":2.6,
               "due_at":"2026-02-01T10:00:00Z","is_mastered":false}}'::jsonb,
    '{"events":[{"event_key":"review:int-1","event_type":"review",
                 "skill_code":"receptive_vocabulary","response_mode":"self_rated",
                 "retrieval_type":"recognition","is_correct":true,
                 "source_kind":"review","word_id":8001,
                 "concepts":["lexical_recognition"]}],
      "skills":[{"skill_code":"receptive_vocabulary","expected_version":0,
                 "score":0.75,"confidence":0.12,"evidence_weight":0.5,
                 "success_weight":0.5,"evidence_count":1,"successful_evidence":1,
                 "failed_evidence":0,"source_kinds":["review"],
                 "first_evidence_at":"2026-01-01T10:00:00Z",
                 "last_evidence_at":"2026-01-01T10:00:00Z"}],
      "words":[{"word_id":8001,"expected_version":0,
                "first_seen_at":"2026-01-01T10:00:00Z","last_seen_at":"2026-01-01T10:00:00Z",
                "last_success_at":"2026-01-01T10:00:00Z",
                "exposure_count":1,"successful_retrievals":1,"failed_retrievals":0,
                "receptive":{"score":0.75,"confidence":0.12,"evidence_weight":0.5,
                             "success_weight":0.5,"evidence_count":1,
                             "last_evidence_at":"2026-01-01T10:00:00Z"},
                "source_kinds":["review"]}]}'::jsonb);

  if v_first.already_applied then
    raise exception 'FAIL: a first review reported itself as a replay';
  end if;

  -- Everything the interaction touches landed together.
  if not exists (select 1 from public.review_events where interaction_id = 'int-1') then
    raise exception 'FAIL: no review event was written';
  end if;
  if not exists (
    select 1 from public.saved_words
    where user_id = '33333333-3333-3333-3333-333333333333'
      and word_id = 8001 and interval = 1
  ) then
    raise exception 'FAIL: the SM-2 schedule was not applied';
  end if;
  if not exists (
    select 1 from public.learning_events where event_key = 'review:int-1'
  ) then
    raise exception 'FAIL: no learning event was written';
  end if;
  if not exists (
    select 1 from public.learning_event_concepts lec
    join public.learning_events e on e.id = lec.event_id
    where e.event_key = 'review:int-1' and lec.concept_code = 'lexical_recognition'
  ) then
    raise exception 'FAIL: the event was not tagged with its concept';
  end if;
  if (select words_reviewed_today from public.profiles
       where id = '33333333-3333-3333-3333-333333333333') <> 1 then
    raise exception 'FAIL: the daily review counter did not advance';
  end if;

  -- RECEPTIVE EVIDENCE MUST NOT CREATE ACTIVE KNOWLEDGE. This is the single most
  -- important assertion in this file: it is what stops Fluent claiming someone
  -- can produce a word because they recognised it.
  if (select active_score from public.user_word_knowledge
       where user_id = '33333333-3333-3333-3333-333333333333' and word_id = 8001)
     is not null then
    raise exception 'FAIL: a receptive review created active word knowledge';
  end if;
  if (select receptive_score from public.user_word_knowledge
       where user_id = '33333333-3333-3333-3333-333333333333' and word_id = 8001)
     is null then
    raise exception 'FAIL: the receptive channel was not updated';
  end if;

  -- IDEMPOTENCY: the same interaction id settles the same review. A double tap
  -- on "Dobrze" must not push the interval out twice.
  select * into v_second from public.apply_review(
    '33333333-3333-3333-3333-333333333333', 'int-1', 8001, 'good', 'flashcard', 'de_to_pl', 2500,
    '{"before":{"exists":false},
      "after":{"interval":99,"repetitions":9,"ease_factor":3.0,
               "due_at":"2027-01-01T10:00:00Z","is_mastered":true}}'::jsonb,
    '{}'::jsonb);

  if not v_second.already_applied then
    raise exception 'FAIL: a replayed review was applied again';
  end if;
  if v_second.interval_days <> 1 then
    raise exception 'FAIL: the replay returned % instead of the stored schedule',
      v_second.interval_days;
  end if;
  if (select interval from public.saved_words
       where user_id = '33333333-3333-3333-3333-333333333333' and word_id = 8001) <> 1 then
    raise exception 'FAIL: a replayed review moved the schedule';
  end if;
  if (select words_reviewed_today from public.profiles
       where id = '33333333-3333-3333-3333-333333333333') <> 1 then
    raise exception 'FAIL: a replayed review advanced the daily counter again';
  end if;

  select count(*) into v_events from public.review_events where interaction_id = 'int-1';
  if v_events <> 1 then
    raise exception 'FAIL: % review events for one interaction', v_events;
  end if;
end $$;

-- A stale scheduling read is refused rather than applied on top.
do $$
begin
  begin
    perform public.apply_review(
      '33333333-3333-3333-3333-333333333333', 'int-2', 8001, 'good', 'flashcard', 'de_to_pl', null,
      -- Claims the card was still unenrolled; it now has a real schedule.
      '{"before":{"exists":false},
        "after":{"interval":6,"repetitions":2,"ease_factor":2.6,
                 "due_at":"2026-02-10T10:00:00Z","is_mastered":false}}'::jsonb,
      '{}'::jsonb);
    raise exception 'FAIL: a review computed from a stale schedule was accepted';
  exception when sqlstate 'FL423' then null;
  end;

  -- …and nothing was left behind by the rejected attempt.
  if exists (select 1 from public.review_events where interaction_id = 'int-2') then
    raise exception 'FAIL: a rejected review still wrote a review event';
  end if;
end $$;

-- A failure partway through rolls the whole interaction back.
do $$
begin
  begin
    perform public.apply_review(
      '33333333-3333-3333-3333-333333333333', 'int-3', 8002, 'good', 'flashcard', 'de_to_pl', null,
      '{"before":{"exists":false},
        "after":{"interval":1,"repetitions":1,"ease_factor":2.6,
                 "due_at":"2026-02-01T10:00:00Z","is_mastered":false}}'::jsonb,
      -- A concept code that is not in the catalog: the evidence step fails.
      '{"events":[{"event_key":"review:int-3","event_type":"review",
                   "skill_code":"receptive_vocabulary","response_mode":"self_rated",
                   "retrieval_type":"recognition","is_correct":true,
                   "source_kind":"review","word_id":8002,
                   "concepts":["not_a_real_concept"]}]}'::jsonb);
    raise exception 'FAIL: an invalid evidence payload was accepted';
  exception when foreign_key_violation then null;
  end;

  if exists (select 1 from public.review_events where interaction_id = 'int-3') then
    raise exception 'FAIL: the review event survived a failed evidence step';
  end if;
  if exists (
    select 1 from public.saved_words
    where user_id = '33333333-3333-3333-3333-333333333333' and word_id = 8002
  ) then
    raise exception 'FAIL: the SM-2 schedule survived a failed evidence step';
  end if;
  if exists (select 1 from public.learning_events where event_key = 'review:int-3') then
    raise exception 'FAIL: the learning event survived a failed evidence step';
  end if;
end $$;

\echo '── L4. concurrent state writes are rejected, not silently merged ───────'

do $$
declare v_version int;
begin
  select version into v_version from public.user_skill_state
   where user_id = '33333333-3333-3333-3333-333333333333'
     and skill_code = 'receptive_vocabulary';
  if v_version <> 1 then
    raise exception 'FAIL: skill state version is % after one write', v_version;
  end if;

  -- A writer that computed from version 0 has read a state that has since moved.
  begin
    perform public.apply_review(
      '33333333-3333-3333-3333-333333333333', 'int-4', 8002, 'good', 'flashcard', 'de_to_pl', null,
      '{"before":{"exists":false},
        "after":{"interval":1,"repetitions":1,"ease_factor":2.6,
                 "due_at":"2026-02-01T10:00:00Z","is_mastered":false}}'::jsonb,
      '{"skills":[{"skill_code":"receptive_vocabulary","expected_version":0,
                   "score":0.99,"confidence":0.99,"evidence_weight":9,
                   "success_weight":9,"evidence_count":9,"successful_evidence":9,
                   "failed_evidence":0,"source_kinds":["review"],
                   "last_evidence_at":"2026-01-02T10:00:00Z"}]}'::jsonb);
    raise exception 'FAIL: a lost update overwrote concurrent knowledge state';
  exception when sqlstate 'FL423' then null;
  end;

  if (select score from public.user_skill_state
       where user_id = '33333333-3333-3333-3333-333333333333'
         and skill_code = 'receptive_vocabulary') <> 0.75 then
    raise exception 'FAIL: the rejected write still changed the score';
  end if;
end $$;

\echo '── L5. a test answer feeds skill and concept evidence exactly once ─────'

reset role;
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false); end $switch$;

do $$
declare
  v_session uuid;
  v_tags    record;
begin
  v_session := public.start_test_session(8900);
  -- Wrong answer on the tagged grammar item, right one on the untagged reader.
  perform public.answer_test_question(v_session, 8901, 0, 4000);
  perform public.answer_test_question(v_session, 8902, 0, 3000);

  -- Tags reach the learner through the answer-free view, never the base table.
  select skill_code, concepts into v_tags
  from public.questions_public where id = 8901;
  if v_tags.skill_code <> 'grammar' then
    raise exception 'FAIL: questions_public does not expose the skill tag';
  end if;
  if not (v_tags.concepts @> array['preposition_case','case_dative']) then
    raise exception 'FAIL: questions_public does not expose the concept tags';
  end if;
  if exists (select 1 from public.question_concepts) then
    raise exception 'FAIL: a learner can read the raw question_concepts table';
  end if;
end $$;

reset role;
set role service_role;

do $$
declare
  v_session uuid;
  v_before  numeric;
  v_result  record;
  v_evidence jsonb;
  v_events  int;
begin
  select id, ability_before into v_session, v_before from public.test_sessions
   where user_id = '33333333-3333-3333-3333-333333333333' and status = 'in_progress';

  v_evidence := jsonb_build_object(
    'events', jsonb_build_array(
      jsonb_build_object(
        'event_key', 'test:' || v_session || ':8901',
        'event_type', 'test_answer', 'skill_code', 'grammar',
        'response_mode', 'multiple_choice', 'retrieval_type', 'recognition',
        'is_correct', false, 'source_kind', 'reading_test',
        'text_id', 8900, 'question_id', 8901, 'test_session_id', v_session,
        'concepts', jsonb_build_array('preposition_case', 'case_dative')
      )
    ),
    'skills', jsonb_build_array(
      jsonb_build_object('skill_code', 'grammar', 'expected_version', 0,
        'score', 0.25, 'confidence', 0.14, 'evidence_weight', 0.6,
        'success_weight', 0, 'evidence_count', 1, 'successful_evidence', 0,
        'failed_evidence', 1, 'source_kinds', jsonb_build_array('reading_test'),
        'last_evidence_at', '2026-01-03T10:00:00Z')
    ),
    'concepts', jsonb_build_array(
      jsonb_build_object('concept_code', 'preposition_case', 'expected_version', 0,
        'score', 0.25, 'confidence', 0.14, 'evidence_weight', 0.6,
        'success_weight', 0, 'evidence_count', 1, 'successful_evidence', 0,
        'failed_evidence', 1, 'source_kinds', jsonb_build_array('reading_test'),
        'last_failure_at', '2026-01-03T10:00:00Z'),
      jsonb_build_object('concept_code', 'case_dative', 'expected_version', 0,
        'score', 0.25, 'confidence', 0.14, 'evidence_weight', 0.6,
        'success_weight', 0, 'evidence_count', 1, 'successful_evidence', 0,
        'failed_evidence', 1, 'source_kinds', jsonb_build_array('reading_test'),
        'last_failure_at', '2026-01-03T10:00:00Z')
    )
  );

  select * into v_result from public.finalize_test_session(
    v_session, '33333333-3333-3333-3333-333333333333',
    v_before, v_before - 20, 300, 'A2', 0, false, v_evidence);
  if v_result.already_finalized then
    raise exception 'FAIL: a first finalize reported itself as a replay';
  end if;

  if not exists (
    select 1 from public.learning_events
    where user_id = '33333333-3333-3333-3333-333333333333'
      and event_key = 'test:' || v_session || ':8901'
  ) then
    raise exception 'FAIL: finalizing a test wrote no learning event';
  end if;
  if (select failed_evidence from public.user_concept_state
       where user_id = '33333333-3333-3333-3333-333333333333'
         and concept_code = 'preposition_case') <> 1 then
    raise exception 'FAIL: the tagged concept received no evidence';
  end if;

  -- No concept was invented for the UNTAGGED comprehension question.
  if exists (
    select 1 from public.user_concept_state
    where user_id = '33333333-3333-3333-3333-333333333333'
      and concept_code not in ('preposition_case', 'case_dative', 'lexical_recognition')
  ) then
    raise exception 'FAIL: a weakness was invented for an untagged question';
  end if;

  -- REPLAY: a second finalize must change nothing at all.
  perform public.finalize_test_session(
    v_session, '33333333-3333-3333-3333-333333333333',
    v_before, v_before - 999, 300, 'A1', 0, false, v_evidence);

  select count(*) into v_events from public.learning_events
   where user_id = '33333333-3333-3333-3333-333333333333'
     and test_session_id = v_session;
  if v_events <> 1 then
    raise exception 'FAIL: a replayed finalize produced % events', v_events;
  end if;
  if (select failed_evidence from public.user_concept_state
       where user_id = '33333333-3333-3333-3333-333333333333'
         and concept_code = 'preposition_case') <> 1 then
    raise exception 'FAIL: a replayed finalize counted the same answer twice';
  end if;
end $$;

-- The same event key can never produce two rows, whatever calls it. Run as the
-- owner, because `apply_learning_evidence` is revoked from every role including
-- service_role — the assertion just above is that this call is impossible from
-- anywhere but inside the functions that own the transaction.
reset role;

do $$
declare v_written int;
begin
  v_written := public.apply_learning_evidence(
    '33333333-3333-3333-3333-333333333333',
    '{"events":[{"event_key":"manual-dup","event_type":"review",
                 "response_mode":"self_rated","retrieval_type":"recognition",
                 "source_kind":"review","is_correct":true}]}'::jsonb);
  if v_written <> 1 then
    raise exception 'FAIL: the first write reported % events', v_written;
  end if;

  v_written := public.apply_learning_evidence(
    '33333333-3333-3333-3333-333333333333',
    '{"events":[{"event_key":"manual-dup","event_type":"review",
                 "response_mode":"self_rated","retrieval_type":"recognition",
                 "source_kind":"review","is_correct":false}]}'::jsonb);
  if v_written <> 0 then
    raise exception 'FAIL: a duplicate event key wrote % rows', v_written;
  end if;
  if (select count(*) from public.learning_events where event_key = 'manual-dup') <> 1 then
    raise exception 'FAIL: a duplicate event key produced two rows';
  end if;
end $$;

\echo '── L6. user A never sees user B''s learning profile ─────────────────────'

reset role;
set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', false); end $switch$;

do $$
begin
  if exists (select 1 from public.learning_events) then
    raise exception 'FAIL: user D can read another learner''s learning events';
  end if;
  if exists (select 1 from public.review_events) then
    raise exception 'FAIL: user D can read another learner''s review history';
  end if;
  if exists (select 1 from public.user_skill_state) then
    raise exception 'FAIL: user D can read another learner''s skill state';
  end if;
  if exists (select 1 from public.user_concept_state) then
    raise exception 'FAIL: user D can read another learner''s concept state';
  end if;
  if exists (select 1 from public.user_word_knowledge) then
    raise exception 'FAIL: user D can read another learner''s word knowledge';
  end if;
  if exists (select 1 from public.learning_event_concepts) then
    raise exception 'FAIL: user D can read another learner''s event tags';
  end if;
end $$;

-- …and the owner can read their own, which the app needs for the profile view.
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', false); end $switch$;

do $$
begin
  if not exists (select 1 from public.learning_events) then
    raise exception 'FAIL: a learner cannot read their own learning history';
  end if;
  if not exists (select 1 from public.user_skill_state) then
    raise exception 'FAIL: a learner cannot read their own skill state';
  end if;
  if not exists (select 1 from public.review_events) then
    raise exception 'FAIL: a learner cannot read their own review history';
  end if;
end $$;

\echo '── L7. legacy attempts were backfilled, review history was not faked ───'

reset role;

-- A pre-Phase-2 attempt: recorded before test sessions existed, so it has no
-- session id — exactly the shape the migration has to cope with.
insert into public.attempts
  (user_id, question_id, text_id, is_correct, ability_before, ability_after, response_ms)
values ('44444444-4444-4444-4444-444444444444', 8902, 8900, false, 1000, 990, 5000);

-- The migration's backfill statement, verbatim. Running it here (rather than
-- relying on the copy that ran during the migration, before these fixtures
-- existed) is what makes the assertions below meaningful on both paths.
create or replace procedure pg_temp.backfill_attempts()
language sql as $$
  insert into public.learning_events (
    user_id, event_key, event_type, occurred_at, skill_code,
    response_mode, retrieval_type, is_correct, response_ms,
    source_kind, origin, text_id, question_id, test_session_id
  )
  select a.user_id, 'legacy-attempt:' || a.id, 'test_answer', a.created_at,
         'reading_comprehension', 'multiple_choice', 'recognition',
         a.is_correct, a.response_ms, 'reading_test', 'legacy_backfill',
         a.text_id, a.question_id, a.test_session_id
  from public.attempts a
  where not exists (
    select 1 from public.learning_events e
    where e.user_id = a.user_id and e.question_id = a.question_id
      and e.event_type = 'test_answer'
      and e.test_session_id is not distinct from a.test_session_id
  )
  on conflict (user_id, event_key) do nothing;
$$;

do $$
declare
  v_attempt bigint;
  v_before  int;
  v_after   int;
  v_reviews int;
begin
  select id into v_attempt from public.attempts
   where user_id = '44444444-4444-4444-4444-444444444444' and question_id = 8902;

  call pg_temp.backfill_attempts();

  -- The historical answer is now real evidence, labelled as reconstructed.
  if not exists (
    select 1 from public.learning_events
    where event_key = 'legacy-attempt:' || v_attempt
      and origin = 'legacy_backfill'
      and skill_code = 'reading_comprehension'
      and is_correct = false
  ) then
    raise exception 'FAIL: a historical attempt was not backfilled';
  end if;

  -- Every attempt is now covered, either natively or by the backfill.
  if exists (
    select 1 from public.attempts a
    where not exists (
      select 1 from public.learning_events e
      where e.user_id = a.user_id and e.question_id = a.question_id
        and e.event_type = 'test_answer'
        and e.test_session_id is not distinct from a.test_session_id
    )
  ) then
    raise exception 'FAIL: an attempt has no corresponding learning event';
  end if;

  -- An answer already recorded natively is never shadowed by a legacy copy.
  if (select count(*) from public.learning_events
       where user_id = '33333333-3333-3333-3333-333333333333'
         and question_id = 8901) <> 1 then
    raise exception 'FAIL: a natively recorded answer was duplicated by the backfill';
  end if;

  -- IDEMPOTENT: running it again changes nothing.
  select count(*) into v_before from public.learning_events;
  call pg_temp.backfill_attempts();
  select count(*) into v_after from public.learning_events;
  if v_after <> v_before then
    raise exception 'FAIL: re-running the backfill added % rows', v_after - v_before;
  end if;

  -- Review history is NOT reconstructed: `saved_words` keeps only the current
  -- SM-2 state, so inventing past reviews from `repetitions` would put fiction
  -- into the one table whose value is being trustworthy later.
  select count(*) into v_reviews from public.review_events where origin <> 'native';
  if v_reviews <> 0 then
    raise exception 'FAIL: % fabricated review events exist', v_reviews;
  end if;
end $$;

\echo '── L8. every item tag points at something real ─────────────────────────'

do $$
begin
  if exists (
    select 1 from public.questions q
    where not exists (select 1 from public.skills s where s.code = q.skill_code)
  ) then
    raise exception 'FAIL: a question points at a skill that does not exist';
  end if;

  -- Placement items keep their coarse skill AND gain the engine's code.
  if exists (
    select 1 from public.calibration_questions
    where skill is not null and skill_code is null
  ) then
    raise exception 'FAIL: a placement item was not mapped to a skill code';
  end if;
  if exists (
    select 1 from public.calibration_questions
    where skill = 'grammar' and skill_code <> 'grammar'
  ) then
    raise exception 'FAIL: a grammar placement item was mapped to the wrong skill';
  end if;
  -- Multiple choice is recognition whichever direction it is asked in, so a
  -- vocabulary placement item is receptive evidence, never active.
  if exists (
    select 1 from public.calibration_questions
    where skill = 'vocab' and skill_code <> 'receptive_vocabulary'
  ) then
    raise exception 'FAIL: a vocabulary placement item was mapped to active vocabulary';
  end if;
end $$;

\echo ''
\echo '✔ all learning-engine checks passed'
