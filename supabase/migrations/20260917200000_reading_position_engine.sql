-- ═════════════════════════════════════════════════════════════════════════════
-- Fluent — READING POSITION ENGINE
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Two bugs, one root cause: reading progress was expressed as a PARAGRAPH INDEX.
--
--   1. `progress_ratio = (furthest_paragraph + 1) / paragraph_count` gives an
--      eight-word line of dialogue and a four-hundred-word description exactly
--      the same weight. In a novel that is not a rounding error — reading two
--      lines of a chapter of dialogue could report 8%, and reading three pages
--      of description could report 2%.
--
--   2. A paragraph is far too coarse to be a bookmark. A learner who stopped in
--      the middle of a 400-word paragraph was returned to the top of it, and the
--      only finer column that existed (`resume_sentence_position`) was never
--      written by anything.
--
-- So this migration moves the whole model onto WORDS — lexical tokens, the unit
-- the content pipeline already counts:
--
--   sentences.word_start        how many of the chapter's tokens precede this
--                               sentence. Derived, never asserted: the database
--                               computes it from `word_count` when content is
--                               stored, which is why the pipeline itself is
--                               untouched and CONTENT_PROCESSOR_VERSION does not
--                               move — the same input still produces the same
--                               paragraphs, sentences, tokens and positions.
--
--   chapters.reading_word_count the denominator, on the same scale.
--
--   reading_progress.*_word_offset   where the learner is / has been, in tokens.
--   reading_progress.*_sentence_position, *_token_position
--                               the ANCHOR those offsets came from, so the
--                               reader can scroll back to the exact place rather
--                               than to the top of a paragraph.
--
-- NOTHING IS LOST AND NOTHING NEEDS RESETTING. `resume_paragraph_position` and
-- `furthest_paragraph_position` stay, keep being written, and remain the
-- fallback for a bookmark saved before this existed. Existing rows are converted
-- in place: a learner who had read through paragraph 80 still has read through
-- paragraph 80 — only its expression as a percentage is corrected. A chapter
-- already completed keeps 100%, so nothing that was finished becomes unfinished.
--
-- See `docs/architecture/reader-story-engine.md` § Reading Position Engine.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE WORD SCALE
-- ─────────────────────────────────────────────────────────────────────────────

-- Exclusive prefix sum of `word_count` over the chapter's sentences, in reading
-- order. Turning an anchor into an offset is then one index seek, which is what
-- makes the reader able to ask "how far through am I?" on every animation frame.
alter table public.sentences
  add column if not exists word_start int not null default 0;

-- The denominator, from the same rows as the numerator. NOT `chapters.word_count`
-- — that is counted by a different function (`countWords` over paragraph text,
-- for display and time estimates) and would be a few tokens off, which is how a
-- progress bar ends up at 99.7% on the last word of a chapter.
alter table public.chapters
  add column if not exists reading_word_count int not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THREE POSITIONS, STORED AS THREE THINGS
-- ─────────────────────────────────────────────────────────────────────────────
-- current   is never stored: it is whatever the reading line is on right now.
-- resume    follows the learner, in BOTH directions.
-- furthest  only ever increases, and is the only input to progress and
--           completion.
--
-- `resume_sentence_position` already existed and was dead. It is alive now, and
-- it means the sentence's position within the CHAPTER (`chapter_position`) —
-- unique per chapter, so an anchor resolves without a join.
alter table public.reading_progress
  add column if not exists resume_token_position      int,
  add column if not exists resume_word_offset         int not null default 0,
  add column if not exists furthest_sentence_position int,
  add column if not exists furthest_token_position    int,
  add column if not exists furthest_word_offset       int not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL — the word scale for content that already exists
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent by construction: both statements compute the target value and skip
-- rows that already hold it, so re-running the migration (or re-applying
-- `schema.sql` to a live database) is a no-op rather than a rewrite.

with ordered as (
  select
    s.id,
    coalesce(
      sum(s.word_count) over (
        partition by s.chapter_id
        order by s.chapter_position, s.id
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as computed_start
  from public.sentences s
)
update public.sentences s
   set word_start = o.computed_start
  from ordered o
 where s.id = o.id
   and s.word_start is distinct from o.computed_start;

update public.chapters c
   set reading_word_count = t.total
  from (
    select s.chapter_id, coalesce(max(s.word_start + s.word_count), 0) as total
    from public.sentences s
    group by s.chapter_id
  ) t
 where t.chapter_id = c.id
   and c.reading_word_count is distinct from t.total;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. BACKFILL — every learner's existing place, on the new scale
-- ─────────────────────────────────────────────────────────────────────────────
-- A paragraph bookmark carries no sentence, so the conversion is the only thing
-- it can honestly be:
--
--   furthest  the END of the furthest paragraph reached — "read through it",
--             which is exactly what the old ratio claimed
--   resume    the START of the paragraph the learner was on
--
-- A completed chapter is pinned at the end: it was finished, and an arithmetic
-- change must never un-finish it.
--
-- The `furthest_word_offset = 0` guard is what makes this run once. A row the
-- engine has since written has a non-zero offset and is left alone.
update public.reading_progress p
   set furthest_word_offset = x.furthest_offset,
       resume_word_offset   = x.resume_offset,
       progress_ratio       = case
         when x.total <= 0 then p.progress_ratio
         else round(x.furthest_offset::numeric / x.total, 4)
       end
  from (
    select
      p2.user_id,
      p2.chapter_id,
      c.reading_word_count as total,
      case
        when p2.completed_at is not null then c.reading_word_count
        else least(
          coalesce((
            select max(s.word_start + s.word_count)
            from public.sentences s
            join public.paragraphs pg on pg.id = s.paragraph_id
            where pg.chapter_id = c.id
              and pg.position <= p2.furthest_paragraph_position
          ), 0),
          c.reading_word_count
        )
      end as furthest_offset,
      coalesce((
        select min(s.word_start)
        from public.sentences s
        join public.paragraphs pg on pg.id = s.paragraph_id
        where pg.chapter_id = c.id
          and pg.position = p2.resume_paragraph_position
      ), 0) as resume_offset
    from public.reading_progress p2
    join public.chapters c on c.id = p2.chapter_id
    where p2.furthest_word_offset = 0
      and c.reading_word_count > 0
  ) x
 where p.user_id = x.user_id
   and p.chapter_id = x.chapter_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ANCHOR → WORD OFFSET
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SERVER RESOLVES THE ANCHOR, NOT THE CLIENT. The reader reports a place in
-- the text — a paragraph, a sentence, a token — and the database works out what
-- that is worth. A client that sent an offset (or a percentage) directly would
-- be deciding its own progress, which is the one thing progress may never be.
--
-- Three levels of precision, in order, because a bookmark is allowed to be vague
-- and must never be wrong:
--
--   sentence + token   exact: the token the reading line was on
--   sentence           the start of that sentence
--   paragraph only     the start of that paragraph — the legacy bookmark
create or replace function public.reading_word_offset(
  p_chapter_id uuid,
  p_paragraph  int,
  p_sentence   int,
  p_token      int
)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select s.word_start + least(greatest(coalesce(p_token, 0), 0), s.word_count)
      from public.sentences s
      where s.chapter_id = p_chapter_id
        and s.chapter_position = p_sentence
      limit 1
    ),
    (
      select min(s.word_start)
      from public.sentences s
      join public.paragraphs pg on pg.id = s.paragraph_id
      where pg.chapter_id = p_chapter_id
        and pg.position = p_paragraph
    ),
    0
  );
$$;

-- NOT REACHABLE FROM A BROWSER ROLE. It exists for the SECURITY DEFINER
-- functions that own progress; a learner has no business resolving anchors
-- directly, and every answer they could want comes back from a report anyway.
revoke all on function public.reading_word_offset(uuid, int, int, int) from public;
revoke all on function public.reading_word_offset(uuid, int, int, int) from anon, authenticated;
grant execute on function public.reading_word_offset(uuid, int, int, int) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE PIPELINE DERIVES THE WORD SCALE WHEN IT STORES CONTENT
-- ─────────────────────────────────────────────────────────────────────────────
-- Unchanged from the previous definition except for the two statements at the
-- end of the content loop. Deliberately DERIVED here rather than accepted from
-- the payload: `word_start` is a running total of numbers the pipeline already
-- produced, and a second definition of it in TypeScript is a second thing that
-- can disagree with the progress bar.
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
  v_reading_words int;
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
          (v_occurrence ->> 'word_id')::bigint,
          coalesce((v_occurrence ->> 'char_start')::int, 0),
          coalesce((v_occurrence ->> 'char_end')::int, 0)
        );
      end loop;
    end loop;
  end loop;

  -- THE WORD SCALE. One pass with a window function over the chapter's own
  -- sentences, in reading order.
  with ordered as (
    select
      s.id,
      coalesce(
        sum(s.word_count) over (
          order by s.chapter_position, s.id
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as computed_start
    from public.sentences s
    where s.chapter_id = p_chapter_id
  )
  update public.sentences s
     set word_start = o.computed_start
    from ordered o
   where s.id = o.id;

  select coalesce(max(s.word_start + s.word_count), 0)
    into v_reading_words
  from public.sentences s where s.chapter_id = p_chapter_id;

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
         reading_word_count        = v_reading_words,
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
    'word_count', v_word_count,
    'reading_word_count', v_reading_words
  );
end;
$$;

revoke all on function public.replace_chapter_content(uuid, jsonb) from public;
revoke all on function public.replace_chapter_content(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_chapter_content(uuid, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OPENING A CHAPTER RETURNS THE WHOLE POSITION
-- ─────────────────────────────────────────────────────────────────────────────
-- Dropped rather than replaced: the return shape changes, and PostgreSQL will
-- not `create or replace` a function whose OUT columns differ.
drop function if exists public.start_reading_session(uuid);

create or replace function public.start_reading_session(p_chapter_id uuid)
returns table (
  session_id          uuid,
  library_item_id     uuid,
  resume_paragraph    int,
  resume_sentence     int,
  resume_token        int,
  resume_word_offset  int,
  furthest_paragraph  int,
  furthest_sentence   int,
  furthest_token      int,
  furthest_word_offset int,
  reading_word_count  int,
  progress_ratio      numeric,
  completed_at        timestamptz,
  resumed             boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_item      uuid;
  v_status    text;
  v_session   uuid;
  v_existing  boolean := false;
  v_words     int;
  v_progress  public.reading_progress%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id, c.status, c.reading_word_count
    into v_item, v_status, v_words
  from public.chapters c
  join public.library_items i on i.id = c.library_item_id
  where c.id = p_chapter_id
    and public.library_item_readable(i.status, i.archived_at, i.owner_user_id);

  if v_item is null then
    raise exception 'Rozdział nie istnieje lub nie masz do niego dostępu.' using errcode = 'FL404';
  end if;
  if v_status <> 'ready' then
    -- Unprocessed content is not shown to a learner: half-parsed text is worse
    -- than an honest "jeszcze nie gotowe".
    raise exception 'Rozdział nie jest jeszcze gotowy do czytania.' using errcode = 'FL412';
  end if;

  insert into public.reading_progress (user_id, chapter_id, library_item_id, session_count)
  values (v_user, p_chapter_id, v_item, 1)
  on conflict (user_id, chapter_id) do update
    set last_read_at  = now(),
        session_count = public.reading_progress.session_count + 1;

  select * into v_progress
  from public.reading_progress p
  where p.user_id = v_user and p.chapter_id = p_chapter_id;

  select s.id into v_session
  from public.reading_sessions s
  where s.user_id = v_user and s.chapter_id = p_chapter_id and s.status = 'in_progress'
  limit 1;

  if v_session is not null then
    v_existing := true;
    update public.reading_sessions s
       set last_active_at = now()
     where s.id = v_session;
  else
    insert into public.reading_sessions (
      user_id, chapter_id, library_item_id, progress_before, progress_after
    ) values (
      v_user, p_chapter_id, v_item, v_progress.progress_ratio, v_progress.progress_ratio
    )
    returning id into v_session;
  end if;

  return query select
    v_session,
    v_item,
    v_progress.resume_paragraph_position,
    v_progress.resume_sentence_position,
    v_progress.resume_token_position,
    v_progress.resume_word_offset,
    v_progress.furthest_paragraph_position,
    v_progress.furthest_sentence_position,
    v_progress.furthest_token_position,
    v_progress.furthest_word_offset,
    coalesce(v_words, 0),
    v_progress.progress_ratio,
    v_progress.completed_at,
    v_existing;
end;
$$;

revoke all on function public.start_reading_session(uuid) from public;
revoke all on function public.start_reading_session(uuid) from anon;
grant execute on function public.start_reading_session(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RECORDING A POSITION
-- ─────────────────────────────────────────────────────────────────────────────
-- TWO ANCHORS PER REPORT, AND THAT IS THE WHOLE FIX.
--
--   the resume anchor    where the learner IS. Written in both directions.
--   the furthest anchor  how far they have CONFIRMED reading — the reader only
--                        advances this after the place has held at the reading
--                        line for a dwell, so a fling to the end of the chapter
--                        moves the bookmark and not the progress bar.
--
-- `greatest(...)` is still where monotonicity lives, not an application `if`:
-- two tabs on the same chapter report different positions and only the database
-- sees both.
--
-- `p_max_active_seconds` is the cap from `src/lib/reading/constants.ts`. It is a
-- PARAMETER rather than a literal so the constant stays in one place, and it is
-- applied here rather than trusted from the client so that a slept machine, a
-- paused debugger or a forged request cannot claim an hour of reading.
drop function if exists public.record_reading_progress(uuid, int, int, int, int);

create or replace function public.record_reading_progress(
  p_session_id                  uuid,
  p_paragraph_position          int,
  p_sentence_position           int,
  p_token_position              int,
  p_furthest_paragraph_position int,
  p_furthest_sentence_position  int,
  p_furthest_token_position     int,
  p_active_seconds              int,
  p_max_active_seconds          int
)
returns table (
  progress_ratio       numeric,
  furthest_paragraph   int,
  furthest_word_offset int,
  reading_word_count   int,
  active_seconds       int,
  words_read           int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user         uuid := (select auth.uid());
  v_session      public.reading_sessions%rowtype;
  v_paragraphs   int;
  v_words        int;
  v_total        int;
  v_resume_par   int;
  v_furthest_par int;
  v_resume_off   int;
  v_reported_off int;
  v_seconds      int;
  v_ratio        numeric;
  v_furthest     int;
  v_offset       int;
  v_seconds_total int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_session
  from public.reading_sessions s
  where s.id = p_session_id for update;

  if not found then
    raise exception 'Sesja czytania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'Ta sesja czytania została zakończona.' using errcode = 'FL409';
  end if;

  select greatest(c.paragraph_count, 1), c.word_count, c.reading_word_count
    into v_paragraphs, v_words, v_total
  from public.chapters c where c.id = v_session.chapter_id;

  v_resume_par := least(greatest(coalesce(p_paragraph_position, 0), 0), v_paragraphs - 1);
  v_furthest_par := least(
    greatest(coalesce(p_furthest_paragraph_position, v_resume_par), 0),
    v_paragraphs - 1
  );
  v_seconds := least(
    greatest(coalesce(p_active_seconds, 0), 0),
    greatest(coalesce(p_max_active_seconds, 0), 0)
  );

  v_resume_off := public.reading_word_offset(
    v_session.chapter_id, v_resume_par, p_sentence_position, p_token_position
  );
  v_reported_off := public.reading_word_offset(
    v_session.chapter_id, v_furthest_par,
    p_furthest_sentence_position, p_furthest_token_position
  );

  update public.reading_progress p
     set resume_paragraph_position   = v_resume_par,
         resume_sentence_position    = p_sentence_position,
         resume_token_position       = p_token_position,
         resume_word_offset          = v_resume_off,

         furthest_paragraph_position = greatest(p.furthest_paragraph_position, v_furthest_par),
         furthest_word_offset        = greatest(p.furthest_word_offset, v_reported_off),
         -- The anchor is kept only when it is the one that WON, so the stored
         -- sentence and token always describe the stored offset.
         furthest_sentence_position  = case
           when v_reported_off > p.furthest_word_offset then p_furthest_sentence_position
           else p.furthest_sentence_position
         end,
         furthest_token_position     = case
           when v_reported_off > p.furthest_word_offset then p_furthest_token_position
           else p.furthest_token_position
         end,

         progress_ratio = case
           -- THE WORD SCALE, when the chapter has one.
           when coalesce(v_total, 0) > 0 then greatest(
             p.progress_ratio,
             round(greatest(p.furthest_word_offset, v_reported_off)::numeric / v_total, 4)
           )
           -- FALLBACK for a chapter stored before this migration ran and never
           -- reprocessed since. Coarse, but it is the same answer the reader gave
           -- yesterday, which is better than dividing by zero.
           else greatest(
             p.progress_ratio,
             round((greatest(p.furthest_paragraph_position, v_furthest_par) + 1)::numeric / v_paragraphs, 4)
           )
         end,
         active_seconds = p.active_seconds + v_seconds,
         last_read_at   = now()
   where p.user_id = v_user and p.chapter_id = v_session.chapter_id
   returning p.progress_ratio, p.furthest_paragraph_position,
             p.furthest_word_offset, p.active_seconds
        into v_ratio, v_furthest, v_offset, v_seconds_total;

  if v_ratio is null then
    raise exception 'Brak postępu czytania dla tej sesji.' using errcode = 'FL404';
  end if;

  update public.reading_sessions s
     set active_seconds   = s.active_seconds + v_seconds,
         last_active_at   = now(),
         progress_after   = v_ratio,
         words_progressed = greatest(
           s.words_progressed,
           round(greatest(v_ratio - s.progress_before, 0) * coalesce(v_words, 0))::int
         )
   where s.id = p_session_id;

  return query select
    v_ratio,
    v_furthest,
    v_offset,
    coalesce(v_total, 0),
    v_seconds_total,
    round(v_ratio * coalesce(v_words, 0))::int;
end;
$$;

revoke all on function public.record_reading_progress(uuid, int, int, int, int, int, int, int, int) from public;
revoke all on function public.record_reading_progress(uuid, int, int, int, int, int, int, int, int) from anon;
grant execute on function public.record_reading_progress(uuid, int, int, int, int, int, int, int, int) to authenticated;
