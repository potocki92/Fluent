-- Fluent — Material covers: who may publish artwork, and what a cover cannot do.
--
-- The arithmetic of a cover — what file types are allowed, what path an object
-- gets, whether a stored URL is one of ours to delete — is unit-tested in
-- TypeScript (`src/lib/library/covers.test.ts`), and which activity gets a
-- picture at all is tested in `src/lib/library/artwork.test.ts`. What CANNOT be
-- tested there is everything this file asserts:
--
--   * the cover bucket exists, is PUBLIC to read, and is closed to a learner for
--     insert, update and delete — an admin-only button is not an access control;
--   * `library_items.cover_url` is admin-write, and a learner cannot set it
--     however they craft the request;
--   * a private import's artwork is not an admin's to set, exactly as its text
--     is not an admin's to read;
--   * a passage written after Phase 4 acquires its library item through the
--     EXISTING `backfill_library_from_texts()`, and the cover lands on that one
--     item — never on a second content row;
--   * clearing a cover clears the column;
--   * and changing a cover does not touch a daily plan, its items, or their
--     statuses. A picture is presentation metadata; a plan is a snapshot of a
--     day's decision, and the two must not be able to move each other.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use ids in the 6xxx range and the c0be…/ee00… uuid space so they
-- cannot collide with the suites that run before this one.

\set ON_ERROR_STOP on

\set ADMIN   '''c0be0000-0000-0000-0000-0000000000a1'''
\set LEARNER '''c0be0000-0000-0000-0000-0000000000b2'''

\echo '── C0. cover fixtures ──────────────────────────────────────────────────'

insert into auth.users (id, email) values
  ('c0be0000-0000-0000-0000-0000000000a1', 'cover-admin@example.test'),
  ('c0be0000-0000-0000-0000-0000000000b2', 'cover-learner@example.test');

update public.profiles set role = 'admin'
  where id = 'c0be0000-0000-0000-0000-0000000000a1';

-- A passage written AFTER the library existed: a `texts` row with no library
-- item. This is the state an admin is in the moment they save a new text and
-- then attach a picture to it.
insert into public.texts (id, title, cefr, body, difficulty, status)
  overriding system value
  values (6601, 'Ein neues Café', 'A2', '<p>Ein neues Café in der Stadt.</p>', 1300, 'published');

-- A private import, to prove artwork obeys the same ownership rule the text does.
insert into public.library_items (id, slug, title, content_type, rights, status, owner_user_id)
  values (
    'ee000000-0000-0000-0000-000000000009', 'cover-private-book', 'Privates Buch',
    'book', 'private_import', 'published', 'c0be0000-0000-0000-0000-0000000000b2'
  );

\echo '── C1. a new passage reaches the library through the EXISTING backfill ─'

set role service_role;

do $$
declare
  v_created int;
  v_item    public.library_items;
  v_again   int;
begin
  v_created := public.backfill_library_from_texts();
  if v_created < 1 then
    raise exception 'FAIL: the backfill created no item for a passage that had none';
  end if;

  select * into v_item from public.library_items where legacy_text_id = 6601;
  if v_item.id is null then
    raise exception 'FAIL: passage 6601 still has no library item';
  end if;
  if v_item.cover_url is not null then
    raise exception 'FAIL: a freshly backfilled item arrived with artwork';
  end if;

  -- Idempotent: an admin attaching a cover must not be able to mint a second
  -- item for the same passage by pressing the button twice.
  v_again := public.backfill_library_from_texts();
  if exists (
    select 1 from public.library_items
    where legacy_text_id is not null
    group by legacy_text_id having count(*) > 1
  ) then
    raise exception 'FAIL: a passage ended up with two library items (% on the re-run)', v_again;
  end if;

  -- The backfill deliberately leaves the item a DRAFT: the content pipeline
  -- publishes it once the chapter is `ready`. Standing in for that here, because
  -- what this suite is about starts once the material is on the shelf.
  update public.library_items
     set status = 'published', published_at = now()
   where legacy_text_id = 6601;
end $$;

reset role;

\echo '── C2. only an admin may record a cover ────────────────────────────────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"c0be0000-0000-0000-0000-0000000000b2"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_item uuid;
begin
  select id into v_item from public.library_items where legacy_text_id = 6601;

  -- The learner can SEE the published material…
  if not exists (select 1 from public.library_items where id = v_item) then
    raise exception 'FAIL: a learner cannot read published material';
  end if;

  -- …and cannot give it a picture. RLS makes the update affect no rows rather
  -- than raise, which is the same protection with a quieter failure mode.
  update public.library_items
     set cover_url = 'https://evil.example/hijack.png'
   where id = v_item;

  if found then
    raise exception 'FAIL: a learner wrote cover_url on public material';
  end if;
end $$;

reset role;
do $$
declare
  v_cover text;
begin
  select cover_url into v_cover from public.library_items where legacy_text_id = 6601;
  if v_cover is not null then
    raise exception 'FAIL: a learner''s cover_url write survived (%)', v_cover;
  end if;
end $$;

\echo '── C3. an admin sets the cover, on the passage''s own library item ──────'

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"c0be0000-0000-0000-0000-0000000000a1"}', false); end $switch$;
set role authenticated;

do $$
declare
  v_item uuid;
  v_url  text;
begin
  select id into v_item from public.library_items where legacy_text_id = 6601;

  v_url := 'https://project.supabase.co/storage/v1/object/public/content-covers/library/'
        || v_item || '/1f2e3d4c.webp';

  update public.library_items set cover_url = v_url where id = v_item;
  if not found then
    raise exception 'FAIL: an admin could not set a cover on first-party material';
  end if;

  -- THE COVER BELONGS TO THE ITEM. Nothing was written to `chapters`, and a book
  -- with thirty chapters stores one URL rather than thirty.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'chapters'
      and column_name in ('cover_url', 'image_url')
  ) then
    raise exception 'FAIL: a cover column appeared on chapters';
  end if;

  -- And the image is the LIBRARY's fact, not a second column on `texts`.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'texts'
      and column_name in ('cover_url', 'image_url', 'background_url')
  ) then
    raise exception 'FAIL: a second source of truth for artwork appeared on texts';
  end if;
end $$;

\echo '── C4. a private import''s artwork is not an admin''s to set ─────────────'

do $$
begin
  -- `library_item_writable` refuses an owned item to everybody, admins included.
  -- A learner's own book is their document; an admin panel is not a reason to
  -- redecorate it.
  update public.library_items
     set cover_url = 'https://project.supabase.co/storage/v1/object/public/content-covers/library/x/y.webp'
   where id = 'ee000000-0000-0000-0000-000000000009';
  if found then
    raise exception 'FAIL: an admin set the cover of a private import';
  end if;
end $$;

\echo '── C5. clearing a cover clears the column ──────────────────────────────'

do $$
declare
  v_item uuid;
  v_cover text;
begin
  select id into v_item from public.library_items where legacy_text_id = 6601;

  update public.library_items set cover_url = null where id = v_item;
  if not found then
    raise exception 'FAIL: an admin could not remove a cover';
  end if;

  select cover_url into v_cover from public.library_items where id = v_item;
  if v_cover is not null then
    raise exception 'FAIL: the cover survived its removal (%)', v_cover;
  end if;

  -- Put it back for the plan assertions below.
  update public.library_items
     set cover_url = 'https://project.supabase.co/storage/v1/object/public/content-covers/library/'
                  || v_item || '/aaaa1111.webp'
   where id = v_item;
end $$;

reset role;

\echo '── C6. the bucket is public to read and closed to a learner to write ───'

do $$
declare
  v_item uuid;
  v_path text;
begin
  if to_regclass('storage.objects') is null then
    raise notice 'SKIP: no storage schema in this database';
    return;
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'content-covers' and public = true
  ) then
    raise exception 'FAIL: the content-covers bucket is missing or not public';
  end if;

  select id into v_item from public.library_items where legacy_text_id = 6601;
  v_path := 'library/' || v_item || '/aaaa1111.webp';

  insert into storage.objects (bucket_id, name) values ('content-covers', v_path)
    on conflict do nothing;

  -- READ: anyone, signed in or not. `/library` is readable without an account,
  -- so its artwork has to be too.
  perform set_config('request.jwt.claims', '', false);
  set role anon;
  if not exists (
    select 1 from storage.objects where bucket_id = 'content-covers' and name = v_path
  ) then
    raise exception 'FAIL: a published cover is not publicly readable';
  end if;
  reset role;

  -- WRITE: not a learner's, in any of the three ways a learner could try.
  perform set_config('request.jwt.claims',
    '{"sub":"c0be0000-0000-0000-0000-0000000000b2"}', false);
  set role authenticated;

  begin
    insert into storage.objects (bucket_id, name)
    values ('content-covers', 'library/' || v_item || '/hijack.webp');
    raise exception 'FAIL: a learner uploaded into the cover bucket';
  exception when insufficient_privilege then null;
  end;

  update storage.objects set name = 'library/' || v_item || '/swapped.webp'
   where bucket_id = 'content-covers' and name = v_path;
  if found then
    raise exception 'FAIL: a learner replaced a published cover';
  end if;

  delete from storage.objects where bucket_id = 'content-covers' and name = v_path;
  reset role;
  if not exists (
    select 1 from storage.objects where bucket_id = 'content-covers' and name = v_path
  ) then
    raise exception 'FAIL: a learner deleted a published cover';
  end if;

  -- An admin may do all three.
  perform set_config('request.jwt.claims',
    '{"sub":"c0be0000-0000-0000-0000-0000000000a1"}', false);
  set role authenticated;

  insert into storage.objects (bucket_id, name)
  values ('content-covers', 'library/' || v_item || '/bbbb2222.webp');

  delete from storage.objects
   where bucket_id = 'content-covers' and name = 'library/' || v_item || '/bbbb2222.webp';
  if exists (
    select 1 from storage.objects
    where bucket_id = 'content-covers' and name = 'library/' || v_item || '/bbbb2222.webp'
  ) then
    raise exception 'FAIL: an admin could not delete a cover they uploaded';
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', false);
end $$;

reset role;

\echo '── C7. changing a cover does not touch the daily plan ──────────────────'

-- The probe carries one plan id and two snapshots across the role switches this
-- assertion needs: only the service role may BUILD a plan, only the learner may
-- sync their own, and only an admin may change a cover.
create temporary table cover_plan_probe (
  plan_id  uuid,
  snapshot jsonb,
  taken    text
);

-- The probe is scaffolding, not schema: every role in this assertion writes to
-- it, and none of them is the superuser that created it.
grant select, insert on cover_plan_probe to service_role, authenticated;

set role service_role;

do $$
declare
  v_items jsonb := jsonb_build_array(
    jsonb_build_object(
      'item_position', 1, 'item_type', 'continue_text', 'estimated_minutes', 6,
      'priority_score', 0.8, 'reason_code', 'text_started',
      'reason_data', jsonb_build_object('textTitle', 'Ein neues Café'),
      'target_count', 1, 'text_id', 6601,
      'payload', jsonb_build_object('title', 'Ein neues Café')
    )
  );
begin
  insert into cover_plan_probe (plan_id, taken)
  values (
    public.create_daily_plan(
      'c0be0000-0000-0000-0000-0000000000b2', date '2026-09-21', 'Europe/Warsaw',
      15, 'planner_v1', 'medium', v_items, false
    ),
    'plan'
  );
end $$;

reset role;

-- The learner reconciles their own plan, exactly as opening Today does.
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"c0be0000-0000-0000-0000-0000000000b2"}', false); end $switch$;
set role authenticated;
do $$
declare
  v_plan uuid;
begin
  select plan_id into v_plan from cover_plan_probe where taken = 'plan';
  perform public.sync_daily_plan(v_plan);
end $$;
reset role;

-- Everything a learner would notice about the plan, before the picture changes.
insert into cover_plan_probe (plan_id, snapshot, taken)
select p.id,
       jsonb_build_object(
         'plan_status', p.status,
         'items', jsonb_agg(jsonb_build_object(
           'id', i.id, 'type', i.item_type, 'status', i.status,
           'completed', i.completed_count, 'payload', i.payload
         ) order by i.item_position)
       ),
       'before'
  from public.daily_plans p
  join public.daily_plan_items i on i.plan_id = p.id
 where p.id = (select plan_id from cover_plan_probe where taken = 'plan')
 group by p.id, p.status;

-- An admin replaces the artwork at noon. THE PLAN IS A SNAPSHOT OF A DECISION;
-- a cover is how the material is presented. Neither may move the other: no plan
-- is regenerated, no item changes status, and nothing loses its progress.
do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"c0be0000-0000-0000-0000-0000000000a1"}', false); end $switch$;
set role authenticated;
do $$
declare
  v_item uuid;
begin
  select id into v_item from public.library_items where legacy_text_id = 6601;
  update public.library_items
     set cover_url = 'https://project.supabase.co/storage/v1/object/public/content-covers/library/'
                  || v_item || '/cccc3333.webp'
   where id = v_item;
  if not found then
    raise exception 'FAIL: the admin could not replace the cover';
  end if;
end $$;
reset role;

do $switch$ begin perform set_config('request.jwt.claims', '{"sub":"c0be0000-0000-0000-0000-0000000000b2"}', false); end $switch$;
set role authenticated;
do $$
declare
  v_plan uuid;
begin
  select plan_id into v_plan from cover_plan_probe where taken = 'plan';
  perform public.sync_daily_plan(v_plan);
end $$;
reset role;

insert into cover_plan_probe (plan_id, snapshot, taken)
select p.id,
       jsonb_build_object(
         'plan_status', p.status,
         'items', jsonb_agg(jsonb_build_object(
           'id', i.id, 'type', i.item_type, 'status', i.status,
           'completed', i.completed_count, 'payload', i.payload
         ) order by i.item_position)
       ),
       'after'
  from public.daily_plans p
  join public.daily_plan_items i on i.plan_id = p.id
 where p.id = (select plan_id from cover_plan_probe where taken = 'plan')
 group by p.id, p.status;

do $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_leaked int;
begin
  select snapshot into v_before from cover_plan_probe where taken = 'before';
  select snapshot into v_after  from cover_plan_probe where taken = 'after';

  if v_before is null or v_after is null then
    raise exception 'FAIL: the plan snapshots were not taken';
  end if;
  if v_before is distinct from v_after then
    raise exception 'FAIL: changing a cover changed the plan. before=% after=%',
      v_before, v_after;
  end if;

  -- And the plan never learned the URL in the first place: a cover snapshotted
  -- into a plan item would go stale the moment an admin edited it.
  select count(*) into v_leaked
    from public.daily_plan_items
   where plan_id = (select plan_id from cover_plan_probe where taken = 'plan')
     and payload::text like '%content-covers%';
  if v_leaked <> 0 then
    raise exception 'FAIL: a cover URL was snapshotted into a daily plan item';
  end if;
end $$;

drop table cover_plan_probe;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '✔ material cover security suite passed'
