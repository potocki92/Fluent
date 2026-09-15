-- Fluent — Private book import: ownership, idempotency and privacy.
--
-- The importer's arithmetic is unit-tested in TypeScript — extraction, cleanup,
-- hyphenation, chapter detection, language detection all live in
-- `src/lib/import/**.test.ts` and never touch a database. What CANNOT be tested
-- there is everything this file asserts:
--
--   * an import belongs to one learner and is invisible to every other, and to
--     an admin;
--   * `user_id`, `storage_path` and `status` have NO client write path, so a
--     crafted request cannot declare an unread file a finished book;
--   * finalizing twice — or twice at once — produces exactly one library item;
--   * a finalized book is `private_import` with an owner, always, because
--     neither is a parameter any caller can supply;
--   * excluded chapters do not become chapters, and included ones keep their
--     order 1..N with no gaps;
--   * editing the preview keeps those positions contiguous through every
--     operation, and marks the rows as manually edited;
--   * re-analysis refuses to destroy manual corrections;
--   * an owner can delete their own private book, keeps the vocabulary they
--     learned from it, and loses the private sentences copied out of it;
--   * the private Storage bucket is scoped by owner, and closed to `anon`.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use the 9999…/aaaa… uuid space so they cannot collide with the
-- suites that run before this one.

\set ON_ERROR_STOP on

\set OWNER '''99999999-9999-9999-9999-999999999999'''
\set OTHER '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set ADMIN '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''

\echo '── I0. import fixtures ─────────────────────────────────────────────────'

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999999', 'importer@example.test'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'stranger@example.test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'import-admin@example.test');

update public.profiles set role = 'admin'
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

insert into public.words (id, lemma, display, word_type, translation_pl, cefr)
  values (9901, 'Krankenhaus', 'das Krankenhaus', 'noun', 'szpital', 'A2')
  on conflict (id) do nothing;

\echo '── I1. creating an import derives owner and path from auth.uid() ───────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_import public.book_imports;
begin
  v_import := public.create_book_import('Die Reise.pdf', 'pdf', 120000, 'hash-abc');

  if v_import.user_id <> '99999999-9999-9999-9999-999999999999'::uuid then
    raise exception 'FAIL: the import was not owned by the caller';
  end if;

  -- The path is minted server-side and STARTS with the owner's id, which is
  -- what makes the Storage policy's prefix check a guarantee.
  if split_part(v_import.storage_path, '/', 1)
     <> '99999999-9999-9999-9999-999999999999' then
    raise exception 'FAIL: the storage path is not scoped to the owner (%)',
      v_import.storage_path;
  end if;
  if v_import.status <> 'uploaded' then
    raise exception 'FAIL: a new import did not start as uploaded';
  end if;

  -- An oversized or unknown file is refused before anything is stored.
  begin
    perform public.create_book_import('riesig.pdf', 'pdf', 200 * 1024 * 1024, null);
    raise exception 'FAIL: an oversized file was accepted';
  exception when sqlstate 'FL422' then null;
  end;

  begin
    perform public.create_book_import('foto.png', 'png', 1000, null);
    raise exception 'FAIL: an unsupported format was accepted';
  exception when sqlstate 'FL422' then null;
  end;
end $$;

-- Pin the import for the rest of the suite.
reset role;
update public.book_imports set id = '9b000000-0000-0000-0000-000000000001'
  where user_id = '99999999-9999-9999-9999-999999999999';

\echo '── I2. the system columns have no client write path ────────────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;
set role authenticated;

do $$
begin
  -- There is no UPDATE policy on either table, deliberately. A learner cannot
  -- reassign their import, repoint its storage path, or declare it ready.
  begin
    update public.book_imports set status = 'ready'
      where id = '9b000000-0000-0000-0000-000000000001';
    if found then raise exception 'FAIL: a learner set their own import to ready'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.book_imports set user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      where id = '9b000000-0000-0000-0000-000000000001';
    if found then raise exception 'FAIL: a learner reassigned an import'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.book_imports set storage_path = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/x'
      where id = '9b000000-0000-0000-0000-000000000001';
    if found then raise exception 'FAIL: a learner repointed a storage path'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.book_imports (user_id, file_name, file_type, storage_path)
    values ('99999999-9999-9999-9999-999999999999', 'x.pdf', 'pdf', 'x/y/z.pdf');
    raise exception 'FAIL: a learner inserted an import row directly';
  exception when insufficient_privilege then null;
  end;

  -- The server-only half of the state machine is not reachable from a browser
  -- role at all: a client that could call these could fake an entire book.
  begin
    perform public.set_book_import_state(
      '9b000000-0000-0000-0000-000000000001', 'ready', null, null, null
    );
    raise exception 'FAIL: a learner moved the import state machine';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.apply_book_import_analysis(
      '9b000000-0000-0000-0000-000000000001', '{}'::jsonb
    );
    raise exception 'FAIL: a learner wrote an analysis result';
  exception when insufficient_privilege then null;
  end;
end $$;

\echo '── I3. analysis writes the proposal; front matter starts switched off ──'

reset role;
set role service_role;

do $$
begin
  perform public.apply_book_import_analysis(
    '9b000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'file_hash', 'hash-verified',
      'detected_title', 'Die Reise nach Norden',
      'detected_author', 'Hans Beispiel',
      'detected_language', 'de',
      'language_confidence', 0.42,
      'page_count', 5,
      'word_count', 60,
      'pipeline_version', 'import_v1',
      'detector_version', 'detector_v1',
      'quality', jsonb_build_object('looksScanned', false),
      'chapters', jsonb_build_array(
        jsonb_build_object(
          'title', 'Die Reise nach Norden', 'text', 'Hans Beispiel',
          'word_count', 2, 'confidence', 'low', 'is_front_matter', true,
          'signals', '["preamble"]'::jsonb, 'start_page', 1, 'end_page', 1
        ),
        jsonb_build_object(
          'title', 'Kapitel 1',
          'text', E'Sie ging zum Krankenhaus.\n\nDort war es still.',
          'word_count', 8, 'confidence', 'high', 'is_front_matter', false,
          'signals', '["division"]'::jsonb, 'start_page', 2, 'end_page', 3
        ),
        jsonb_build_object(
          'title', 'Kapitel 2', 'text', 'Am nächsten Morgen fuhr sie nach Osten.',
          'word_count', 7, 'confidence', 'high', 'is_front_matter', false,
          'signals', '["division"]'::jsonb, 'start_page', 4, 'end_page', 5
        )
      )
    )
  );
end $$;

reset role;

do $$
declare
  v public.book_imports;
begin
  select * into v from public.book_imports where id = '9b000000-0000-0000-0000-000000000001';

  if v.status <> 'awaiting_review' then
    raise exception 'FAIL: analysis did not leave the import awaiting review';
  end if;
  if v.file_hash <> 'hash-verified' then
    raise exception 'FAIL: the server-computed hash did not replace the claimed one';
  end if;
  if v.chapter_count <> 3 then
    raise exception 'FAIL: the proposal was not stored (% chapters)', v.chapter_count;
  end if;

  -- Front matter is offered OFF; real chapters are offered ON.
  if exists (
    select 1 from public.book_import_chapters
    where import_id = v.id and is_front_matter and included
  ) then
    raise exception 'FAIL: front matter was included by default';
  end if;
  if exists (
    select 1 from public.book_import_chapters
    where import_id = v.id and not is_front_matter and not included
  ) then
    raise exception 'FAIL: a real chapter was excluded by default';
  end if;
end $$;

\echo '── I4. one learner, one import: nobody else sees it ────────────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', false); end $switch$;
set role authenticated;

do $$
begin
  if exists (select 1 from public.book_imports where id = '9b000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: another learner can see an import';
  end if;
  if exists (
    select 1 from public.book_import_chapters
    where import_id = '9b000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: another learner can read an import preview';
  end if;

  -- And cannot act on it, however the id was obtained.
  begin
    perform public.finalize_book_import('9b000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: another learner finalized an import';
  exception when sqlstate 'FL403' then null;
  end;

  begin
    perform public.edit_book_import_chapters(
      '9b000000-0000-0000-0000-000000000001', 'include', '{"chapter_id":"00000000-0000-0000-0000-000000000000","included":false}'::jsonb
    );
    raise exception 'FAIL: another learner edited an import preview';
  exception when sqlstate 'FL403' then null;
  end;

  begin
    perform public.cancel_book_import('9b000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: another learner cancelled an import';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

-- An ADMIN is not an exception. A learner's own file is their document, and the
-- admin panel is a content tool, not a reason to read it.
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}', false); end $switch$;

do $$
begin
  if exists (select 1 from public.book_imports where id = '9b000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: an admin can see a learner''s import';
  end if;
  if exists (
    select 1 from public.book_import_chapters
    where import_id = '9b000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: an admin can read a learner''s import preview';
  end if;
end $$;

-- Anonymous visitors see nothing at all.
reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;
set role anon;

do $$
begin
  if exists (select 1 from public.book_imports) then
    raise exception 'FAIL: anon can read imports';
  end if;
  if exists (select 1 from public.book_import_chapters) then
    raise exception 'FAIL: anon can read import previews';
  end if;
end $$;

\echo '── I5. editing the preview keeps positions 1..N ────────────────────────'

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_import uuid := '9b000000-0000-0000-0000-000000000001';
  v_second uuid;
  v_third  uuid;
  v_count  int;
  v_max    int;
  v_distinct int;
begin
  select id into v_second from public.book_import_chapters
    where import_id = v_import and position = 2;
  select id into v_third from public.book_import_chapters
    where import_id = v_import and position = 3;

  -- rename
  perform public.edit_book_import_chapters(
    v_import, 'rename', jsonb_build_object('chapter_id', v_second, 'title', 'Erstes Kapitel')
  );
  if not exists (
    select 1 from public.book_import_chapters
    where id = v_second and title = 'Erstes Kapitel' and edited
  ) then
    raise exception 'FAIL: rename did not stick, or did not mark the row edited';
  end if;

  -- split: the chapter has two paragraphs, so cutting after the first makes two
  perform public.edit_book_import_chapters(
    v_import, 'split', jsonb_build_object('chapter_id', v_second, 'paragraph', 1)
  );

  select count(*), max(position), count(distinct position)
    into v_count, v_max, v_distinct
  from public.book_import_chapters where import_id = v_import;

  if v_count <> 4 or v_max <> 4 or v_distinct <> 4 then
    raise exception 'FAIL: split left positions non-contiguous (% rows, max %, % distinct)',
      v_count, v_max, v_distinct;
  end if;

  -- An out-of-range cut is refused rather than silently clamped.
  begin
    perform public.edit_book_import_chapters(
      v_import, 'split', jsonb_build_object('chapter_id', v_second, 'paragraph', 99)
    );
    raise exception 'FAIL: an out-of-range split was accepted';
  exception when sqlstate 'FL422' then null;
  end;

  -- move: swapping two positions must not trip the unique constraint
  perform public.edit_book_import_chapters(
    v_import, 'move', jsonb_build_object('chapter_id', v_second, 'direction', 'down')
  );

  select count(*), max(position), count(distinct position)
    into v_count, v_max, v_distinct
  from public.book_import_chapters where import_id = v_import;
  if v_count <> v_distinct or v_max <> v_count then
    raise exception 'FAIL: move broke the position invariant';
  end if;

  -- merge_up: the text of the merged chapter must survive, heading included
  perform public.edit_book_import_chapters(
    v_import, 'merge_up', jsonb_build_object('chapter_id', v_third)
  );

  select count(*), max(position), count(distinct position)
    into v_count, v_max, v_distinct
  from public.book_import_chapters where import_id = v_import;
  if v_count <> 3 or v_max <> 3 or v_distinct <> 3 then
    raise exception 'FAIL: merge left positions non-contiguous (% rows, max %)',
      v_count, v_max;
  end if;

  if not exists (
    select 1 from public.book_import_chapters
    where import_id = v_import and source_text like '%Am nächsten Morgen%'
  ) then
    raise exception 'FAIL: merging a chapter lost its text';
  end if;
  if not exists (
    select 1 from public.book_import_chapters
    where import_id = v_import and source_text like '%## Kapitel 2%'
  ) then
    raise exception 'FAIL: merging a chapter lost its heading';
  end if;
end $$;

\echo '── I6. re-analysis refuses to destroy manual corrections ───────────────'

reset role;
set role service_role;

do $$
begin
  begin
    perform public.apply_book_import_analysis(
      '9b000000-0000-0000-0000-000000000001',
      jsonb_build_object('chapters', jsonb_build_array(
        jsonb_build_object('title', 'Neu', 'text', 'Anders.', 'word_count', 1)
      ))
    );
    raise exception 'FAIL: re-analysis overwrote manual corrections';
  exception when sqlstate 'FL423' then null;
  end;
end $$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.book_import_chapters
    where import_id = '9b000000-0000-0000-0000-000000000001'
      and title = 'Erstes Kapitel'
  ) then
    raise exception 'FAIL: a refused re-analysis still changed the preview';
  end if;
end $$;

\echo '── I7. finalizing is atomic, private and idempotent ────────────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_import uuid := '9b000000-0000-0000-0000-000000000001';
  v_first  uuid;
  v_again  uuid;
  v_item   public.library_items;
  v_count  int;
  v_positions int;
begin
  v_first := public.finalize_book_import(v_import);

  -- DOUBLE CLICK, TWO TABS, A RETRIED REQUEST: one book.
  v_again := public.finalize_book_import(v_import);
  if v_first <> v_again then
    raise exception 'FAIL: finalizing twice created two books (% and %)', v_first, v_again;
  end if;

  select count(*) into v_count from public.library_items
    where owner_user_id = '99999999-9999-9999-9999-999999999999';
  if v_count <> 1 then
    raise exception 'FAIL: % private books exist after two finalizes', v_count;
  end if;

  select * into v_item from public.library_items where id = v_first;

  -- PRIVATE BY CONSTRUCTION. Neither of these is a parameter any caller can set.
  if v_item.rights <> 'private_import' then
    raise exception 'FAIL: an imported book is not private_import (%)', v_item.rights;
  end if;
  if v_item.owner_user_id <> '99999999-9999-9999-9999-999999999999'::uuid then
    raise exception 'FAIL: an imported book has the wrong owner';
  end if;
  if v_item.status <> 'processing' then
    raise exception 'FAIL: a fresh import is not processing (%)', v_item.status;
  end if;

  -- Excluded front matter did not become a chapter; the rest is 1..N.
  select count(*), count(distinct position) into v_count, v_positions
    from public.chapters where library_item_id = v_first;
  if v_count <> 2 then
    raise exception 'FAIL: % chapters were created, expected 2', v_count;
  end if;
  if v_positions <> v_count
     or (select max(position) from public.chapters where library_item_id = v_first) <> v_count then
    raise exception 'FAIL: chapter positions are not 1..N';
  end if;

  -- Every chapter knows which import it came from.
  if exists (
    select 1 from public.chapters where library_item_id = v_first and import_id is distinct from v_import
  ) then
    raise exception 'FAIL: a chapter lost its import provenance';
  end if;

  -- And the preview rows point at the chapters they became.
  if exists (
    select 1 from public.book_import_chapters
    where import_id = v_import and included and chapter_id is null
  ) then
    raise exception 'FAIL: an included preview row was not linked to its chapter';
  end if;

  -- The import is now a book; cancelling is no longer the operation.
  begin
    perform public.cancel_book_import(v_import);
    raise exception 'FAIL: a finalized import was cancelled';
  exception when sqlstate 'FL409' then null;
  end;
end $$;

\echo '── I8. progress is derived from the chapters, never asserted ───────────'

do $$
declare
  v_import uuid := '9b000000-0000-0000-0000-000000000001';
  v_item   uuid;
  v_result jsonb;
begin
  select final_library_item_id into v_item from public.book_imports where id = v_import;

  v_result := public.sync_book_import_processing(v_import);
  if (v_result ->> 'status') <> 'processing' or (v_result ->> 'ready')::int <> 0 then
    raise exception 'FAIL: an unprocessed book did not read as processing (%)', v_result;
  end if;

  -- Mark one chapter ready the way the pipeline does, and re-derive.
  perform set_config('fluent.item', v_item::text, false);
end $$;

reset role;
set role service_role;
update public.chapters set status = 'ready', processed_at = now()
  where library_item_id = (
    select final_library_item_id from public.book_imports
    where id = '9b000000-0000-0000-0000-000000000001'
  )
  and position = 1;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_result jsonb;
begin
  v_result := public.sync_book_import_processing('9b000000-0000-0000-0000-000000000001');

  if (v_result ->> 'ready')::int <> 1 or (v_result ->> 'total')::int <> 2 then
    raise exception 'FAIL: progress was not derived from the chapter rows (%)', v_result;
  end if;
  if (v_result ->> 'status') <> 'processing' then
    raise exception 'FAIL: a half-built book read as finished';
  end if;

  -- Re-running changes nothing: the counts come from the rows, not a counter.
  if public.sync_book_import_processing('9b000000-0000-0000-0000-000000000001') <> v_result then
    raise exception 'FAIL: syncing progress twice produced different answers';
  end if;
end $$;

reset role;
set role service_role;
update public.chapters set status = 'ready', processed_at = now()
  where library_item_id = (
    select final_library_item_id from public.book_imports
    where id = '9b000000-0000-0000-0000-000000000001'
  );

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_result jsonb;
  v_status text;
begin
  v_result := public.sync_book_import_processing('9b000000-0000-0000-0000-000000000001');
  if (v_result ->> 'status') <> 'ready' then
    raise exception 'FAIL: a fully processed book did not read as ready (%)', v_result;
  end if;

  select status into v_status from public.library_items
    where id = (select final_library_item_id from public.book_imports
                where id = '9b000000-0000-0000-0000-000000000001');
  if v_status <> 'ready' then
    raise exception 'FAIL: the library item was left as % after processing', v_status;
  end if;
end $$;

\echo '── I9. the finished book is private, and only to its owner ─────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}', false); end $switch$;

do $$
declare
  v_item uuid;
begin
  reset role;
  select final_library_item_id into v_item from public.book_imports
    where id = '9b000000-0000-0000-0000-000000000001';
  set role authenticated;

  if exists (select 1 from public.library_items where id = v_item) then
    raise exception 'FAIL: another learner can see an imported private book';
  end if;
  if exists (select 1 from public.chapters where library_item_id = v_item) then
    raise exception 'FAIL: another learner can see a chapter of a private book';
  end if;

  -- Nor delete it.
  begin
    perform public.delete_private_library_item(v_item);
    raise exception 'FAIL: another learner deleted a private book';
  exception when sqlstate 'FL403' then null;
  end;
end $$;

\echo '── I10. deleting keeps what was learned, drops the private text ────────'

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', false); end $switch$;

do $$
declare
  v_item uuid;
begin
  reset role;
  select final_library_item_id into v_item from public.book_imports
    where id = '9b000000-0000-0000-0000-000000000001';

  -- A word saved WHILE READING the private book, with the sentence it came from.
  insert into public.saved_words (user_id, word_id, origin_library_item_id, origin_context, origin_surface)
  values (
    '99999999-9999-9999-9999-999999999999', 9901, v_item,
    'Sie ging zum Krankenhaus.', 'Krankenhaus'
  );

  set role authenticated;

  if array_length(public.delete_private_library_item(v_item), 1) is null then
    raise exception 'FAIL: deleting a private book returned no storage path to clean up';
  end if;

  if exists (select 1 from public.library_items where id = v_item) then
    raise exception 'FAIL: the private book survived its own deletion';
  end if;

  -- WHAT STAYS: the vocabulary and its schedule. Reading German from a book you
  -- later deleted is still reading German.
  if not exists (
    select 1 from public.saved_words
    where user_id = '99999999-9999-9999-9999-999999999999' and word_id = 9901
  ) then
    raise exception 'FAIL: deleting a book destroyed the vocabulary learned from it';
  end if;

  -- WHAT GOES: the private sentence copied out of the book.
  if exists (
    select 1 from public.saved_words
    where user_id = '99999999-9999-9999-9999-999999999999'
      and word_id = 9901
      and (origin_context is not null or origin_surface is not null)
  ) then
    raise exception 'FAIL: a deleted private book left its text behind on a saved word';
  end if;

  -- And the import row goes with it, so the history does not point at a ghost.
  reset role;
  if exists (select 1 from public.book_imports where id = '9b000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: the import outlived the book it produced';
  end if;
end $$;

\echo '── I11. the private bucket is owner-scoped and closed to anon ──────────'

reset role;

do $$
declare
  v_owner text := '99999999-9999-9999-9999-999999999999';
  v_other text := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin
  if to_regclass('storage.objects') is null then
    raise notice 'SKIP: no storage schema in this database';
    return;
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'private-book-imports' and public = false
  ) then
    raise exception 'FAIL: the private import bucket is missing or public';
  end if;

  -- Two objects, one per learner.
  insert into storage.objects (bucket_id, name)
  values
    ('private-book-imports', v_owner || '/import-1/original.pdf'),
    ('private-book-imports', v_other || '/import-2/original.pdf')
  on conflict do nothing;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s"}', v_owner), false);
  set role authenticated;

  if (select count(*) from storage.objects where bucket_id = 'private-book-imports') <> 1 then
    raise exception 'FAIL: a learner can see objects outside their own prefix';
  end if;

  -- Uploading into somebody else's folder is refused by the policy.
  begin
    insert into storage.objects (bucket_id, name)
    values ('private-book-imports', v_other || '/import-3/original.pdf');
    raise exception 'FAIL: a learner uploaded into another learner''s prefix';
  exception when insufficient_privilege then null;
  end;

  -- And deleting somebody else's object affects nothing.
  delete from storage.objects
    where bucket_id = 'private-book-imports' and name like v_other || '%';
  reset role;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'private-book-imports' and name like v_other || '%'
  ) then
    raise exception 'FAIL: a learner deleted another learner''s original file';
  end if;

  perform set_config('request.jwt.claims', '', false);
  set role anon;
  if exists (select 1 from storage.objects where bucket_id = 'private-book-imports') then
    raise exception 'FAIL: anon can read private import originals';
  end if;
  reset role;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '✔ book import security suite passed'
