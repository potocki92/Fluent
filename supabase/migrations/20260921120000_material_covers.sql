-- ═════════════════════════════════════════════════════════════════════════════
-- MATERIAL COVERS — artwork for the things a learner reads.
-- ═════════════════════════════════════════════════════════════════════════════
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
--
-- It adds a Storage bucket and the policies that decide who may write to it. It
-- adds NO column: `library_items.cover_url` has existed since Phase 4
-- (`20260914120000_reader_story_engine.sql`) and is the one place a material's
-- picture is recorded. A passage in `texts` reaches it through
-- `library_items.legacy_text_id` — the same mapping questions, attempts,
-- completions and today's plan already travel — so there is no second image
-- column and no second content model to keep in step.
--
-- A COVER BELONGS TO THE ITEM, NOT THE CHAPTER. A 30-chapter novel stores one
-- URL; a chapter inherits its book's artwork at read time. That is why nothing
-- here touches `chapters`.
--
-- WHO MAY WRITE. `library_items` is already admin-write via
-- `library_item_writable(owner_user_id)`, which also refuses a private import to
-- everyone including admins — so the column's authorisation is settled. What is
-- NOT settled by that policy is the bucket: without the policies below, any
-- authenticated learner could upload, replace or delete the artwork of published
-- teaching material. A hidden button in an admin panel is not an access control.
--
-- WHY THE BUCKET IS PUBLIC-READ. These are the covers of PUBLISHED material —
-- the same bytes every learner is meant to see. Signing a URL per render would
-- cost a round trip and defeat CDN caching to protect nothing. The importer's
-- bucket is private for the opposite reason: a learner's own file is theirs.
-- Two buckets, two rules, neither inherited from the other.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE BUCKET.
-- ─────────────────────────────────────────────────────────────────────────────
-- Guarded on `storage.buckets` existing so the schema still applies to a plain
-- PostgreSQL instance, which is exactly what `supabase/tests/run.sh` does. The
-- test shim provides a minimal `storage` schema, so the policies below are
-- created — and exercised — there too.
do $$
declare
  -- Mirrors MAX_COVER_BYTES in `src/lib/library/covers.ts` (5 MB). A PL/pgSQL
  -- function cannot import a TypeScript constant; change both together.
  v_size_limit bigint := 5 * 1024 * 1024;
  v_mime text[] := array['image/jpeg', 'image/png', 'image/webp'];
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('content-covers', 'content-covers', true)
    on conflict (id) do update set public = true;

    -- THE THIRD PLACE THE LIMITS ARE ENFORCED, after the browser and the Server
    -- Action. Storage rejects an oversized or wrong-typed object itself, so a
    -- signed upload URL cannot be used to park a 200 MB video in a public
    -- bucket. Applied only where the columns exist: the test shim has neither,
    -- and an older Storage release may have only one.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'buckets'
        and column_name = 'file_size_limit'
    ) then
      execute 'update storage.buckets set file_size_limit = $1 where id = ''content-covers'''
        using v_size_limit;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'buckets'
        and column_name = 'allowed_mime_types'
    ) then
      execute 'update storage.buckets set allowed_mime_types = $1 where id = ''content-covers'''
        using v_mime;
    end if;
  end if;

  -- ───────────────────────────────────────────────────────────────────────────
  -- 2. WHO MAY DO WHAT TO AN OBJECT IN IT.
  -- ───────────────────────────────────────────────────────────────────────────
  if to_regclass('storage.objects') is not null then
    -- A hosted Supabase project already has RLS on `storage.objects`, and the
    -- role running migrations may not own that table. Enabling it again would
    -- fail for a permission reason on a database where it is already correct, so
    -- it is only touched when it is actually off.
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
      execute 'alter table storage.objects enable row level security';
    end if;

    -- READ: everyone, signed in or not. A published material's artwork is public
    -- content, and `/library` is readable without an account.
    execute 'drop policy if exists "content covers public read" on storage.objects';
    execute $p$
      create policy "content covers public read" on storage.objects
        for select to anon, authenticated using (
          bucket_id = 'content-covers'
        )
    $p$;

    -- WRITE: admins, and nobody else. `public.is_admin()` reads the role from
    -- `profiles` — the same predicate every other admin policy in this schema
    -- uses — so there is one definition of "admin" and a learner cannot upload,
    -- replace or delete artwork whatever request they craft against the bucket.
    execute 'drop policy if exists "content covers admin insert" on storage.objects';
    execute $p$
      create policy "content covers admin insert" on storage.objects
        for insert to authenticated with check (
          bucket_id = 'content-covers' and public.is_admin()
        )
    $p$;

    execute 'drop policy if exists "content covers admin update" on storage.objects';
    execute $p$
      create policy "content covers admin update" on storage.objects
        for update to authenticated using (
          bucket_id = 'content-covers' and public.is_admin()
        ) with check (
          bucket_id = 'content-covers' and public.is_admin()
        )
    $p$;

    execute 'drop policy if exists "content covers admin delete" on storage.objects';
    execute $p$
      create policy "content covers admin delete" on storage.objects
        for delete to authenticated using (
          bucket_id = 'content-covers' and public.is_admin()
        )
    $p$;
  end if;
exception
  when insufficient_privilege then
    -- Some managed deployments lock the `storage` schema to its own admin role.
    -- The migration must not abort, and the failure mode is SAFE: without the
    -- bucket uploads fail loudly, and without the policies RLS denies
    -- everything. Fail closed, warn, and let the operator apply the block.
    raise warning 'content cover storage objects were not created (%). Create the public bucket and its policies manually — see supabase/migrations/README.md.', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FINDING THE ITEM A PASSAGE BECAME.
-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing new is needed: `backfill_library_from_texts()` already creates the
-- missing item for a passage written after Phase 4, and it is already
-- service_role-only and idempotent. The cover actions call it exactly as
-- `processPendingChapters` does, rather than inventing a second way for a
-- `texts` row to acquire a library item.
--
-- It is run here too, so that a project applying this migration has an item for
-- every passage before an admin tries to give one a picture.
do $$ begin perform public.backfill_library_from_texts(); end $$;

comment on column public.library_items.cover_url is
  'The material''s artwork: an absolute URL, normally a public object in the content-covers bucket. Set for a passage through legacy_text_id, inherited by every chapter of a book, and never duplicated onto chapters.';
