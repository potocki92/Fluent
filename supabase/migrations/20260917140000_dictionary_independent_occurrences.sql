-- ═════════════════════════════════════════════════════════════════════════════
-- DICTIONARY-INDEPENDENT READING STRUCTURE
--
-- THE BUG THIS ENDS. `word_occurrences` used to get a row only for a token the
-- dictionary could match AT PROCESSING TIME. That made the STRUCTURE of a book a
-- function of the dictionary as it stood on the day it was imported: a word
-- added a month later was in `/browse` and dead text in the book, and the only
-- way to connect them was to reprocess the chapter — deleting and re-inserting
-- every paragraph, sentence and occurrence in it to change one nullable column.
-- For a 42-chapter novel that is an enormous, risky write whose real purpose was
-- a `word_id` update, and it had to be triggered by hand.
--
-- THE NEW INVARIANT, and it is the one the rest of this file exists to serve:
--
--     Every lexical token gets an occurrence. Dictionary resolution is OPTIONAL
--     and may evolve independently of the immutable reading structure.
--
-- So `word_id` is nullable in the honest sense — "no entry TODAY" — and the
-- structure around it never moves. Bringing a chapter up to date with a newer
-- dictionary is then an in-place, additive, idempotent pass
-- (`sync_chapter_dictionary` below) rather than a rewrite, which is why it is
-- safe to run on a book somebody is in the middle of reading.
--
-- WHAT THIS MIGRATION ADDS
--   1. `dictionary_revision` — one row, bumped by a trigger on `words`, so
--      "has the dictionary changed?" is a primary-key read.
--   2. `chapters.dictionary_revision` — which dictionary this chapter's stored
--      `word_id`s were resolved against. NULL means "never reconciled", which is
--      every chapter processed before today.
--   3. `sync_chapter_dictionary` — the only write path for reconciliation.
--
-- WHAT IT DOES NOT DO. No backfill runs here. The German tokenizer lives in
-- TypeScript (`src/lib/content/tokenize.ts`) and re-implementing it in PL/pgSQL
-- to fill the legacy gaps would be a second tokenizer — the one thing the content
-- pipeline is not allowed to have. Existing chapters are reconciled by the
-- application, batched, through the function below, the first time anything opens
-- them. Re-running this migration is safe and re-running a reconciliation writes
-- nothing.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE DICTIONARY'S REVISION NUMBER
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE ROW ON PURPOSE. The question "is my cached dictionary index still current?"
-- is asked on chapter renders, so it must cost a primary-key lookup — not a
-- `count(*)` that grows with the dictionary, and not a `max(updated_at)` that
-- cannot see a DELETE.
create table if not exists public.dictionary_revision (
  id         boolean primary key default true check (id),
  revision   bigint      not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.dictionary_revision (id) values (true)
on conflict (id) do nothing;

-- Statement-level: one bump per statement, so importing 5 000 words costs one
-- update rather than five thousand.
create or replace function public.bump_dictionary_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.dictionary_revision d
     set revision = d.revision + 1,
         updated_at = now()
   where d.id;
  return null;
end;
$$;

drop trigger if exists words_bump_dictionary_revision on public.words;
create trigger words_bump_dictionary_revision
  after insert or update or delete on public.words
  for each statement execute function public.bump_dictionary_revision();

alter table public.dictionary_revision enable row level security;

-- Readable by everyone, exactly like `words` itself: it says nothing but "the
-- dictionary has changed N times". Writable by nobody — only the trigger, which
-- is security definer.
drop policy if exists "dictionary revision read" on public.dictionary_revision;
create policy "dictionary revision read" on public.dictionary_revision
  for select using (true);

grant select on public.dictionary_revision to anon, authenticated;
revoke insert, update, delete on public.dictionary_revision from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WHICH DICTIONARY A CHAPTER AGREES WITH
-- ─────────────────────────────────────────────────────────────────────────────
-- `content_hash` describes the source and `processor_version` describes the
-- pipeline; neither said anything about `words`, which is precisely why nothing
-- ever noticed that a chapter's glosses had fallen behind. This is that missing
-- third stamp, and it is what makes reconciliation a no-op when there is nothing
-- to do.
alter table public.chapters
  add column if not exists dictionary_revision bigint;

comment on column public.chapters.dictionary_revision is
  'The dictionary_revision.revision this chapter''s word_occurrences.word_id values were resolved against. NULL means never reconciled.';

-- The reconciler updates unresolved rows by (chapter, normalized form). The
-- existing (chapter_id, word_id) index already serves "this chapter''s
-- unresolved tokens", which is the selective half of that predicate.
comment on table public.word_occurrences is
  'One row per LEXICAL TOKEN of a sentence. word_id is the current dictionary''s answer and NULL is a legitimate one; the row, its position and its offsets are structure and never depend on the dictionary.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RECONCILIATION — the in-place, additive write path
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRAST IT WITH `replace_chapter_content`, which is the function for when the
-- TEXT changed: that one deletes paragraphs wholesale and everything cascades.
-- This one only ever
--
--   * inserts occurrence rows for token positions that have none, and
--   * fills in `word_id` / `lemma` on rows that had no answer yet.
--
-- It never deletes an occurrence, never renumbers a position, never touches a
-- paragraph, a sentence or a character of text. Reading progress, notebook notes,
-- saved words and reading history are anchored on exactly those positions and
-- ids, so they survive by construction — which is the difference between a pass
-- that can run while somebody is reading and one that cannot.
--
-- IDEMPOTENT. The insert conflicts on the unique (sentence_id, position) index
-- and does nothing; the update only touches rows that are still unresolved.
-- Running it twice writes nothing the second time.
--
-- TRUSTED INPUT, VERIFIED ANYWAY. Sentences are joined back to the chapter, so a
-- payload cannot reach another chapter's rows, and `word_id` is looked up in
-- `words` rather than trusted, so a dictionary entry deleted mid-run leaves the
-- occurrence unresolved instead of aborting the batch.
--
-- service_role only: it accepts computed structure, so a browser must never reach
-- it. The application decides WHO may ask for a chapter to be reconciled (anyone
-- who may read it) — but the payload is always derived from that chapter's own
-- stored text and from `words`, never from the caller.
create or replace function public.sync_chapter_dictionary(
  p_chapter_id  uuid,
  p_occurrences jsonb   default '[]'::jsonb,
  p_resolutions jsonb   default '[]'::jsonb,
  p_revision    bigint  default null,
  p_finalize    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter  public.chapters%rowtype;
  v_inserted int := 0;
  v_resolved int := 0;
begin
  select * into v_chapter from public.chapters c where c.id = p_chapter_id for update;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  -- 3a. The gaps: token positions a pre-phase chapter never stored a row for.
  with payload as (
    select
      (row ->> 'sentenceId')::bigint as sentence_id,
      (row ->> 'position')::int      as position,
      row ->> 'surface'              as surface,
      row ->> 'normalized'           as normalized,
      row ->> 'lemma'                as lemma,
      (row ->> 'wordId')::bigint     as word_id,
      coalesce((row ->> 'charStart')::int, 0) as char_start,
      coalesce((row ->> 'charEnd')::int, 0)   as char_end
    from jsonb_array_elements(coalesce(p_occurrences, '[]'::jsonb)) as t(row)
  ),
  inserted as (
    insert into public.word_occurrences (
      sentence_id, chapter_id, position, surface, normalized, lemma,
      word_id, char_start, char_end
    )
    select
      p.sentence_id,
      p_chapter_id,
      p.position,
      p.surface,
      p.normalized,
      p.lemma,
      -- Never trusted: a dictionary row can vanish between planning and writing.
      (select w.id from public.words w where w.id = p.word_id),
      p.char_start,
      p.char_end
    from payload p
    -- The payload cannot reach outside the chapter it names.
    join public.sentences s on s.id = p.sentence_id and s.chapter_id = p_chapter_id
    where p.surface is not null and p.normalized is not null
    on conflict (sentence_id, position) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  -- 3b. The resolutions: "every unresolved occurrence of this form, in this
  -- chapter, is that dictionary word". Keyed on the normalized form because that
  -- is the only thing matching depends on — which is also why one update per
  -- distinct form is enough for thousands of tokens.
  with payload as (
    select distinct on (row ->> 'normalized')
      row ->> 'normalized'         as normalized,
      (row ->> 'wordId')::bigint   as word_id,
      row ->> 'lemma'              as lemma
    from jsonb_array_elements(coalesce(p_resolutions, '[]'::jsonb)) as t(row)
    -- `distinct on` without an order is an arbitrary choice; a duplicated form
    -- in the payload must not make the write non-deterministic.
    order by row ->> 'normalized', (row ->> 'wordId')::bigint
  ),
  updated as (
    update public.word_occurrences o
       set word_id = w.id,
           lemma   = coalesce(p.lemma, o.lemma)
      from payload p
      join public.words w on w.id = p.word_id
     where o.chapter_id = p_chapter_id
       and o.word_id is null
       and o.normalized = p.normalized
    returning 1
  )
  select count(*) into v_resolved from updated;

  -- 3c. Finalising: the aggregate and the stamp, together, once the whole
  -- chapter has been walked.
  --
  -- `chapter_vocabulary` is RECOMPUTED from the occurrences rather than patched,
  -- because it is a derived aggregate and the one thing worse than a stale
  -- aggregate is one that is stale in a way nothing can detect. This is counting,
  -- not arithmetic the application owns: the frequencies and first positions are
  -- read straight off the rows.
  if p_finalize then
    delete from public.chapter_vocabulary v where v.chapter_id = p_chapter_id;

    insert into public.chapter_vocabulary (
      chapter_id, word_id, occurrence_count,
      first_paragraph_position, first_sentence_position
    )
    select
      p_chapter_id,
      o.word_id,
      count(*),
      min(p.position),
      min(s.chapter_position)
    from public.word_occurrences o
    join public.sentences  s on s.id = o.sentence_id
    join public.paragraphs p on p.id = s.paragraph_id
    where o.chapter_id = p_chapter_id
      and o.word_id is not null
    group by o.word_id;

    update public.chapters c
       set dictionary_revision = coalesce(p_revision, c.dictionary_revision),
           updated_at          = now()
     where c.id = p_chapter_id;
  end if;

  return jsonb_build_object(
    'chapter_id', p_chapter_id,
    'inserted',   v_inserted,
    'resolved',   v_resolved,
    'finalized',  p_finalize
  );
end;
$$;

revoke all on function public.sync_chapter_dictionary(uuid, jsonb, jsonb, bigint, boolean) from public;
revoke all on function public.sync_chapter_dictionary(uuid, jsonb, jsonb, bigint, boolean) from anon, authenticated;
grant execute on function public.sync_chapter_dictionary(uuid, jsonb, jsonb, bigint, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PROCESSING STAMPS THE DICTIONARY IT USED
-- ─────────────────────────────────────────────────────────────────────────────
-- A freshly processed chapter already agrees with the dictionary that processed
-- it, so it carries the stamp from the start and the reconciler skips it. The
-- rest of the function is unchanged — this is `replace_chapter_content` with one
-- more column written from the payload.
create or replace function public.replace_chapter_content(
  p_chapter_id uuid,
  p_payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chapter      public.chapters%rowtype;
  v_paragraph    jsonb;
  v_sentence     jsonb;
  v_occurrence   jsonb;
  v_paragraph_id bigint;
  v_sentence_id  bigint;
  v_word_count   int;
  v_item_words   int;
  v_item_chapters int;
begin
  select * into v_chapter from public.chapters c where c.id = p_chapter_id for update;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  delete from public.paragraphs p where p.chapter_id = p_chapter_id;
  delete from public.chapter_vocabulary v where v.chapter_id = p_chapter_id;

  for v_paragraph in
    select value from jsonb_array_elements(coalesce(p_payload -> 'paragraphs', '[]'::jsonb))
  loop
    insert into public.paragraphs (chapter_id, position, kind, text, word_count)
    values (
      p_chapter_id,
      (v_paragraph ->> 'position')::int,
      coalesce(v_paragraph ->> 'kind', 'paragraph'),
      v_paragraph ->> 'text',
      coalesce((v_paragraph ->> 'word_count')::int, 0)
    )
    returning id into v_paragraph_id;

    for v_sentence in
      select value from jsonb_array_elements(coalesce(v_paragraph -> 'sentences', '[]'::jsonb))
    loop
      insert into public.sentences (
        paragraph_id, chapter_id, position, chapter_position,
        text, char_start, char_end, word_count
      ) values (
        v_paragraph_id,
        p_chapter_id,
        (v_sentence ->> 'position')::int,
        (v_sentence ->> 'chapter_position')::int,
        v_sentence ->> 'text',
        coalesce((v_sentence ->> 'char_start')::int, 0),
        coalesce((v_sentence ->> 'char_end')::int, 0),
        coalesce((v_sentence ->> 'word_count')::int, 0)
      )
      returning id into v_sentence_id;

      for v_occurrence in
        select value from jsonb_array_elements(coalesce(v_sentence -> 'occurrences', '[]'::jsonb))
      loop
        insert into public.word_occurrences (
          sentence_id, chapter_id, position, surface, normalized, lemma,
          word_id, char_start, char_end
        ) values (
          v_sentence_id,
          p_chapter_id,
          (v_occurrence ->> 'position')::int,
          v_occurrence ->> 'surface',
          v_occurrence ->> 'normalized',
          v_occurrence ->> 'lemma',
          -- NULL is the ordinary case now: a token the dictionary has no entry
          -- for is still a token, and still a row.
          (v_occurrence ->> 'word_id')::bigint,
          coalesce((v_occurrence ->> 'char_start')::int, 0),
          coalesce((v_occurrence ->> 'char_end')::int, 0)
        );
      end loop;
    end loop;
  end loop;

  insert into public.chapter_vocabulary (
    chapter_id, word_id, occurrence_count,
    first_paragraph_position, first_sentence_position
  )
  select
    p_chapter_id,
    (entry ->> 'word_id')::bigint,
    coalesce((entry ->> 'occurrence_count')::int, 1),
    coalesce((entry ->> 'first_paragraph_position')::int, 0),
    coalesce((entry ->> 'first_sentence_position')::int, 0)
  from jsonb_array_elements(coalesce(p_payload -> 'vocabulary', '[]'::jsonb)) as t(entry)
  -- A dictionary row can disappear between processing and persisting; the
  -- occurrence keeps its lemma either way, the aggregate simply skips it.
  where exists (select 1 from public.words w where w.id = (entry ->> 'word_id')::bigint)
  on conflict (chapter_id, word_id) do update
    set occurrence_count = excluded.occurrence_count;

  v_word_count := coalesce((p_payload ->> 'word_count')::int, 0);

  update public.chapters c
     set word_count                = v_word_count,
         paragraph_count           = coalesce((p_payload ->> 'paragraph_count')::int, 0),
         sentence_count            = coalesce((p_payload ->> 'sentence_count')::int, 0),
         estimated_reading_minutes = greatest(1, coalesce((p_payload ->> 'estimated_reading_minutes')::int, 1)),
         processor_version         = p_payload ->> 'processor_version',
         content_hash              = p_payload ->> 'content_hash',
         dictionary_revision       = coalesce((p_payload ->> 'dictionary_revision')::bigint, c.dictionary_revision),
         dictionary_match_rate     = (p_payload ->> 'dictionary_match_rate')::numeric,
         unmatched_sample          = coalesce(p_payload -> 'unmatched_sample', '[]'::jsonb),
         vocabulary_stats          = coalesce(p_payload -> 'vocabulary_stats', '{}'::jsonb),
         status                    = 'ready',
         processing_error          = null,
         processed_at              = now(),
         updated_at                = now()
   where c.id = p_chapter_id;

  -- The item's totals are DERIVED from its chapters, never asserted, so they
  -- cannot drift away from the content they describe.
  select coalesce(sum(c.word_count), 0), count(*)
    into v_item_words, v_item_chapters
  from public.chapters c where c.library_item_id = v_chapter.library_item_id;

  update public.library_items i
     set word_count    = v_item_words,
         chapter_count = v_item_chapters,
         updated_at    = now()
   where i.id = v_chapter.library_item_id;

  return jsonb_build_object(
    'chapter_id', p_chapter_id,
    'paragraph_count', coalesce((p_payload ->> 'paragraph_count')::int, 0),
    'sentence_count', coalesce((p_payload ->> 'sentence_count')::int, 0),
    'word_count', v_word_count
  );
end;
$$;

revoke all on function public.replace_chapter_content(uuid, jsonb) from public;
revoke all on function public.replace_chapter_content(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_chapter_content(uuid, jsonb) to service_role;
