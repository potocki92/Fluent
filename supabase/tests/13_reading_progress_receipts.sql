-- Fluent — reading progress receipts and ordering.
--
-- WHAT THIS SUITE IS ABOUT. `active_seconds` is an INCREMENT
-- (`p.active_seconds + v_seconds`), and until now there was nothing to
-- recognise a report by. That gave the reader two options and no good one:
-- drop the seconds when a write fails (what it did — twenty minutes of reading
-- over a flaky connection recorded four), or keep them and retry, which
-- double-counts, because a request that reached the database and whose RESPONSE
-- was lost looks, from the browser, exactly like one that never arrived.
--
-- `resume_*` had the matching problem in the other direction. It is a bookmark,
-- written as given rather than with `greatest(...)`, so a slow report landing
-- after a faster one rewound the learner's place.
--
-- Neither is reachable from a TypeScript test: both are about what the database
-- does when the same report, or an out-of-order one, arrives twice.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use the 5eed… uuid space so they cannot collide with earlier suites.

\set ON_ERROR_STOP on

\echo '── R0. a chapter, a learner, and a reading session ─────────────────────'

insert into auth.users (id, email) values
  ('5eed0000-0000-4000-8000-000000000001', 'receipt-reader@example.test');

insert into public.library_items (id, slug, title, content_type, rights, status, published_at)
  values ('5eed1111-0000-0000-0000-000000000001', 'receipt-book', 'Quittung',
          'story', 'first_party', 'published', now());

insert into public.chapters
  (id, library_item_id, position, title, source_text, status,
   paragraph_count, word_count, reading_word_count)
  values ('5eed2222-0000-0000-0000-000000000001',
          '5eed1111-0000-0000-0000-000000000001',
          1, 'Kapitel 1',
          'Erster Absatz mit vier Wörtern.' || E'\n\n' || 'Zweiter Absatz ebenfalls.',
          'ready', 2, 8, 8);

\echo '── R1. the same report, sent twice, is counted once ────────────────────'

do $$
declare
  v_session uuid;
  v_start   record;
  v_first   record;
  v_second  record;
  v_report  uuid := '5eed9999-0000-4000-8000-00000000000a';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5eed0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select * into v_start
    from public.start_reading_session('5eed2222-0000-0000-0000-000000000001');
  v_session := v_start.session_id;

  select active_seconds, applied into v_first
    from public.record_reading_progress(
      v_session, 0, 0, 0, 0, 0, 0, 60, 300, v_report, 1);

  -- The request landed; the response did not. The browser retries the SAME
  -- report, which is the whole reason it is allowed to keep its seconds.
  select active_seconds, applied into v_second
    from public.record_reading_progress(
      v_session, 0, 0, 0, 0, 0, 0, 60, 300, v_report, 1);

  if not v_first.applied then
    raise exception 'FAIL: the first report reported itself as already applied';
  end if;
  if v_second.applied then
    raise exception 'FAIL: a repeated report claimed to have been applied again';
  end if;
  if v_first.active_seconds <> 60 then
    raise exception 'FAIL: the first report recorded % seconds (expected 60)',
      v_first.active_seconds;
  end if;
  -- THE REGRESSION. Without the receipt this reads 120: one minute of reading
  -- recorded as two.
  if v_second.active_seconds <> 60 then
    raise exception 'FAIL: a retried report double-counted to % seconds',
      v_second.active_seconds;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── R2. a genuinely new report still adds its seconds ───────────────────'

do $$
declare
  v_session uuid;
  v_row     record;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5eed0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select session_id into v_session
    from public.start_reading_session('5eed2222-0000-0000-0000-000000000001');

  select active_seconds, applied into v_row
    from public.record_reading_progress(
      v_session, 0, 0, 0, 0, 0, 0, 15, 300,
      '5eed9999-0000-4000-8000-00000000000b', 2);

  if not v_row.applied then
    raise exception 'FAIL: a new report was mistaken for a repeat';
  end if;
  if v_row.active_seconds <> 75 then
    raise exception 'FAIL: the second report brought the total to % (expected 75)',
      v_row.active_seconds;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── R3. a late report does not rewind the bookmark ──────────────────────'

do $$
declare
  v_session uuid;
  v_resume  int;
  v_seconds int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5eed0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select session_id into v_session
    from public.start_reading_session('5eed2222-0000-0000-0000-000000000001');

  -- The learner reads on to paragraph 1. Report 5 lands.
  perform public.record_reading_progress(
    v_session, 1, 0, 0, 1, 0, 0, 10, 300,
    '5eed9999-0000-4000-8000-00000000000c', 5);

  -- Report 4 — issued EARLIER, from paragraph 0 — arrives now, having taken
  -- the slow path. Its seconds are real; its bookmark is history.
  select active_seconds into v_seconds
    from public.record_reading_progress(
      v_session, 0, 0, 0, 0, 0, 0, 7, 300,
      '5eed9999-0000-4000-8000-00000000000d', 4);

  select resume_paragraph_position into v_resume
    from public.reading_progress
   where user_id = '5eed0000-0000-4000-8000-000000000001'
     and chapter_id = '5eed2222-0000-0000-0000-000000000001';

  -- THE REGRESSION. `resume_*` is written as given, so the out-of-order report
  -- used to send the learner back to paragraph 0 on their next visit.
  if v_resume <> 1 then
    raise exception 'FAIL: a late report rewound the bookmark to paragraph %', v_resume;
  end if;
  -- But the time it measured is still time they spent reading.
  if v_seconds <> 92 then
    raise exception 'FAIL: a late report lost its seconds (total %, expected 92)',
      v_seconds;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── R4. an IN-ORDER report still moves the bookmark back ────────────────'

do $$
declare
  v_session uuid;
  v_resume   int;
  v_furthest int;
  v_ratio    numeric;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5eed0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select session_id into v_session
    from public.start_reading_session('5eed2222-0000-0000-0000-000000000001');

  -- Scrolling back is a legitimate thing to do, and the bookmark follows. Only
  -- an OUT-OF-ORDER report is refused — the ordering guard must not be mistaken
  -- for making `resume` monotonic, which would be the opposite of the contract.
  select progress_ratio into v_ratio
    from public.record_reading_progress(
      v_session, 0, 0, 0, 0, 0, 0, 3, 300,
      '5eed9999-0000-4000-8000-00000000000e', 9);

  select resume_paragraph_position, furthest_paragraph_position
    into v_resume, v_furthest
    from public.reading_progress
   where user_id = '5eed0000-0000-4000-8000-000000000001'
     and chapter_id = '5eed2222-0000-0000-0000-000000000001';

  if v_resume <> 0 then
    raise exception 'FAIL: scrolling back did not move the bookmark (still at %)',
      v_resume;
  end if;
  -- And the furthest mark does NOT fall with it. (The ratio itself is exercised
  -- on a pipeline-processed chapter in 04_reader_story_security.sql; this
  -- fixture is inserted straight into `chapters`, so it has no sentence rows for
  -- `reading_word_offset` to resolve against.)
  if v_furthest <> 1 then
    raise exception 'FAIL: furthest fell when the learner scrolled back (got %)',
      v_furthest;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── R5. a report with no receipt behaves exactly as before ──────────────'

do $$
declare
  v_session uuid;
  v_before  int;
  v_after   int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5eed0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select session_id into v_session
    from public.start_reading_session('5eed2222-0000-0000-0000-000000000001');

  select active_seconds into v_before
    from public.record_reading_progress(v_session, 0, 0, 0, 1, 0, 0, 4, 300);
  select active_seconds into v_after
    from public.record_reading_progress(v_session, 0, 0, 0, 1, 0, 0, 4, 300);

  -- Both parameters default to null, so a tab open across the deploy keeps
  -- working — at the old at-least-once semantics, which is what it expects.
  if v_after <> v_before + 4 then
    raise exception 'FAIL: an unreceipted report changed behaviour (% then %)',
      v_before, v_after;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── R6. the cap still holds, receipt or not ─────────────────────────────'

do $$
declare
  v_session uuid;
  v_before  int;
  v_after   int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"5eed0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select session_id into v_session
    from public.start_reading_session('5eed2222-0000-0000-0000-000000000001');

  select active_seconds into v_before
    from public.reading_progress
   where user_id = '5eed0000-0000-4000-8000-000000000001'
     and chapter_id = '5eed2222-0000-0000-0000-000000000001';

  select active_seconds into v_after
    from public.record_reading_progress(
      v_session, 0, 0, 0, 1, 0, 0, 86400, 300,
      '5eed9999-0000-4000-8000-00000000000f', 20);

  -- A slept machine, a paused debugger and a forged request all look the same
  -- here, and a receipt does not excuse any of them.
  if v_after > v_before + 300 then
    raise exception 'FAIL: an oversized report was not capped (% -> %)',
      v_before, v_after;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── R7. grants ──────────────────────────────────────────────────────────'

do $$
declare
  v_sig text := 'public.record_reading_progress(uuid, int, int, int, int, int, int, int, int, uuid, bigint)';
begin
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception 'FAIL: anon may report reading progress';
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'FAIL: a learner cannot report their own reading progress';
  end if;
end $$;

\echo '✔ reading progress receipts suite passed'
