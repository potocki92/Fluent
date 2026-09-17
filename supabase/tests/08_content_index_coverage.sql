-- ═════════════════════════════════════════════════════════════════════════════
-- 08 — EVERY FOREIGN KEY INTO THE CONTENT GRAPH IS INDEXED.
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY THIS IS A TEST AND NOT A CODE REVIEW NOTE. Deleting a private book, and
-- reprocessing a chapter, both delete content rows in bulk: one book is one
-- `library_items` row, tens of thousands of `word_occurrences` rows, and a
-- referential action fired once PER CHILD ROW for every column that points at
-- one. Each of those actions is `where <fk> = $1`. With an index that is a
-- probe; without one it is a sequential scan of the learner's whole history,
-- and the delete cannot finish inside PostgREST's statement budget — which is
-- precisely the failure `20260917120000_content_delete_indexes.sql` fixes.
--
-- Postgres indexes the referenced side of a foreign key and never the
-- referencing side, so this is an invariant nothing enforces on its own. It is
-- also one that a future migration breaks silently and for free: add a table
-- with `chapter_id uuid references public.chapters(id)`, index it by
-- `(user_id, chapter_id)` because that is what the screen reads, and book
-- deletion gets quietly slower until one day it stops working.
--
-- So this suite asks the catalog rather than a list: EVERY single-column foreign
-- key in `public` whose target is part of the content graph must have an index
-- on the referencing table with that column FIRST. A composite index counts only
-- when the foreign key column leads it; a partial index counts, because every
-- predicate used here is `is not null` and a referential check always searches
-- for a concrete id.
\echo '▸ 08 content index coverage'

do $$
declare
  v_missing text;
begin
  select string_agg(
           format('%s.%s -> %s', c.conrelid::regclass, a.attname, c.confrelid::regclass),
           E'\n  ' order by c.conrelid::regclass::text, a.attname)
    into v_missing
  from pg_constraint c
  join pg_attribute  a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and array_length(c.conkey, 1) = 1
    -- The content graph: everything a book deletion or a chapter reprocess
    -- removes in bulk.
    and c.confrelid::regclass::text in (
      'library_items', 'chapters', 'paragraphs', 'sentences', 'word_occurrences',
      'chapter_vocabulary', 'chapter_questions', 'reading_sessions',
      'book_imports', 'user_text_annotations', 'user_sentence_notes',
      'chapter_preparation_sessions', 'chapter_assessment_sessions'
    )
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indkey[0] = c.conkey[1]
        -- An expression index cannot serve an equality on the raw column.
        and i.indexprs is null
    );

  if v_missing is not null then
    raise exception E'FAIL: foreign keys into the content graph with no supporting index:\n  %', v_missing;
  end if;
end $$;

-- The specific columns the book-deletion path depends on, named rather than
-- derived, so the failure message says what broke instead of only that
-- something did. These are the five per-row referential actions that fire on
-- every deleted occurrence and sentence — the ones that made "Usuń książkę"
-- time out.
do $$
declare
  v_pairs text[][] := array[
    ['learning_events',        'word_occurrence_id'],
    ['learning_events',        'sentence_id'],
    ['learning_events',        'chapter_id'],
    ['learning_events',        'library_item_id'],
    ['saved_words',            'origin_occurrence_id'],
    ['saved_words',            'origin_sentence_id'],
    ['saved_words',            'origin_chapter_id'],
    ['saved_words',            'origin_library_item_id'],
    ['reading_lookups',        'occurrence_id'],
    ['reading_lookups',        'sentence_id'],
    ['user_text_annotations',  'start_occurrence_id'],
    ['user_text_annotations',  'end_occurrence_id'],
    ['user_sentence_notes',    'sentence_id'],
    ['book_imports',           'final_library_item_id'],
    ['review_events',          'annotation_id'],
    ['review_events',          'sentence_note_id']
  ];
  v_i int;
begin
  for v_i in 1 .. array_length(v_pairs, 1) loop
    if not exists (
      select 1
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = ('public.' || v_pairs[v_i][1])::regclass
        and a.attname  = v_pairs[v_i][2]
        and i.indexprs is null
    ) then
      raise exception 'FAIL: %.% leads no index; deleting a book will scan it once per content row',
        v_pairs[v_i][1], v_pairs[v_i][2];
    end if;
  end loop;
end $$;

\echo '✔ content index coverage suite passed'
