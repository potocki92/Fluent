-- Fluent — Phase 4: Reader 2.0 + Story Engine foundation.
--
-- WHAT THIS REPLACES. Until now a reading passage was one row: `texts.body`, an
-- HTML string with `<mark data-lemma="…">` annotations, parsed in the browser
-- with `DOMParser` and rendered as React nodes. For a 200-word A1 passage that
-- is fine. For a book it is not a data model at all:
--
--   * there is nothing to point AT — no paragraph, no sentence, no word
--     occurrence — so a resume position, a per-sentence translation, a
--     contextual gloss or a sentence-level exercise has nowhere to attach;
--   * the whole text is one value, so opening chapter 12 of a 300 000-word book
--     means loading all 300 000 words;
--   * the markup IS the data, so changing how vocabulary is detected means
--     rewriting stored content, and the browser has to re-parse HTML on every
--     render before a single word is interactive.
--
-- Phase 4 separates CONTENT STRUCTURE from RENDERED HTML:
--
--     library_items → chapters → paragraphs → sentences → word_occurrences
--
-- Nothing about the old passages is destroyed. Every published `texts` row gets
-- a library item and a single chapter carrying `legacy_text_id`, so questions,
-- test sessions, attempts, completions and today's plan keep working against the
-- ids they already hold, while the reader reads structured content.
--
-- Idempotent and non-destructive, like every migration here: re-running it is a
-- normal event and it never drops a column or deletes a row holding progress.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. READER PREFERENCES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Reading for forty minutes is a different activity from answering eight
-- questions, and it needs its own typography. These are ORDINARY learner-owned
-- preferences — like `daily_word_goal` — so they are not listed in
-- `guard_profile_server_fields` and the learner may write them directly. Stored
-- on the profile rather than in the browser so the same book looks the same on a
-- phone and a laptop.
alter table public.profiles
  add column if not exists reader_preferences jsonb not null default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LIBRARY ITEMS — one model for everything that can be read.
-- ─────────────────────────────────────────────────────────────────────────────
-- A story, a book, an article and today's graded passages are the same kind of
-- thing to a reader: a titled piece of content made of chapters. Modelling them
-- separately would mean two readers, two progress models and two sets of
-- analytics for the same act of reading, which is exactly the duplication this
-- phase exists to avoid.
--
-- RIGHTS ARE PART OF THE MODEL, not a policy document. `rights` decides who may
-- see an item at all, and it exists before there is any import feature on
-- purpose: the moment a learner can bring their own EPUB, "can Fluent show this
-- to everyone?" becomes a question the database has to answer, and retrofitting
-- that answer onto a public-by-default table is how content leaks.
--
--   first_party    — written for Fluent. Ours to publish.
--   public_domain  — out of copyright. Ours to publish.
--   licensed       — publishable under a specific agreement; the agreement is
--                    recorded in `rights_note`, not assumed.
--   private_import — someone's own file. Readable by its owner and nobody else,
--                    ever, whatever `status` says.
create table if not exists public.library_items (
  id   uuid primary key default gen_random_uuid(),
  -- ID IS THE IDENTITY, the slug is a convenience. A title can be corrected, a
  -- slug can collide, and neither may ever break a stored reading position.
  slug text not null,

  title       text not null,
  subtitle    text,
  author      text,
  language    text not null default 'de',
  description text,
  cover_url   text,

  content_type text not null default 'story'
    check (content_type in ('story', 'book', 'article', 'lesson')),

  rights      text not null default 'first_party'
    check (rights in ('first_party', 'public_domain', 'licensed', 'private_import')),
  rights_note text,

  -- Set only for `private_import`. A CHECK below makes that an invariant rather
  -- than a convention.
  owner_user_id uuid references auth.users(id) on delete cascade,

  -- Where the text came from, for provenance. Free-form on purpose: this is
  -- documentation, not a switch anything branches on.
  source_type text,
  source_url  text,

  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'published', 'failed')),

  cefr_estimate text check (cefr_estimate in ('A1', 'A2', 'B1', 'B2')),
  word_count    int not null default 0,
  chapter_count int not null default 0,

  -- SOFT DELETE. Withdrawing a book must not destroy the reading history of
  -- everyone who read it, so nothing is deleted: an archived item disappears
  -- from the library and stays joinable from `learning_events`.
  archived_at  timestamptz,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- COMPATIBILITY WITH THE PASSAGES THAT ALREADY EXIST. Questions, attempts,
  -- completions, test sessions and today's plans all key on `texts.id`; a
  -- migration that renumbered them would be a rewrite of half the app for no
  -- learner-visible gain. The mapping lives here instead.
  legacy_text_id bigint references public.texts(id) on delete set null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'library_items_private_owner_check'
  ) then
    alter table public.library_items
      add constraint library_items_private_owner_check check (
        (rights = 'private_import' and owner_user_id is not null)
        or (rights <> 'private_import' and owner_user_id is null)
      );
  end if;
end $$;

-- A slug identifies an item within its owner's space: two learners may both
-- import "Der Prozess", and neither may collide with the public library.
create unique index if not exists library_items_slug_idx
  on public.library_items (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create unique index if not exists library_items_legacy_text_idx
  on public.library_items (legacy_text_id) where legacy_text_id is not null;

-- "What can I read?" — the library listing, in one index scan.
create index if not exists library_items_published_idx
  on public.library_items (status, published_at desc) where archived_at is null;

create index if not exists library_items_owner_idx
  on public.library_items (owner_user_id, updated_at desc) where owner_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CHAPTERS — the unit of reading, and the unit of loading.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY CHAPTERS ARE A TABLE and not an array on the item: they are what a query
-- is scoped to. "Give me chapter 12" must cost the same on a 40-chapter novel as
-- on a one-chapter story, which it cannot if the book is one row. They are also
-- what progress, sessions and plan items point at, so they need ids.
--
-- PROCESSING STATE LIVES HERE, not on the item: one unparseable chapter must not
-- take a whole book off the shelf. A chapter that failed keeps its error for an
-- admin and is skipped by the reader.
create table if not exists public.chapters (
  id              uuid primary key default gen_random_uuid(),
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  -- 1-based, and part of the URL. Unique per item — see the index below.
  position int not null,
  title    text,
  subtitle text,

  -- THE SOURCE OF TRUTH FOR REPROCESSING. Keeping the raw text means a chapter
  -- can be rebuilt with a better tokenizer without going back to wherever it
  -- originally came from. It is also why `content_hash` can be trusted: it is
  -- computed from this exact value.
  source_text text not null default '',

  word_count                int not null default 0,
  paragraph_count           int not null default 0,
  sentence_count            int not null default 0,
  estimated_reading_minutes int not null default 1,
  cefr_estimate             text check (cefr_estimate in ('A1', 'A2', 'B1', 'B2')),

  status text not null default 'draft'
    check (status in ('draft', 'processing', 'ready', 'failed')),

  -- HOW THIS CONTENT WAS BUILT. In a year the sentence splitter will behave
  -- differently, and the only way to know which chapters predate the change is
  -- to have written it down. `content_hash` + `processor_version` together are
  -- what make reprocessing a no-op when nothing would change — which is what
  -- protects every stored reading position from a pointless rebuild.
  processor_version text,
  content_hash      text,
  processed_at      timestamptz,
  processing_error  text,

  -- CONTENT QUALITY, measured rather than assumed. `dictionary_match_rate` is
  -- the share of content words Fluent can gloss; `unmatched_sample` names the
  -- ones it cannot, which is what turns a bad number into a task.
  dictionary_match_rate numeric,
  unmatched_sample      jsonb not null default '[]'::jsonb,
  vocabulary_stats      jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ORDERING IS AN INVARIANT. Two chapters at position 7 would make "next chapter"
-- ambiguous and `/library/<slug>/7` non-deterministic.
create unique index if not exists chapters_item_position_idx
  on public.chapters (library_item_id, position);

create index if not exists chapters_item_idx on public.chapters (library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. STRUCTURED CONTENT — paragraphs, sentences, occurrences.
-- ─────────────────────────────────────────────────────────────────────────────
-- PLAIN TEXT, NOT HTML. The reader renders structure; it never renders stored
-- markup. That is a security property (no sanitiser between the database and the
-- page), a portability property (the same rows can drive audio, exercises or an
-- export) and the reason a legacy `<mark>` body has to be parsed back to text on
-- the way in rather than copied across.
--
-- bigint identities rather than uuids: a 300 000-word book is ~20 000 sentences
-- and a few hundred thousand occurrences, and these are always read in position
-- order. Sequential keys keep those reads on adjacent index pages.
create table if not exists public.paragraphs (
  id         bigint generated always as identity primary key,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- 0-based within the chapter. STABLE for a given source: reading positions
  -- point at this number, so the pipeline is deterministic by requirement.
  position   int  not null,
  kind       text not null default 'paragraph'
               check (kind in ('paragraph', 'heading', 'list_item')),
  text       text not null,
  word_count int  not null default 0,
  metadata   jsonb not null default '{}'::jsonb
);

create unique index if not exists paragraphs_chapter_position_idx
  on public.paragraphs (chapter_id, position);

-- SENTENCES exist so that help can be about THIS sentence.
--
-- "Er zog sein Schwert." is where *ziehen* means "wyciągnąć" rather than
-- "ciągnąć". Without a sentence id there is nothing for a contextual
-- translation, a grammar note, an audio clip, a bookmark or a sentence-level
-- exercise to hang off, and every one of those would later require re-splitting
-- stored text and hoping the boundaries came out the same. The columns for those
-- features exist and stay NULL: Phase 4 builds the place, not the content.
create table if not exists public.sentences (
  id           bigint generated always as identity primary key,
  paragraph_id bigint not null references public.paragraphs(id) on delete cascade,
  -- Denormalised so "load this chapter" is one index scan rather than a join
  -- through paragraphs. Written by the pipeline only; nothing else may set it.
  chapter_id   uuid   not null references public.chapters(id) on delete cascade,

  position          int not null,   -- within the paragraph
  chapter_position  int not null,   -- within the chapter, for reading order
  text              text not null,
  char_start        int not null default 0,
  char_end          int not null default 0,
  word_count        int not null default 0,

  -- RESERVED, DELIBERATELY EMPTY. Generating these now would mean paying for
  -- content before the workflow that uses it exists, and generating it against a
  -- tokenizer that may still change.
  translation_pl  text,
  simplified_de   text,
  grammar_notes   jsonb,

  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists sentences_paragraph_position_idx
  on public.sentences (paragraph_id, position);

create index if not exists sentences_chapter_order_idx
  on public.sentences (chapter_id, chapter_position);

-- WORD OCCURRENCES — "this word, in this sentence, here".
--
-- `<mark data-lemma="Schwert">` was a rendering instruction. This is the datum
-- behind it: a specific token, at a specific position, resolved to a specific
-- dictionary entry. That is what lets a lookup be recorded against a place in a
-- book rather than against a string, and what a future lexeme → sense → occurrence
-- layer attaches to without any of this changing shape.
--
-- ONLY MATCHED TOKENS GET A ROW. An occurrence exists to be interacted with, and
-- a token Fluent cannot gloss has nothing to show. Unmatched content words are
-- counted and sampled on the chapter instead (`unmatched_sample`), which is what
-- makes the dictionary gap visible without storing a row per "the".
create table if not exists public.word_occurrences (
  id          bigint generated always as identity primary key,
  sentence_id bigint not null references public.sentences(id) on delete cascade,
  chapter_id  uuid   not null references public.chapters(id) on delete cascade,

  -- Index among the sentence's LEXICAL tokens, so it survives punctuation edits.
  position   int  not null,
  surface    text not null,   -- exactly as written: "zog", "Bücher"
  normalized text not null,   -- lowercased, apostrophes folded
  lemma      text not null,   -- the dictionary headword it resolved to
  word_id    bigint references public.words(id) on delete set null,
  char_start int not null default 0,
  char_end   int not null default 0,

  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists word_occurrences_sentence_position_idx
  on public.word_occurrences (sentence_id, position);

create index if not exists word_occurrences_chapter_word_idx
  on public.word_occurrences (chapter_id, word_id);

-- THE CHAPTER'S VOCABULARY, aggregated once at processing time.
--
-- Everything worth knowing before opening a chapter — how much of its vocabulary
-- a learner already knows, which five words are worth learning first — is a join
-- between this and `user_word_knowledge`. Deriving it from `word_occurrences` on
-- every render would mean scanning a few hundred thousand rows to draw one
-- progress ring.
create table if not exists public.chapter_vocabulary (
  chapter_id              uuid   not null references public.chapters(id) on delete cascade,
  word_id                 bigint not null references public.words(id) on delete cascade,
  occurrence_count        int    not null default 1,
  first_paragraph_position int   not null default 0,
  first_sentence_position  int   not null default 0,
  primary key (chapter_id, word_id)
);

create index if not exists chapter_vocabulary_word_idx
  on public.chapter_vocabulary (word_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. READING PROGRESS — resume vs furthest.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONE DESIGN DECISION THAT MATTERS HERE. A learner who scrolls back to
-- re-read the opening of a chapter is AT paragraph 3 and has READ up to
-- paragraph 80. One number cannot be both. Stored as one, either the bookmark is
-- wrong or the progress bar collapses from 80% to 4% because someone checked
-- something — and a progress bar that goes backwards is a progress bar nobody
-- believes again.
--
--   resume_*   follows the learner, moves in both directions
--   furthest_* only ever increases, and is the ONLY input to progress and
--              completion (`greatest(...)` below, not an application `if`)
--
-- POSITIONS, NOT FOREIGN KEYS. Reprocessing a chapter replaces its paragraph
-- rows; a resume pointer that was a paragraph id would dangle or be nulled on
-- every reprocess. The pipeline is deterministic, so position 43 is position 43
-- before and after — a stable bookmark, for free.
create table if not exists public.reading_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- Denormalised so "which book am I reading?" does not need a join per chapter.
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  started_at   timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  completed_at timestamptz,

  resume_paragraph_position int not null default 0,
  resume_sentence_position  int,

  furthest_paragraph_position int not null default 0,
  progress_ratio numeric not null default 0 check (progress_ratio between 0 and 1),

  -- Reading behaviour, accumulated across every session on this chapter. These
  -- are what a lookup RATE is computed from later — "one word in 9" in chapter
  -- one and "one in 31" in chapter twenty is the reader's headline metric, and
  -- it needs both halves.
  active_seconds int not null default 0,
  lookup_count   int not null default 0,
  session_count  int not null default 0,

  primary key (user_id, chapter_id)
);

create index if not exists reading_progress_user_recent_idx
  on public.reading_progress (user_id, last_read_at desc);

create index if not exists reading_progress_user_item_idx
  on public.reading_progress (user_id, library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. READING SESSIONS — one sitting with a chapter.
-- ─────────────────────────────────────────────────────────────────────────────
-- ACTIVE TIME, NOT WALL TIME. A tab left open for two hours is not two hours of
-- reading, and recording it as such would poison every metric built on top of it
-- — reading speed, lookup rate, the chapter summary, and eventually a
-- personalised time estimate. The reader accumulates seconds only while the
-- document is visible and something happened recently, reports increments, and
-- this table caps what one report may add. The result is not laboratory-accurate
-- and is not fiction either.
create table if not exists public.reading_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  started_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at       timestamptz,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'ended')),

  active_seconds  int not null default 0,
  words_progressed int not null default 0,
  progress_before numeric not null default 0,
  progress_after  numeric not null default 0,

  lookup_count        int not null default 0,
  unique_lookup_count int not null default 0,
  sentence_help_count int not null default 0,
  saved_word_count    int not null default 0
);

create index if not exists reading_sessions_user_chapter_idx
  on public.reading_sessions (user_id, chapter_id, started_at desc);

create index if not exists reading_sessions_user_recent_idx
  on public.reading_sessions (user_id, started_at desc);

-- ONE ACTIVE SESSION PER CHAPTER. Two tabs on the same chapter must share a
-- session or the summary counts everything twice.
create unique index if not exists reading_sessions_one_active_idx
  on public.reading_sessions (user_id, chapter_id) where status = 'in_progress';

-- WHICH WORD, IN WHICH SENTENCE, IN WHICH CHAPTER, WHEN.
--
-- `learning_events` already records that a lookup happened and what it is worth
-- to the knowledge model. This table is the reading-behaviour half: it is what
-- "you looked *Schwert* up five times, in five different chapters" is computed
-- from, and what a future "words you keep checking" view reads. Deliberately not
-- shown to a learner yet — the data has to exist before the feature can be
-- honest about it.
create table if not exists public.reading_lookups (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  session_id      uuid references public.reading_sessions(id) on delete set null,

  -- Nulled rather than cascaded when a chapter is reprocessed: the fact that the
  -- word was looked up here survives, the exact token does not have to.
  sentence_id   bigint references public.sentences(id) on delete set null,
  occurrence_id bigint references public.word_occurrences(id) on delete set null,
  word_id       bigint not null references public.words(id) on delete cascade,

  -- IDEMPOTENCY. Minted per tap, so a retried Server Action settles the same
  -- lookup instead of counting the word as unknown twice. The unique constraint
  -- is what makes that a guarantee rather than a debounce.
  interaction_id text not null,
  looked_up_at   timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reading_lookups_interaction_unique'
  ) then
    alter table public.reading_lookups
      add constraint reading_lookups_interaction_unique unique (user_id, interaction_id);
  end if;
end $$;

create index if not exists reading_lookups_user_word_idx
  on public.reading_lookups (user_id, word_id, looked_up_at desc);

create index if not exists reading_lookups_session_idx
  on public.reading_lookups (session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. THE EVIDENCE LOG LEARNS ABOUT READING.
-- ─────────────────────────────────────────────────────────────────────────────
-- `learning_events` was built for this: "when books arrive, a paragraph lookup
-- is source_kind = 'book' plus a new nullable id column; nothing about this
-- table has to be rebuilt." These are those columns.
--
-- ON DELETE SET NULL, not cascade. Deleting a private import must remove the
-- CONTENT, not the learner's history of having learned from it — the evidence
-- that they looked a word up stays, detached from the book that is gone.
alter table public.learning_events
  add column if not exists library_item_id uuid references public.library_items(id) on delete set null;
alter table public.learning_events
  add column if not exists chapter_id uuid references public.chapters(id) on delete set null;
alter table public.learning_events
  add column if not exists sentence_id bigint references public.sentences(id) on delete set null;
alter table public.learning_events
  add column if not exists word_occurrence_id bigint references public.word_occurrences(id) on delete set null;
alter table public.learning_events
  add column if not exists reading_session_id uuid references public.reading_sessions(id) on delete set null;

do $$
begin
  alter table public.learning_events drop constraint if exists learning_events_event_type_check;
  alter table public.learning_events
    add constraint learning_events_event_type_check check (event_type in (
      'test_answer', 'calibration_answer', 'review', 'practice_answer',
      -- produced by the reader
      'reading_lookup', 'reading_chapter_started', 'reading_chapter_completed',
      -- accepted by the model, produced by nothing yet
      'reading_sentence_help', 'reading_resume', 'typed_recall',
      'listening_answer', 'speaking_answer', 'writing_answer'
    ));
end $$;

create index if not exists learning_events_user_chapter_idx
  on public.learning_events (user_id, chapter_id, occurred_at desc)
  where chapter_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. A SAVED WORD REMEMBERS WHERE IT CAME FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- Saving *Schwert* while reading "Er zog sein Schwert." and reviewing it three
-- days later as a bare headword throws away the most valuable thing about it.
-- The sentence is the reason the word means anything.
--
-- `origin_context` STORES THE SENTENCE TEXT, not only a reference to it. A
-- reference would break the moment a private book is deleted or a chapter is
-- reprocessed — and a flashcard losing its context because someone tidied their
-- library is exactly the kind of quiet data loss that makes a feature untrusted.
alter table public.saved_words
  add column if not exists origin_library_item_id uuid references public.library_items(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_chapter_id uuid references public.chapters(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_sentence_id bigint references public.sentences(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_occurrence_id bigint references public.word_occurrences(id) on delete set null;
alter table public.saved_words
  add column if not exists origin_context text;
alter table public.saved_words
  add column if not exists origin_surface text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. THE PLANNER LEARNS ABOUT CHAPTERS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 was built so that this would be additive: "adding a source later
-- (book chapters, say) means writing one generator, not reopening the ranking."
-- What the TABLE needs is somewhere to point and something to measure against.
alter table public.daily_plan_items
  add column if not exists library_item_id uuid references public.library_items(id) on delete set null;
alter table public.daily_plan_items
  add column if not exists chapter_id uuid references public.chapters(id) on delete set null;

-- HOW MUCH READING COUNTS AS HAVING DONE IT.
--
-- "Czytaj przez około 8 minut" is satisfied by eight minutes of reading, not by
-- finishing a chapter that happens to be three times that long — and equally,
-- opening a chapter is not doing it. The planner computes this number from
-- `src/lib/reading/constants.ts` and writes it here; the database only compares
-- against it, so the rule stays in one place and stays unit-tested.
alter table public.daily_plan_items
  add column if not exists target_seconds int;

do $$
begin
  alter table public.daily_plan_items drop constraint if exists daily_plan_items_item_type_check;
  alter table public.daily_plan_items
    add constraint daily_plan_items_item_type_check check (item_type in (
      'placement', 'review_due', 'weakness_practice',
      'continue_text', 'new_text', 'new_vocabulary',
      -- Reading real content: resuming a chapter already begun, or the next one
      -- of something already being read.
      'continue_chapter', 'new_chapter'
    ));
end $$;

create index if not exists daily_plan_items_chapter_idx
  on public.daily_plan_items (chapter_id) where chapter_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. WHO MAY READ WHAT.
-- ─────────────────────────────────────────────────────────────────────────────
-- One predicate, used by every content table, so "can this learner see this?"
-- has exactly one answer and cannot drift between chapters and sentences.
--
-- PRIVATE IMPORT IS ABSOLUTE. An item with an owner is readable by that owner
-- and by nobody else — not by another learner, not by an anonymous visitor, and
-- deliberately NOT by an admin either: a learner's own book is their document,
-- and an admin panel is not a reason to read it.
create or replace function public.library_item_readable(
  p_status    text,
  p_archived  timestamptz,
  p_owner     uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_owner is not null then p_owner = (select auth.uid())
    when p_archived is not null then public.is_admin()
    when p_status = 'published' then true
    else public.is_admin()
  end;
$$;

comment on function public.library_item_readable(text, timestamptz, uuid) is
  'Single definition of library visibility: private imports are owner-only, published first-party/public-domain/licensed content is public-read, everything else is admin-only.';

-- Who may CHANGE content. Admins — and never a private import, whoever they are.
--
-- The two predicates are separate on purpose: `library_item_readable` decides
-- visibility, this one decides authorship, and a private book is outside both
-- for an admin. An admin panel is a content tool, not a reason to open somebody's
-- personal library.
create or replace function public.library_item_writable(p_owner uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_owner is null and public.is_admin();
$$;

-- The same judgement, addressed by id, for the tables that only hold a
-- reference. `security definer` so the lookup is not itself filtered by the
-- policy it is being used to evaluate.
create or replace function public.item_is_writable(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_items i
    where i.id = p_item_id and i.owner_user_id is null
  ) and public.is_admin();
$$;

create or replace function public.chapter_is_writable(p_chapter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chapters c
    join public.library_items i on i.id = c.library_item_id
    where c.id = p_chapter_id and i.owner_user_id is null
  ) and public.is_admin();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. THE CONTENT PIPELINE'S ONLY WRITE PATH.
-- ─────────────────────────────────────────────────────────────────────────────
-- The linguistics live in TypeScript (`src/lib/content/`), where they are pure
-- and unit-tested; this function owns the TRANSACTION. Same contract as
-- `finalize_test_session` and `apply_review`: the database does not re-implement
-- the arithmetic, and the application does not attempt atomicity.
--
-- REPROCESSING IS SAFE. Paragraphs are replaced wholesale (sentences and
-- occurrences cascade), which is the only way to guarantee no duplicates — an
-- upsert on "position" would leave orphans behind whenever a chapter got
-- shorter. Reading positions survive because they are POSITIONS, not ids, and
-- the pipeline is deterministic.
--
-- service_role only: it accepts computed structure, so a browser must never
-- reach it.
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

-- A chapter that could not be processed keeps its error for an admin instead of
-- taking the whole book off the shelf. service_role only, like the success path.
create or replace function public.fail_chapter_processing(
  p_chapter_id uuid,
  p_error      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chapters c
     set status           = 'failed',
         processing_error = left(coalesce(p_error, 'Nieznany błąd przetwarzania.'), 2000),
         updated_at       = now()
   where c.id = p_chapter_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. READING — the learner-facing write paths.
-- ─────────────────────────────────────────────────────────────────────────────
-- Reading progress is PROGRESS, and progress in Fluent is server-owned: the
-- tables below have no insert or update policy at all, and every write goes
-- through one of these functions, each of which derives the learner from
-- `auth.uid()` rather than trusting a parameter.

-- Open (or re-open) a chapter, and say where to resume.
--
-- One call does three things that must not be able to disagree: it establishes
-- that this learner may read this chapter, it records that they opened it, and
-- it returns the position to scroll to. Two tabs on the same chapter share one
-- session — otherwise the chapter summary counts everything twice.
create or replace function public.start_reading_session(p_chapter_id uuid)
returns table (
  session_id          uuid,
  library_item_id     uuid,
  resume_paragraph    int,
  resume_sentence     int,
  furthest_paragraph  int,
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
  v_progress  public.reading_progress%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id, c.status into v_item, v_status
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
    v_progress.furthest_paragraph_position,
    v_progress.progress_ratio,
    v_progress.completed_at,
    v_existing;
end;
$$;

-- Record where the learner is, and how long they have actually been reading.
--
-- RESUME MOVES BOTH WAYS, FURTHEST ONLY FORWARD. That is the whole point of the
-- two columns, and `greatest(...)` is where the rule is enforced — not in the
-- application, which cannot stop a second tab reporting paragraph 2 while the
-- first is at 80.
--
-- `p_max_active_seconds` is the cap from `src/lib/reading/constants.ts`. It is a
-- PARAMETER rather than a literal so the constant stays in one place, and it is
-- applied here rather than trusted from the client so that a slept machine, a
-- paused debugger or a forged request cannot claim an hour of reading.
create or replace function public.record_reading_progress(
  p_session_id          uuid,
  p_paragraph_position  int,
  p_sentence_position   int,
  p_active_seconds      int,
  p_max_active_seconds  int
)
returns table (
  progress_ratio     numeric,
  furthest_paragraph int,
  active_seconds     int,
  words_read         int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_session    public.reading_sessions%rowtype;
  v_paragraphs int;
  v_words      int;
  v_reported   int;
  v_seconds    int;
  v_ratio      numeric;
  v_furthest   int;
  v_total      int;
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

  select greatest(c.paragraph_count, 1), c.word_count
    into v_paragraphs, v_words
  from public.chapters c where c.id = v_session.chapter_id;

  v_reported := least(greatest(coalesce(p_paragraph_position, 0), 0), v_paragraphs - 1);
  v_seconds  := least(
    greatest(coalesce(p_active_seconds, 0), 0),
    greatest(coalesce(p_max_active_seconds, 0), 0)
  );

  update public.reading_progress p
     set resume_paragraph_position   = v_reported,
         resume_sentence_position    = p_sentence_position,
         furthest_paragraph_position = greatest(p.furthest_paragraph_position, v_reported),
         -- The learner has read THROUGH the furthest paragraph they reached, so
         -- the last one puts the ratio at exactly 1.
         progress_ratio              = greatest(
           p.progress_ratio,
           round((greatest(p.furthest_paragraph_position, v_reported) + 1)::numeric / v_paragraphs, 4)
         ),
         active_seconds              = p.active_seconds + v_seconds,
         last_read_at                = now()
   where p.user_id = v_user and p.chapter_id = v_session.chapter_id
   returning p.progress_ratio, p.furthest_paragraph_position, p.active_seconds
        into v_ratio, v_furthest, v_total;

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
    v_total,
    round(v_ratio * coalesce(v_words, 0))::int;
end;
$$;

-- Finish a chapter.
--
-- COMPLETION IS AN ACT, NOT A SIDE EFFECT. A last paragraph that renders one
-- pixel into the viewport because of a sticky footer is not a chapter that was
-- read, so this refuses unless the learner's FURTHEST position actually reached
-- `p_min_ratio` (the threshold from `src/lib/reading/constants.ts`). The UI then
-- still asks them to press the button.
--
-- Idempotent: finishing twice returns the same summary and writes nothing the
-- second time, so a double tap or a replayed action cannot inflate anything.
create or replace function public.complete_reading_chapter(
  p_session_id uuid,
  p_min_ratio  numeric
)
returns table (
  already_completed   boolean,
  words_read          int,
  active_seconds      int,
  lookup_count        int,
  unique_lookup_count int,
  saved_word_count    int,
  chapter_id          uuid,
  library_item_id     uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_session  public.reading_sessions%rowtype;
  v_progress public.reading_progress%rowtype;
  v_words    int;
  v_done     boolean := false;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_session from public.reading_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja czytania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  select * into v_progress
  from public.reading_progress p
  where p.user_id = v_user and p.chapter_id = v_session.chapter_id
  for update;

  if not found then
    raise exception 'Brak postępu czytania dla tego rozdziału.' using errcode = 'FL404';
  end if;

  v_done := v_progress.completed_at is not null;

  if not v_done and v_progress.progress_ratio < coalesce(p_min_ratio, 1) then
    raise exception 'Rozdział nie został jeszcze przeczytany do końca.' using errcode = 'FL412';
  end if;

  select c.word_count into v_words from public.chapters c where c.id = v_session.chapter_id;

  if not v_done then
    update public.reading_progress p
       set completed_at   = now(),
           progress_ratio = 1,
           last_read_at   = now()
     where p.user_id = v_user and p.chapter_id = v_session.chapter_id;
  end if;

  update public.reading_sessions s
     set status         = 'ended',
         ended_at       = coalesce(s.ended_at, now()),
         progress_after = 1,
         words_progressed = greatest(
           s.words_progressed,
           round(greatest(1 - s.progress_before, 0) * coalesce(v_words, 0))::int
         )
   where s.id = p_session_id;

  select * into v_session from public.reading_sessions s where s.id = p_session_id;

  return query select
    v_done,
    coalesce(v_words, 0),
    v_session.active_seconds,
    v_session.lookup_count,
    v_session.unique_lookup_count,
    v_session.saved_word_count,
    v_session.chapter_id,
    v_session.library_item_id;
end;
$$;

-- Seal a session without finishing the chapter — the learner simply stopped.
create or replace function public.end_reading_session(
  p_session_id         uuid,
  p_active_seconds     int,
  p_max_active_seconds int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_seconds int;
  v_chapter uuid;
begin
  if v_user is null then
    return;
  end if;

  v_seconds := least(
    greatest(coalesce(p_active_seconds, 0), 0),
    greatest(coalesce(p_max_active_seconds, 0), 0)
  );

  -- Only an session that was still open may add time. Without the guard a
  -- replayed "I am leaving" request would keep topping up the total, which is
  -- precisely the kind of quiet inflation that makes a reading-time metric
  -- worthless.
  update public.reading_sessions s
     set status         = 'ended',
         ended_at       = coalesce(s.ended_at, now()),
         last_active_at = now(),
         active_seconds = s.active_seconds + v_seconds
   where s.id = p_session_id and s.user_id = v_user and s.status = 'in_progress'
   returning s.chapter_id into v_chapter;

  if v_chapter is null then
    return;
  end if;

  update public.reading_progress p
     set active_seconds = p.active_seconds + v_seconds,
         last_read_at   = now()
   where p.user_id = v_user and p.chapter_id = v_chapter;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. A WORD LOOKED UP WHILE READING.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two things happen and they must happen together: the reading behaviour is
-- recorded (`reading_lookups`, the session counters) and the learning evidence
-- is applied (`apply_learning_evidence`). Splitting them would let a retry write
-- one without the other, and the whole point of the reader is that what happens
-- while reading reaches the knowledge model.
--
-- IDEMPOTENCY IS THE INTERESTING PART. `interaction_id` is minted per tap. The
-- unique constraint decides whether this is a new lookup; evidence is applied
-- ONLY on a genuinely new row. Without that guard a retried request would count
-- the same word as unknown twice — and since a lookup is negative evidence, a
-- flaky connection would slowly convince Fluent the learner knows less than they
-- do.
--
-- service_role only: it takes a user id.
create or replace function public.apply_reading_lookup(
  p_user_id        uuid,
  p_interaction_id text,
  p_chapter_id     uuid,
  p_word_id        bigint,
  p_sentence_id    bigint,
  p_occurrence_id  bigint,
  p_session_id     uuid,
  p_evidence       jsonb
)
returns table (
  already_recorded    boolean,
  lookup_count        int,
  unique_lookup_count int,
  word_lookup_total   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     uuid;
  v_lookup   bigint;
  v_first    boolean := false;
  v_session  public.reading_sessions%rowtype;
  v_total    int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id into v_item from public.chapters c where c.id = p_chapter_id;
  if v_item is null then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  -- Was this word already looked up in THIS session? Decided before the insert,
  -- so "unique words looked up" stays a count of words rather than of taps.
  if p_session_id is not null then
    v_first := not exists (
      select 1 from public.reading_lookups l
      where l.session_id = p_session_id and l.word_id = p_word_id
    );
  end if;

  insert into public.reading_lookups (
    user_id, chapter_id, library_item_id, session_id,
    sentence_id, occurrence_id, word_id, interaction_id
  ) values (
    p_user_id, p_chapter_id, v_item, p_session_id,
    p_sentence_id, p_occurrence_id, p_word_id, p_interaction_id
  )
  on conflict (user_id, interaction_id) do nothing
  returning id into v_lookup;

  select count(*)::int into v_total
  from public.reading_lookups l
  where l.user_id = p_user_id and l.word_id = p_word_id;

  if v_lookup is null then
    -- A replay. Report the stored state and change nothing.
    if p_session_id is not null then
      select * into v_session from public.reading_sessions s where s.id = p_session_id;
    end if;
    return query select
      true,
      coalesce(v_session.lookup_count, 0),
      coalesce(v_session.unique_lookup_count, 0),
      v_total;
    return;
  end if;

  if p_session_id is not null then
    update public.reading_sessions s
       set lookup_count        = s.lookup_count + 1,
           unique_lookup_count = s.unique_lookup_count + (case when v_first then 1 else 0 end),
           last_active_at      = now()
     where s.id = p_session_id
     returning * into v_session;
  end if;

  update public.reading_progress p
     set lookup_count = p.lookup_count + 1
   where p.user_id = p_user_id and p.chapter_id = p_chapter_id;

  perform public.apply_learning_evidence(p_user_id, p_evidence);

  return query select
    false,
    coalesce(v_session.lookup_count, 0),
    coalesce(v_session.unique_lookup_count, 0),
    v_total;
end;
$$;

-- Record a chapter being opened or finished as HISTORY.
--
-- These events carry no skill, no concept and no word, so the knowledge model
-- moves nothing when it folds them — having read a chapter is not evidence that
-- its language was understood, and a reader that quietly credited comprehension
-- for scrolling would be inventing exactly the knowledge Fluent refuses to
-- claim. What they buy is the reading history: when a chapter was started, when
-- it was finished, and how the lookup rate changed between chapter one and
-- chapter twenty. service_role only, like every other evidence path.
create or replace function public.apply_reading_event(
  p_user_id  uuid,
  p_evidence jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.apply_learning_evidence(p_user_id, p_evidence);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. SAVING A WORD, WITH THE SENTENCE IT CAME FROM.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE CONTEXT IS THE POINT. A learner who saved *Schwert* while reading
-- "Er zog sein Schwert." and later reviews a bare headword has lost the reason
-- the word meant anything. The sentence text is COPIED onto the card rather than
-- referenced, so deleting a private book or reprocessing a chapter cannot
-- silently empty it.
--
-- The origin is derived from the occurrence, not accepted from the caller, so a
-- card cannot claim to come from a sentence it never appeared in — and the
-- occurrence has to belong to content this learner may actually read.
--
-- Only a NEW card gets an origin. Re-saving a word already in the deck keeps the
-- first place it was met, which is the one worth remembering.
create or replace function public.save_word_from_reader(
  p_word_id       bigint,
  p_occurrence_id bigint
)
returns table (
  saved      boolean,
  was_new    boolean,
  context_de text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_sentence  bigint;
  v_chapter   uuid;
  v_item      uuid;
  v_context   text;
  v_surface   text;
  v_word      bigint;
  v_inserted  bigint;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  if p_occurrence_id is not null then
    select o.sentence_id, o.chapter_id, c.library_item_id, s.text, o.surface, o.word_id
      into v_sentence, v_chapter, v_item, v_context, v_surface, v_word
    from public.word_occurrences o
    join public.sentences s      on s.id = o.sentence_id
    join public.chapters c       on c.id = o.chapter_id
    join public.library_items i  on i.id = c.library_item_id
    where o.id = p_occurrence_id
      and public.library_item_readable(i.status, i.archived_at, i.owner_user_id);

    if v_sentence is null then
      raise exception 'Nie znaleźliśmy tego słowa w tekście.' using errcode = 'FL404';
    end if;
    if v_word is distinct from p_word_id then
      raise exception 'To słowo nie pasuje do wskazanego miejsca w tekście.' using errcode = 'FL422';
    end if;
  end if;

  insert into public.saved_words (
    user_id, word_id,
    origin_library_item_id, origin_chapter_id, origin_sentence_id,
    origin_occurrence_id, origin_context, origin_surface
  ) values (
    v_user, p_word_id, v_item, v_chapter, v_sentence, p_occurrence_id, v_context, v_surface
  )
  on conflict (user_id, word_id) do nothing
  returning word_id into v_inserted;

  if v_inserted is not null and p_occurrence_id is not null then
    update public.reading_sessions s
       set saved_word_count = s.saved_word_count + 1
     where s.user_id = v_user and s.chapter_id = v_chapter and s.status = 'in_progress';
  end if;

  return query select true, v_inserted is not null, v_context;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. apply_learning_evidence LEARNS THE READER'S COLUMNS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Only the event INSERT changes: five more nullable references, so a lookup can
-- say which book, chapter, sentence and occurrence it happened at. The skill,
-- concept and word-knowledge folding below is byte-for-byte the Phase 2
-- function — it is repeated here because `create or replace function` replaces
-- the whole body, not because anything about it moved.
create or replace function public.apply_learning_evidence(
  p_user_id         uuid,
  p_payload         jsonb,
  p_review_event_id bigint default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event    jsonb;
  v_state    jsonb;
  v_channel  jsonb;
  v_event_id bigint;
  v_written  int := 0;
  v_rows     int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika dla dowodu nauki.' using errcode = 'FL401';
  end if;
  if p_payload is null then
    return 0;
  end if;

  for v_event in
    select value from jsonb_array_elements(coalesce(p_payload -> 'events', '[]'::jsonb))
  loop
    v_event_id := null;

    insert into public.learning_events (
      user_id, event_key, event_type, occurred_at, skill_code,
      response_mode, retrieval_type, is_correct, response_ms, hints_used,
      source_kind, origin, text_id, question_id, calibration_question_id,
      word_id, test_session_id, calibration_session_id, review_event_id,
      library_item_id, chapter_id, sentence_id, word_occurrence_id,
      reading_session_id, metadata
    ) values (
      p_user_id,
      v_event ->> 'event_key',
      v_event ->> 'event_type',
      coalesce((v_event ->> 'occurred_at')::timestamptz, now()),
      v_event ->> 'skill_code',
      v_event ->> 'response_mode',
      v_event ->> 'retrieval_type',
      (v_event ->> 'is_correct')::boolean,
      (v_event ->> 'response_ms')::int,
      coalesce((v_event ->> 'hints_used')::int, 0),
      v_event ->> 'source_kind',
      coalesce(v_event ->> 'origin', 'native'),
      (v_event ->> 'text_id')::bigint,
      (v_event ->> 'question_id')::bigint,
      (v_event ->> 'calibration_question_id')::bigint,
      (v_event ->> 'word_id')::bigint,
      (v_event ->> 'test_session_id')::uuid,
      (v_event ->> 'calibration_session_id')::uuid,
      coalesce((v_event ->> 'review_event_id')::bigint, p_review_event_id),
      (v_event ->> 'library_item_id')::uuid,
      (v_event ->> 'chapter_id')::uuid,
      (v_event ->> 'sentence_id')::bigint,
      (v_event ->> 'word_occurrence_id')::bigint,
      (v_event ->> 'reading_session_id')::uuid,
      coalesce(v_event -> 'metadata', '{}'::jsonb)
    )
    on conflict (user_id, event_key) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      v_written := v_written + 1;
      insert into public.learning_event_concepts (event_id, concept_code)
      select v_event_id, code
      from jsonb_array_elements_text(coalesce(v_event -> 'concepts', '[]'::jsonb)) as t(code)
      on conflict do nothing;
    end if;
  end loop;

  for v_state in
    select value from jsonb_array_elements(coalesce(p_payload -> 'skills', '[]'::jsonb))
  loop
    insert into public.user_skill_state as s (
      user_id, skill_code, score, confidence, evidence_weight, success_weight,
      evidence_count, successful_evidence, failed_evidence, source_kinds,
      first_evidence_at, last_evidence_at, model_version, version, updated_at
    ) values (
      p_user_id,
      v_state ->> 'skill_code',
      (v_state ->> 'score')::numeric,
      (v_state ->> 'confidence')::numeric,
      (v_state ->> 'evidence_weight')::numeric,
      (v_state ->> 'success_weight')::numeric,
      (v_state ->> 'evidence_count')::int,
      (v_state ->> 'successful_evidence')::int,
      (v_state ->> 'failed_evidence')::int,
      coalesce(
        array(select jsonb_array_elements_text(v_state -> 'source_kinds')),
        array[]::text[]
      ),
      (v_state ->> 'first_evidence_at')::timestamptz,
      (v_state ->> 'last_evidence_at')::timestamptz,
      coalesce(v_state ->> 'model_version', 'knowledge_v1'),
      coalesce((v_state ->> 'expected_version')::int, 0) + 1,
      now()
    )
    on conflict (user_id, skill_code) do update
      set score               = excluded.score,
          confidence          = excluded.confidence,
          evidence_weight     = excluded.evidence_weight,
          success_weight      = excluded.success_weight,
          evidence_count      = excluded.evidence_count,
          successful_evidence = excluded.successful_evidence,
          failed_evidence     = excluded.failed_evidence,
          source_kinds        = excluded.source_kinds,
          first_evidence_at   = coalesce(s.first_evidence_at, excluded.first_evidence_at),
          last_evidence_at    = excluded.last_evidence_at,
          model_version       = excluded.model_version,
          version             = excluded.version,
          updated_at          = excluded.updated_at
      where s.version = coalesce((v_state ->> 'expected_version')::int, 0);

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Stan umiejętności zmienił się w trakcie zapisu.' using errcode = 'FL423';
    end if;
  end loop;

  for v_state in
    select value from jsonb_array_elements(coalesce(p_payload -> 'concepts', '[]'::jsonb))
  loop
    insert into public.user_concept_state as c (
      user_id, concept_code, score, confidence, evidence_weight, success_weight,
      evidence_count, successful_evidence, failed_evidence, source_kinds,
      first_evidence_at, last_evidence_at, last_success_at, last_failure_at,
      model_version, version, updated_at
    ) values (
      p_user_id,
      v_state ->> 'concept_code',
      (v_state ->> 'score')::numeric,
      (v_state ->> 'confidence')::numeric,
      (v_state ->> 'evidence_weight')::numeric,
      (v_state ->> 'success_weight')::numeric,
      (v_state ->> 'evidence_count')::int,
      (v_state ->> 'successful_evidence')::int,
      (v_state ->> 'failed_evidence')::int,
      coalesce(
        array(select jsonb_array_elements_text(v_state -> 'source_kinds')),
        array[]::text[]
      ),
      (v_state ->> 'first_evidence_at')::timestamptz,
      (v_state ->> 'last_evidence_at')::timestamptz,
      (v_state ->> 'last_success_at')::timestamptz,
      (v_state ->> 'last_failure_at')::timestamptz,
      coalesce(v_state ->> 'model_version', 'knowledge_v1'),
      coalesce((v_state ->> 'expected_version')::int, 0) + 1,
      now()
    )
    on conflict (user_id, concept_code) do update
      set score               = excluded.score,
          confidence          = excluded.confidence,
          evidence_weight     = excluded.evidence_weight,
          success_weight      = excluded.success_weight,
          evidence_count      = excluded.evidence_count,
          successful_evidence = excluded.successful_evidence,
          failed_evidence     = excluded.failed_evidence,
          source_kinds        = excluded.source_kinds,
          first_evidence_at   = coalesce(c.first_evidence_at, excluded.first_evidence_at),
          last_evidence_at    = excluded.last_evidence_at,
          last_success_at     = coalesce(excluded.last_success_at, c.last_success_at),
          last_failure_at     = coalesce(excluded.last_failure_at, c.last_failure_at),
          model_version       = excluded.model_version,
          version             = excluded.version,
          updated_at          = excluded.updated_at
      where c.version = coalesce((v_state ->> 'expected_version')::int, 0);

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Stan zagadnienia zmienił się w trakcie zapisu.' using errcode = 'FL423';
    end if;
  end loop;

  for v_state in
    select value from jsonb_array_elements(coalesce(p_payload -> 'words', '[]'::jsonb))
  loop
    v_channel := coalesce(v_state -> 'receptive', '{}'::jsonb);

    insert into public.user_word_knowledge as w (
      user_id, word_id, first_seen_at, last_seen_at, last_success_at, last_failure_at,
      exposure_count, successful_retrievals, failed_retrievals,
      receptive_score, receptive_confidence, receptive_evidence_weight,
      receptive_success_weight, receptive_evidence_count, receptive_last_at,
      active_score, active_confidence, active_evidence_weight,
      active_success_weight, active_evidence_count, active_last_at,
      source_kinds, model_version, version, updated_at
    ) values (
      p_user_id,
      (v_state ->> 'word_id')::bigint,
      (v_state ->> 'first_seen_at')::timestamptz,
      (v_state ->> 'last_seen_at')::timestamptz,
      (v_state ->> 'last_success_at')::timestamptz,
      (v_state ->> 'last_failure_at')::timestamptz,
      (v_state ->> 'exposure_count')::int,
      (v_state ->> 'successful_retrievals')::int,
      (v_state ->> 'failed_retrievals')::int,
      (v_channel ->> 'score')::numeric,
      coalesce((v_channel ->> 'confidence')::numeric, 0),
      coalesce((v_channel ->> 'evidence_weight')::numeric, 0),
      coalesce((v_channel ->> 'success_weight')::numeric, 0),
      coalesce((v_channel ->> 'evidence_count')::int, 0),
      (v_channel ->> 'last_evidence_at')::timestamptz,
      (v_state -> 'active' ->> 'score')::numeric,
      coalesce((v_state -> 'active' ->> 'confidence')::numeric, 0),
      coalesce((v_state -> 'active' ->> 'evidence_weight')::numeric, 0),
      coalesce((v_state -> 'active' ->> 'success_weight')::numeric, 0),
      coalesce((v_state -> 'active' ->> 'evidence_count')::int, 0),
      (v_state -> 'active' ->> 'last_evidence_at')::timestamptz,
      coalesce(
        array(select jsonb_array_elements_text(v_state -> 'source_kinds')),
        array[]::text[]
      ),
      coalesce(v_state ->> 'model_version', 'knowledge_v1'),
      coalesce((v_state ->> 'expected_version')::int, 0) + 1,
      now()
    )
    on conflict (user_id, word_id) do update
      set first_seen_at         = coalesce(w.first_seen_at, excluded.first_seen_at),
          last_seen_at          = excluded.last_seen_at,
          last_success_at       = coalesce(excluded.last_success_at, w.last_success_at),
          last_failure_at       = coalesce(excluded.last_failure_at, w.last_failure_at),
          exposure_count        = excluded.exposure_count,
          successful_retrievals = excluded.successful_retrievals,
          failed_retrievals     = excluded.failed_retrievals,
          receptive_score           = excluded.receptive_score,
          receptive_confidence      = excluded.receptive_confidence,
          receptive_evidence_weight = excluded.receptive_evidence_weight,
          receptive_success_weight  = excluded.receptive_success_weight,
          receptive_evidence_count  = excluded.receptive_evidence_count,
          receptive_last_at         = excluded.receptive_last_at,
          active_score           = excluded.active_score,
          active_confidence      = excluded.active_confidence,
          active_evidence_weight = excluded.active_evidence_weight,
          active_success_weight  = excluded.active_success_weight,
          active_evidence_count  = excluded.active_evidence_count,
          active_last_at         = excluded.active_last_at,
          source_kinds  = excluded.source_kinds,
          model_version = excluded.model_version,
          version       = excluded.version,
          updated_at    = excluded.updated_at
      where w.version = coalesce((v_state ->> 'expected_version')::int, 0);

    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Stan znajomości słowa zmienił się w trakcie zapisu.' using errcode = 'FL423';
    end if;
  end loop;

  return v_written;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. THE PLAN CAN NOW POINT AT A CHAPTER…
-- ─────────────────────────────────────────────────────────────────────────────
-- Three more columns on the insert. Everything else — the race on
-- `unique (user_id, learning_date)`, the onboarding-replacement rule — is the
-- Phase 3 function unchanged.
create or replace function public.create_daily_plan(
  p_user_id           uuid,
  p_learning_date     date,
  p_timezone          text,
  p_target_minutes    int,
  p_algorithm_version text,
  p_evidence_level    text,
  p_items             jsonb,
  p_replace_onboarding boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan     uuid;
  v_existing uuid;
  v_item     jsonb;
  v_minutes  int;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika planu.' using errcode = 'FL401';
  end if;

  select p.id into v_existing
  from public.daily_plans p
  where p.user_id = p_user_id and p.learning_date = p_learning_date;

  if v_existing is not null and p_replace_onboarding then
    if not exists (
      select 1 from public.daily_plan_items i
      where i.plan_id = v_existing
        and (i.item_type <> 'placement' or i.status <> 'pending')
    ) then
      delete from public.daily_plans p where p.id = v_existing;
      v_existing := null;
    end if;
  end if;

  if v_existing is not null then
    return v_existing;
  end if;

  begin
    insert into public.daily_plans (
      user_id, learning_date, timezone, target_minutes,
      algorithm_version, evidence_level
    ) values (
      p_user_id, p_learning_date, p_timezone, greatest(1, p_target_minutes),
      p_algorithm_version, coalesce(p_evidence_level, 'none')
    )
    returning id into v_plan;
  exception when unique_violation then
    select p.id into v_plan
    from public.daily_plans p
    where p.user_id = p_user_id and p.learning_date = p_learning_date;
    return v_plan;
  end;

  v_minutes := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.daily_plan_items (
      plan_id, item_position, item_type, estimated_minutes, priority_score,
      reason_code, reason_data, signals, target_count,
      text_id, concept_code, word_ids, payload,
      library_item_id, chapter_id, target_seconds
    ) values (
      v_plan,
      (v_item ->> 'item_position')::int,
      v_item ->> 'item_type',
      greatest(0, coalesce((v_item ->> 'estimated_minutes')::int, 0)),
      coalesce((v_item ->> 'priority_score')::numeric, 0),
      v_item ->> 'reason_code',
      coalesce(v_item -> 'reason_data', '{}'::jsonb),
      coalesce(v_item -> 'signals', '{}'::jsonb),
      greatest(1, coalesce((v_item ->> 'target_count')::int, 1)),
      (v_item ->> 'text_id')::bigint,
      v_item ->> 'concept_code',
      coalesce(
        array(select jsonb_array_elements_text(v_item -> 'word_ids')::bigint),
        array[]::bigint[]
      ),
      coalesce(v_item -> 'payload', '{}'::jsonb),
      (v_item ->> 'library_item_id')::uuid,
      (v_item ->> 'chapter_id')::uuid,
      (v_item ->> 'target_seconds')::int
    );
    v_minutes := v_minutes + greatest(0, coalesce((v_item ->> 'estimated_minutes')::int, 0));
  end loop;

  update public.daily_plans p set estimated_minutes = v_minutes where p.id = v_plan;

  return v_plan;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. …AND MEASURE WHETHER IT WAS READ.
-- ─────────────────────────────────────────────────────────────────────────────
-- Still derived, never asserted. A reading task is done when the learner either
--
--   * finished the chapter today — `reading_progress.completed_at`, written only
--     by `complete_reading_chapter`, which itself refuses below the completion
--     threshold; or
--   * put in the reading the plan asked for — `target_seconds` of ACTIVE reading
--     on that chapter today, summed from `reading_sessions`.
--
-- OPENING A CHAPTER IS NOT DOING IT. That is the whole reason the second rule is
-- about seconds rather than about a row existing: "Czytaj przez około 8 minut"
-- has to mean eight minutes, or the plan is measuring intent instead of work.
--
-- `v_touched` replaces the repeated `exists (...)` the previous version used to
-- decide `in_progress`: each branch now says whether the learner has started the
-- activity, which is a fact the branch already knows.
create or replace function public.sync_daily_plan(p_plan_id uuid)
returns table (
  item_id         uuid,
  item_status     text,
  completed_count int,
  plan_status     text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user       uuid := (select auth.uid());
  v_plan       public.daily_plans%rowtype;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_item       public.daily_plan_items%rowtype;
  v_done       int;
  v_status     text;
  v_vocab_ids  bigint[];
  v_open       int;
  v_completed  int;
  v_plan_state text;
  v_touched    boolean;
  v_seconds    int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_plan from public.daily_plans p where p.id = p_plan_id for update;
  if not found then
    raise exception 'Plan nie istnieje.' using errcode = 'FL404';
  end if;
  if v_plan.user_id <> v_user then
    raise exception 'Brak dostępu do tego planu.' using errcode = 'FL403';
  end if;

  v_day_start := public.learning_day_start(v_plan.learning_date, v_plan.timezone);
  v_day_end   := v_day_start + interval '1 day';

  select coalesce(array_agg(w), array[]::bigint[]) into v_vocab_ids
  from (
    select distinct unnest(i.word_ids) as w
    from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.item_type = 'new_vocabulary'
  ) t;

  for v_item in
    select * from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position
  loop
    if v_item.status = 'skipped' then
      continue;
    end if;

    v_done    := 0;
    v_touched := false;

    if v_item.item_type = 'review_due' then
      select count(*)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and not (r.word_id = any (v_vocab_ids));

    elsif v_item.item_type = 'new_vocabulary' then
      select count(distinct r.word_id)::int into v_done
      from public.review_events r
      where r.user_id = v_user
        and r.reviewed_at >= v_day_start and r.reviewed_at < v_day_end
        and r.word_id = any (v_item.word_ids);

    elsif v_item.item_type = 'weakness_practice' then
      select coalesce(max(s.total), 0)::int into v_done
      from public.practice_sessions s
      where s.plan_item_id = v_item.id and s.status = 'completed';
      if v_done = 0 then
        select count(*)::int into v_done
        from public.practice_session_items pi
        join public.practice_sessions s on s.id = pi.session_id
        where s.plan_item_id = v_item.id
          and s.status = 'in_progress'
          and pi.answered_at is not null;
      end if;

    elsif v_item.item_type in ('continue_text', 'new_text') then
      v_touched := exists (
        select 1 from public.text_progress tp
        where tp.user_id = v_user and tp.text_id = v_item.text_id
          and tp.last_opened_at >= v_day_start and tp.last_opened_at < v_day_end
      );
      if exists (
        select 1 from public.text_completions c
        where c.user_id = v_user and c.text_id = v_item.text_id
          and c.completed_at >= v_day_start and c.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif v_touched or exists (
        select 1 from public.test_sessions s
        where s.user_id = v_user and s.text_id = v_item.text_id
          and s.status = 'in_progress'
      ) then
        v_touched := true;
      end if;

    elsif v_item.item_type in ('continue_chapter', 'new_chapter') then
      select coalesce(sum(s.active_seconds), 0)::int into v_seconds
      from public.reading_sessions s
      where s.user_id = v_user and s.chapter_id = v_item.chapter_id
        and s.started_at >= v_day_start and s.started_at < v_day_end;

      -- Opening the chapter starts the task; only READING finishes it. The two
      -- are deliberately different facts, measured from different columns.
      v_touched := exists (
        select 1 from public.reading_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.started_at >= v_day_start and s.started_at < v_day_end
      );

      if exists (
        select 1 from public.reading_progress rp
        where rp.user_id = v_user and rp.chapter_id = v_item.chapter_id
          and rp.completed_at >= v_day_start and rp.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      elsif v_item.target_seconds is not null
        and v_item.target_seconds > 0
        and v_seconds >= v_item.target_seconds
      then
        v_done := v_item.target_count;
      end if;

    elsif v_item.item_type = 'placement' then
      if exists (
        select 1 from public.profiles p
        where p.id = v_user and p.level_source <> 'default'
      ) then
        v_done := v_item.target_count;
      end if;
    end if;

    v_done := least(greatest(v_done, 0), v_item.target_count);

    if v_done >= v_item.target_count then
      v_status := 'completed';
    elsif v_done > 0 or v_touched then
      v_status := 'in_progress';
    else
      v_status := 'pending';
    end if;

    update public.daily_plan_items i
       set completed_count = v_done,
           status          = v_status,
           started_at      = case when i.started_at is null and v_status <> 'pending'
                                  then now() else i.started_at end,
           completed_at    = case when v_status = 'completed'
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_item.id;
  end loop;

  select count(*) filter (where i.status in ('pending', 'in_progress'))::int,
         count(*) filter (where i.status = 'completed')::int
    into v_open, v_completed
  from public.daily_plan_items i where i.plan_id = p_plan_id;

  if v_open = 0 and v_completed > 0 then
    v_plan_state := 'completed';
  elsif v_completed > 0 or exists (
    select 1 from public.daily_plan_items i
    where i.plan_id = p_plan_id and i.status in ('in_progress', 'skipped')
  ) then
    v_plan_state := 'in_progress';
  else
    v_plan_state := 'pending';
  end if;

  update public.daily_plans p
     set status       = v_plan_state,
         started_at   = case when p.started_at is null and v_plan_state <> 'pending'
                             then now() else p.started_at end,
         completed_at = case when v_plan_state = 'completed'
                             then coalesce(p.completed_at, now()) else null end
   where p.id = p_plan_id;

  return query
    select i.id, i.status, i.completed_count, v_plan_state
    from public.daily_plan_items i
    where i.plan_id = p_plan_id
    order by i.item_position;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same split as everywhere else in Fluent: functions a learner calls derive the
-- learner from `auth.uid()`; functions that take a user id, accept computed
-- state or write content are service-role only and are REVOKED from the roles a
-- browser can hold — not merely left ungranted.

grant execute on function public.library_item_readable(text, timestamptz, uuid)
  to anon, authenticated;
grant execute on function public.library_item_writable(uuid) to anon, authenticated;
grant execute on function public.item_is_writable(uuid)      to anon, authenticated;
grant execute on function public.chapter_is_writable(uuid)   to anon, authenticated;

grant execute on function public.start_reading_session(uuid)                       to authenticated;
grant execute on function public.record_reading_progress(uuid, int, int, int, int) to authenticated;
grant execute on function public.complete_reading_chapter(uuid, numeric)           to authenticated;
grant execute on function public.end_reading_session(uuid, int, int)               to authenticated;
grant execute on function public.save_word_from_reader(bigint, bigint)             to authenticated;

revoke all on function public.replace_chapter_content(uuid, jsonb) from public;
revoke all on function public.replace_chapter_content(uuid, jsonb) from anon, authenticated;
grant execute on function public.replace_chapter_content(uuid, jsonb) to service_role;

revoke all on function public.fail_chapter_processing(uuid, text) from public;
revoke all on function public.fail_chapter_processing(uuid, text) from anon, authenticated;
grant execute on function public.fail_chapter_processing(uuid, text) to service_role;

revoke all on function public.apply_reading_lookup(uuid, text, uuid, bigint, bigint, bigint, uuid, jsonb) from public;
revoke all on function public.apply_reading_lookup(uuid, text, uuid, bigint, bigint, bigint, uuid, jsonb) from anon, authenticated;
grant execute on function public.apply_reading_lookup(uuid, text, uuid, bigint, bigint, bigint, uuid, jsonb) to service_role;

revoke all on function public.apply_reading_event(uuid, jsonb) from public;
revoke all on function public.apply_reading_event(uuid, jsonb) from anon, authenticated;
grant execute on function public.apply_reading_event(uuid, jsonb) to service_role;

-- `apply_learning_evidence` was replaced above; re-assert that it is reachable
-- from nowhere at all. It is called only from inside other SECURITY DEFINER
-- functions, which run as the owner.
revoke all on function public.apply_learning_evidence(uuid, jsonb, bigint) from public;
revoke all on function public.apply_learning_evidence(uuid, jsonb, bigint) from anon, authenticated, service_role;

revoke all on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) from public;
revoke all on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.create_daily_plan(uuid, date, text, int, text, text, jsonb, boolean) to service_role;

grant execute on function public.sync_daily_plan(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.library_items     enable row level security;
alter table public.chapters          enable row level security;
alter table public.paragraphs        enable row level security;
alter table public.sentences         enable row level security;
alter table public.word_occurrences  enable row level security;
alter table public.chapter_vocabulary enable row level security;
alter table public.reading_progress  enable row level security;
alter table public.reading_sessions  enable row level security;
alter table public.reading_lookups   enable row level security;

-- CONTENT: readable per `library_item_readable`, writable by admins only.
--
-- A normal learner cannot edit a chapter of a public book — not the text, not
-- the sentences, not the occurrences. Content changes arrive through the
-- processing pipeline (service role) or the admin panel, and nowhere else.
-- Ownership of a private import gives READ access here; a personal editor is a
-- deliberate later feature, not a side effect of importing a file.
drop policy if exists "library items read" on public.library_items;
create policy "library items read" on public.library_items
  for select using (
    public.library_item_readable(status, archived_at, owner_user_id)
  );

-- INSERT/UPDATE/DELETE only. Admin READ comes from the policy above, which
-- stops at private imports — so `for all` here would quietly hand admins a
-- learner's own books.
drop policy if exists "library items admin write" on public.library_items;
drop policy if exists "library items admin insert" on public.library_items;
create policy "library items admin insert" on public.library_items
  for insert with check (public.library_item_writable(owner_user_id));
drop policy if exists "library items admin update" on public.library_items;
create policy "library items admin update" on public.library_items
  for update using (public.library_item_writable(owner_user_id))
          with check (public.library_item_writable(owner_user_id));
drop policy if exists "library items admin delete" on public.library_items;
create policy "library items admin delete" on public.library_items
  for delete using (public.library_item_writable(owner_user_id));

drop policy if exists "chapters read" on public.chapters;
create policy "chapters read" on public.chapters
  for select using (
    exists (
      select 1 from public.library_items i
      where i.id = chapters.library_item_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "chapters admin write" on public.chapters;
drop policy if exists "chapters admin insert" on public.chapters;
create policy "chapters admin insert" on public.chapters
  for insert with check (public.item_is_writable(library_item_id));
drop policy if exists "chapters admin update" on public.chapters;
create policy "chapters admin update" on public.chapters
  for update using (public.item_is_writable(library_item_id))
          with check (public.item_is_writable(library_item_id));
drop policy if exists "chapters admin delete" on public.chapters;
create policy "chapters admin delete" on public.chapters
  for delete using (public.item_is_writable(library_item_id));

drop policy if exists "paragraphs read" on public.paragraphs;
create policy "paragraphs read" on public.paragraphs
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = paragraphs.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "paragraphs admin write" on public.paragraphs;
drop policy if exists "paragraphs admin insert" on public.paragraphs;
create policy "paragraphs admin insert" on public.paragraphs
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "paragraphs admin update" on public.paragraphs;
create policy "paragraphs admin update" on public.paragraphs
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "paragraphs admin delete" on public.paragraphs;
create policy "paragraphs admin delete" on public.paragraphs
  for delete using (public.chapter_is_writable(chapter_id));

drop policy if exists "sentences read" on public.sentences;
create policy "sentences read" on public.sentences
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = sentences.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "sentences admin write" on public.sentences;
drop policy if exists "sentences admin insert" on public.sentences;
create policy "sentences admin insert" on public.sentences
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "sentences admin update" on public.sentences;
create policy "sentences admin update" on public.sentences
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "sentences admin delete" on public.sentences;
create policy "sentences admin delete" on public.sentences
  for delete using (public.chapter_is_writable(chapter_id));

drop policy if exists "occurrences read" on public.word_occurrences;
create policy "occurrences read" on public.word_occurrences
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = word_occurrences.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "occurrences admin write" on public.word_occurrences;
drop policy if exists "occurrences admin insert" on public.word_occurrences;
create policy "occurrences admin insert" on public.word_occurrences
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "occurrences admin update" on public.word_occurrences;
create policy "occurrences admin update" on public.word_occurrences
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "occurrences admin delete" on public.word_occurrences;
create policy "occurrences admin delete" on public.word_occurrences
  for delete using (public.chapter_is_writable(chapter_id));

drop policy if exists "chapter vocabulary read" on public.chapter_vocabulary;
create policy "chapter vocabulary read" on public.chapter_vocabulary
  for select using (
    exists (
      select 1
      from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = chapter_vocabulary.chapter_id
        and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
    )
  );

drop policy if exists "chapter vocabulary admin write" on public.chapter_vocabulary;
drop policy if exists "chapter vocabulary admin insert" on public.chapter_vocabulary;
create policy "chapter vocabulary admin insert" on public.chapter_vocabulary
  for insert with check (public.chapter_is_writable(chapter_id));
drop policy if exists "chapter vocabulary admin update" on public.chapter_vocabulary;
create policy "chapter vocabulary admin update" on public.chapter_vocabulary
  for update using (public.chapter_is_writable(chapter_id))
          with check (public.chapter_is_writable(chapter_id));
drop policy if exists "chapter vocabulary admin delete" on public.chapter_vocabulary;
create policy "chapter vocabulary admin delete" on public.chapter_vocabulary
  for delete using (public.chapter_is_writable(chapter_id));

-- READING STATE: owner-readable, and writable by NOBODY.
--
-- No insert or update policy exists for any of these three tables, deliberately.
-- Reading progress is progress, and progress in Fluent has no learner write path
-- — every change goes through the SECURITY DEFINER functions above, which derive
-- the learner from `auth.uid()` instead of believing a parameter.
drop policy if exists "own reading progress read" on public.reading_progress;
create policy "own reading progress read" on public.reading_progress
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own reading sessions read" on public.reading_sessions;
create policy "own reading sessions read" on public.reading_sessions
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own reading lookups read" on public.reading_lookups;
create policy "own reading lookups read" on public.reading_lookups
  for select using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. THE PASSAGES THAT ALREADY EXIST.
-- ─────────────────────────────────────────────────────────────────────────────
-- Every `texts` row becomes a library item with exactly one chapter. Nothing is
-- moved, renumbered or deleted: `texts` keeps its `body`, its questions, its
-- completions and its id, and the library points back at it through
-- `legacy_text_id`.
--
-- WHY NOT PARSE THE BODY HERE. Because the parsing is TypeScript: paragraph and
-- sentence splitting, tokenizing and dictionary matching live in
-- `src/lib/content/`, are unit-tested there, and re-implementing any of it in
-- PL/pgSQL would give Fluent two tokenizers that disagree — the exact failure
-- `AGENTS.md` forbids. So the migration creates the SHELL (item, chapter, source
-- text) and leaves `status = 'draft'`; the structured content is produced by the
-- pipeline through `/admin/library`, which is also the path a reprocess takes.
--
-- UNTIL THEN NOTHING CHANGES FOR A LEARNER. `/learn/[textId]` renders the legacy
-- body exactly as before and only redirects into the reader once the chapter is
-- `ready`, so an already-provisioned project upgrades without a content freeze.

-- A URL-safe slug. German-aware: ä/ö/ü/ß expand rather than vanishing, which is
-- the difference between `fussgangerubergang` and `fgngerbergang`.
create or replace function public.slugify(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(
          regexp_replace(
            lower(
              translate(
                coalesce(p_value, ''),
                'äöüÄÖÜßàáâãåèéêëìíîïòóôõùúûýñçÀÁÂÃÅÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÝÑÇ',
                'aouAOUsaaaaaeeeeiiiioooouuuyncAAAAAEEEEIIIIOOOOUUUYNC'
              )
            ),
            '[^a-z0-9]+', '-', 'g'
          ),
          '-{2,}', '-', 'g'
        )
      ),
      ''
    ),
    'tekst'
  );
$$;

grant execute on function public.slugify(text) to anon, authenticated;

-- A FUNCTION, not a one-off block, because the gap it fills keeps reopening: an
-- admin who writes a new passage in `/admin/texts` tomorrow creates a `texts`
-- row with no library item, and a passage that never reaches the library is a
-- passage the reader cannot open. It is called by the migration below, and again
-- whenever content is processed, so the two models cannot drift apart.
--
-- Idempotent by construction: it only creates items for passages that do not
-- have one.
create or replace function public.backfill_library_from_texts()
returns int
language plpgsql
security definer
set search_path = ''
as $backfill$
declare
  v_text  record;
  v_item  uuid;
  v_count int := 0;
begin
  for v_text in
    select t.id, t.title, t.cefr, t.body, t.word_count, t.created_at
    from public.texts t
    where not exists (
      select 1 from public.library_items i where i.legacy_text_id = t.id
    )
    order by t.id
  loop
    -- The id is appended so two passages with the same title cannot collide,
    -- and so the slug is reproducible if this ever has to be re-run.
    insert into public.library_items (
      slug, title, content_type, rights, status, cefr_estimate,
      word_count, chapter_count, source_type, legacy_text_id, created_at
    ) values (
      public.slugify(v_text.title) || '-' || v_text.id,
      v_text.title,
      'lesson',
      'first_party',
      'draft',
      v_text.cefr,
      coalesce(v_text.word_count, 0),
      1,
      'fluent_text',
      v_text.id,
      coalesce(v_text.created_at, now())
    )
    returning id into v_item;

    insert into public.chapters (
      library_item_id, position, title, source_text,
      word_count, cefr_estimate, status
    ) values (
      v_item, 1, v_text.title, coalesce(v_text.body, ''),
      coalesce(v_text.word_count, 0), v_text.cefr, 'draft'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$backfill$;

revoke all on function public.backfill_library_from_texts() from public;
revoke all on function public.backfill_library_from_texts() from anon, authenticated;
grant execute on function public.backfill_library_from_texts() to service_role;

do $$ begin perform public.backfill_library_from_texts(); end $$;

-- A PROCESSED LEGACY CHAPTER RE-PUBLISHES ITS ITEM.
--
-- The admin already decided this passage was publishable when they published the
-- `texts` row; processing it into the library must not silently retract that
-- decision, and must not require them to make it twice. Anything that is NOT a
-- migrated passage stays a draft until someone publishes it deliberately.
create or replace function public.publish_processed_legacy_items()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with promoted as (
    update public.library_items i
       set status       = 'published',
           published_at = coalesce(i.published_at, now()),
           updated_at   = now()
     where i.status = 'draft'
       and i.owner_user_id is null
       and i.legacy_text_id is not null
       and exists (
         select 1 from public.texts t
         where t.id = i.legacy_text_id and t.status = 'published'
       )
       and exists (
         select 1 from public.chapters c
         where c.library_item_id = i.id and c.status = 'ready'
       )
    returning 1
  )
  select count(*)::int into v_count from promoted;

  return v_count;
end;
$$;

revoke all on function public.publish_processed_legacy_items() from public;
revoke all on function public.publish_processed_legacy_items() from anon, authenticated;
grant execute on function public.publish_processed_legacy_items() to service_role;
