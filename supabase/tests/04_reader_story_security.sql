-- Fluent — Reader / Story engine: rights, privacy, progress and reading data.
--
-- The pipeline's arithmetic is unit-tested in TypeScript
-- (`src/lib/content/process.test.ts`, `src/lib/reading/*.test.ts`). What CANNOT
-- be tested there is everything this file asserts: that a private import is
-- invisible to everyone but its owner, that public content cannot be rewritten
-- by a learner, that reading progress has no client write path, that furthest
-- progress never goes backwards, that finishing a chapter is refused before the
-- end and idempotent after it, that a retried lookup is still ONE lookup, that a
-- saved word keeps the sentence it came from, and that reprocessing a chapter
-- replaces its content instead of duplicating it.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use ids in the 8xxx range and the 7777…/8888… uuid space so they
-- cannot collide with the suites that run before this one.

\set ON_ERROR_STOP on

\set USER_A '''77777777-7777-7777-7777-777777777777'''
\set USER_B '''88888888-8888-8888-8888-888888888888'''

\echo '── R0. reader fixtures ─────────────────────────────────────────────────'

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'reader-a@example.test'),
  ('88888888-8888-8888-8888-888888888888', 'reader-b@example.test');

insert into public.words (id, lemma, display, word_type, translation_pl, cefr)
  values
  (8801, 'Schwert',  'das Schwert',  'noun', 'miecz',    'B1'),
  (8802, 'Keller',   'der Keller',   'noun', 'piwnica',  'A2'),
  (8803, 'Schlüssel','der Schlüssel','noun', 'klucz',    'A2');

-- A published, first-party story: two chapters, the public library.
insert into public.library_items (id, slug, title, content_type, rights, status, cefr_estimate, published_at)
  values (
    '8a000000-0000-0000-0000-000000000001', 'test-story', 'Testgeschichte',
    'story', 'first_party', 'published', 'A2', now()
  );

-- A PRIVATE IMPORT owned by user A. This is the row the privacy assertions hang
-- off: whatever its status says, nobody but A may ever see it.
insert into public.library_items (id, slug, title, content_type, rights, status, owner_user_id)
  values (
    '8a000000-0000-0000-0000-000000000002', 'private-book', 'Privates Buch',
    'book', 'private_import', 'published', '77777777-7777-7777-7777-777777777777'
  );

insert into public.chapters (id, library_item_id, position, title, source_text, status)
  values
  ('8c000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001',
   1, 'Kapitel 1', 'Er zog sein Schwert. Der Keller war dunkel.', 'draft'),
  ('8c000000-0000-0000-0000-000000000002', '8a000000-0000-0000-0000-000000000001',
   2, 'Kapitel 2', 'Der Schlüssel lag da.', 'draft'),
  ('8c000000-0000-0000-0000-000000000003', '8a000000-0000-0000-0000-000000000002',
   1, 'Privat', 'Ein privates Kapitel.', 'draft');

\echo '── R1. the pipeline owns content, and replacing it is idempotent ───────'

set role service_role;

do $$
declare
  v_payload jsonb := jsonb_build_object(
    'processor_version', 'content_v1',
    'content_hash', 'hash-1',
    'word_count', 8,
    'paragraph_count', 2,
    'sentence_count', 2,
    'estimated_reading_minutes', 1,
    'dictionary_match_rate', 0.5,
    'unmatched_sample', jsonb_build_array(jsonb_build_object('token', 'dunkel', 'count', 1)),
    'vocabulary_stats', jsonb_build_object('unique_word_count', 8),
    'paragraphs', jsonb_build_array(
      jsonb_build_object(
        'position', 0, 'kind', 'paragraph', 'text', 'Er zog sein Schwert.', 'word_count', 4,
        'sentences', jsonb_build_array(jsonb_build_object(
          'position', 0, 'chapter_position', 0, 'text', 'Er zog sein Schwert.',
          'char_start', 0, 'char_end', 20, 'word_count', 4,
          'occurrences', jsonb_build_array(jsonb_build_object(
            'position', 3, 'surface', 'Schwert', 'normalized', 'schwert',
            'lemma', 'Schwert', 'word_id', 8801, 'char_start', 12, 'char_end', 19
          ))
        ))
      ),
      jsonb_build_object(
        'position', 1, 'kind', 'paragraph', 'text', 'Der Keller war dunkel.', 'word_count', 4,
        'sentences', jsonb_build_array(jsonb_build_object(
          'position', 0, 'chapter_position', 1, 'text', 'Der Keller war dunkel.',
          'char_start', 0, 'char_end', 22, 'word_count', 4,
          'occurrences', jsonb_build_array(jsonb_build_object(
            'position', 1, 'surface', 'Keller', 'normalized', 'keller',
            'lemma', 'Keller', 'word_id', 8802, 'char_start', 4, 'char_end', 10
          ))
        ))
      )
    ),
    'vocabulary', jsonb_build_array(
      jsonb_build_object('word_id', 8801, 'occurrence_count', 1,
                         'first_paragraph_position', 0, 'first_sentence_position', 0),
      jsonb_build_object('word_id', 8802, 'occurrence_count', 1,
                         'first_paragraph_position', 1, 'first_sentence_position', 1)
    )
  );
  v_paragraphs int;
  v_sentences  int;
  v_occurrences int;
  v_vocab      int;
begin
  perform public.replace_chapter_content('8c000000-0000-0000-0000-000000000001', v_payload);

  -- REPROCESSING MUST NOT DUPLICATE. Running the pipeline twice over the same
  -- chapter is a normal event (a better tokenizer, a corrected source); if it
  -- doubled the rows, every occurrence id and every stored position would be
  -- meaningless after the second run.
  perform public.replace_chapter_content('8c000000-0000-0000-0000-000000000001', v_payload);

  select count(*) into v_paragraphs from public.paragraphs
  where chapter_id = '8c000000-0000-0000-0000-000000000001';
  select count(*) into v_sentences from public.sentences
  where chapter_id = '8c000000-0000-0000-0000-000000000001';
  select count(*) into v_occurrences from public.word_occurrences
  where chapter_id = '8c000000-0000-0000-0000-000000000001';
  select count(*) into v_vocab from public.chapter_vocabulary
  where chapter_id = '8c000000-0000-0000-0000-000000000001';

  if v_paragraphs <> 2 then
    raise exception 'FAIL: reprocessing duplicated paragraphs (got %)', v_paragraphs;
  end if;
  if v_sentences <> 2 then
    raise exception 'FAIL: reprocessing duplicated sentences (got %)', v_sentences;
  end if;
  if v_occurrences <> 2 then
    raise exception 'FAIL: reprocessing duplicated occurrences (got %)', v_occurrences;
  end if;
  if v_vocab <> 2 then
    raise exception 'FAIL: reprocessing duplicated chapter vocabulary (got %)', v_vocab;
  end if;

  -- Positions are STABLE: reading progress points at them, so a reprocess that
  -- moved them would move every learner's bookmark.
  if (select array_agg(position order by position) from public.paragraphs
      where chapter_id = '8c000000-0000-0000-0000-000000000001') <> array[0, 1] then
    raise exception 'FAIL: paragraph positions are not stable across a reprocess';
  end if;

  if (select status from public.chapters where id = '8c000000-0000-0000-0000-000000000001')
     <> 'ready' then
    raise exception 'FAIL: a processed chapter is not ready';
  end if;

  -- The item's totals are derived from its chapters, never asserted.
  if (select word_count from public.library_items
      where id = '8a000000-0000-0000-0000-000000000001') <> 8 then
    raise exception 'FAIL: the item word count was not derived from its chapters';
  end if;

  -- Process the second chapter and the private one, for the tests below.
  perform public.replace_chapter_content(
    '8c000000-0000-0000-0000-000000000002',
    jsonb_build_object(
      'processor_version', 'content_v1', 'content_hash', 'hash-2',
      'word_count', 4, 'paragraph_count', 1, 'sentence_count', 1,
      'estimated_reading_minutes', 1, 'dictionary_match_rate', 1,
      'paragraphs', jsonb_build_array(jsonb_build_object(
        'position', 0, 'kind', 'paragraph', 'text', 'Der Schlüssel lag da.', 'word_count', 4,
        'sentences', jsonb_build_array(jsonb_build_object(
          'position', 0, 'chapter_position', 0, 'text', 'Der Schlüssel lag da.',
          'char_start', 0, 'char_end', 21, 'word_count', 4, 'occurrences', '[]'::jsonb
        ))
      )),
      'vocabulary', '[]'::jsonb
    )
  );

  perform public.replace_chapter_content(
    '8c000000-0000-0000-0000-000000000003',
    jsonb_build_object(
      'processor_version', 'content_v1', 'content_hash', 'hash-3',
      'word_count', 3, 'paragraph_count', 1, 'sentence_count', 1,
      'estimated_reading_minutes', 1, 'dictionary_match_rate', 1,
      'paragraphs', jsonb_build_array(jsonb_build_object(
        'position', 0, 'kind', 'paragraph', 'text', 'Ein privates Kapitel.', 'word_count', 3,
        'sentences', jsonb_build_array(jsonb_build_object(
          'position', 0, 'chapter_position', 0, 'text', 'Ein privates Kapitel.',
          'char_start', 0, 'char_end', 21, 'word_count', 3, 'occurrences', '[]'::jsonb
        ))
      )),
      'vocabulary', '[]'::jsonb
    )
  );
end $$;

reset role;

\echo '── R2. private content is private, public content is read-only ────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888"}', false); end $switch$;

do $$
begin
  -- User B may read the public story…
  if not exists (select 1 from public.library_items where slug = 'test-story') then
    raise exception 'FAIL: published first-party content is not readable';
  end if;
  if not exists (
    select 1 from public.sentences where chapter_id = '8c000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: sentences of published content are not readable';
  end if;

  -- …and CANNOT see user A's private import at any level of the tree.
  if exists (select 1 from public.library_items where slug = 'private-book') then
    raise exception 'FAIL: user B can see another learner''s private import';
  end if;
  if exists (
    select 1 from public.chapters where id = '8c000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'FAIL: user B can see a chapter of a private import';
  end if;
  if exists (
    select 1 from public.sentences where chapter_id = '8c000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'FAIL: user B can read the TEXT of a private import';
  end if;
  if exists (
    select 1 from public.word_occurrences where chapter_id = '8c000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'FAIL: user B can see occurrences of a private import';
  end if;

  -- A learner cannot rewrite published content — not the book, not the chapter,
  -- not a single sentence of it.
  begin
    update public.library_items set title = 'Gekapert' where slug = 'test-story';
    if found then raise exception 'FAIL: a learner rewrote a library item'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.sentences set text = 'Gekapert'
    where chapter_id = '8c000000-0000-0000-0000-000000000001';
    if found then raise exception 'FAIL: a learner rewrote a sentence'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.paragraphs (chapter_id, position, text)
    values ('8c000000-0000-0000-0000-000000000001', 99, 'Eingeschmuggelt');
    raise exception 'FAIL: a learner inserted a paragraph into published content';
  exception when insufficient_privilege then null;
  end;

  -- The pipeline's write path is not reachable from a browser role at all.
  begin
    perform public.replace_chapter_content(
      '8c000000-0000-0000-0000-000000000001', '{}'::jsonb
    );
    raise exception 'FAIL: a learner could call replace_chapter_content';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

\echo '── R3. the owner of a private import can read it ───────────────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false); end $switch$;

do $$
begin
  if not exists (select 1 from public.library_items where slug = 'private-book') then
    raise exception 'FAIL: the owner cannot see their own private import';
  end if;
  if not exists (
    select 1 from public.sentences where chapter_id = '8c000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'FAIL: the owner cannot read their own private content';
  end if;
end $$;

reset role;

\echo '── R4. anonymous visitors see published content and nothing private ────'

set role anon;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

do $$
begin
  if exists (select 1 from public.library_items where slug = 'private-book') then
    raise exception 'FAIL: an anonymous visitor can see a private import';
  end if;
  if exists (
    select 1 from public.sentences where chapter_id = '8c000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'FAIL: an anonymous visitor can read private content';
  end if;
end $$;

reset role;

\echo '── R5. reading progress: server-owned, resumable, never going backwards ─'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888"}', false); end $switch$;

do $$
declare
  v_session uuid;
  v_start   record;
  v_ratio   numeric;
  v_furthest int;
  v_seconds int;
  v_row     record;
begin
  -- A learner cannot write their own reading progress. It is progress, and
  -- progress in Fluent has no client write path.
  begin
    insert into public.reading_progress (user_id, chapter_id, library_item_id, progress_ratio)
    values ('88888888-8888-8888-8888-888888888888',
            '8c000000-0000-0000-0000-000000000001',
            '8a000000-0000-0000-0000-000000000001', 1);
    raise exception 'FAIL: a learner forged reading progress';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.reading_sessions (user_id, chapter_id, library_item_id, active_seconds)
    values ('88888888-8888-8888-8888-888888888888',
            '8c000000-0000-0000-0000-000000000001',
            '8a000000-0000-0000-0000-000000000001', 99999);
    raise exception 'FAIL: a learner forged a reading session';
  exception when insufficient_privilege then null;
  end;

  -- Opening a chapter creates the progress row and the session.
  select * into v_start from public.start_reading_session('8c000000-0000-0000-0000-000000000001');
  v_session := v_start.session_id;
  if v_session is null then
    raise exception 'FAIL: start_reading_session returned no session';
  end if;
  if v_start.resumed then
    raise exception 'FAIL: a brand-new session reported itself as resumed';
  end if;

  -- A SECOND TAB SHARES THE SESSION, or the chapter summary counts everything
  -- twice.
  select * into v_row from public.start_reading_session('8c000000-0000-0000-0000-000000000001');
  if v_row.session_id <> v_session then
    raise exception 'FAIL: a second open created a second concurrent session';
  end if;
  if not v_row.resumed then
    raise exception 'FAIL: re-opening did not report itself as resumed';
  end if;

  -- Read to the second (last) paragraph.
  select progress_ratio, furthest_paragraph, active_seconds
    into v_ratio, v_furthest, v_seconds
  from public.record_reading_progress(v_session, 1, 1, 30, 300);

  if v_ratio <> 1 then
    raise exception 'FAIL: reaching the last paragraph did not reach 100%% (got %)', v_ratio;
  end if;
  if v_seconds <> 30 then
    raise exception 'FAIL: active seconds were not accumulated (got %)', v_seconds;
  end if;

  -- SCROLL BACK. The bookmark follows; the progress does NOT. This is the
  -- regression the two columns exist for.
  select progress_ratio, furthest_paragraph
    into v_ratio, v_furthest
  from public.record_reading_progress(v_session, 0, 0, 5, 300);

  if v_ratio <> 1 then
    raise exception 'FAIL: progress fell when the learner scrolled back (got %)', v_ratio;
  end if;
  if v_furthest <> 1 then
    raise exception 'FAIL: furthest position moved backwards (got %)', v_furthest;
  end if;
  if (select resume_paragraph_position from public.reading_progress
      where user_id = '88888888-8888-8888-8888-888888888888'
        and chapter_id = '8c000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'FAIL: the resume position did not follow the learner back';
  end if;

  -- ONE REPORT MAY NEVER CLAIM AN HOUR. A slept machine, a paused debugger or a
  -- forged request all look the same here, and all are capped.
  select active_seconds into v_seconds
  from public.record_reading_progress(v_session, 1, 1, 86400, 300);
  if v_seconds > 30 + 5 + 300 then
    raise exception 'FAIL: an oversized progress report was not capped (got %)', v_seconds;
  end if;
end $$;

reset role;

\echo '── R6. finishing a chapter is refused early, and idempotent after ──────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777"}', false); end $switch$;

do $$
declare
  v_session uuid;
  v_row     record;
begin
  select session_id into v_session
  from public.start_reading_session('8c000000-0000-0000-0000-000000000001');

  -- Only the first of two paragraphs: 50%.
  perform public.record_reading_progress(v_session, 0, 0, 10, 300);

  begin
    perform public.complete_reading_chapter(v_session, 0.95);
    raise exception 'FAIL: a chapter was completed from halfway through';
  exception when sqlstate 'FL412' then null;
  end;

  perform public.record_reading_progress(v_session, 1, 1, 10, 300);

  select * into v_row from public.complete_reading_chapter(v_session, 0.95);
  if v_row.already_completed then
    raise exception 'FAIL: the first completion reported itself as a repeat';
  end if;
  if v_row.active_seconds <> 20 then
    raise exception 'FAIL: the summary lost reading time (got %)', v_row.active_seconds;
  end if;

  -- A double tap, a retried Server Action or a refreshed page must not inflate
  -- anything.
  select * into v_row from public.complete_reading_chapter(v_session, 0.95);
  if not v_row.already_completed then
    raise exception 'FAIL: completing twice was not idempotent';
  end if;

  if (select count(*) from public.reading_progress
      where user_id = '77777777-7777-7777-7777-777777777777'
        and chapter_id = '8c000000-0000-0000-0000-000000000001'
        and completed_at is not null) <> 1 then
    raise exception 'FAIL: completion was not recorded exactly once';
  end if;
end $$;

reset role;

\echo '── R7. a lookup is recorded once, whatever the network does ────────────'

set role service_role;

do $$
declare
  v_session uuid;
  v_row     record;
begin
  select s.id into v_session from public.reading_sessions s
  where s.user_id = '88888888-8888-8888-8888-888888888888'
    and s.chapter_id = '8c000000-0000-0000-0000-000000000001'
  order by s.started_at desc limit 1;

  select * into v_row from public.apply_reading_lookup(
    '88888888-8888-8888-8888-888888888888', 'lookup-1',
    '8c000000-0000-0000-0000-000000000001', 8801,
    (select id from public.sentences where chapter_id = '8c000000-0000-0000-0000-000000000001'
       and chapter_position = 0),
    (select id from public.word_occurrences where chapter_id = '8c000000-0000-0000-0000-000000000001'
       and word_id = 8801),
    v_session,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_key', 'reading-lookup:lookup-1',
      'event_type', 'reading_lookup',
      'response_mode', 'passive',
      'retrieval_type', 'recognition',
      'is_correct', false,
      'source_kind', 'reader',
      'skill_code', 'receptive_vocabulary',
      'word_id', 8801,
      'chapter_id', '8c000000-0000-0000-0000-000000000001',
      'library_item_id', '8a000000-0000-0000-0000-000000000001'
    )))
  );

  if v_row.already_recorded then
    raise exception 'FAIL: the first lookup reported itself as a repeat';
  end if;

  -- THE RETRY. Same interaction id, so the same lookup — not a second one.
  -- A lookup is negative evidence; counting it twice would slowly convince
  -- Fluent the learner knows less than they do.
  select * into v_row from public.apply_reading_lookup(
    '88888888-8888-8888-8888-888888888888', 'lookup-1',
    '8c000000-0000-0000-0000-000000000001', 8801, null, null, v_session,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_key', 'reading-lookup:lookup-1',
      'event_type', 'reading_lookup',
      'response_mode', 'passive',
      'retrieval_type', 'recognition',
      'is_correct', false,
      'source_kind', 'reader',
      'word_id', 8801
    )))
  );

  if not v_row.already_recorded then
    raise exception 'FAIL: a retried lookup was recorded twice';
  end if;

  if (select count(*) from public.reading_lookups
      where user_id = '88888888-8888-8888-8888-888888888888' and word_id = 8801) <> 1 then
    raise exception 'FAIL: a retried lookup produced two rows';
  end if;

  if (select count(*) from public.learning_events
      where user_id = '88888888-8888-8888-8888-888888888888'
        and event_type = 'reading_lookup') <> 1 then
    raise exception 'FAIL: a retried lookup produced two learning events';
  end if;

  -- A second, different word in the same sitting is a second unique lookup.
  perform public.apply_reading_lookup(
    '88888888-8888-8888-8888-888888888888', 'lookup-2',
    '8c000000-0000-0000-0000-000000000001', 8802, null, null, v_session,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_key', 'reading-lookup:lookup-2',
      'event_type', 'reading_lookup',
      'response_mode', 'passive',
      'retrieval_type', 'recognition',
      'is_correct', false,
      'source_kind', 'reader',
      'word_id', 8802
    )))
  );

  select * into v_row from public.reading_sessions where id = v_session;
  if v_row.lookup_count <> 2 or v_row.unique_lookup_count <> 2 then
    raise exception 'FAIL: session lookup counters are wrong (% / %)',
      v_row.lookup_count, v_row.unique_lookup_count;
  end if;

  -- The chapter's own counter, which is what a lookup RATE is computed from.
  if (select lookup_count from public.reading_progress
      where user_id = '88888888-8888-8888-8888-888888888888'
        and chapter_id = '8c000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FAIL: the chapter lookup counter did not move';
  end if;
end $$;

reset role;

\echo '── R8. a saved word remembers the sentence it came from ────────────────'

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888"}', false); end $switch$;

do $$
declare
  v_occurrence bigint;
  v_row        record;
  v_saved      public.saved_words%rowtype;
begin
  select id into v_occurrence from public.word_occurrences
  where chapter_id = '8c000000-0000-0000-0000-000000000001' and word_id = 8801;

  select * into v_row from public.save_word_from_reader(8801, v_occurrence);
  if not v_row.was_new then
    raise exception 'FAIL: the first save did not create a card';
  end if;

  select * into v_saved from public.saved_words
  where user_id = '88888888-8888-8888-8888-888888888888' and word_id = 8801;

  -- The sentence text is COPIED, not referenced: deleting the book later must
  -- not quietly empty the card.
  if v_saved.origin_context <> 'Er zog sein Schwert.' then
    raise exception 'FAIL: the origin sentence was not stored (got %)', v_saved.origin_context;
  end if;
  if v_saved.origin_chapter_id <> '8c000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: the origin chapter was not stored';
  end if;
  if v_saved.origin_surface <> 'Schwert' then
    raise exception 'FAIL: the surface form met in the text was not stored';
  end if;

  -- Re-saving keeps the FIRST place the word was met.
  select * into v_row from public.save_word_from_reader(8801, null);
  if v_row.was_new then
    raise exception 'FAIL: re-saving created a second card';
  end if;
  if (select origin_context from public.saved_words
      where user_id = '88888888-8888-8888-8888-888888888888' and word_id = 8801)
     is distinct from 'Er zog sein Schwert.' then
    raise exception 'FAIL: re-saving overwrote the original context';
  end if;

  -- The origin cannot be forged: the word must really occur at that occurrence.
  begin
    perform public.save_word_from_reader(8803, v_occurrence);
    raise exception 'FAIL: a card claimed a sentence the word never appeared in';
  exception when sqlstate 'FL422' then null;
  end;
end $$;

reset role;

\echo '── R9. a reading task in a plan is measured, never asserted ────────────'

set role service_role;

do $$
declare
  v_plan uuid;
  v_item uuid;
  v_row  record;
begin
  v_plan := public.create_daily_plan(
    '88888888-8888-8888-8888-888888888888',
    (public.learning_day('UTC', now())),
    'UTC', 20, 'planner_v1', 'low',
    jsonb_build_array(jsonb_build_object(
      'item_position', 1,
      'item_type', 'continue_chapter',
      'estimated_minutes', 8,
      'reason_code', 'chapter_started',
      'target_count', 1,
      'library_item_id', '8a000000-0000-0000-0000-000000000001',
      'chapter_id', '8c000000-0000-0000-0000-000000000002',
      -- 8 minutes of reading, less the completion share: 384 seconds.
      'target_seconds', 384
    ))
  );

  select id into v_item from public.daily_plan_items where plan_id = v_plan;
  if (select chapter_id from public.daily_plan_items where id = v_item)
     <> '8c000000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: the plan item did not keep its chapter reference';
  end if;
end $$;

reset role;

set role authenticated;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888"}', false); end $switch$;

do $$
declare
  v_plan    uuid;
  v_session uuid;
  v_status  text;
begin
  select id into v_plan from public.daily_plans
  where user_id = '88888888-8888-8888-8888-888888888888';

  -- OPENING A CHAPTER IS NOT DOING IT. This is the rule the Today engine most
  -- needed for reading: a reading task measured by "a row exists" would be
  -- satisfied by a tap.
  select session_id into v_session
  from public.start_reading_session('8c000000-0000-0000-0000-000000000002');

  select item_status into v_status from public.sync_daily_plan(v_plan);
  if v_status = 'completed' then
    raise exception 'FAIL: merely opening a chapter completed the reading task';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'FAIL: an opened chapter is not in progress (got %)', v_status;
  end if;

  -- Do less reading than the plan asked for: still not done.
  perform public.record_reading_progress(v_session, 0, 0, 100, 300);
  select item_status into v_status from public.sync_daily_plan(v_plan);
  if v_status = 'completed' then
    raise exception 'FAIL: a short sitting satisfied an 8-minute reading task';
  end if;

  -- Now do the reading the plan asked for.
  perform public.record_reading_progress(v_session, 0, 0, 300, 300);
  select item_status into v_status from public.sync_daily_plan(v_plan);
  if v_status <> 'completed' then
    raise exception 'FAIL: the reading segment was done but the task is % ', v_status;
  end if;

  -- Reconciling again changes nothing.
  select item_status into v_status from public.sync_daily_plan(v_plan);
  if v_status <> 'completed' then
    raise exception 'FAIL: reconciling a finished reading task was not idempotent';
  end if;
end $$;

reset role;

\echo '── R10. the migrated passages, and the compatibility mapping ───────────'

-- The backfill is a FUNCTION rather than a one-off migration block precisely so
-- that passages written after the migration still reach the library. Calling it
-- here proves that: the suites above created `texts` rows long after the
-- migration ran.
set role service_role;
do $$ begin perform public.backfill_library_from_texts(); end $$;
reset role;

do $$
declare
  v_texts    int;
  v_items    int;
  v_orphans  int;
begin
  select count(*) into v_texts from public.texts;
  select count(*) into v_items from public.library_items where legacy_text_id is not null;

  -- Every passage became a library item. Nothing was moved or renumbered:
  -- `texts` keeps its ids, its questions and its completions.
  if v_items <> v_texts then
    raise exception 'FAIL: % passages but % migrated items', v_texts, v_items;
  end if;

  select count(*) into v_orphans
  from public.library_items i
  where i.legacy_text_id is not null
    and not exists (select 1 from public.chapters c where c.library_item_id = i.id);
  if v_orphans > 0 then
    raise exception 'FAIL: % migrated items have no chapter', v_orphans;
  end if;

  -- The mapping is one-to-one, which is what makes `/learn/[textId]` able to
  -- redirect deterministically.
  if exists (
    select legacy_text_id from public.library_items
    where legacy_text_id is not null
    group by legacy_text_id having count(*) > 1
  ) then
    raise exception 'FAIL: a passage mapped to more than one library item';
  end if;
end $$;

\echo ''
\echo '✔ all reader / story-engine checks passed'
