-- ═════════════════════════════════════════════════════════════════════════════
-- READING PROGRESS RECEIPTS — a report you can safely send twice.
-- ═════════════════════════════════════════════════════════════════════════════
-- THE CONTRACT THIS CHANGES, STATED PLAINLY. Until now a progress report was
-- fire-and-hope: `active_seconds = p.active_seconds + v_seconds`, an increment
-- with nothing to recognise it by. That left the reader with two options and no
-- good one.
--
--   * Drop the seconds when a report fails — which is what it did. `drain()`
--     ran before the request, so a failed write took the time with it. Twenty
--     minutes of reading over a flaky connection recorded four.
--   * Or keep them and retry — which double-counts, because a request that
--     REACHED the database and whose response was lost is indistinguishable,
--     from the browser, from one that never arrived.
--
-- Neither is acceptable and neither can be fixed alone: holding the seconds for
-- a retry is exactly what makes double-counting possible. So the report gets a
-- receipt.
--
-- `p_report_id` identifies one report. The function applies an id it has
-- already seen EXACTLY ONCE: a repeat returns the state it already holds and
-- adds no seconds. Retrying becomes safe, which is what lets the client keep
-- the seconds instead of dropping them.
--
-- `p_report_seq` orders reports within one reading. `furthest_*` never needed
-- it (`greatest(...)` is monotonic by construction), but `resume_*` is a
-- BOOKMARK and is written as given — so a slow report landing after a faster
-- one used to rewind the learner's place. A report whose seq the session has
-- already passed now leaves `resume_*` alone while still contributing its
-- seconds and its furthest mark, both of which are true regardless of arrival
-- order.
--
-- BOTH PARAMETERS ARE OPTIONAL. A client that sends neither gets exactly the
-- old behaviour, so this migration cannot break a tab that is open while it is
-- being applied.
--
-- Deduplication is against the session's LAST report only, which is all the
-- client needs: it sends one report at a time and retries the most recent one.
-- A full log of applied ids would grow without bound to buy nothing.
--
-- Non-destructive and idempotent: two added columns, and a function replaced.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE RECEIPT, ON THE SESSION.
-- ─────────────────────────────────────────────────────────────────────────────
-- On `reading_sessions` rather than `reading_progress` because the function
-- already takes a row lock there (`for update`), so the check costs nothing —
-- and because a receipt belongs to a sitting, not to a chapter for ever.
alter table public.reading_sessions
  add column if not exists last_report_id  uuid,
  add column if not exists last_report_seq bigint not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE FUNCTION.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_reading_progress(
  p_session_id                  uuid,
  p_paragraph_position          int,
  p_sentence_position           int,
  p_token_position              int,
  p_furthest_paragraph_position int,
  p_furthest_sentence_position  int,
  p_furthest_token_position     int,
  p_active_seconds              int,
  p_max_active_seconds          int,
  p_report_id                   uuid   default null,
  p_report_seq                  bigint default null
)
returns table (
  progress_ratio       numeric,
  furthest_paragraph   int,
  furthest_word_offset int,
  reading_word_count   int,
  active_seconds       int,
  words_read           int,
  /** False when this exact report had already been applied. */
  applied              boolean
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
  v_out_of_order boolean;
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

  -- ALREADY APPLIED. The request reached us; its response did not reach the
  -- browser. Return what we hold and add nothing — this is the whole reason the
  -- client may keep its seconds through a failure.
  if p_report_id is not null and p_report_id = v_session.last_report_id then
    select p.progress_ratio, p.furthest_paragraph_position,
           p.furthest_word_offset, p.active_seconds
      into v_ratio, v_furthest, v_offset, v_seconds_total
    from public.reading_progress p
    where p.user_id = v_user and p.chapter_id = v_session.chapter_id;

    if v_ratio is null then
      raise exception 'Brak postępu czytania dla tej sesji.' using errcode = 'FL404';
    end if;

    return query select
      v_ratio, v_furthest, v_offset, coalesce(v_total, 0), v_seconds_total,
      round(v_ratio * coalesce(v_words, 0))::int, false;
    return;
  end if;

  -- OUT OF ORDER. A report the session has already moved past. Its seconds and
  -- its furthest mark are still true; its bookmark is not.
  v_out_of_order :=
    p_report_seq is not null and p_report_seq <= v_session.last_report_seq;

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
     set resume_paragraph_position   = case
           when v_out_of_order then p.resume_paragraph_position else v_resume_par end,
         resume_sentence_position    = case
           when v_out_of_order then p.resume_sentence_position else p_sentence_position end,
         resume_token_position       = case
           when v_out_of_order then p.resume_token_position else p_token_position end,
         resume_word_offset          = case
           when v_out_of_order then p.resume_word_offset else v_resume_off end,

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
           -- FALLBACK for a chapter stored before the reading-position engine
           -- ran and never reprocessed since. Coarse, but it is the same answer
           -- the reader gave yesterday, which beats dividing by zero.
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
         ),
         -- The receipt for what we just applied.
         last_report_id   = coalesce(p_report_id, s.last_report_id),
         last_report_seq  = greatest(s.last_report_seq, coalesce(p_report_seq, 0))
   where s.id = p_session_id;

  return query select
    v_ratio,
    v_furthest,
    v_offset,
    coalesce(v_total, 0),
    v_seconds_total,
    round(v_ratio * coalesce(v_words, 0))::int,
    true;
end;
$$;

revoke all on function public.record_reading_progress(
  uuid, int, int, int, int, int, int, int, int, uuid, bigint) from public;
revoke all on function public.record_reading_progress(
  uuid, int, int, int, int, int, int, int, int, uuid, bigint) from anon;
grant execute on function public.record_reading_progress(
  uuid, int, int, int, int, int, int, int, int, uuid, bigint) to authenticated;

-- The nine-argument form is gone: every caller is in this repository and moves
-- with it, and leaving both would mean two functions to keep in step — which is
-- how one of them quietly stops being the one that gets fixed.
drop function if exists public.record_reading_progress(
  uuid, int, int, int, int, int, int, int, int);
