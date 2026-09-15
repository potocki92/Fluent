-- Fluent — The personal language notebook: ownership, anchoring and privacy.
--
-- The notebook's arithmetic is unit-tested in TypeScript — snapping a selection
-- to tokens, cutting a cloze at offsets, normalising a note, counting a chapter
-- — and none of it touches a database (`src/lib/notebook/*.test.ts`). What
-- CANNOT be tested there is everything this file asserts:
--
--   * a personal note NEVER reaches the shared dictionary, whatever a learner
--     writes about a word;
--   * a contextual meaning belongs to an OCCURRENCE, so the same lexeme in two
--     sentences carries two independent meanings;
--   * every note is private: learner B cannot read A's, and cannot create one
--     against a sentence of A's private import by guessing its id;
--   * none of the three tables has a client write path at all — `user_id`, the
--     anchors and the snapshots are unforgeable because no policy allows a write;
--   * a span is verified against the book: a request claiming a surface the
--     sentence does not contain is refused, and so is one longer than a phrase
--     may be;
--   * "nie rozumiem" is reversible, and reversing it keeps the history;
--   * deleting a private book takes its notes — and the fragments of that book
--     copied into them — with it, while the vocabulary learned from it stays;
--   * grading a notebook card is idempotent and service_role only.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use the cc…/dd… uuid space and the 77xx word ids so they cannot
-- collide with the suites that run before this one.

\set ON_ERROR_STOP on

\set LEARNER '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set OTHER   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set ADMIN   '''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'''

\echo '── P0. notebook fixtures ───────────────────────────────────────────────'

insert into auth.users (id, email) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'notebook-a@example.test'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'notebook-b@example.test'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'notebook-admin@example.test');

update public.profiles set role = 'admin'
  where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

insert into public.words (id, lemma, display, word_type, translation_pl, cefr) values
  (7701, 'sollen',  'sollen',      'verb', 'powinien / mieć powinność', 'A2'),
  (7702, 'ziehen',  'ziehen',      'verb', 'ciągnąć',                   'B1'),
  (7703, 'Schwert', 'das Schwert', 'noun', 'miecz',                     'B1'),
  (7704, 'Angst',   'die Angst',   'noun', 'strach',                    'A2');

insert into public.library_items
  (id, slug, title, content_type, rights, status, cefr_estimate, published_at)
  values (
    'cc000000-0000-0000-0000-000000000001', 'notebook-story', 'Notizbuchgeschichte',
    'story', 'first_party', 'published', 'B1', now()
  );

-- A PRIVATE IMPORT owned by the learner. Everything the privacy assertions need
-- hangs off this row: it is published, and it is still invisible to everyone
-- but its owner — admins included.
insert into public.library_items
  (id, slug, title, content_type, rights, status, owner_user_id)
  values (
    'cc000000-0000-0000-0000-000000000002', 'notebook-private', 'Privatbuch',
    'book', 'private_import', 'published', 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  );

insert into public.chapters (id, library_item_id, position, title, source_text, status)
  values
  ('cd000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001',
   1, 'Prolog', 'Wir sollten umkehren.', 'draft'),
  ('cd000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000002',
   1, 'Privat', 'Ein privates Kapitel.', 'draft');

set role service_role;

-- Four sentences that between them cover every case the notebook has to handle:
-- a word worth a contextual meaning, the SAME lexeme in two different places, a
-- multi-token phrase, and a token the dictionary does not know.
do $$
begin
  perform public.replace_chapter_content(
    'cd000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'processor_version', 'content_v1',
      'content_hash', 'notebook-hash-1',
      'word_count', 15, 'paragraph_count', 4, 'sentence_count', 4,
      'estimated_reading_minutes', 1, 'dictionary_match_rate', 0.4,
      'unmatched_sample', '[]'::jsonb,
      'vocabulary_stats', jsonb_build_object('unique_word_count', 15),
      'paragraphs', jsonb_build_array(
        jsonb_build_object(
          'position', 0, 'kind', 'paragraph', 'text', 'Wir sollten umkehren.', 'word_count', 3,
          'sentences', jsonb_build_array(jsonb_build_object(
            'position', 0, 'chapter_position', 0, 'text', 'Wir sollten umkehren.',
            'char_start', 0, 'char_end', 21, 'word_count', 3,
            'occurrences', jsonb_build_array(jsonb_build_object(
              'position', 1, 'surface', 'sollten', 'normalized', 'sollten',
              'lemma', 'sollen', 'word_id', 7701, 'char_start', 4, 'char_end', 11
            ))
          ))
        ),
        jsonb_build_object(
          'position', 1, 'kind', 'paragraph', 'text', 'Er zog sein Schwert.', 'word_count', 4,
          'sentences', jsonb_build_array(jsonb_build_object(
            'position', 0, 'chapter_position', 1, 'text', 'Er zog sein Schwert.',
            'char_start', 0, 'char_end', 20, 'word_count', 4,
            'occurrences', jsonb_build_array(
              jsonb_build_object('position', 1, 'surface', 'zog', 'normalized', 'zog',
                'lemma', 'ziehen', 'word_id', 7702, 'char_start', 3, 'char_end', 6),
              jsonb_build_object('position', 3, 'surface', 'Schwert', 'normalized', 'schwert',
                'lemma', 'Schwert', 'word_id', 7703, 'char_start', 12, 'char_end', 19)
            )
          ))
        ),
        jsonb_build_object(
          'position', 2, 'kind', 'paragraph', 'text', 'Sie zogen den Wagen.', 'word_count', 4,
          'sentences', jsonb_build_array(jsonb_build_object(
            'position', 0, 'chapter_position', 2, 'text', 'Sie zogen den Wagen.',
            'char_start', 0, 'char_end', 20, 'word_count', 4,
            'occurrences', jsonb_build_array(jsonb_build_object(
              'position', 1, 'surface', 'zogen', 'normalized', 'zogen',
              'lemma', 'ziehen', 'word_id', 7702, 'char_start', 4, 'char_end', 9
            ))
          ))
        ),
        jsonb_build_object(
          'position', 3, 'kind', 'paragraph', 'text', 'Sie wollten ihm Angst machen.', 'word_count', 5,
          'sentences', jsonb_build_array(jsonb_build_object(
            'position', 0, 'chapter_position', 3, 'text', 'Sie wollten ihm Angst machen.',
            'char_start', 0, 'char_end', 29, 'word_count', 5,
            -- `machen` gets no row: the dictionary does not know it, which is
            -- exactly the personal-word case (§82).
            'occurrences', jsonb_build_array(jsonb_build_object(
              'position', 3, 'surface', 'Angst', 'normalized', 'angst',
              'lemma', 'Angst', 'word_id', 7704, 'char_start', 16, 'char_end', 21
            ))
          ))
        )
      ),
      'vocabulary', jsonb_build_array(
        jsonb_build_object('word_id', 7701, 'occurrence_count', 1,
                           'first_paragraph_position', 0, 'first_sentence_position', 0),
        jsonb_build_object('word_id', 7702, 'occurrence_count', 2,
                           'first_paragraph_position', 1, 'first_sentence_position', 1),
        jsonb_build_object('word_id', 7703, 'occurrence_count', 1,
                           'first_paragraph_position', 1, 'first_sentence_position', 1),
        jsonb_build_object('word_id', 7704, 'occurrence_count', 1,
                           'first_paragraph_position', 3, 'first_sentence_position', 3)
      )
    )
  );

  perform public.replace_chapter_content(
    'cd000000-0000-0000-0000-000000000002',
    jsonb_build_object(
      'processor_version', 'content_v1', 'content_hash', 'notebook-hash-2',
      'word_count', 3, 'paragraph_count', 1, 'sentence_count', 1,
      'estimated_reading_minutes', 1, 'dictionary_match_rate', 0,
      'unmatched_sample', '[]'::jsonb,
      'vocabulary_stats', jsonb_build_object('unique_word_count', 3),
      'paragraphs', jsonb_build_array(jsonb_build_object(
        'position', 0, 'kind', 'paragraph', 'text', 'Ein privates Kapitel.', 'word_count', 3,
        'sentences', jsonb_build_array(jsonb_build_object(
          'position', 0, 'chapter_position', 0, 'text', 'Ein privates Kapitel.',
          'char_start', 0, 'char_end', 21, 'word_count', 3,
          'occurrences', '[]'::jsonb
        ))
      )),
      'vocabulary', '[]'::jsonb
    )
  );
end $$;

reset role;

-- A tiny helper so each assertion below reads as what it is testing rather than
-- as forty lines of jsonb. Mirrors exactly what `eventRow` in
-- `src/lib/learning/aggregate.ts` produces for a note event: no skill, no
-- concepts, no word channel — history, not mastery.
create or replace function pg_temp.note_evidence(
  p_key text, p_type text, p_sentence bigint
)
returns jsonb language sql as $$
  select jsonb_build_object(
    'events', jsonb_build_array(jsonb_build_object(
      'event_key', p_key,
      'event_type', p_type,
      'occurred_at', now(),
      'skill_code', null,
      'response_mode', 'passive',
      'retrieval_type', 'recognition',
      'is_correct', true,
      'hints_used', 0,
      'source_kind', 'notebook',
      'origin', 'native',
      'sentence_id', p_sentence,
      'concepts', '[]'::jsonb
    )),
    'skills', '[]'::jsonb, 'concepts', '[]'::jsonb, 'words', '[]'::jsonb
  );
$$;

\echo '── P1. a translation belongs to one learner and one sentence ───────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_sentence bigint;
  v_first    record;
  v_second   record;
  v_note     public.user_sentence_notes%rowtype;
  v_count    int;
begin
  select id into v_sentence from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 0;

  select * into v_first from public.save_sentence_translation(
    v_sentence, '  Powinniśmy zawrócić.  ',
    pg_temp.note_evidence('notebook:t:' || v_sentence, 'sentence_translation_created', v_sentence)
  );

  if not v_first.was_new then
    raise exception 'FAIL: the first save was not reported as new';
  end if;
  -- Trimmed on the way in: a note is what the learner wrote, not what their
  -- keyboard added around it.
  if v_first.translation <> 'Powinniśmy zawrócić.' then
    raise exception 'FAIL: the translation was not trimmed (got %)', v_first.translation;
  end if;

  select * into v_note from public.user_sentence_notes where id = v_first.note_id;

  -- THE ANCHOR IS THE POSITION, not the row id: this is what survives a chapter
  -- being reprocessed under a new tokenizer.
  if v_note.chapter_id <> 'cd000000-0000-0000-0000-000000000001'
     or v_note.sentence_position <> 0 then
    raise exception 'FAIL: the note was not anchored on (chapter, position)';
  end if;
  if v_note.sentence_text <> 'Wir sollten umkehren.' then
    raise exception 'FAIL: the German was not snapshotted onto the note';
  end if;
  if v_note.user_id <> 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid then
    raise exception 'FAIL: the note was not owned by the caller';
  end if;

  -- §126: a second save is an EDIT. One learner, one sentence, one note.
  select * into v_second from public.save_sentence_translation(
    v_sentence, 'Lepiej zawróćmy.',
    pg_temp.note_evidence('notebook:t:' || v_sentence, 'sentence_translation_created', v_sentence)
  );
  if v_second.was_new then
    raise exception 'FAIL: re-saving reported a new note';
  end if;
  if v_second.note_id <> v_first.note_id then
    raise exception 'FAIL: re-saving created a second note';
  end if;

  select count(*) into v_count from public.user_sentence_notes
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and chapter_id = 'cd000000-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL: % notes exist where one should', v_count;
  end if;

  -- THE EVENT FIRES ONCE, EVER. Editing is correcting what you already said.
  select count(*) into v_count from public.learning_events
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and event_type = 'sentence_translation_created';
  if v_count <> 1 then
    raise exception 'FAIL: editing a translation wrote % events', v_count;
  end if;

  -- §102: whitespace is not a translation.
  begin
    perform public.save_sentence_translation(
      v_sentence, '   ',
      pg_temp.note_evidence('notebook:blank', 'sentence_translation_created', v_sentence)
    );
    raise exception 'FAIL: a whitespace-only translation was stored';
  exception when sqlstate 'FL422' then null;
  end;
end $$;

\echo '── P2. a contextual meaning belongs to an OCCURRENCE, not a word ───────'

do $$
declare
  v_s1 bigint;
  v_s2 bigint;
  v_a  record;
  v_b  record;
  v_dictionary text;
begin
  select id into v_s1 from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 1;
  select id into v_s2 from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 2;

  -- The SAME lexeme (ziehen) in two sentences. §23, §127: two notes, two
  -- meanings, neither overwriting the other — which keying on `word_id` could
  -- not have done.
  select * into v_a from public.save_text_annotation(
    v_s1, 'word', 1, 1, 3, 6, 'zog', 'wyciągnął', 'ziehen', 8,
    pg_temp.note_evidence('notebook:m:' || v_s1, 'context_meaning_created', v_s1)
  );
  select * into v_b from public.save_text_annotation(
    v_s2, 'word', 1, 1, 4, 9, 'zogen', 'ciągnęli', null, 8,
    pg_temp.note_evidence('notebook:m:' || v_s2, 'context_meaning_created', v_s2)
  );

  if v_a.annotation_id = v_b.annotation_id then
    raise exception 'FAIL: two occurrences of one lexeme shared a note';
  end if;
  if v_a.meaning <> 'wyciągnął' or v_b.meaning <> 'ciągnęli' then
    raise exception 'FAIL: one contextual meaning overwrote the other';
  end if;

  -- The dictionary link is LOOKED UP, never accepted: both resolve to ziehen
  -- because that is what the content pipeline matched there.
  if v_a.word_id <> 7702 or v_b.word_id <> 7702 then
    raise exception 'FAIL: the annotation did not resolve to the matched lexeme';
  end if;

  -- §5, §84, §128: THE SHARED DICTIONARY IS UNTOUCHED. This is the invariant the
  -- whole occurrence layer exists to protect.
  select translation_pl into v_dictionary from public.words where id = 7702;
  if v_dictionary <> 'ciągnąć' then
    raise exception 'FAIL: a personal note changed words.translation_pl (now %)', v_dictionary;
  end if;
end $$;

\echo '── P3. a span is verified against the book ─────────────────────────────'

do $$
declare
  v_sentence bigint;
  v_phrase   record;
  v_personal record;
begin
  select id into v_sentence from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 3;

  -- §130: a real multi-token phrase, anchored on token positions and verified
  -- character by character against the stored sentence.
  select * into v_phrase from public.save_text_annotation(
    v_sentence, 'phrase', 3, 4, 16, 28, 'Angst machen', 'straszyć / budzić strach', null, 8,
    pg_temp.note_evidence('notebook:p:' || v_sentence, 'phrase_saved', v_sentence)
  );
  if v_phrase.surface <> 'Angst machen' then
    raise exception 'FAIL: the phrase surface was not stored as written';
  end if;
  -- §71: a phrase is its own unit. Pinning it to *Angst* would make recalling
  -- "Angst machen" count as knowing "Angst".
  if v_phrase.word_id is not null then
    raise exception 'FAIL: a phrase was linked to a dictionary entry';
  end if;

  -- §82, §132: `machen` has no occurrence row — the dictionary does not know it.
  -- It is still a word the learner met, and it is still saveable.
  select * into v_personal from public.save_text_annotation(
    v_sentence, 'word', 4, 4, 22, 28, 'machen', 'robić / sprawiać', null, 8,
    pg_temp.note_evidence('notebook:pw:' || v_sentence, 'context_meaning_created', v_sentence)
  );
  if v_personal.word_id is not null then
    raise exception 'FAIL: a personal word was attached to a dictionary entry';
  end if;
  if exists (select 1 from public.words where lemma = 'machen') then
    raise exception 'FAIL: saving a personal word wrote into the shared dictionary';
  end if;

  -- A FORGED SURFACE IS REFUSED. The offsets and the text have to agree with
  -- what the book says, or the notebook could be made to quote sentences the
  -- book does not contain.
  begin
    perform public.save_text_annotation(
      v_sentence, 'word', 3, 3, 16, 21, 'Freude', 'radość', null, 8,
      pg_temp.note_evidence('notebook:forged', 'context_meaning_created', v_sentence)
    );
    raise exception 'FAIL: a span was saved with a surface the sentence does not contain';
  exception when sqlstate 'FL422' then null;
  end;

  -- §32: the limit is passed IN, and enforced here as well as in the UI.
  begin
    perform public.save_text_annotation(
      v_sentence, 'phrase', 0, 4, 0, 28, 'Sie wollten ihm Angst machen', 'za długo', null, 2,
      pg_temp.note_evidence('notebook:long', 'phrase_saved', v_sentence)
    );
    raise exception 'FAIL: a span longer than the limit was saved';
  exception when sqlstate 'FL422' then null;
  end;

  -- A "word" is one token, by definition of the two kinds.
  begin
    perform public.save_text_annotation(
      v_sentence, 'word', 3, 4, 16, 28, 'Angst machen', 'nie', null, 8,
      pg_temp.note_evidence('notebook:badkind', 'context_meaning_created', v_sentence)
    );
    raise exception 'FAIL: a two-token span was saved as a word';
  exception when sqlstate 'FL422' then null;
  end;
end $$;

\echo '── P4. "nie rozumiem" is reversible, and the history is kept ───────────'

do $$
declare
  v_sentence bigint;
  v_state    record;
  v_note     public.user_sentence_notes%rowtype;
  v_marked   int;
  v_resolved int;
begin
  select id into v_sentence from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 1;

  select * into v_state from public.set_sentence_unclear(
    v_sentence, true,
    pg_temp.note_evidence('notebook:u:1', 'sentence_marked_unclear', v_sentence)
  );
  if not v_state.is_unclear then
    raise exception 'FAIL: the sentence was not flagged';
  end if;

  -- §18, §129: "już rozumiem" changes the STATE…
  select * into v_state from public.set_sentence_unclear(
    v_sentence, false,
    pg_temp.note_evidence('notebook:u:2', 'sentence_marked_understood', v_sentence)
  );
  if v_state.is_unclear then
    raise exception 'FAIL: the flag could not be cleared';
  end if;

  -- …and §19: the HISTORY keeps both. A learner is never left carrying a
  -- permanent failure, and we never lose the fact that they once struggled.
  select count(*) into v_marked from public.learning_events
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and event_type = 'sentence_marked_unclear';
  select count(*) into v_resolved from public.learning_events
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and event_type = 'sentence_marked_understood';
  if v_marked <> 1 or v_resolved <> 1 then
    raise exception 'FAIL: the unclear history is % marked / % resolved', v_marked, v_resolved;
  end if;

  -- §16: it is NOT a graded failure. No skill, no concept, no word knowledge
  -- moved — the learner told us WHERE they are stuck, not why.
  if exists (
    select 1 from public.learning_events
    where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      and event_type in ('sentence_marked_unclear', 'sentence_marked_understood')
      and (skill_code is not null or word_id is not null)
  ) then
    raise exception 'FAIL: an unclear flag was attributed to a skill or a word';
  end if;

  -- A sentence flagged and then understood, with no translation on it, leaves
  -- nothing behind: an empty note is not a note.
  select * into v_note from public.user_sentence_notes
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and chapter_id = 'cd000000-0000-0000-0000-000000000001'
     and sentence_position = 1;
  if v_note.id is not null then
    raise exception 'FAIL: an empty note was left behind';
  end if;
end $$;

\echo '── P5. deleting a note never touches the book ──────────────────────────'

do $$
declare
  v_sentence bigint;
  v_result   record;
  v_text     text;
begin
  select id into v_sentence from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 0;

  -- A note that also carries the unclear flag keeps it: deleting the translation
  -- is not the same act as saying you understand the sentence.
  perform public.set_sentence_unclear(
    v_sentence, true,
    pg_temp.note_evidence('notebook:u:3', 'sentence_marked_unclear', v_sentence)
  );
  select * into v_result from public.delete_sentence_translation(v_sentence);
  if v_result.deleted then
    raise exception 'FAIL: a flagged note was deleted with its translation';
  end if;
  if not exists (
    select 1 from public.user_sentence_notes
    where id = v_result.note_id and is_unclear and translation is null
  ) then
    raise exception 'FAIL: the unclear flag did not survive deleting the translation';
  end if;

  -- §13: the SENTENCE is untouched. It is the book's, not the learner's.
  select text into v_text from public.sentences where id = v_sentence;
  if v_text <> 'Wir sollten umkehren.' then
    raise exception 'FAIL: deleting a note changed the book';
  end if;
end $$;

\echo '── P6. no client write path exists at all ─────────────────────────────'

do $$
declare v_rows int;
begin
  -- Every column that matters — `user_id`, the anchor, the snapshots — is
  -- unforgeable because there is no INSERT/UPDATE/DELETE policy to forge it
  -- through. This is the same rule progress has followed since Phase 1.
  begin
    insert into public.user_sentence_notes
      (user_id, chapter_id, library_item_id, sentence_position, sentence_text, translation)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cd000000-0000-0000-0000-000000000001',
            'cc000000-0000-0000-0000-000000000001', 99, 'Gefälscht.', 'podrobione');
    raise exception 'FAIL: a learner inserted a sentence note directly';
  exception when insufficient_privilege then null;
  end;

  -- An UPDATE or DELETE with no policy behind it does not error — the rows are
  -- simply not there to change, which is the same guarantee arriving by a
  -- different route. Asserting on the ROW COUNT is therefore the honest test:
  -- a policy added later by accident would show up here as rows changed.
  update public.user_text_annotations set meaning = 'przejęte';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a learner updated % annotations directly', v_rows;
  end if;

  delete from public.user_notebook_reviews;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a learner deleted % review schedules directly', v_rows;
  end if;

  delete from public.user_sentence_notes;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a learner deleted % of their notes directly', v_rows;
  end if;

  -- …and nothing actually moved.
  if not exists (
    select 1 from public.user_text_annotations where meaning = 'wyciągnął'
  ) then
    raise exception 'FAIL: a direct update reached the annotations after all';
  end if;

  -- And the grading path takes a user id, so it is service_role only — exactly
  -- like `apply_review` and `apply_reading_lookup`.
  begin
    perform public.apply_notebook_review(
      'cccccccc-cccc-cccc-cccc-cccccccccccc', 'x', null, null,
      'phrase', 'good', 'flashcard', 'de_to_pl', null, '{}'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL: a learner could call apply_notebook_review';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

\echo '── P7. another learner sees nothing, and cannot reach private content ──'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_sentence bigint;
  v_private  bigint;
  v_visible  int;
begin
  -- §8, §107: two learners reading the same public book each see their own
  -- notes and nothing of each other's.
  select count(*) into v_visible from public.user_sentence_notes;
  if v_visible <> 0 then
    raise exception 'FAIL: learner B can read % of A''s notes', v_visible;
  end if;
  select count(*) into v_visible from public.user_text_annotations;
  if v_visible <> 0 then
    raise exception 'FAIL: learner B can read % of A''s annotations', v_visible;
  end if;
  select count(*) into v_visible from public.notebook_entries;
  if v_visible <> 0 then
    raise exception 'FAIL: the notebook view leaked % of A''s entries', v_visible;
  end if;

  -- B may annotate the PUBLIC book — that is the point of §107 — and the note is
  -- theirs alone, sitting at the same anchor as A's.
  set role postgres;
  select id into v_sentence from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000001' and chapter_position = 0;
  select id into v_private from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000002';
  set role authenticated;

  perform public.save_sentence_translation(
    v_sentence, 'Moje własne tłumaczenie.',
    pg_temp.note_evidence('notebook:b:' || v_sentence, 'sentence_translation_created', v_sentence)
  );
  select count(*) into v_visible from public.user_sentence_notes;
  if v_visible <> 1 then
    raise exception 'FAIL: learner B sees % notes after writing one', v_visible;
  end if;

  -- §106, §133: A'S PRIVATE IMPORT IS UNREACHABLE. B knows the sentence id and
  -- it makes no difference — `chapter_is_readable` refuses before anything is
  -- written, so B cannot even confirm the row exists.
  begin
    perform public.save_sentence_translation(
      v_private, 'Nie powinno się udać.',
      pg_temp.note_evidence('notebook:steal', 'sentence_translation_created', v_private)
    );
    raise exception 'FAIL: learner B annotated a private import';
  exception when sqlstate 'FL404' then null;
  end;

  begin
    perform public.set_sentence_unclear(
      v_private, true,
      pg_temp.note_evidence('notebook:steal2', 'sentence_marked_unclear', v_private)
    );
    raise exception 'FAIL: learner B flagged a sentence of a private import';
  exception when sqlstate 'FL404' then null;
  end;

  begin
    perform public.save_text_annotation(
      v_private, 'word', 0, 0, 0, 3, 'Ein', 'jeden', null, 8,
      pg_temp.note_evidence('notebook:steal3', 'context_meaning_created', v_private)
    );
    raise exception 'FAIL: learner B annotated a word of a private import';
  exception when sqlstate 'FL404' then null;
  end;
end $$;

reset role;

\echo '── P8. an admin is not an exception ───────────────────────────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}', false); end $switch$;
set role authenticated;

do $$
declare v_visible int;
begin
  -- A personal notebook is not content, and the admin panel is not a reason to
  -- read one. Same judgement `library_item_readable` already makes about a
  -- private import.
  select count(*) into v_visible from public.user_sentence_notes;
  if v_visible <> 0 then
    raise exception 'FAIL: an admin can read % learner notes', v_visible;
  end if;
  select count(*) into v_visible from public.user_text_annotations;
  if v_visible <> 0 then
    raise exception 'FAIL: an admin can read % learner annotations', v_visible;
  end if;
end $$;

reset role;

\echo '── P9. reviewing a note: opt-in, idempotent, one history ───────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_annotation bigint;
  v_review     record;
  v_scheduled  int;
begin
  select id into v_annotation from public.user_text_annotations
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and kind = 'phrase';

  -- §72: nothing is scheduled until the learner says so.
  select count(*) into v_scheduled from public.user_notebook_reviews;
  if v_scheduled <> 0 then
    raise exception 'FAIL: % notes were scheduled without being asked for', v_scheduled;
  end if;

  select * into v_review from public.set_notebook_review(v_annotation, null, true);
  if not v_review.enabled then
    raise exception 'FAIL: the note was not added to review';
  end if;

  -- Enabling twice is one card, not two.
  perform public.set_notebook_review(v_annotation, null, true);
  select count(*) into v_scheduled from public.user_notebook_reviews;
  if v_scheduled <> 1 then
    raise exception 'FAIL: enabling review twice made % cards', v_scheduled;
  end if;

  -- Ownership is proved by reading the parent as this learner. A note id that
  -- is not theirs is simply not found.
  begin
    perform public.set_notebook_review(999999, null, true);
    raise exception 'FAIL: a note that does not belong to the caller was scheduled';
  exception when sqlstate 'FL404' then null;
  end;

  -- Exactly one parent, always.
  begin
    perform public.set_notebook_review(v_annotation, 1, true);
    raise exception 'FAIL: a card was created with two parents';
  exception when sqlstate 'FL422' then null;
  end;
end $$;

reset role;
set role service_role;

do $$
declare
  v_annotation bigint;
  v_first      record;
  v_replay     record;
  v_events     int;
  v_srs        jsonb := jsonb_build_object(
    'before', jsonb_build_object('interval', 0, 'repetitions', 0, 'ease_factor', 2.5),
    'after',  jsonb_build_object('interval', 1, 'repetitions', 1, 'ease_factor', 2.6,
                                 'due_at', (now() + interval '1 day'),
                                 'is_mastered', false)
  );
begin
  select id into v_annotation from public.user_text_annotations
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and kind = 'phrase';

  select * into v_first from public.apply_notebook_review(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'notebook-int-1', v_annotation, null,
    'phrase', 'good', 'flashcard', 'de_to_pl', 1200, v_srs,
    pg_temp.note_evidence('notebook-review:notebook-int-1', 'notebook_review', null)
  );
  if v_first.already_applied then
    raise exception 'FAIL: the first grading was reported as a replay';
  end if;

  -- IDEMPOTENT BY CONSTRAINT, not by a UI guard: a double tap settles the same
  -- review rather than pushing the interval out twice.
  select * into v_replay from public.apply_notebook_review(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'notebook-int-1', v_annotation, null,
    'phrase', 'again', 'flashcard', 'de_to_pl', 1200, v_srs,
    pg_temp.note_evidence('notebook-review:notebook-int-1', 'notebook_review', null)
  );
  if not v_replay.already_applied then
    raise exception 'FAIL: a replayed grading was applied again';
  end if;

  -- ONE REVIEW HISTORY. The notebook card is a row of `review_events` like any
  -- word card — a second table would split the corpus a future memory model has
  -- to be fitted to.
  select count(*) into v_events from public.review_events
   where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and item_type = 'phrase' and annotation_id = v_annotation;
  if v_events <> 1 then
    raise exception 'FAIL: grading wrote % review events', v_events;
  end if;

  -- The stale-state guard: an interval computed from a schedule that has since
  -- moved is refused rather than silently applied.
  begin
    perform public.apply_notebook_review(
      'cccccccc-cccc-cccc-cccc-cccccccccccc', 'notebook-int-2', v_annotation, null,
      'phrase', 'good', 'flashcard', 'de_to_pl', null, v_srs,
      pg_temp.note_evidence('notebook-review:notebook-int-2', 'notebook_review', null)
    );
    raise exception 'FAIL: a grading computed from a stale schedule was applied';
  exception when sqlstate 'FL423' then null;
  end;
end $$;

reset role;

\echo '── P10. deleting a private book takes its notes with it ────────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_private bigint;
  v_notes   int;
begin
  set role postgres;
  select id into v_private from public.sentences
   where chapter_id = 'cd000000-0000-0000-0000-000000000002';
  set role authenticated;

  -- The owner CAN annotate their own private book…
  perform public.save_sentence_translation(
    v_private, 'Prywatny rozdział.',
    pg_temp.note_evidence('notebook:priv', 'sentence_translation_created', v_private)
  );

  select count(*) into v_notes from public.user_sentence_notes
   where library_item_id = 'cc000000-0000-0000-0000-000000000002';
  if v_notes <> 1 then
    raise exception 'FAIL: the owner could not annotate their own private book';
  end if;

  -- …and §117: deleting the book takes the note with it. A personal note holds a
  -- COPY of a sentence of that book, and a copy of a deleted private book is
  -- exactly what must not be left behind.
  perform public.delete_private_library_item('cc000000-0000-0000-0000-000000000002');

  select count(*) into v_notes from public.user_sentence_notes
   where library_item_id = 'cc000000-0000-0000-0000-000000000002';
  if v_notes <> 0 then
    raise exception 'FAIL: % private-book notes outlived the book', v_notes;
  end if;

  -- §118: the KNOWLEDGE is not source-specific and stays. Notes are about a
  -- book; what you learned is about you.
  if not exists (
    select 1 from public.user_text_annotations
    where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      and library_item_id = 'cc000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: deleting one book removed notes from another';
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '✔ personal notebook security suite passed'
