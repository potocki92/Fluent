-- ═════════════════════════════════════════════════════════════════════════════
-- DICTIONARY WRITE INTEGRITY — who allocates an id, and who owns a transaction.
-- ═════════════════════════════════════════════════════════════════════════════
-- Two admin write paths did in the application what only the database can do.
--
-- 1. ALLOCATING AN ID. `createWord` read `max(id)`, added one, and inserted:
--
--      select id from words order by id desc limit 1;   -- 2588
--      insert into words (id, …) values (2589, …);
--
--    Two admins adding a word in the same few milliseconds both read 2588 and
--    both try 2589. One wins; the other gets a primary-key violation surfaced
--    as a raw Postgres message. Nothing was corrupted, but the losing admin's
--    work vanished behind an error nobody could act on — and the window widens
--    with every import running alongside.
--
--    `words.id` is a plain `bigint` rather than an identity column BECAUSE the
--    seeds and the DTZ wordlist import insert explicit ids, and those ids are
--    referenced by `saved_words`, `word_occurrences`, `user_word_knowledge`,
--    `questions.tested_word_id` and a learner's own annotations. Renumbering is
--    out of the question. So this does not convert the column: it attaches a
--    sequence as a DEFAULT and keeps that sequence ahead of every explicit id,
--    which leaves all existing rows and all existing ids exactly as they are
--    while making the next allocation atomic.
--
-- 2. REVIEWING A SUGGESTION. `reviewSuggestion` ran three statements with no
--    transaction and no lock: read the status, patch `words`, mark the
--    suggestion. Two admins opening the same queue both read `pending`, both
--    apply the edit, and both stamp their own name on it. Worse, a failure
--    between statements two and three left the word EDITED and the suggestion
--    still `pending` — so the next review applied the same edit again.
--
--    `review_word_suggestion` does all of it in one statement, under a row
--    lock, and is idempotent: a suggestion that is no longer pending returns
--    the decision it already has instead of applying anything a second time.
--
-- Non-destructive and idempotent, like every migration here: no data is moved,
-- no id changes, and re-running it is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AN ATOMIC ID FOR A NEW DICTIONARY WORD.
-- ─────────────────────────────────────────────────────────────────────────────
create sequence if not exists public.words_id_seq as bigint owned by public.words.id;

-- Start where the dictionary already is. `greatest` with the sequence's own
-- current value is what makes this safe to re-run: a second application can
-- only ever move the sequence forward, never back onto ids already handed out.
select setval(
  'public.words_id_seq',
  greatest(
    coalesce((select max(id) from public.words), 0),
    coalesce(pg_sequence_last_value('public.words_id_seq'), 0),
    1
  ),
  true
);

alter table public.words alter column id set default nextval('public.words_id_seq');

-- AN EXPLICIT ID MUST NOT LEAVE THE SEQUENCE BEHIND IT. The seeds and the
-- wordlist import name their own ids; without this, the sequence would still be
-- sitting at 1 afterwards and the first admin-created word would collide with
-- seed row 1. Comparing against `pg_sequence_last_value` rather than calling
-- `nextval` means a bulk import does not burn an id per row — and a
-- default-allocated id compares equal, so the normal path does no work at all.
create or replace function public.words_keep_id_sequence_ahead()
returns trigger language plpgsql as $$
begin
  if new.id is not null
     and new.id > coalesce(pg_sequence_last_value('public.words_id_seq'), 0) then
    perform setval('public.words_id_seq', new.id, true);
  end if;
  return new;
end;
$$;

drop trigger if exists words_keep_id_sequence_ahead on public.words;
create trigger words_keep_id_sequence_ahead
  before insert on public.words
  for each row execute function public.words_keep_id_sequence_ahead();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REVIEWING A SUGGESTION, ONCE.
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because it writes `words`, and the admin check is taken from
-- `auth.uid()` through the existing `is_admin()` — never from a parameter. The
-- reviewer recorded is the caller, for the same reason.
create or replace function public.review_word_suggestion(
  p_suggestion_id bigint,
  p_decision      text
)
returns table (
  suggestion_id     bigint,
  status            text,
  /** True when this call was the one that decided it. */
  applied           boolean,
  /** The word the edit landed on, or null when nothing was written. */
  updated_word_id   bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_suggestion public.word_suggestions%rowtype;
  v_value      text;
  v_reviewer   uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = 'FL403';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = 'FL422';
  end if;

  -- The lock is the whole point: a concurrent reviewer waits here and then sees
  -- the decided row, instead of racing past the `pending` check beside us.
  select * into v_suggestion
  from public.word_suggestions
  where id = p_suggestion_id
  for update;

  if not found then
    raise exception 'suggestion % not found', p_suggestion_id using errcode = 'FL404';
  end if;

  -- ALREADY DECIDED. Not an error — two tabs, a double click, a retry after a
  -- dropped response. Report what it is and write nothing.
  if v_suggestion.status <> 'pending' then
    return query select v_suggestion.id, v_suggestion.status, false, null::bigint;
    return;
  end if;

  updated_word_id := null;

  -- `field = 'other'` is a free-form note, never a column to overwrite.
  if p_decision = 'approved' and v_suggestion.field <> 'other' then
    v_value := btrim(v_suggestion.suggestion);

    update public.words
       set translation_pl = case when v_suggestion.field = 'translation_pl'
                                 then v_value else translation_pl end,
           example_de     = case when v_suggestion.field = 'example_de'
                                 then v_value else example_de end,
           example_pl     = case when v_suggestion.field = 'example_pl'
                                 then v_value else example_pl end
     where id = v_suggestion.word_id;

    if not found then
      raise exception 'word % not found', v_suggestion.word_id using errcode = 'FL404';
    end if;
    updated_word_id := v_suggestion.word_id;
  end if;

  update public.word_suggestions
     set status      = p_decision,
         reviewed_at = now(),
         reviewed_by = v_reviewer
   where id = p_suggestion_id;

  return query select p_suggestion_id, p_decision, true, updated_word_id;
end;
$$;

-- Narrow grant: a signed-in admin calls this from a Server Action on their own
-- cookie-bound client, and `is_admin()` inside decides. `anon` has no business
-- here at all.
revoke all on function public.review_word_suggestion(bigint, text) from public;
grant execute on function public.review_word_suggestion(bigint, text) to authenticated;
