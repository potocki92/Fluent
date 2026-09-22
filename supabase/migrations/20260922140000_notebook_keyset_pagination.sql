-- ═════════════════════════════════════════════════════════════════════════════
-- NOTEBOOK PAGINATION — a cursor that is actually a cursor.
-- ═════════════════════════════════════════════════════════════════════════════
-- WHAT WAS WRONG. The notebook paged with a keyset on `created_at` alone:
--
--     .order("created_at", { ascending: false }).limit(25)
--     .lt("created_at", pageParam)          -- the last row's timestamp
--
-- and a comment explaining that two notes sharing a microsecond "does not
-- happen at human pace, across two tables". Both halves of that are wrong.
--
--   * `created_at` defaults to `now()`, which in PostgreSQL is TRANSACTION
--     START TIME — identical for every row written by one statement or one
--     transaction. Saving a word annotation and the sentence translation around
--     it in one request gives them the same timestamp, exactly.
--   * `notebook_entries` is a UNION of `user_text_annotations` and
--     `user_sentence_notes`, so "across two tables" makes ties MORE likely, not
--     less: the two sequences are independent and nothing orders the halves
--     against each other.
--
-- And a tie is not a cosmetic wobble. `created_at DESC` alone is not a total
-- order, so rows sharing a timestamp come back in whatever order the plan
-- produced this time; then `.lt(cursor)` is a STRICT comparison, so every row
-- sharing the boundary timestamp is skipped. A learner who saved four notes in
-- one save, with the page boundary falling inside them, simply never sees the
-- other three — no error, no gap, just notes that are not there.
--
-- THE FIX. A total order — `(created_at, entry_type, entry_id)` — and a cursor
-- that carries all three, compared as a row. `entry_id` is unique within each
-- half of the union, and `entry_type` separates the halves (`word`/`phrase`
-- come from the annotations table, `sentence` from the notes table), so the
-- triple is unique across the whole view.
--
-- WHY A FUNCTION RATHER THAN MORE POSTGREST. A row comparison
-- `(a, b, c) < (x, y, z)` is one expression that is right by construction.
-- Expressed through PostgREST it becomes a nested `or=(…,and(…),and(…))` string
-- with hand-quoted timestamps — three clauses that must agree, in a string no
-- compiler checks and no test here can execute. The predicate belongs where it
-- can be proved.
--
-- `security invoker` (the default), so the view's own RLS still scopes every
-- row to its owner; the explicit `user_id = auth.uid()` is belt and braces.

create or replace function public.list_notebook_entries(
  p_filter            text        default 'all',
  p_library_item_id   uuid        default null,
  p_chapter_id        uuid        default null,
  p_search            text        default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_entry_type text        default null,
  p_cursor_entry_id   bigint      default null,
  p_limit             int         default 25
)
returns setof public.notebook_entries
language sql
stable
set search_path = public
as $$
  with bounds as (
    select
      -- The learner's text is a LIKE pattern's worth of metacharacters waiting
      -- to happen: a note containing `100%` must search for a percent sign, not
      -- for "anything".
      case
        when nullif(btrim(p_search), '') is null then null
        else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as pattern,
      -- A cursor is all three or none. A partial one would silently degrade to
      -- the single-column comparison this migration exists to remove.
      (p_cursor_created_at is not null
        and p_cursor_entry_type is not null
        and p_cursor_entry_id is not null) as has_cursor
  )
  select e.*
  from public.notebook_entries e, bounds b
  where e.user_id = auth.uid()
    and (p_library_item_id is null or e.library_item_id = p_library_item_id)
    and (p_chapter_id is null or e.chapter_id = p_chapter_id)
    -- An unrecognised filter matches no branch and returns nothing: failing
    -- closed beats showing a learner someone else's idea of "everything".
    and (
      p_filter = 'all'
      or (p_filter = 'words'     and e.entry_type = 'word')
      or (p_filter = 'phrases'   and e.entry_type = 'phrase')
      or (p_filter = 'sentences' and e.has_translation)
      or (p_filter = 'unclear'   and e.is_unclear)
    )
    and (
      b.pattern is null
      or e.surface ilike b.pattern
      or e.lemma   ilike b.pattern
      or e.meaning ilike b.pattern
    )
    and (
      not b.has_cursor
      or (e.created_at, e.entry_type, e.entry_id)
         < (p_cursor_created_at, p_cursor_entry_type, p_cursor_entry_id)
    )
  order by e.created_at desc, e.entry_type desc, e.entry_id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 200);
$$;

-- The notebook is the learner's own; `anon` has nothing to page through.
revoke all on function public.list_notebook_entries(
  text, uuid, uuid, text, timestamptz, text, bigint, int) from public;
grant execute on function public.list_notebook_entries(
  text, uuid, uuid, text, timestamptz, text, bigint, int) to authenticated;

-- The order the function asks for, so page 40 costs what page 1 costs. Two
-- indexes, because the view is a union and each half is scanned on its own.
create index if not exists user_text_annotations_notebook_page_idx
  on public.user_text_annotations (user_id, created_at desc, kind desc, id desc);

create index if not exists user_sentence_notes_notebook_page_idx
  on public.user_sentence_notes (user_id, created_at desc, id desc);
