-- Fluent — notebook pagination at a tie.
--
-- WHAT THIS SUITE IS ABOUT. The notebook paged on `created_at` alone, with a
-- strict `<` cursor and no tie-breaker. `created_at` defaults to `now()`, which
-- is TRANSACTION start time, so every note written by one save shares a
-- timestamp to the microsecond — and `notebook_entries` is a union of two
-- tables, which makes ties likelier rather than rarer.
--
-- The failure is silent. `created_at DESC` alone is not a total order, so tied
-- rows come back in plan order; the strict `<` then skips every row sharing the
-- boundary timestamp. A learner who saved four notes in one go, with the page
-- boundary falling inside them, never sees the other three. No error, no
-- duplicate, no gap on screen — just notes that are not there.
--
-- Every fixture below is written with an IDENTICAL `created_at` on purpose:
-- that is the case the old cursor could not survive and the case a TypeScript
-- test cannot construct.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use the e17e… uuid space so they cannot collide with earlier suites.

\set ON_ERROR_STOP on

\set LEARNER '''e17e0000-0000-4000-8000-000000000001'''
\set OTHER   '''e17e0000-0000-4000-8000-000000000002'''

\echo '── N0. one book, one chapter, and ten notes saved in one moment ────────'

insert into auth.users (id, email) values
  ('e17e0000-0000-4000-8000-000000000001', 'nb-learner@example.test'),
  ('e17e0000-0000-4000-8000-000000000002', 'nb-other@example.test');

insert into public.library_items (id, slug, title, content_type, rights, status, published_at)
  values ('e17e1111-0000-0000-0000-000000000001', 'nb-book', 'Notizbuch',
          'story', 'first_party', 'published', now());

insert into public.chapters (id, library_item_id, position, title, source_text, status)
  values ('e17e2222-0000-0000-0000-000000000001',
          'e17e1111-0000-0000-0000-000000000001',
          1, 'Kapitel 1', 'Er zog den Schlüssel aus der Tasche.', 'ready');

-- THE TIE, BUILT ON PURPOSE. Ten entries, one timestamp, both halves of the
-- union: six annotations and four sentence notes. This is what one save of a
-- selected phrase plus its sentence produces — `now()` does not advance inside
-- a transaction.
do $$
declare
  v_at timestamptz := '2026-03-01 09:00:00+00';
  i int;
begin
  for i in 1..6 loop
    insert into public.user_text_annotations
      (user_id, kind, chapter_id, library_item_id, sentence_position,
       start_position, end_position, surface, lemma, meaning, sentence_text,
       content_version, created_at, updated_at)
    values
      ('e17e0000-0000-4000-8000-000000000001',
       case when i % 2 = 0 then 'phrase' else 'word' end,
       'e17e2222-0000-0000-0000-000000000001',
       'e17e1111-0000-0000-0000-000000000001',
       1, i, i, 'wort' || i, 'lemma' || i, 'znaczenie ' || i,
       'Er zog den Schlüssel aus der Tasche.', 'content_v2', v_at, v_at);
  end loop;

  for i in 1..4 loop
    insert into public.user_sentence_notes
      (user_id, chapter_id, library_item_id, sentence_position, sentence_text,
       translation, is_unclear, content_version, created_at, updated_at)
    values
      ('e17e0000-0000-4000-8000-000000000001',
       'e17e2222-0000-0000-0000-000000000001',
       'e17e1111-0000-0000-0000-000000000001',
       i, 'Satz ' || i, 'Zdanie ' || i, false, 'content_v2', v_at, v_at);
  end loop;
end $$;

-- Somebody else's notebook, at the same instant. Nothing below may see it.
insert into public.user_sentence_notes
  (user_id, chapter_id, library_item_id, sentence_position, sentence_text,
   translation, content_version, created_at, updated_at)
values
  ('e17e0000-0000-4000-8000-000000000002',
   'e17e2222-0000-0000-0000-000000000001',
   'e17e1111-0000-0000-0000-000000000001',
   9, 'Fremder Satz', 'Cudze zdanie', 'content_v2',
   '2026-03-01 09:00:00+00', '2026-03-01 09:00:00+00');

\echo '── N1. paging three at a time returns all ten, once each ───────────────'

do $$
declare
  v_seen      text[] := '{}';
  v_page      record;
  v_cur_at    timestamptz := null;
  v_cur_type  text := null;
  v_cur_id    bigint := null;
  v_rows      int;
  v_pages     int := 0;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  loop
    v_pages := v_pages + 1;
    if v_pages > 20 then
      raise exception 'FAIL: pagination did not terminate';
    end if;

    v_rows := 0;
    for v_page in
      select entry_type, entry_id, created_at
      from public.list_notebook_entries(
        'all', null, null, null, v_cur_at, v_cur_type, v_cur_id, 3)
    loop
      v_rows := v_rows + 1;
      v_seen := v_seen || (v_page.entry_type || '#' || v_page.entry_id);
      v_cur_at := v_page.created_at;
      v_cur_type := v_page.entry_type;
      v_cur_id := v_page.entry_id;
    end loop;

    exit when v_rows < 3;
  end loop;

  -- THE REGRESSION. With a `created_at`-only cursor this array came back with
  -- three entries: the first page, and then nothing, because `< '09:00:00'`
  -- excluded every remaining row — all ten share that timestamp.
  if array_length(v_seen, 1) <> 10 then
    raise exception 'FAIL: paged % of 10 entries (%)',
      coalesce(array_length(v_seen, 1), 0), v_seen;
  end if;

  if array_length(v_seen, 1) <> (select count(distinct x) from unnest(v_seen) x) then
    raise exception 'FAIL: an entry was returned on two pages (%)', v_seen;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── N2. the order is total, so two identical queries agree ──────────────'

do $$
declare
  v_first  text;
  v_second text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select string_agg(entry_type || '#' || entry_id, ',')
    into v_first
    from public.list_notebook_entries('all', null, null, null, null, null, null, 10);

  -- A different plan shape for the same question: if the ordering were not
  -- total, the two could legitimately disagree.
  set local enable_seqscan = off;
  select string_agg(entry_type || '#' || entry_id, ',')
    into v_second
    from public.list_notebook_entries('all', null, null, null, null, null, null, 10);
  reset enable_seqscan;

  if v_first is distinct from v_second then
    raise exception 'FAIL: the same page came back in two orders:%  /  %',
      v_first, v_second;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── N3. a page boundary inside a tie loses nothing ──────────────────────'

do $$
declare
  v_boundary record;
  v_rest     int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  -- Take exactly five, then ask for everything after the fifth.
  select entry_type, entry_id, created_at into v_boundary
    from public.list_notebook_entries('all', null, null, null, null, null, null, 5)
    offset 4 limit 1;

  select count(*) into v_rest
    from public.list_notebook_entries(
      'all', null, null, null,
      v_boundary.created_at, v_boundary.entry_type, v_boundary.entry_id, 100);

  if v_rest <> 5 then
    raise exception
      'FAIL: % entries survived a boundary that falls inside a tie (expected 5)',
      v_rest;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── N4. the filters still mean what they meant ──────────────────────────'

do $$
declare
  v_words     int;
  v_phrases   int;
  v_sentences int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select count(*) into v_words from public.list_notebook_entries(
    'words', null, null, null, null, null, null, 100);
  select count(*) into v_phrases from public.list_notebook_entries(
    'phrases', null, null, null, null, null, null, 100);
  select count(*) into v_sentences from public.list_notebook_entries(
    'sentences', null, null, null, null, null, null, 100);

  if v_words <> 3 then raise exception 'FAIL: % words (expected 3)', v_words; end if;
  if v_phrases <> 3 then raise exception 'FAIL: % phrases (expected 3)', v_phrases; end if;
  if v_sentences <> 4 then
    raise exception 'FAIL: % sentences (expected 4)', v_sentences;
  end if;

  -- Fails closed rather than falling back to "everything".
  if (select count(*) from public.list_notebook_entries(
        'nonsense', null, null, null, null, null, null, 100)) <> 0 then
    raise exception 'FAIL: an unrecognised filter returned rows';
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── N5. search treats the learner''s text as text ────────────────────────'

do $$
declare
  v_hits int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select count(*) into v_hits from public.list_notebook_entries(
    'all', null, null, 'lemma1', null, null, null, 100);
  if v_hits <> 1 then raise exception 'FAIL: % hits for lemma1', v_hits; end if;

  -- A LIKE metacharacter is a character, not a wildcard: searching for "%"
  -- must not return the whole notebook.
  select count(*) into v_hits from public.list_notebook_entries(
    'all', null, null, '%', null, null, null, 100);
  if v_hits <> 0 then
    raise exception 'FAIL: searching for "%%" returned % entries', v_hits;
  end if;

  select count(*) into v_hits from public.list_notebook_entries(
    'all', null, null, '_', null, null, null, 100);
  if v_hits <> 0 then
    raise exception 'FAIL: searching for "_" returned % entries', v_hits;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── N6. a notebook is one learner''s ─────────────────────────────────────'

do $$
declare
  v_mine   int;
  v_theirs int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;
  select count(*) into v_mine from public.list_notebook_entries(
    'all', null, null, null, null, null, null, 100);

  perform set_config('request.jwt.claims',
    '{"sub":"e17e0000-0000-4000-8000-000000000002"}', false);
  select count(*) into v_theirs from public.list_notebook_entries(
    'all', null, null, null, null, null, null, 100);

  if v_mine <> 10 then raise exception 'FAIL: the learner sees % of 10', v_mine; end if;
  if v_theirs <> 1 then
    raise exception 'FAIL: the other learner sees % entries (expected their own 1)',
      v_theirs;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── N7. grants ──────────────────────────────────────────────────────────'

do $$
declare
  v_sig text := 'public.list_notebook_entries(text, uuid, uuid, text, timestamptz, text, bigint, int)';
begin
  if has_function_privilege('anon', v_sig, 'execute') then
    raise exception 'FAIL: anon may page somebody''s notebook';
  end if;
  if not has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception 'FAIL: authenticated cannot page their own notebook';
  end if;
end $$;

\echo '✔ notebook pagination suite passed'
