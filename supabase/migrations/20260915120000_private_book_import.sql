-- Fluent — Phase 5.5: the private book import engine.
--
-- WHAT THIS ADDS. Until now the only way a text reached the library was an admin
-- pasting it into `/admin/library`, one chapter at a time. That is a workable
-- way to publish forty graded passages and an impossible way to read a novel:
-- nobody is going to paste seventy-three chapters of "Der Prozess" into a form,
-- and if they did, the result would be first-party content owned by Fluent
-- rather than a private file owned by whoever uploaded it.
--
-- So this migration builds the other door. A learner uploads a PDF, an EPUB or a
-- TXT; the server extracts, cleans and splits it; the learner checks the chapter
-- list and confirms; and the result is an ordinary `library_items` row with
-- `rights = 'private_import'`, whose chapters go through the same content
-- pipeline, the same reader and the same Story engine as everything else.
--
-- THE THREE INVARIANTS THIS SCHEMA EXISTS TO ENFORCE.
--
--   1. A PRIVATE BOOK CANNOT BECOME PUBLIC. `rights` and `owner_user_id` are set
--      by `finalize_book_import` and by nothing else; `library_item_readable`
--      (Phase 4) already refuses an owned item to everyone but its owner,
--      including admins. There is no code path that clears `owner_user_id`.
--
--   2. FINALIZING IS IDEMPOTENT. Two clicks, two tabs, two concurrent requests:
--      one book. The import row is locked, `final_library_item_id` is the
--      receipt, and a second call returns the first call's answer.
--
--   3. THE CLIENT OWNS NOTHING SYSTEMIC. `user_id`, `storage_path`, `status`,
--      `final_library_item_id` have no learner write path — same rule progress
--      has followed since Phase 1. Titles, inclusion and splits are edited
--      through one SECURITY DEFINER function that derives the owner from
--      `auth.uid()` and keeps positions contiguous in the same transaction.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE IMPORT — one row per uploaded file.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TABLE AND NOT A REQUEST. A 400-page novel cannot be extracted, cleaned,
-- split, reviewed and processed inside one HTTP request on any deployment Fluent
-- targets, and a learner who closes the tab must not lose the upload they waited
-- two minutes for. So the import is a persistent object with a state machine:
-- every stage reads its state from here, writes its state back here, and can be
-- resumed by any later request.
--
-- STATUS AND STAGE ARE DIFFERENT QUESTIONS. `status` is where the import is in
-- its life and decides which screen renders; `stage` is what the work is doing
-- and decides what that screen says. Collapsed into one column the UI can only
-- say "przetwarzanie" for two minutes, which tells a learner nothing about
-- whether anything is happening. The values are mirrored in
-- `src/lib/import/state.ts`, which also holds the transition table.
create table if not exists public.book_imports (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  file_name text not null,
  file_type text not null check (file_type in ('pdf', 'epub', 'txt')),
  file_size bigint not null default 0,

  -- SHA-256 of the original, computed in the browser before the upload starts.
  -- Used for ONE thing: telling a learner "this looks like a book you already
  -- have". Never a uniqueness constraint — wanting a second copy is legitimate,
  -- and a hash is not a policy.
  file_hash text,

  -- `<user_id>/<import_id>/original.<ext>` in the private bucket. Written by
  -- `create_book_import` so that the path always agrees with the row, and never
  -- by a client, which is what makes the Storage policy's prefix check a
  -- guarantee rather than a convention.
  storage_path text not null,

  status text not null default 'uploaded'
    check (status in (
      'uploaded', 'extracting', 'analyzing', 'awaiting_review',
      'importing', 'processing', 'ready', 'failed', 'cancelled'
    )),

  stage text
    check (stage in (
      'extract_text', 'detect_metadata', 'detect_chapters',
      'persist_content', 'process_chapters'
    )),

  -- REAL COUNTS, NOT A PERCENTAGE. "17 z 42 rozdziałów" is a fact the learner
  -- can check; "73%" is a number invented to fill a progress bar. Recomputed
  -- from the `chapters` rows by `sync_book_import_processing` rather than
  -- incremented, so a retried batch cannot count a chapter twice.
  total_chapters     int not null default 0,
  processed_chapters int not null default 0,
  failed_chapters    int not null default 0,

  -- What the FILE said about itself, kept apart from what the LEARNER confirmed.
  -- PDF metadata is wrong often enough that overwriting the learner's correction
  -- with it on a re-analysis would be a bug; two columns make that impossible.
  detected_title    text,
  detected_author   text,
  detected_language text,
  language_confidence numeric,

  title  text,
  author text,

  page_count    int,
  word_count    int not null default 0,
  chapter_count int not null default 0,

  -- Extraction quality signals (sparse pages, garbage ratio, text samples).
  -- jsonb because it is a diagnostic report read as a whole, never queried by
  -- field, and because adding a signal must not need a migration.
  quality jsonb not null default '{}'::jsonb,

  -- WHICH PIPELINE BUILT THIS. `pipeline_version` stamps extraction and cleanup,
  -- `detector_version` stamps chapter detection. Separate because they answer
  -- separate questions and improve on separate schedules — and because
  -- "which imports predate the better detector?" is the question that makes
  -- re-analysis worth offering at all.
  pipeline_version text,
  detector_version text,

  -- THE IDEMPOTENCY RECEIPT. Non-null means this import has already become a
  -- book, and finalizing again returns this id instead of creating a second one.
  final_library_item_id uuid references public.library_items(id) on delete set null,

  -- Classified failure, for the UI, plus a technical detail for the logs. The
  -- learner never sees `error_message`; `src/lib/import/state.ts` maps
  -- `error_code` to a Polish sentence that says what to try next.
  error_code    text,
  error_message text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  analyzed_at  timestamptz,
  finalized_at timestamptz
);

-- One import per stored object. Belt and braces: the path already contains the
-- import id, so a collision would mean `gen_random_uuid()` repeated itself.
create unique index if not exists book_imports_storage_path_idx
  on public.book_imports (storage_path);

-- "My imports, newest first" — the whole of the import history screen.
create index if not exists book_imports_user_recent_idx
  on public.book_imports (user_id, created_at desc);

-- "Have I imported this file before?" One index lookup, scoped to the learner:
-- a hash is never compared across accounts, because whether somebody else has
-- the same book is not Fluent's business.
create index if not exists book_imports_user_hash_idx
  on public.book_imports (user_id, file_hash) where file_hash is not null;

-- Unconfirmed drafts, oldest first — what a future cleanup job scans.
create index if not exists book_imports_draft_age_idx
  on public.book_imports (updated_at)
  where status in ('uploaded', 'extracting', 'analyzing', 'awaiting_review', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE PREVIEW — detected chapters, before they are a book.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NOT `chapters`. A detected chapter is a PROPOSAL. Writing proposals
-- into the library would mean a cancelled import leaves a half-book on the shelf,
-- an abandoned import leaves rows the reader can open, and "is this a real book?"
-- becomes a status check in every library query. Keeping the proposal in its own
-- table means cancelling is a delete and nothing else in the app has to know the
-- importer exists.
--
-- IT HOLDS THE CLEANED TEXT. The alternative — re-extracting the PDF each time
-- the learner opens the preview — would make every keystroke in the review
-- screen cost a full re-parse of the book. The original binary stays in Storage,
-- this holds the text once, and after finalizing the text lives on `chapters`
-- and these rows are the only copy that can be dropped.
create table if not exists public.book_import_chapters (
  id        uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.book_imports(id) on delete cascade,

  -- 1-based and contiguous. Kept contiguous by `edit_book_import_chapters`,
  -- which is why the constraint below is DEFERRABLE: a reorder swaps two
  -- positions and would otherwise collide with itself mid-statement.
  position int not null,

  -- What the detector proposed, and what the learner decided. Two columns for
  -- the same reason the import has `detected_title` and `title`: a re-analysis
  -- must never silently overwrite a correction somebody typed.
  detected_title text,
  title          text,

  source_text text not null default '',
  word_count  int  not null default 0,

  -- WHERE THIS CAME FROM IN THE FILE. Page numbers for a PDF, spine index for an
  -- EPUB. Not used by the reader; used by a person trying to work out why a
  -- split landed where it did, which is the only way a detector ever improves.
  source_page_start int,
  source_page_end   int,
  source_href       text,

  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  -- Which signals fired. Diagnostic, never rendered raw to a learner.
  signals jsonb not null default '[]'::jsonb,

  -- Title pages, contents, colophons. Detected so the preview can offer them
  -- switched OFF; never deleted, because an importer that silently drops pages
  -- is an importer nobody trusts.
  is_front_matter boolean not null default false,
  included        boolean not null default true,

  -- THE GUARD ON MANUAL WORK. Set the moment a learner renames, splits, merges
  -- or reorders. `apply_book_import_analysis` refuses to replace a chapter set
  -- containing edited rows, so re-running the detector cannot quietly destroy
  -- twenty minutes of somebody's corrections.
  edited boolean not null default false,

  -- Filled in by `finalize_book_import`, so a chapter in the library can be
  -- traced back to the proposal it came from.
  chapter_id uuid references public.chapters(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'book_import_chapters_position_key'
  ) then
    -- DEFERRABLE on purpose. "Move chapter 7 up" is two updates that transiently
    -- collide; an immediate constraint would force a shuffle through a sentinel
    -- position, which is three times the statements and one more way to leave the
    -- list inconsistent if anything throws.
    alter table public.book_import_chapters
      add constraint book_import_chapters_position_key
      unique (import_id, position) deferrable initially deferred;
  end if;
end $$;

create index if not exists book_import_chapters_import_idx
  on public.book_import_chapters (import_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. WHERE A CHAPTER CAME FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- One nullable column rather than a join table: a chapter has at most one
-- import, the reference is documentation rather than something the reader
-- branches on, and `on delete set null` means deleting an import never touches
-- a book that already exists.
alter table public.chapters
  add column if not exists import_id uuid references public.book_imports(id) on delete set null;

create index if not exists chapters_import_idx
  on public.chapters (import_id) where import_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PRIVATE STORAGE.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ORIGINAL FILE IS NOT DATABASE DATA. A 30 MB PDF in a `bytea` column is a
-- 30 MB row that every backup, every replica and every `select *` pays for, to
-- store something that is read at most twice in its life. It goes in Storage.
--
-- THE BUCKET IS PRIVATE, AND THAT IS ENFORCED TWICE: `public = false` means no
-- object has a public URL at all, and the policies below scope every operation
-- to the first path segment, which `create_book_import` sets to the owner's id.
-- "The URL is hard to guess" is not a security model.
--
-- Guarded on `storage.objects` existing so that the schema still applies to a
-- plain PostgreSQL instance — which is exactly what `supabase/tests/run.sh`
-- does. The test shim provides a minimal `storage` schema so these policies are
-- created, and exercised, there too.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('private-book-imports', 'private-book-imports', false)
    on conflict (id) do nothing;
  end if;

  if to_regclass('storage.objects') is not null then
    -- A hosted Supabase project already has RLS on `storage.objects`, and the
    -- role running migrations may not own that table. Enabling it again would
    -- fail for a permission reason on a database where it is already correct, so
    -- it is only touched when it is actually off.
    if not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass) then
      execute 'alter table storage.objects enable row level security';
    end if;

    -- READ / WRITE / DELETE YOUR OWN PREFIX, AND NOTHING ELSE.
    --
    -- `split_part(name, '/', 1)` is the owner's user id, because the path is
    -- minted server-side as `<user_id>/<import_id>/original.<ext>`. A learner
    -- cannot upload into somebody else's folder (the WITH CHECK refuses it) and
    -- cannot read out of one (the USING refuses it). `anon` gets nothing: the
    -- policies are on `authenticated` alone.
    execute 'drop policy if exists "own book imports read" on storage.objects';
    execute $p$
      create policy "own book imports read" on storage.objects
        for select to authenticated using (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;

    execute 'drop policy if exists "own book imports insert" on storage.objects';
    execute $p$
      create policy "own book imports insert" on storage.objects
        for insert to authenticated with check (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;

    execute 'drop policy if exists "own book imports update" on storage.objects';
    execute $p$
      create policy "own book imports update" on storage.objects
        for update to authenticated using (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        ) with check (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;

    execute 'drop policy if exists "own book imports delete" on storage.objects';
    execute $p$
      create policy "own book imports delete" on storage.objects
        for delete to authenticated using (
          bucket_id = 'private-book-imports'
          and split_part(name, '/', 1) = (select auth.uid())::text
        )
    $p$;
  end if;
exception
  when insufficient_privilege then
    -- Some managed deployments lock the `storage` schema to its own admin role.
    -- The migration must not abort — every other object here is independent of
    -- Storage — and the failure mode is SAFE: without the bucket, uploads fail
    -- loudly, and without the policies RLS denies everything. Fail closed, warn,
    -- and let the operator apply the block by hand.
    raise warning 'book import storage objects were not created (%). Create the private bucket and its policies manually — see supabase/migrations/README.md.', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CREATING AN IMPORT.
-- ─────────────────────────────────────────────────────────────────────────────
-- The learner supplies the file's name, type, size and hash. Everything the
-- system depends on — who owns it, where it is stored, what state it is in — is
-- derived here, from `auth.uid()`, and is therefore not something a crafted
-- request can set.
create or replace function public.create_book_import(
  p_file_name text,
  p_file_type text,
  p_file_size bigint,
  p_file_hash text default null
)
returns public.book_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_id     uuid := gen_random_uuid();
  v_ext    text;
  v_result public.book_imports;
begin
  if v_user is null then
    raise exception 'Zaloguj się, aby zaimportować książkę.' using errcode = 'FL401';
  end if;

  if p_file_type not in ('pdf', 'epub', 'txt') then
    raise exception 'Nieobsługiwany format pliku.' using errcode = 'FL422';
  end if;

  -- 40 MB. THE ONE PLACE THIS NUMBER IS DUPLICATED: `MAX_BOOK_IMPORT_MB` in
  -- `src/lib/import/constants.ts` is what the browser and the server action read,
  -- and a PL/pgSQL function cannot import it. Change both together. The database
  -- enforces the limit because a browser check is a courtesy to the uploader, not
  -- a control.
  if coalesce(p_file_size, 0) <= 0 or p_file_size > 40 * 1024 * 1024 then
    raise exception 'Plik ma nieprawidłowy rozmiar.' using errcode = 'FL422';
  end if;

  v_ext := p_file_type;

  insert into public.book_imports (
    id, user_id, file_name, file_type, file_size, file_hash, storage_path, status
  )
  values (
    v_id,
    v_user,
    -- The name is displayed, never used as a path. Trimmed and bounded so a
    -- pathological filename cannot break a layout.
    left(coalesce(nullif(trim(p_file_name), ''), 'książka'), 200),
    p_file_type,
    p_file_size,
    nullif(trim(p_file_hash), ''),
    v_user::text || '/' || v_id::text || '/original.' || v_ext,
    'uploaded'
  )
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.create_book_import(text, text, bigint, text) is
  'Mint an import row for the caller. Owner and storage path are derived from auth.uid(), never accepted from the client.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. MOVING THE STATE MACHINE.
-- ─────────────────────────────────────────────────────────────────────────────
-- service_role only. The stages between `uploaded` and `awaiting_review` are
-- server work, and a client that could declare itself `ready` could declare an
-- unextracted file a finished book.
create or replace function public.set_book_import_state(
  p_import_id     uuid,
  p_status        text,
  p_stage         text default null,
  p_error_code    text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.book_imports i
  set status        = p_status,
      stage         = p_stage,
      error_code    = p_error_code,
      -- Bounded: a Postgres error detail can be long, and this column is read by
      -- humans debugging, not by machines.
      error_message = left(p_error_message, 1000),
      updated_at    = now()
  where i.id = p_import_id;

  if not found then
    raise exception 'Import nie istnieje.' using errcode = 'FL404';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RECORDING ONE ANALYSIS RUN.
-- ─────────────────────────────────────────────────────────────────────────────
-- The whole result of extraction, cleanup and detection, written in one
-- transaction: the import's metadata and its complete chapter proposal. Partial
-- state is not a thing this can leave behind.
--
-- IT REFUSES TO DESTROY MANUAL WORK. If any proposed chapter carries
-- `edited = true`, the caller is re-running the detector over corrections
-- somebody made by hand, and the answer is FL423 rather than a silent overwrite.
-- The UI turns that into "re-analysis would discard your changes" and asks.
create or replace function public.apply_book_import_analysis(
  p_import_id uuid,
  p_payload   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import  public.book_imports%rowtype;
  v_chapter jsonb;
  v_index   int := 0;
begin
  select * into v_import from public.book_imports i where i.id = p_import_id for update;
  if not found then
    raise exception 'Import nie istnieje.' using errcode = 'FL404';
  end if;

  if v_import.final_library_item_id is not null then
    raise exception 'Ten import został już zakończony.' using errcode = 'FL409';
  end if;

  if exists (
    select 1 from public.book_import_chapters c
    where c.import_id = p_import_id and c.edited
  ) and coalesce((p_payload ->> 'force')::boolean, false) is not true then
    raise exception 'Import ma ręczne poprawki.' using errcode = 'FL423';
  end if;

  update public.book_imports i
  set detected_title      = nullif(p_payload ->> 'detected_title', ''),
      detected_author     = nullif(p_payload ->> 'detected_author', ''),
      detected_language   = nullif(p_payload ->> 'detected_language', ''),
      language_confidence = (p_payload ->> 'language_confidence')::numeric,
      -- The learner's own title survives re-analysis; the detector only fills a
      -- field nobody has typed in yet.
      title               = coalesce(i.title, nullif(p_payload ->> 'detected_title', '')),
      author              = coalesce(i.author, nullif(p_payload ->> 'detected_author', '')),
      -- The hash the SERVER computed over the stored bytes replaces the one the
      -- browser claimed at upload time. It only drives a duplicate warning, but
      -- a value a client supplied is a claim and one derived from the file is a
      -- fact, and there is no reason to keep the weaker of the two.
      file_hash           = coalesce(nullif(p_payload ->> 'file_hash', ''), i.file_hash),
      page_count          = (p_payload ->> 'page_count')::int,
      word_count          = coalesce((p_payload ->> 'word_count')::int, 0),
      chapter_count       = coalesce(jsonb_array_length(p_payload -> 'chapters'), 0),
      quality             = coalesce(p_payload -> 'quality', '{}'::jsonb),
      pipeline_version    = nullif(p_payload ->> 'pipeline_version', ''),
      detector_version    = nullif(p_payload ->> 'detector_version', ''),
      status              = 'awaiting_review',
      stage               = null,
      error_code          = null,
      error_message       = null,
      analyzed_at         = now(),
      updated_at          = now()
  where i.id = p_import_id;

  -- Replaced wholesale rather than upserted by position: a second analysis that
  -- found fewer chapters would otherwise leave the tail of the first one behind.
  delete from public.book_import_chapters c where c.import_id = p_import_id;

  for v_chapter in select * from jsonb_array_elements(coalesce(p_payload -> 'chapters', '[]'::jsonb))
  loop
    v_index := v_index + 1;
    insert into public.book_import_chapters (
      import_id, position, detected_title, title, source_text, word_count,
      source_page_start, source_page_end, source_href,
      confidence, signals, is_front_matter, included
    )
    values (
      p_import_id,
      v_index,
      nullif(v_chapter ->> 'title', ''),
      nullif(v_chapter ->> 'title', ''),
      coalesce(v_chapter ->> 'text', ''),
      coalesce((v_chapter ->> 'word_count')::int, 0),
      (v_chapter ->> 'start_page')::int,
      (v_chapter ->> 'end_page')::int,
      nullif(v_chapter ->> 'href', ''),
      coalesce(nullif(v_chapter ->> 'confidence', ''), 'medium'),
      coalesce(v_chapter -> 'signals', '[]'::jsonb),
      coalesce((v_chapter ->> 'is_front_matter')::boolean, false),
      -- Front matter starts switched off. It is a title page, a contents list or
      -- a colophon; importing it as chapter 1 of a novel is never what anyone
      -- wanted, and one tap puts it back.
      not coalesce((v_chapter ->> 'is_front_matter')::boolean, false)
    );
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. WHAT THE LEARNER MAY CHANGE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Title, author, and — through `edit_book_import_chapters` — the chapter list.
-- Everything else about an import is systemic. These run as the caller's owner
-- check, not as an admin: `auth.uid()` is the only source of "whose import is
-- this?" anywhere in this file.
create or replace function public.update_book_import_metadata(
  p_import_id uuid,
  p_title     text,
  p_author    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  update public.book_imports i
  set title      = left(nullif(trim(p_title), ''), 200),
      author     = left(nullif(trim(p_author), ''), 200),
      updated_at = now()
  where i.id = p_import_id
    and i.user_id = v_user
    and i.final_library_item_id is null;

  if not found then
    raise exception 'Nie można zmienić tego importu.' using errcode = 'FL403';
  end if;
end;
$$;

-- The preview's five edits, in one transaction each.
--
-- WHY ONE FUNCTION AND NOT COLUMN GRANTS. Renaming a chapter is a single-column
-- update and could be a policy; merging two is a delete, a concatenation and a
-- renumber, and splitting one is an insert and a renumber. Those must be atomic
-- or the list ends up with a gap, and a list with a gap becomes a book with
-- chapter 7 missing. One entry point means one place where `position` is kept
-- contiguous and one place where ownership is checked.
--
--   rename   {chapter_id, title}
--   include  {chapter_id, included}
--   merge_up {chapter_id}                 fold into the chapter before it
--   split    {chapter_id, paragraph}      cut at a paragraph boundary
--   move     {chapter_id, direction}      up / down
create or replace function public.edit_book_import_chapters(
  p_import_id uuid,
  p_op        text,
  p_payload   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_import     public.book_imports%rowtype;
  v_chapter    public.book_import_chapters%rowtype;
  v_other      public.book_import_chapters%rowtype;
  v_target_id  uuid := (p_payload ->> 'chapter_id')::uuid;
  v_paragraphs text[];
  v_cut        int;
  v_head       text;
  v_tail       text;
begin
  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user
  for update;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  if v_import.final_library_item_id is not null then
    raise exception 'Ten import został już zakończony.' using errcode = 'FL409';
  end if;

  select * into v_chapter
  from public.book_import_chapters c
  where c.id = v_target_id and c.import_id = p_import_id;

  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  if p_op = 'rename' then
    update public.book_import_chapters c
    set title      = left(nullif(trim(p_payload ->> 'title'), ''), 200),
        edited     = true,
        updated_at = now()
    where c.id = v_chapter.id;

  elsif p_op = 'include' then
    update public.book_import_chapters c
    set included   = coalesce((p_payload ->> 'included')::boolean, true),
        edited     = true,
        updated_at = now()
    where c.id = v_chapter.id;

  elsif p_op = 'merge_up' then
    select * into v_other
    from public.book_import_chapters c
    where c.import_id = p_import_id and c.position < v_chapter.position
    order by c.position desc
    limit 1;

    if not found then
      raise exception 'Nie ma rozdziału powyżej.' using errcode = 'FL422';
    end if;

    -- THE MERGED CHAPTER'S TITLE BECOMES A HEADING, not nothing. The content
    -- pipeline reads `## …` on its own line as a heading paragraph, so the words
    -- survive in the text exactly where they were — merging must never lose
    -- characters from somebody's book.
    update public.book_import_chapters c
    set source_text = c.source_text
                      || case
                           when coalesce(v_chapter.title, '') <> ''
                             then E'\n\n## ' || v_chapter.title || E'\n\n'
                           else E'\n\n'
                         end
                      || v_chapter.source_text,
        word_count  = c.word_count + v_chapter.word_count,
        source_page_end = greatest(
          coalesce(c.source_page_end, 0), coalesce(v_chapter.source_page_end, 0)
        ),
        -- The merged result is only as trustworthy as the weaker half.
        confidence  = case when c.confidence = 'high' then v_chapter.confidence
                           else c.confidence end,
        edited      = true,
        updated_at  = now()
    where c.id = v_other.id;

    delete from public.book_import_chapters c where c.id = v_chapter.id;

  elsif p_op = 'split' then
    v_paragraphs := regexp_split_to_array(v_chapter.source_text, E'\n{2,}');
    v_cut := coalesce((p_payload ->> 'paragraph')::int, 0);

    if v_cut < 1 or v_cut >= array_length(v_paragraphs, 1) then
      raise exception 'Nieprawidłowe miejsce podziału.' using errcode = 'FL422';
    end if;

    v_head := array_to_string(v_paragraphs[1:v_cut], E'\n\n');
    v_tail := array_to_string(
      v_paragraphs[v_cut + 1 : array_length(v_paragraphs, 1)], E'\n\n'
    );

    -- Everything after the cut shifts down by one. Deferred uniqueness is what
    -- lets this be a single statement instead of a shuffle.
    update public.book_import_chapters c
    set position = c.position + 1
    where c.import_id = p_import_id and c.position > v_chapter.position;

    update public.book_import_chapters c
    set source_text = v_head,
        word_count  = public.count_source_words(v_head),
        edited      = true,
        updated_at  = now()
    where c.id = v_chapter.id;

    insert into public.book_import_chapters (
      import_id, position, detected_title, title, source_text, word_count,
      source_page_start, source_page_end, confidence, signals,
      is_front_matter, included, edited
    )
    values (
      p_import_id,
      v_chapter.position + 1,
      null,
      null,
      v_tail,
      public.count_source_words(v_tail),
      v_chapter.source_page_start,
      v_chapter.source_page_end,
      'low',
      '["manual_split"]'::jsonb,
      v_chapter.is_front_matter,
      v_chapter.included,
      true
    );

  elsif p_op = 'move' then
    if (p_payload ->> 'direction') = 'up' then
      select * into v_other
      from public.book_import_chapters c
      where c.import_id = p_import_id and c.position < v_chapter.position
      order by c.position desc limit 1;
    else
      select * into v_other
      from public.book_import_chapters c
      where c.import_id = p_import_id and c.position > v_chapter.position
      order by c.position asc limit 1;
    end if;

    if not found then
      return;
    end if;

    update public.book_import_chapters c
    set position = v_chapter.position, edited = true, updated_at = now()
    where c.id = v_other.id;

    update public.book_import_chapters c
    set position = v_other.position, edited = true, updated_at = now()
    where c.id = v_chapter.id;

  else
    raise exception 'Nieznana operacja.' using errcode = 'FL422';
  end if;

  -- One renumber after every operation, so "positions are 1..N with no gaps" is
  -- an invariant of this function rather than of each branch. `row_number()`
  -- over the current order is idempotent: running it when nothing moved writes
  -- the same numbers back.
  perform public.renumber_book_import_chapters(p_import_id);

  update public.book_imports i
  set chapter_count = (
        select count(*) from public.book_import_chapters c where c.import_id = p_import_id
      ),
      word_count = (
        select coalesce(sum(c.word_count), 0) from public.book_import_chapters c
        where c.import_id = p_import_id and c.included
      ),
      updated_at = now()
  where i.id = p_import_id;
end;
$$;

-- Words, by the same definition the content pipeline uses: a letter followed by
-- letters, marks, apostrophes or hyphens. Kept here so a split's word count
-- agrees with the one `src/lib/content/paragraphs.ts` computes for the same text
-- — one definition of "word", two runtimes.
create or replace function public.count_source_words(p_text text)
returns int
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array_length(
      array_remove(regexp_split_to_array(coalesce(p_text, ''), '[^[:alpha:]''’-]+'), ''),
      1
    ),
    0
  );
$$;

create or replace function public.renumber_book_import_chapters(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.book_import_chapters c
  set position = ranked.next_position
  from (
    select id, row_number() over (order by position, created_at, id) as next_position
    from public.book_import_chapters
    where import_id = p_import_id
  ) ranked
  where c.id = ranked.id and c.position <> ranked.next_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. FINALIZING — the one place a private book is born.
-- ─────────────────────────────────────────────────────────────────────────────
-- ATOMIC: the library item, its chapters and the import's receipt are written in
-- one transaction, so there is no state where a book exists without its chapters
-- or an import points at a book that was never created.
--
-- IDEMPOTENT: `final_library_item_id` is checked under a row lock and returned
-- if set. A double click, a retried request and two browser tabs all produce one
-- book — and the second caller gets the first one's id, not an error, because
-- "you already did this" is not a failure from the learner's side.
--
-- CONCURRENT-SAFE: `select … for update` on the import row serialises two
-- simultaneous finalizes. The loser blocks, then sees the receipt.
--
-- PRIVATE BY CONSTRUCTION: `rights` is hardcoded to `private_import` and
-- `owner_user_id` to the caller. There is no parameter for either, so no request
-- can ask for anything else.
create or replace function public.finalize_book_import(p_import_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_import   public.book_imports%rowtype;
  v_item_id  uuid;
  v_slug     text;
  v_title    text;
  v_position int := 0;
  v_row      record;
  v_words    int := 0;
begin
  if v_user is null then
    raise exception 'Zaloguj się, aby zaimportować książkę.' using errcode = 'FL401';
  end if;

  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user
  for update;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  -- THE RECEIPT. Everything below this line runs at most once per import.
  if v_import.final_library_item_id is not null then
    return v_import.final_library_item_id;
  end if;

  if v_import.status not in ('awaiting_review', 'failed') then
    raise exception 'Import nie jest gotowy do zatwierdzenia.' using errcode = 'FL423';
  end if;

  if not exists (
    select 1 from public.book_import_chapters c
    where c.import_id = p_import_id and c.included and length(trim(c.source_text)) > 0
  ) then
    raise exception 'Nie wybrano żadnego rozdziału.' using errcode = 'FL422';
  end if;

  v_title := coalesce(
    nullif(trim(v_import.title), ''),
    nullif(trim(v_import.detected_title), ''),
    'Moja książka'
  );

  -- The slug is scoped per owner by `library_items_slug_idx`, so two learners
  -- may both import "Der Prozess" and neither collides with the public library.
  -- The suffix keeps one learner's two copies apart.
  v_slug := public.slugify(v_title) || '-' || right(replace(p_import_id::text, '-', ''), 6);

  insert into public.library_items (
    slug, title, author, language, content_type,
    rights, owner_user_id, source_type, status, published_at,
    word_count, chapter_count
  )
  values (
    v_slug,
    left(v_title, 200),
    left(nullif(trim(coalesce(v_import.author, v_import.detected_author)), ''), 200),
    coalesce(nullif(v_import.detected_language, ''), 'de'),
    'book',
    'private_import',
    v_user,
    'import_' || v_import.file_type,
    -- `processing`, not `draft`: the book appears on the owner's shelf
    -- immediately and fills in chapter by chapter. A learner who waited for an
    -- upload should not then wait for an empty library.
    'processing',
    -- Private items are never "published" in the public sense —
    -- `library_item_readable` refuses an owned item to everyone but its owner
    -- whatever the status says. The timestamp is set so the shelf, which orders
    -- by it, puts a freshly imported book where the learner expects it.
    now(),
    0,
    0
  )
  returning id into v_item_id;

  for v_row in
    select * from public.book_import_chapters c
    where c.import_id = p_import_id
      and c.included
      and length(trim(c.source_text)) > 0
    order by c.position
  loop
    v_position := v_position + 1;
    v_words := v_words + v_row.word_count;

    insert into public.chapters (
      library_item_id, position, title, source_text, status, import_id
    )
    values (
      v_item_id,
      v_position,
      coalesce(nullif(trim(v_row.title), ''), nullif(trim(v_row.detected_title), '')),
      v_row.source_text,
      'draft',
      p_import_id
    );

    update public.book_import_chapters c
    set chapter_id = (
          select ch.id from public.chapters ch
          where ch.library_item_id = v_item_id and ch.position = v_position
        ),
        updated_at = now()
    where c.id = v_row.id;
  end loop;

  update public.library_items i
  set chapter_count = v_position,
      word_count    = v_words,
      updated_at    = now()
  where i.id = v_item_id;

  update public.book_imports i
  set final_library_item_id = v_item_id,
      status                = 'processing',
      stage                 = 'process_chapters',
      total_chapters        = v_position,
      processed_chapters    = 0,
      failed_chapters       = 0,
      error_code            = null,
      error_message         = null,
      finalized_at          = now(),
      updated_at            = now()
  where i.id = p_import_id;

  return v_item_id;
end;
$$;

comment on function public.finalize_book_import(uuid) is
  'Turn a reviewed import into a private library item. Idempotent via final_library_item_id; rights and owner are hardcoded, never parameters.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PROCESSING PROGRESS IS DERIVED, NEVER ASSERTED.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same rule as `sync_daily_plan`: there is no "mark this chapter done" endpoint
-- and there must not be one. The counts are recomputed from the `chapters` rows
-- that recorded the work, which makes them idempotent (a retried batch cannot
-- double-count), unforgeable (a client cannot claim a chapter is ready) and
-- self-healing (a count that drifted is corrected on the next call).
--
-- PARTIAL READINESS IS THE POINT. The item flips to `ready` only when nothing is
-- pending, but every chapter that IS ready is readable the moment it is
-- processed — a learner can start chapter 1 while chapter 42 is still being
-- built. One failed chapter leaves the book usable and the failure visible.
create or replace function public.sync_book_import_processing(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_import  public.book_imports%rowtype;
  v_total   int;
  v_ready   int;
  v_failed  int;
  v_status  text;
begin
  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  if v_import.final_library_item_id is null then
    return jsonb_build_object('status', v_import.status, 'total', 0, 'ready', 0, 'failed', 0);
  end if;

  select count(*),
         count(*) filter (where c.status = 'ready'),
         count(*) filter (where c.status = 'failed')
    into v_total, v_ready, v_failed
  from public.chapters c
  where c.library_item_id = v_import.final_library_item_id;

  v_status := case
    when v_total = 0 then 'processing'
    when v_ready + v_failed < v_total then 'processing'
    when v_ready = 0 then 'failed'
    else 'ready'
  end;

  update public.book_imports i
  set total_chapters     = v_total,
      processed_chapters = v_ready,
      failed_chapters    = v_failed,
      status             = v_status,
      stage              = case when v_status = 'processing' then 'process_chapters' end,
      error_code         = case when v_status = 'failed' then 'processing_failed' end,
      updated_at         = now()
  where i.id = p_import_id;

  -- A book with at least one readable chapter is a readable book. The item only
  -- stays `processing` while something is still pending, so the shelf stops
  -- showing a spinner the moment the last chapter lands.
  update public.library_items li
  set status     = case when v_ready + v_failed >= v_total and v_ready > 0 then 'ready'
                        else 'processing' end,
      updated_at = now()
  where li.id = v_import.final_library_item_id;

  return jsonb_build_object(
    'status', v_status, 'total', v_total, 'ready', v_ready, 'failed', v_failed
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. CANCELLING, AND DELETING.
-- ─────────────────────────────────────────────────────────────────────────────
-- Before the book exists, cancel. After it exists, delete the book — those are
-- different operations on different objects and conflating them is how an
-- "undo" ends up orphaning rows.
--
-- Returns the storage path so the caller can remove the original object in the
-- same action; Storage is not transactional with Postgres, and pretending
-- otherwise would leave the deletion silently half-done.
create or replace function public.cancel_book_import(p_import_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_import public.book_imports%rowtype;
begin
  select * into v_import
  from public.book_imports i
  where i.id = p_import_id and i.user_id = v_user
  for update;

  if not found then
    raise exception 'Nie masz dostępu do tego importu.' using errcode = 'FL403';
  end if;

  if v_import.final_library_item_id is not null then
    raise exception 'Ten import jest już książką — usuń ją z biblioteki.'
      using errcode = 'FL409';
  end if;

  -- The proposal goes; the row stays, as history, so the import list can show
  -- "anulowane" rather than a hole.
  delete from public.book_import_chapters c where c.import_id = p_import_id;

  update public.book_imports i
  set status = 'cancelled', stage = null, chapter_count = 0, updated_at = now()
  where i.id = p_import_id;

  return v_import.storage_path;
end;
$$;

-- Deleting a private book.
--
-- A LEARNER IS NEVER LOCKED OUT OF THEIR OWN DATA. The library's DELETE policy
-- is admin-only and excludes owned items entirely, which is right for content
-- and wrong for somebody's own file — so this is the owner's door, and it opens
-- only onto items they own.
--
-- WHAT SURVIVES, AND WHY. Deleting the book cascades its chapters, structure,
-- reading progress and sessions: those are all *about this text*, and keeping
-- them would mean keeping a private book's paragraphs after its owner asked for
-- them to go. What does NOT go is aggregate knowledge — `user_word_knowledge`,
-- skill and concept state, review history, saved words. Learning German from a
-- book you later deleted is still learning German, and throwing away a month of
-- vocabulary because somebody tidied their shelf would be indefensible.
--
-- The one exception is the private TEXT those records carry: a saved word keeps
-- its scheduling and its word, and loses the sentence it was copied out of,
-- because that sentence is a fragment of a book its owner has asked Fluent to
-- forget.
create or replace function public.delete_private_library_item(p_item_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_paths text[];
begin
  if not exists (
    select 1 from public.library_items i
    where i.id = p_item_id and i.owner_user_id = v_user
  ) then
    raise exception 'Nie masz dostępu do tej książki.' using errcode = 'FL403';
  end if;

  select coalesce(array_agg(i.storage_path), '{}'::text[])
    into v_paths
  from public.book_imports i
  where i.user_id = v_user and i.final_library_item_id = p_item_id;

  -- Before the cascade nulls the reference and we lose the ability to find them.
  update public.saved_words w
  set origin_context = null,
      origin_surface = null
  where w.user_id = v_user and w.origin_library_item_id = p_item_id;

  delete from public.book_imports i
  where i.user_id = v_user and i.final_library_item_id = p_item_id;

  delete from public.library_items i
  where i.id = p_item_id and i.owner_user_id = v_user;

  return v_paths;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Narrow on purpose. A learner may create an import, edit its preview, finalize
-- it, sync its progress, cancel it and delete their own book — every one of
-- which derives the acting user from `auth.uid()`. Moving the state machine and
-- writing an analysis are server work and are service_role only: a browser that
-- could call `set_book_import_state` could declare an unread file a finished
-- book.
revoke all on function public.create_book_import(text, text, bigint, text) from public;
revoke all on function public.set_book_import_state(uuid, text, text, text, text) from public;
revoke all on function public.apply_book_import_analysis(uuid, jsonb) from public;
revoke all on function public.update_book_import_metadata(uuid, text, text) from public;
revoke all on function public.edit_book_import_chapters(uuid, text, jsonb) from public;
revoke all on function public.renumber_book_import_chapters(uuid) from public;
revoke all on function public.finalize_book_import(uuid) from public;
revoke all on function public.sync_book_import_processing(uuid) from public;
revoke all on function public.cancel_book_import(uuid) from public;
revoke all on function public.delete_private_library_item(uuid) from public;

grant execute on function public.create_book_import(text, text, bigint, text)  to authenticated;
grant execute on function public.update_book_import_metadata(uuid, text, text) to authenticated;
grant execute on function public.edit_book_import_chapters(uuid, text, jsonb)  to authenticated;
grant execute on function public.finalize_book_import(uuid)                    to authenticated;
grant execute on function public.sync_book_import_processing(uuid)             to authenticated;
grant execute on function public.cancel_book_import(uuid)                      to authenticated;
grant execute on function public.delete_private_library_item(uuid)             to authenticated;
grant execute on function public.count_source_words(text)                to anon, authenticated;

grant execute on function public.set_book_import_state(uuid, text, text, text, text) to service_role;
grant execute on function public.apply_book_import_analysis(uuid, jsonb)             to service_role;
grant execute on function public.renumber_book_import_chapters(uuid)                 to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- READ YOUR OWN, WRITE NOTHING. Both tables are readable by their owner and by
-- nobody else — not another learner, not an anonymous visitor, and deliberately
-- not an admin: a private import is somebody's own file, and the admin panel is
-- a content tool, not a reason to read it. That is the same judgement
-- `library_item_readable` already makes about the finished book.
--
-- There is no INSERT, UPDATE or DELETE policy on either table, and that is the
-- design. Every write goes through a SECURITY DEFINER function above, which
-- derives the owner from `auth.uid()` instead of believing a column — so
-- `user_id`, `storage_path`, `status` and `final_library_item_id` have no client
-- write path at all.
alter table public.book_imports          enable row level security;
alter table public.book_import_chapters  enable row level security;

drop policy if exists "own book imports read" on public.book_imports;
create policy "own book imports read" on public.book_imports
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own book import chapters read" on public.book_import_chapters;
create policy "own book import chapters read" on public.book_import_chapters
  for select using (
    exists (
      select 1 from public.book_imports i
      where i.id = book_import_chapters.import_id
        and i.user_id = (select auth.uid())
    )
  );
