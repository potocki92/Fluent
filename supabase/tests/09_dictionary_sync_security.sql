-- Fluent — dictionary-independent reading structure.
--
-- WHAT THIS SUITE IS ABOUT. A book used to be tied to the dictionary as it stood
-- on the day it was imported: an occurrence row existed only for a token that
-- matched, so a word added a month later was dead text until all forty chapters
-- were REPROCESSED — every paragraph, sentence and occurrence deleted and
-- re-inserted to fill in one nullable column.
--
-- The TypeScript side of the fix is unit-tested in
-- `src/lib/content/dictionary-sync.test.ts` (the plan) and
-- `src/lib/content/process.test.ts` (the rows). What cannot be tested there is
-- everything below: that reconciliation is idempotent in the database, that it
-- never moves an id or a position a learner's notes and bookmarks are anchored
-- on, that it cannot be aimed at another chapter, that it cannot be called by a
-- learner at all, that the derived aggregate is rebuilt from the rows, and that
-- the revision counter actually moves when the dictionary does.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use ids in the 9xxx range and the 9a…/9c… uuid space so they cannot
-- collide with the suites that run before this one.

\set ON_ERROR_STOP on

\set USER_A '''d1c70000-0000-4000-8000-000000000001'''

\echo '── D0. a chapter imported before the dictionary knew the verb ──────────'

insert into auth.users (id, email) values
  ('d1c70000-0000-4000-8000-000000000001', 'dict-a@example.test');

-- The dictionary at import time: it knows the noun and not the verb.
insert into public.words (id, lemma, display, word_type, translation_pl, cefr) values
  (9701, 'Schwert', 'das Schwert', 'noun', 'miecz', 'B1');

insert into public.library_items (id, slug, title, content_type, rights, status, published_at)
  values (
    '9a000000-0000-0000-0000-000000000001', 'dict-story', 'Wörterbuchgeschichte',
    'story', 'first_party', 'published', now()
  );

insert into public.chapters (id, library_item_id, position, title, source_text, status)
  values
  ('9c000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001',
   1, 'Kapitel 1', 'Er zog sein Schwert.', 'draft'),
  ('9c000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-000000000001',
   2, 'Kapitel 2', 'Er zog sein Schwert.', 'draft');

set role service_role;

-- A LEGACY CHAPTER, written exactly as the old pipeline wrote one: a row for
-- *Schwert*, which matched, and nothing at all for *Er*, *zog* and *sein*.
do $$
declare
  v_payload jsonb := jsonb_build_object(
    'processor_version', 'content_v2',
    'content_hash', 'dict-hash-1',
    'word_count', 4, 'paragraph_count', 1, 'sentence_count', 1,
    'estimated_reading_minutes', 1, 'dictionary_match_rate', 0.5,
    'paragraphs', jsonb_build_array(jsonb_build_object(
      'position', 0, 'kind', 'paragraph', 'text', 'Er zog sein Schwert.', 'word_count', 4,
      'sentences', jsonb_build_array(jsonb_build_object(
        'position', 0, 'chapter_position', 0, 'text', 'Er zog sein Schwert.',
        'char_start', 0, 'char_end', 20, 'word_count', 4,
        'occurrences', jsonb_build_array(jsonb_build_object(
          'position', 3, 'surface', 'Schwert', 'normalized', 'schwert',
          'lemma', 'Schwert', 'word_id', 9701, 'char_start', 12, 'char_end', 19
        ))
      ))
    )),
    'vocabulary', jsonb_build_array(jsonb_build_object(
      'word_id', 9701, 'occurrence_count', 1,
      'first_paragraph_position', 0, 'first_sentence_position', 0
    ))
  );
begin
  perform public.replace_chapter_content('9c000000-0000-0000-0000-000000000001', v_payload);
  perform public.replace_chapter_content(
    '9c000000-0000-0000-0000-000000000002',
    jsonb_set(v_payload, '{content_hash}', '"dict-hash-2"')
  );

  if (select count(*) from public.word_occurrences
      where chapter_id = '9c000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: the legacy fixture is not a legacy fixture';
  end if;
end $$;

reset role;

\echo '── D1. only the service role may reconcile a chapter ───────────────────'

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'd1c70000-0000-4000-8000-000000000001')::text, true);

  -- A LEARNER MUST NOT REACH THIS FUNCTION. Reconciliation is asked for through
  -- a Server Action that checks the caller may READ the chapter and then derives
  -- every written row from that chapter's own text — the function itself takes a
  -- payload, so a direct caller could otherwise write occurrences by hand.
  begin
    perform public.sync_chapter_dictionary('9c000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a learner could call sync_chapter_dictionary';
  exception
    when insufficient_privilege then null;
  end;
end $$;

reset role;

\echo '── D2. filling the gaps: additive, anchored, idempotent ────────────────'

set role service_role;

do $$
declare
  v_schwert_id bigint;
  v_paragraph_id bigint;
  v_sentence_id bigint;
  v_gaps jsonb;
  v_after_first int;
  v_after_second int;
begin
  select id into v_sentence_id from public.sentences
   where chapter_id = '9c000000-0000-0000-0000-000000000001';
  select paragraph_id into v_paragraph_id from public.sentences
   where id = v_sentence_id;
  select id into v_schwert_id from public.word_occurrences
   where chapter_id = '9c000000-0000-0000-0000-000000000001' and position = 3;

  -- What the application's planner produces for this chapter: the three token
  -- positions that never got a row. *zog* is still unresolved — the dictionary
  -- has no verb yet.
  v_gaps := jsonb_build_array(
    jsonb_build_object('sentenceId', v_sentence_id, 'position', 0, 'surface', 'Er',
                       'normalized', 'er', 'lemma', 'er', 'wordId', null,
                       'charStart', 0, 'charEnd', 2),
    jsonb_build_object('sentenceId', v_sentence_id, 'position', 1, 'surface', 'zog',
                       'normalized', 'zog', 'lemma', 'zog', 'wordId', null,
                       'charStart', 3, 'charEnd', 6),
    jsonb_build_object('sentenceId', v_sentence_id, 'position', 2, 'surface', 'sein',
                       'normalized', 'sein', 'lemma', 'sein', 'wordId', null,
                       'charStart', 7, 'charEnd', 11)
  );

  perform public.sync_chapter_dictionary(
    '9c000000-0000-0000-0000-000000000001', v_gaps, '[]'::jsonb, 1, true);

  select count(*) into v_after_first from public.word_occurrences
   where chapter_id = '9c000000-0000-0000-0000-000000000001';
  if v_after_first <> 4 then
    raise exception 'FAIL: the gaps were not filled (got % rows)', v_after_first;
  end if;

  -- IDEMPOTENT. The unique (sentence_id, position) index is what makes a retried
  -- or repeated pass write nothing, which is what lets the reader fire it and
  -- forget about it.
  perform public.sync_chapter_dictionary(
    '9c000000-0000-0000-0000-000000000001', v_gaps, '[]'::jsonb, 1, true);
  perform public.sync_chapter_dictionary(
    '9c000000-0000-0000-0000-000000000001', v_gaps, '[]'::jsonb, 1, true);

  select count(*) into v_after_second from public.word_occurrences
   where chapter_id = '9c000000-0000-0000-0000-000000000001';
  if v_after_second <> 4 then
    raise exception 'FAIL: reconciling twice duplicated occurrences (got %)', v_after_second;
  end if;

  -- NOTHING A LEARNER'S NOTES POINT AT MOVED. The occurrence that already
  -- existed keeps its id; the paragraph and the sentence keep theirs. This is the
  -- difference between reconciling and reprocessing.
  if (select id from public.word_occurrences
      where chapter_id = '9c000000-0000-0000-0000-000000000001' and position = 3)
     <> v_schwert_id then
    raise exception 'FAIL: reconciliation replaced an existing occurrence row';
  end if;
  if (select id from public.sentences
      where chapter_id = '9c000000-0000-0000-0000-000000000001') <> v_sentence_id then
    raise exception 'FAIL: reconciliation replaced a sentence row';
  end if;
  if (select id from public.paragraphs
      where chapter_id = '9c000000-0000-0000-0000-000000000001') <> v_paragraph_id then
    raise exception 'FAIL: reconciliation replaced a paragraph row';
  end if;

  -- The offsets address the real text, so the reader can still cut the word out
  -- of the sentence it belongs to.
  if (select surface from public.word_occurrences
      where sentence_id = v_sentence_id and position = 1) <> 'zog' then
    raise exception 'FAIL: a filled gap does not carry its surface';
  end if;
end $$;

\echo '── D3. a payload cannot reach another chapter ──────────────────────────'

do $$
declare
  v_foreign_sentence bigint;
  v_before int;
begin
  select id into v_foreign_sentence from public.sentences
   where chapter_id = '9c000000-0000-0000-0000-000000000002';
  select count(*) into v_before from public.word_occurrences
   where chapter_id = '9c000000-0000-0000-0000-000000000002';

  -- The rows are joined back to the named chapter, so a payload naming someone
  -- else's sentence writes nothing rather than writing there.
  perform public.sync_chapter_dictionary(
    '9c000000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'sentenceId', v_foreign_sentence, 'position', 0, 'surface', 'Er',
      'normalized', 'er', 'lemma', 'er', 'wordId', null,
      'charStart', 0, 'charEnd', 2
    )),
    '[]'::jsonb, null, false);

  if (select count(*) from public.word_occurrences
      where chapter_id = '9c000000-0000-0000-0000-000000000002') <> v_before then
    raise exception 'FAIL: a payload reached a chapter it did not name';
  end if;
end $$;

reset role;

\echo '── D4. the word is added a month later, and reaches the book ───────────'

-- T1: the verb finally enters the dictionary. Nothing about the book changes.
insert into public.words (id, lemma, display, word_type, translation_pl, cefr) values
  (9702, 'ziehen', 'ziehen', 'verb', 'ciągnąć', 'B1');

set role service_role;

do $$
declare
  v_zog_id bigint;
  v_sentence_id bigint;
  v_revision bigint;
begin
  select id into v_sentence_id from public.sentences
   where chapter_id = '9c000000-0000-0000-0000-000000000001';
  select id into v_zog_id from public.word_occurrences
   where sentence_id = v_sentence_id and position = 1;
  select revision into v_revision from public.dictionary_revision where id;

  -- T2: reconciliation, with the resolution the application's matcher produced.
  -- NO REPROCESSING: the text, the paragraphs, the sentences and every
  -- occurrence row are exactly as they were.
  perform public.sync_chapter_dictionary(
    '9c000000-0000-0000-0000-000000000001',
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'normalized', 'zog', 'wordId', 9702, 'lemma', 'ziehen'
    )),
    v_revision,
    true);

  if (select word_id from public.word_occurrences where id = v_zog_id) <> 9702 then
    raise exception 'FAIL: a dictionary entry added later did not reach the chapter';
  end if;
  if (select lemma from public.word_occurrences where id = v_zog_id) <> 'ziehen' then
    raise exception 'FAIL: the resolved occurrence kept its provisional lemma';
  end if;
  -- THE ROW IS THE SAME ROW. Anything anchored on it — a saved word's origin, a
  -- personal annotation — still points at the same token in the same sentence.
  if (select count(*) from public.word_occurrences
      where chapter_id = '9c000000-0000-0000-0000-000000000001') <> 4 then
    raise exception 'FAIL: resolving changed the chapter''s row count';
  end if;

  -- THE DERIVED AGGREGATE FOLLOWS. Without this the reader would gloss *zog* as
  -- *ziehen* while preparation insisted the chapter contains no *ziehen* — the
  -- kind of disagreement a learner notices and nobody can explain.
  if not exists (
    select 1 from public.chapter_vocabulary
     where chapter_id = '9c000000-0000-0000-0000-000000000001' and word_id = 9702
  ) then
    raise exception 'FAIL: chapter_vocabulary did not pick up the resolved word';
  end if;

  -- …and the chapter now says which dictionary it agrees with, which is what
  -- makes the next pass a no-op instead of a scan.
  if (select dictionary_revision from public.chapters
      where id = '9c000000-0000-0000-0000-000000000001') <> v_revision then
    raise exception 'FAIL: the chapter was not stamped with the dictionary revision';
  end if;
end $$;

\echo '── D5. a resolution naming a word that is gone resolves to nothing ─────'

do $$
declare
  v_sentence_id bigint;
  v_er_id bigint;
begin
  select id into v_sentence_id from public.sentences
   where chapter_id = '9c000000-0000-0000-0000-000000000001';
  select id into v_er_id from public.word_occurrences
   where sentence_id = v_sentence_id and position = 0;

  -- A dictionary row can vanish between planning and writing. That must leave the
  -- occurrence unresolved, not abort the batch and not write a dangling id.
  perform public.sync_chapter_dictionary(
    '9c000000-0000-0000-0000-000000000001',
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'normalized', 'er', 'wordId', 99999, 'lemma', 'weg'
    )),
    null, false);

  if (select word_id from public.word_occurrences where id = v_er_id) is not null then
    raise exception 'FAIL: a resolution named a word that does not exist and stuck';
  end if;
end $$;

reset role;

\echo '── D6. the revision moves whenever the dictionary does ─────────────────'

do $$
declare
  v_start bigint;
  v_after_insert bigint;
  v_after_update bigint;
  v_after_delete bigint;
begin
  select revision into v_start from public.dictionary_revision where id;

  insert into public.words (id, lemma, display, word_type, translation_pl)
    values (9703, 'Wildling', 'der Wildling', 'noun', 'dziczyzna');
  select revision into v_after_insert from public.dictionary_revision where id;

  update public.words set lemma = 'Wildlinge' where id = 9703;
  select revision into v_after_update from public.dictionary_revision where id;

  delete from public.words where id = 9703;
  select revision into v_after_delete from public.dictionary_revision where id;

  -- ALL THREE MATTER. An insert is the obvious one; an UPDATE changes what the
  -- index resolves and a `max(updated_at)` heuristic would need a column nobody
  -- maintains; a DELETE shrinks it and a `count(*)` would happily miss an
  -- insert-plus-delete. A counter sees all three.
  if v_after_insert <= v_start then
    raise exception 'FAIL: inserting a word did not bump the dictionary revision';
  end if;
  if v_after_update <= v_after_insert then
    raise exception 'FAIL: updating a word did not bump the dictionary revision';
  end if;
  if v_after_delete <= v_after_update then
    raise exception 'FAIL: deleting a word did not bump the dictionary revision';
  end if;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'd1c70000-0000-4000-8000-000000000001')::text, true);

  -- The counter is public knowledge — it says only how many times the dictionary
  -- has changed — and writable by nobody but the trigger.
  if (select count(*) from public.dictionary_revision) <> 1 then
    raise exception 'FAIL: a learner cannot read the dictionary revision';
  end if;

  begin
    update public.dictionary_revision set revision = 0 where id;
    raise exception 'FAIL: a learner could rewrite the dictionary revision';
  exception
    when insufficient_privilege then null;
  end;
end $$;

reset role;

\echo '✔ dictionary sync suite passed'
