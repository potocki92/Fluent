-- Fluent — Story Learning Engine: banks, keys, snapshots and privacy.
--
-- The rankings and the validation are unit-tested in TypeScript
-- (`src/lib/story/*.test.ts`). What CANNOT be tested there is everything this
-- file asserts: that a learner cannot read an answer key, that a private
-- import's question bank is invisible to everyone else, that a Challenge is a
-- snapshot the client cannot extend or reorder, that an answer is written once
-- and a finalize applies evidence once, that a sequence question's correct order
-- never leaves the database, that a reprocessed chapter's questions stop being
-- served, and that no table in this phase has a client write path at all.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Runs after 04, which already processed chapter 8c…001 and had reader A finish
-- it. Fixtures here use the 9xxx id range and the 9a…/9c… uuid space.

\set ON_ERROR_STOP on

\set READER_A '''77777777-7777-7777-7777-777777777777'''
\set READER_B '''88888888-8888-8888-8888-888888888888'''

\echo '── S0. story fixtures ──────────────────────────────────────────────────'

-- A validated bank for the PUBLIC chapter reader A finished in suite 04, plus
-- one question for the PRIVATE chapter, which is the row every privacy
-- assertion below hangs off.
set role service_role;

do $$
declare
  v_sentences bigint[];
  v_written   int;
begin
  select array_agg(s.id order by s.chapter_position)
    into v_sentences
  from public.sentences s
  where s.chapter_id = '8c000000-0000-0000-0000-000000000001';

  if coalesce(array_length(v_sentences, 1), 0) < 2 then
    raise exception 'FIXTURE: chapter 8c…001 has no sentences; suite 04 must run first';
  end if;

  select public.upsert_chapter_questions(
    '8c000000-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'comprehension', 'question_type', 'multiple_choice', 'scope', 'local',
        'prompt', 'Co zrobil bohater?',
        'options', jsonb_build_array('Wyciagnal miecz', 'Zasnal', 'Wyszedl'),
        'correct_idx', 0,
        'skill_code', 'reading_comprehension',
        'concept_codes', jsonb_build_array('detail'),
        'source_sentence_ids', jsonb_build_array(v_sentences[1]),
        'fingerprint', 'fp-comp-1',
        'status', 'published'
      ),
      jsonb_build_object(
        'kind', 'comprehension', 'question_type', 'multiple_choice', 'scope', 'local',
        'prompt', 'Jaki byl piwnica?',
        'options', jsonb_build_array('Ciemna', 'Jasna', 'Pusta'),
        'correct_idx', 0,
        'skill_code', 'reading_comprehension',
        'concept_codes', jsonb_build_array('detail'),
        'source_sentence_ids', jsonb_build_array(v_sentences[2]),
        'fingerprint', 'fp-comp-2',
        'status', 'published'
      ),
      jsonb_build_object(
        'kind', 'contextual_vocabulary', 'question_type', 'cloze', 'scope', 'local',
        'prompt', 'Er ___ sein Schwert.',
        'accepted_answers', jsonb_build_array('zog', 'zieht'),
        'skill_code', 'active_vocabulary',
        'concept_codes', jsonb_build_array('lexical_recall'),
        'word_id', 8801,
        'source_sentence_ids', jsonb_build_array(v_sentences[1]),
        'fingerprint', 'fp-cloze-1',
        'status', 'published'
      ),
      jsonb_build_object(
        'kind', 'comprehension', 'question_type', 'sequence', 'scope', 'chapter',
        'prompt', 'Ulozy wydarzenia w kolejnosci.',
        'sequence_items', jsonb_build_array('Wyciagnal miecz', 'Wszedl do piwnicy', 'Znalazl klucz'),
        'skill_code', 'reading_comprehension',
        'concept_codes', jsonb_build_array('sequence'),
        'source_sentence_ids', jsonb_build_array(v_sentences[1], v_sentences[2]),
        'fingerprint', 'fp-seq-1',
        'status', 'published'
      )
    ),
    jsonb_build_object('generation_source', 'ai', 'generator_version', 'storygen_v1',
                       'provider', 'test-provider', 'model', 'test-model')
  ) into v_written;

  if v_written <> 4 then
    raise exception 'FAIL: expected 4 questions written, got %', v_written;
  end if;
end $$;

-- The private chapter needs content before it can carry a grounded question.
do $$
declare
  v_sentence bigint;
begin
  perform public.replace_chapter_content(
    '8c000000-0000-0000-0000-000000000003',
    jsonb_build_object(
      'processor_version', 'content_v1',
      'content_hash', 'private-hash-1',
      'word_count', 3, 'paragraph_count', 1, 'sentence_count', 1,
      'estimated_reading_minutes', 1, 'dictionary_match_rate', 0,
      'unmatched_sample', '[]'::jsonb, 'vocabulary_stats', '{}'::jsonb,
      'paragraphs', jsonb_build_array(
        jsonb_build_object(
          'position', 0, 'kind', 'paragraph', 'text', 'Ein privates Kapitel.', 'word_count', 3,
          'sentences', jsonb_build_array(jsonb_build_object(
            'position', 0, 'chapter_position', 0, 'text', 'Ein privates Kapitel.',
            'char_start', 0, 'char_end', 21, 'word_count', 3,
            'occurrences', '[]'::jsonb
          ))
        )
      ),
      'vocabulary', '[]'::jsonb
    )
  );

  select s.id into v_sentence
  from public.sentences s where s.chapter_id = '8c000000-0000-0000-0000-000000000003'
  limit 1;

  perform public.upsert_chapter_questions(
    '8c000000-0000-0000-0000-000000000003',
    jsonb_build_array(jsonb_build_object(
      'kind', 'comprehension', 'question_type', 'multiple_choice', 'scope', 'local',
      'prompt', 'Prywatne pytanie.',
      'options', jsonb_build_array('Tak', 'Nie', 'Moze'),
      'correct_idx', 1,
      'skill_code', 'reading_comprehension',
      'concept_codes', jsonb_build_array('detail'),
      'source_sentence_ids', jsonb_build_array(v_sentence),
      'fingerprint', 'fp-private-1',
      'status', 'published'
    )),
    jsonb_build_object('generation_source', 'manual')
  );
end $$;

reset role;

-- The question ids, captured here as a SUPERUSER into a temp table every role
-- may read. The learner-role blocks below cannot look an id up for themselves —
-- `chapter_questions` is unreadable to them, which is precisely the property S2
-- exists to assert — so nothing in this file may depend on doing so.
create temporary table story_ids (name text primary key, id bigint not null);
grant select on story_ids to public;

insert into story_ids (name, id)
select f.name, q.id
from public.chapter_questions q
join (values
  ('fp-comp-1', 'comp1'), ('fp-comp-2', 'comp2'), ('fp-cloze-1', 'cloze1'),
  ('fp-seq-1', 'seq1'), ('fp-private-1', 'private1')
) as f(fingerprint, name) on f.fingerprint = q.fingerprint;

\echo '── S1. ownership is DERIVED, never claimed ─────────────────────────────'

do $$
begin
  -- A question generated from a private import belongs to its owner, because
  -- `upsert_chapter_questions` reads the owner off the item rather than taking
  -- it from the caller. Nothing can publish someone else's book by asking to.
  if (select owner_user_id from public.chapter_questions where fingerprint = 'fp-private-1')
     is distinct from '77777777-7777-7777-7777-777777777777' then
    raise exception 'FAIL: a private import''s question did not inherit its owner';
  end if;

  if (select owner_user_id from public.chapter_questions where fingerprint = 'fp-comp-1')
     is not null then
    raise exception 'FAIL: a public question acquired an owner';
  end if;
end $$;

\echo '── S2. THE ANSWER ORACLE STAYS CLOSED ──────────────────────────────────'

set role authenticated;
set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777"}';

do $$
begin
  -- No learner select policy at all — not even for the owner of the private
  -- book these questions were generated from. `correct_idx`, `accepted_answers`
  -- and `sequence_items` are the answer key of every Challenge they are about
  -- to take.
  if (select count(*) from public.chapter_questions) <> 0 then
    raise exception 'FAIL: a learner can read the question bank';
  end if;
  if (select count(*) from public.chapter_question_concepts) <> 0 then
    raise exception 'FAIL: a learner can read question tags directly';
  end if;
  if (select count(*) from public.chapter_question_stats) <> 0 then
    raise exception 'FAIL: a learner can read global question statistics';
  end if;
end $$;

-- A learner cannot author, publish or re-tag the bank either.
do $$
begin
  begin
    perform public.upsert_chapter_questions(
      '8c000000-0000-0000-0000-000000000001', '[]'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL: a learner could write the question bank';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

do $$
begin
  begin
    insert into public.chapter_questions (
      chapter_id, library_item_id, kind, question_type, prompt,
      options, correct_idx, skill_code, fingerprint
    ) values (
      '8c000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001',
      'comprehension', 'multiple_choice', 'Podstawione pytanie',
      array['a', 'b'], 0, 'reading_comprehension', 'fp-smuggled'
    );
    raise exception 'FAIL: a learner inserted into the question bank';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S3. private banks are invisible to everyone else ────────────────────'

set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888"}';

do $$
declare
  v_count int;
begin
  -- Reader B may take the public chapter's Challenge…
  select count(*) into v_count
  from public.get_chapter_question_candidates('8c000000-0000-0000-0000-000000000001');
  if v_count <> 4 then
    raise exception 'FAIL: expected 4 public candidates, got %', v_count;
  end if;

  -- …and may not so much as ask about reader A's private book.
  begin
    perform public.get_chapter_question_candidates('8c000000-0000-0000-0000-000000000003');
    raise exception 'FAIL: reader B reached a private import''s question bank';
  exception
    when sqlstate 'FL403' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S4. the candidate pool leaks nothing and hides stale questions ──────'

set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777"}';

do $$
declare
  v_row record;
begin
  -- The selection ranking runs on metadata only: no prompt, no options, no key.
  -- The whole personalisation layer therefore reads data a learner could see
  -- without learning anything.
  select * into v_row
  from public.get_chapter_question_candidates('8c000000-0000-0000-0000-000000000001')
  where question_id = (select id from story_ids where name = 'cloze1');

  if v_row.kind <> 'contextual_vocabulary' or v_row.word_id <> 8801 then
    raise exception 'FAIL: candidate metadata is wrong';
  end if;
  if v_row.concept_codes <> array['lexical_recall'] then
    raise exception 'FAIL: candidate concepts are wrong: %', v_row.concept_codes;
  end if;
  if v_row.last_answered_at is not null then
    raise exception 'FAIL: an unanswered question reported a last answer';
  end if;
end $$;

\echo '── S5. a Challenge is a server-owned snapshot ──────────────────────────'

set role service_role;

do $$
declare
  v_ids     bigint[];
  v_session uuid;
  v_again   uuid;
  v_items   int;
begin
  select array_agg(q.id order by q.id) into v_ids
  from public.chapter_questions q
  where q.chapter_id = '8c000000-0000-0000-0000-000000000001';

  v_session := public.start_chapter_assessment(
    '77777777-7777-7777-7777-777777777777',
    '8c000000-0000-0000-0000-000000000001',
    v_ids,
    jsonb_build_object('comprehension', 2, 'contextual_vocabulary', 1, 'transfer', 0),
    '{}'::jsonb
  );

  select count(*) into v_items
  from public.chapter_assessment_items where session_id = v_session;
  if v_items <> 4 then
    raise exception 'FAIL: snapshot has % items, expected 4', v_items;
  end if;

  -- Re-entering RESUMES rather than reshuffling: someone who closed the tab
  -- mid-Challenge comes back to the same questions, not to easier ones.
  v_again := public.start_chapter_assessment(
    '77777777-7777-7777-7777-777777777777',
    '8c000000-0000-0000-0000-000000000001',
    v_ids, '{}'::jsonb, '{}'::jsonb
  );
  if v_again <> v_session then
    raise exception 'FAIL: a second start created a second Challenge';
  end if;

  -- The shuffle for the sequence question exists and is a real permutation.
  if (select presented_order from public.chapter_assessment_items
      where session_id = v_session and question_type = 'sequence') is null then
    raise exception 'FAIL: a sequence question was snapshotted without a shuffle';
  end if;
end $$;

-- A Challenge may not be offered for a chapter that was never finished.
do $$
begin
  begin
    perform public.start_chapter_assessment(
      '88888888-8888-8888-8888-888888888888',
      '8c000000-0000-0000-0000-000000000002',
      array[(select id from story_ids where name = 'comp1')],
      '{}'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL: a Challenge was offered before the chapter was read';
  exception
    when sqlstate 'FL409' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

reset role;

\echo '── S6. the session belongs to its learner, and only to them ────────────'

set role authenticated;
set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888"}';

do $$
declare
  v_session uuid;
begin
  select id into v_session from public.chapter_assessment_sessions
  where user_id = '77777777-7777-7777-7777-777777777777' and status = 'in_progress';

  begin
    perform public.get_chapter_assessment(v_session);
    raise exception 'FAIL: reader B read reader A''s Challenge';
  exception
    when sqlstate 'FL403' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    perform public.answer_chapter_assessment_question(
      v_session,
      (select id from story_ids where name = 'comp1'),
      0, null, null, 1000
    );
    raise exception 'FAIL: reader B answered reader A''s Challenge';
  exception
    when sqlstate 'FL403' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  if (select count(*) from public.chapter_assessment_sessions) <> 0 then
    raise exception 'FAIL: reader B can see reader A''s Challenge rows';
  end if;
end $$;

\echo '── S7. grading, and the key that arrives only after the answer ─────────'

set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777"}';

do $$
declare
  v_session uuid;
  v_q       bigint;
  v_row     record;
  v_seq     int[];
  v_answer  int[];
begin
  select id into v_session from public.chapter_assessment_sessions
  where user_id = '77777777-7777-7777-7777-777777777777' and status = 'in_progress';

  -- Before answering, the snapshot hands over prompts and options — and the
  -- explanation is withheld, because an explanation is a hint.
  select * into v_row from public.get_chapter_assessment(v_session)
  where question_type = 'sequence';
  if v_row.sequence_items is null or array_length(v_row.sequence_items, 1) <> 3 then
    raise exception 'FAIL: a sequence question was presented without its items';
  end if;

  -- A question that is not in the snapshot cannot be answered into it.
  begin
    perform public.answer_chapter_assessment_question(
      v_session,
      (select id from story_ids where name = 'private1'),
      0, null, null, 500
    );
    raise exception 'FAIL: a foreign question was answered into this Challenge';
  exception
    when sqlstate 'FL410' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- Multiple choice.
  select id into v_q from story_ids where name = 'comp1';
  select * into v_row from public.answer_chapter_assessment_question(
    v_session, v_q, 0, null, null, 1200
  );
  if not v_row.is_answer_correct or v_row.already_answered then
    raise exception 'FAIL: a correct multiple-choice answer was not graded correct';
  end if;

  -- ANSWERED ONCE. A replayed request returns the stored result and changes
  -- nothing — the first answer wins, as everywhere else in Fluent.
  select * into v_row from public.answer_chapter_assessment_question(
    v_session, v_q, 1, null, null, 50
  );
  if not v_row.already_answered or not v_row.is_answer_correct then
    raise exception 'FAIL: a question was re-answered';
  end if;

  select id into v_q from story_ids where name = 'comp2';
  select * into v_row from public.answer_chapter_assessment_question(
    v_session, v_q, 2, null, null, 900
  );
  if v_row.is_answer_correct then
    raise exception 'FAIL: a wrong answer was graded correct';
  end if;

  -- Cloze: case, spacing and a leading article are forgiven…
  select id into v_q from story_ids where name = 'cloze1';
  select * into v_row from public.answer_chapter_assessment_question(
    v_session, v_q, null, '  Zog ', null, 3000
  );
  if not v_row.is_answer_correct then
    raise exception 'FAIL: a typed answer was rejected over case and spacing';
  end if;

  -- Sequence: the learner submits PRESENTED positions, and grading maps them
  -- back through the shuffle. Building the right answer requires knowing the
  -- permutation, which is precisely what never reaches the client.
  select presented_order into v_seq from public.chapter_assessment_items
  where session_id = v_session and question_type = 'sequence';

  select array_agg(pos order by target) into v_answer
  from (
    select t.ord - 1 as pos, t.o as target
    from unnest(v_seq) with ordinality as t(o, ord)
  ) mapped;

  select id into v_q from story_ids where name = 'seq1';
  select * into v_row from public.answer_chapter_assessment_question(
    v_session, v_q, null, null, v_answer, 8000
  );
  if not v_row.is_answer_correct then
    raise exception 'FAIL: a correctly ordered sequence was graded wrong';
  end if;
end $$;

reset role;

do $$
declare
  v_stats record;
begin
  -- Global statistics accumulated, for a later empirical calibration. Nothing
  -- reads them to change a difficulty today, and no learner ever sees them.
  select * into v_stats from public.chapter_question_stats
  where question_id = (select id from story_ids where name = 'comp1');
  if v_stats.answer_count <> 1 or v_stats.correct_count <> 1 then
    raise exception 'FAIL: question statistics did not accumulate';
  end if;
end $$;

\echo '── S8. finalize is atomic, gated and idempotent ────────────────────────'

set role service_role;

do $$
declare
  v_session uuid;
  v_row     record;
  v_events  int;
  v_word    bigint;
begin
  select id into v_session from public.chapter_assessment_sessions
  where user_id = '77777777-7777-7777-7777-777777777777' and status = 'in_progress';

  select * into v_row from public.finalize_chapter_assessment(
    v_session,
    '77777777-7777-7777-7777-777777777777',
    jsonb_build_object(
      'events', jsonb_build_array(jsonb_build_object(
        'event_key', 'chapter-challenge:' || v_session || ':test',
        'event_type', 'chapter_assessment_answer',
        'occurred_at', now(),
        'skill_code', 'reading_comprehension',
        'response_mode', 'multiple_choice',
        'retrieval_type', 'recognition',
        'is_correct', true,
        'source_kind', 'story',
        'chapter_id', '8c000000-0000-0000-0000-000000000001',
        'library_item_id', '8a000000-0000-0000-0000-000000000001',
        'concepts', jsonb_build_array('detail')
      )),
      'skills', '[]'::jsonb, 'concepts', '[]'::jsonb, 'words', '[]'::jsonb
    ),
    jsonb_build_object(
      'comprehension_correct', 2, 'comprehension_total', 3,
      'vocabulary_correct', 1, 'vocabulary_total', 1
    )
  );

  if v_row.already_finalized or v_row.total_count <> 4 or v_row.correct_count <> 3 then
    raise exception 'FAIL: Challenge scored %/% (already: %)',
      v_row.correct_count, v_row.total_count, v_row.already_finalized;
  end if;

  select count(*) into v_events from public.learning_events
  where user_id = '77777777-7777-7777-7777-777777777777'
    and event_type = 'chapter_assessment_answer';
  if v_events <> 1 then
    raise exception 'FAIL: expected 1 Challenge event, got %', v_events;
  end if;

  -- FINALIZED ONCE. A retried request returns the stored result and applies no
  -- evidence a second time — the same guarantee `finalize_test_session` gives.
  select * into v_row from public.finalize_chapter_assessment(
    v_session, '77777777-7777-7777-7777-777777777777', '{}'::jsonb, '{}'::jsonb
  );
  if not v_row.already_finalized then
    raise exception 'FAIL: a Challenge was finalized twice';
  end if;

  select count(*) into v_events from public.learning_events
  where user_id = '77777777-7777-7777-7777-777777777777'
    and event_type = 'chapter_assessment_answer';
  if v_events <> 1 then
    raise exception 'FAIL: re-finalizing applied evidence again (% events)', v_events;
  end if;

  -- The lifecycle advanced in the SAME transaction, so the plan and the
  -- Challenge can never disagree about whether it was done.
  if (select status from public.user_chapter_learning_state
      where user_id = '77777777-7777-7777-7777-777777777777'
        and chapter_id = '8c000000-0000-0000-0000-000000000001') <> 'completed' then
    raise exception 'FAIL: finishing a Challenge did not complete the lifecycle';
  end if;

  -- Sanity: nothing here touched a word that was not tested.
  select count(*) into v_word from public.user_word_knowledge
  where user_id = '77777777-7777-7777-7777-777777777777' and word_id = 8803;
  if v_word <> 0 then
    raise exception 'FAIL: an untested word acquired knowledge from a Challenge';
  end if;
end $$;

-- An unfinished Challenge cannot be sealed.
do $$
declare
  v_session uuid;
begin
  v_session := public.start_chapter_assessment(
    '77777777-7777-7777-7777-777777777777',
    '8c000000-0000-0000-0000-000000000001',
    array[(select id from story_ids where name = 'comp1')],
    '{}'::jsonb, '{}'::jsonb
  );

  begin
    perform public.finalize_chapter_assessment(
      v_session, '77777777-7777-7777-7777-777777777777', '{}'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL: an unanswered Challenge was finalized';
  exception
    when sqlstate 'FL412' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- …and it cannot be sealed on someone else's behalf either.
  begin
    perform public.finalize_chapter_assessment(
      v_session, '88888888-8888-8888-8888-888888888888', '{}'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL: a Challenge was finalized by the wrong learner';
  exception
    when sqlstate 'FL403' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  update public.chapter_assessment_sessions set status = 'abandoned' where id = v_session;
end $$;

reset role;

\echo '── S9. preparation: a stable snapshot the learner may walk away from ───'

set role service_role;

do $$
declare
  v_session uuid;
  v_again   uuid;
  v_items   jsonb := jsonb_build_array(
    jsonb_build_object(
      'word_id', 8801, 'lemma', 'Schwert', 'display', 'das Schwert', 'translation', 'miecz',
      'options', jsonb_build_array('miecz', 'piwnica', 'klucz', 'dom'), 'correct_idx', 0,
      'context_sentence', 'Er zog sein Schwert.', 'context_source', 'chapter_opening'
    ),
    jsonb_build_object(
      'word_id', 8802, 'lemma', 'Keller', 'display', 'der Keller', 'translation', 'piwnica',
      'options', jsonb_build_array('miecz', 'piwnica', 'klucz', 'dom'), 'correct_idx', 1,
      'context_source', 'none'
    )
  );
begin
  v_session := public.start_chapter_preparation(
    '88888888-8888-8888-8888-888888888888',
    '8c000000-0000-0000-0000-000000000002',
    v_items
  );

  -- THE SNAPSHOT IS STABLE. Re-entering returns the same session with the same
  -- words, even when the caller offers a different list: a task that rewrites
  -- itself halfway through is not a task.
  v_again := public.start_chapter_preparation(
    '88888888-8888-8888-8888-888888888888',
    '8c000000-0000-0000-0000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'word_id', 8803, 'lemma', 'Schlüssel', 'display', 'der Schlüssel', 'translation', 'klucz',
      'options', jsonb_build_array('klucz', 'miecz'), 'correct_idx', 0,
      'context_source', 'none'
    ))
  );
  if v_again <> v_session then
    raise exception 'FAIL: a second preparation session was created';
  end if;
  if (select count(*) from public.chapter_preparation_items where session_id = v_session) <> 2 then
    raise exception 'FAIL: the preparation snapshot changed underneath the learner';
  end if;

  -- Starting preparation puts the chapter in the lifecycle without claiming
  -- anything about reading it.
  if (select status from public.user_chapter_learning_state
      where user_id = '88888888-8888-8888-8888-888888888888'
        and chapter_id = '8c000000-0000-0000-0000-000000000002') <> 'prepared' then
    raise exception 'FAIL: preparation did not advance the lifecycle';
  end if;
end $$;

reset role;

set role authenticated;
set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888"}';

do $$
declare
  v_session uuid;
  v_row     record;
begin
  select id into v_session from public.chapter_preparation_sessions
  where user_id = '88888888-8888-8888-8888-888888888888' and status = 'in_progress';

  select * into v_row from public.answer_preparation_item(v_session, 8801, 0, 2000);
  if not v_row.is_answer_correct or v_row.already_answered then
    raise exception 'FAIL: a correct preparation answer was not graded correct';
  end if;

  select * into v_row from public.answer_preparation_item(v_session, 8801, 1, 10);
  if not v_row.already_answered or not v_row.is_answer_correct then
    raise exception 'FAIL: a preparation card was re-answered';
  end if;

  -- A word outside the snapshot cannot be answered into it.
  begin
    perform public.answer_preparation_item(v_session, 8803, 0, 100);
    raise exception 'FAIL: a foreign word was answered into a preparation';
  exception
    when sqlstate 'FL410' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S10. skipping preparation is allowed, and recorded ──────────────────'

do $$
declare
  v_status text;
begin
  v_status := public.skip_chapter_preparation('8c000000-0000-0000-0000-000000000002');

  if (select status from public.chapter_preparation_sessions
      where user_id = '88888888-8888-8888-8888-888888888888'
        and chapter_id = '8c000000-0000-0000-0000-000000000002') <> 'skipped' then
    raise exception 'FAIL: skipping did not close the preparation session';
  end if;
  if (select preparation_skipped_at from public.user_chapter_learning_state
      where user_id = '88888888-8888-8888-8888-888888888888'
        and chapter_id = '8c000000-0000-0000-0000-000000000002') is null then
    raise exception 'FAIL: a skip was not recorded';
  end if;
end $$;

\echo '── S11. the lifecycle is measured, never asserted ──────────────────────'

do $$
begin
  -- There is no "mark this read" endpoint: the lifecycle only advances if the
  -- reading table, which itself refuses below the completion threshold, says the
  -- chapter was finished.
  begin
    perform public.mark_chapter_reading_completed('8c000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: a chapter was marked read without being read';
  exception
    when sqlstate 'FL409' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- Deferring a Challenge is likewise only possible for a chapter that was read.
  begin
    perform public.defer_chapter_assessment('8c000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: a Challenge was deferred for an unread chapter';
  exception
    when sqlstate 'FL409' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S12. no table in this phase has a client write path ─────────────────'

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'user_chapter_learning_state', 'chapter_user_analysis', 'chapter_questions',
    'chapter_question_concepts', 'chapter_question_stats',
    'chapter_generation_jobs', 'chapter_preparation_sessions',
    'chapter_preparation_items', 'chapter_assessment_sessions',
    'chapter_assessment_items'
  ]
  loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_table and cmd <> 'SELECT'
    ) then
      raise exception 'FAIL: % has a write policy', v_table;
    end if;
  end loop;
end $$;

-- Progress is server-owned: a learner cannot write their own Challenge result.
do $$
begin
  begin
    update public.chapter_assessment_sessions set correct = 99
    where user_id = '77777777-7777-7777-7777-777777777777';
    if found then
      raise exception 'FAIL: a learner rewrote their own Challenge result';
    end if;
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    insert into public.user_chapter_learning_state (user_id, chapter_id, library_item_id, status)
    values ('88888888-8888-8888-8888-888888888888',
            '8c000000-0000-0000-0000-000000000002',
            '8a000000-0000-0000-0000-000000000001', 'completed');
    raise exception 'FAIL: a learner asserted their own chapter completion';
  exception
    when insufficient_privilege then null;
    when unique_violation then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S13. reporting a bad question ───────────────────────────────────────'

do $$
declare
  v_q bigint := (select id from story_ids where name = 'comp2');
begin
  perform public.report_chapter_question(v_q, 'ambiguous', 'Dwie odpowiedzi pasuja.');
  -- One report per learner per question: a report is a signal, not a vote.
  perform public.report_chapter_question(v_q, 'wrong_answer', null);

  if (select count(*) from public.chapter_question_reports where question_id = v_q) <> 1 then
    raise exception 'FAIL: reporting twice created two rows';
  end if;

  begin
    perform public.report_chapter_question(v_q, 'because_i_said_so', null);
    raise exception 'FAIL: an unknown report reason was accepted';
  exception
    when sqlstate 'FL422' then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S14. generated assets know what they were made from ─────────────────'

reset role;
set role service_role;

do $$
declare
  v_written int;
  v_stale   int;
  v_count   int;
begin
  -- IDEMPOTENT GENERATION: re-running over an unchanged chapter adds nothing.
  select count(*) into v_count from public.chapter_questions
  where chapter_id = '8c000000-0000-0000-0000-000000000001';

  select public.upsert_chapter_questions(
    '8c000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'kind', 'comprehension', 'question_type', 'multiple_choice', 'scope', 'local',
      'prompt', 'Co zrobil bohater?',
      'options', jsonb_build_array('Wyciagnal miecz', 'Zasnal', 'Wyszedl'),
      'correct_idx', 0,
      'skill_code', 'reading_comprehension',
      'concept_codes', jsonb_build_array('detail'),
      'source_sentence_ids', jsonb_build_array(
        (select id from public.sentences where chapter_id = '8c000000-0000-0000-0000-000000000001'
         order by chapter_position limit 1)
      ),
      'fingerprint', 'fp-comp-1',
      'status', 'published'
    )),
    jsonb_build_object('generation_source', 'ai', 'generator_version', 'storygen_v1')
  ) into v_written;

  if (select count(*) from public.chapter_questions
      where chapter_id = '8c000000-0000-0000-0000-000000000001') <> v_count then
    raise exception 'FAIL: re-running generation duplicated the bank';
  end if;

  -- A REPROCESSED CHAPTER INVALIDATES ITS OWN QUESTIONS. They are marked stale
  -- rather than deleted: most of them are probably still fine, and deleting
  -- would take the answering history of everyone who took the Challenge with it.
  update public.chapters set content_hash = 'hash-2'
  where id = '8c000000-0000-0000-0000-000000000001';

  select public.mark_stale_chapter_questions('8c000000-0000-0000-0000-000000000001')
    into v_stale;
  if v_stale < 4 then
    raise exception 'FAIL: only % questions went stale after a reprocess', v_stale;
  end if;
end $$;

reset role;
set role authenticated;
set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777"}';

do $$
begin
  -- Stale questions stop being served, rather than quietly asking about a
  -- paragraph that may have been edited away.
  if (select count(*) from public.get_chapter_question_candidates(
        '8c000000-0000-0000-0000-000000000001')) <> 0 then
    raise exception 'FAIL: a stale question was still offered to a learner';
  end if;
end $$;

\echo '── S15. the answer-shape constraint refuses an ungradable question ─────'

reset role;
set role service_role;

do $$
begin
  begin
    insert into public.chapter_questions (
      chapter_id, library_item_id, kind, question_type, prompt,
      options, correct_idx, skill_code, fingerprint
    ) values (
      '8c000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001',
      'comprehension', 'multiple_choice', 'Pytanie bez klucza',
      array['a', 'b'], null, 'reading_comprehension', 'fp-broken-1'
    );
    raise exception 'FAIL: a multiple-choice question with no answer key was stored';
  exception
    when check_violation then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    insert into public.chapter_questions (
      chapter_id, library_item_id, kind, question_type, prompt,
      accepted_answers, skill_code, fingerprint
    ) values (
      '8c000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001',
      'transfer', 'cloze', 'Er ___ das Buch.',
      null, 'grammar', 'fp-broken-2'
    );
    raise exception 'FAIL: a cloze with no accepted answer was stored';
  exception
    when check_violation then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

\echo '── S16. fold_typed_answer matches its TypeScript twin ──────────────────'

do $$
begin
  if public.fold_typed_answer('  Das Schwert ') <> 'schwert' then
    raise exception 'FAIL: article and case folding differ from TypeScript';
  end if;
  if public.fold_typed_answer('Schwert.') <> 'schwert' then
    raise exception 'FAIL: trailing punctuation was not folded';
  end if;
  -- Diacritics are NOT folded: schon and schön are different words, and
  -- accepting either would be grading German by ignoring German.
  if public.fold_typed_answer('schön') = public.fold_typed_answer('schon') then
    raise exception 'FAIL: umlauts were folded away';
  end if;
end $$;

\echo '── S17. generation jobs are retryable and never log content ────────────'

do $$
declare
  v_job   uuid;
  v_again uuid;
begin
  v_job := public.start_chapter_generation_job(
    '8c000000-0000-0000-0000-000000000001', 'storygen_v1'
  );

  -- Retry is idempotent: a double-clicked button lands on the same job with one
  -- more attempt recorded, not on a second concurrent generation.
  v_again := public.start_chapter_generation_job(
    '8c000000-0000-0000-0000-000000000001', 'storygen_v1'
  );
  if v_again <> v_job then
    raise exception 'FAIL: a second generation job was started concurrently';
  end if;
  if (select attempts from public.chapter_generation_jobs where id = v_job) <> 2 then
    raise exception 'FAIL: the retry was not counted';
  end if;

  perform public.finish_chapter_generation_job(
    v_job, 'failed',
    jsonb_build_object(
      'error_code', 'provider_error',
      'error_message', 'upstream refused',
      'provider', 'test-provider', 'model', 'test-model',
      'input_tokens', 1200, 'output_tokens', 300, 'cost_usd', 0.004,
      'candidate_count', 8, 'accepted_count', 0, 'rejected_count', 8
    )
  );

  if (select status from public.chapter_generation_jobs where id = v_job) <> 'failed' then
    raise exception 'FAIL: a finished job kept its running status';
  end if;

  -- The unique index is partial, so a failed job does not block the next attempt.
  v_again := public.start_chapter_generation_job(
    '8c000000-0000-0000-0000-000000000001', 'storygen_v1'
  );
  if v_again = v_job then
    raise exception 'FAIL: a failed job was resumed instead of retried';
  end if;
  perform public.finish_chapter_generation_job(v_again, 'ready', '{}'::jsonb);
end $$;

reset role;
reset request.jwt.claims;

\echo ''
\echo '✔ all story-engine checks passed'
