-- Fluent — Phase 5.6: the personal language notebook.
--
-- WHAT THIS ADDS. Until now everything a learner could record while reading was
-- a DICTIONARY fact: tapping *sollten* saved the headword *sollen* with the
-- sentence it was met in, and that was the whole vocabulary of the reader. It is
-- the wrong grain for reading a novel. "sollen → powinien / mieć powinność" is
-- true and nearly useless in front of
--
--     „Wir sollten umkehren“, drängte Gared.
--
-- where the thing worth writing down is *powinniśmy*, and the thing worth
-- writing down next to it is the whole Polish sentence. Neither belongs in
-- `words.translation_pl`, because neither is true of the lexeme — they are true
-- of THIS PLACE IN THIS BOOK, for THIS learner.
--
-- So this migration builds the layer underneath that: three grains of personal
-- annotation, owned by one learner, never global, never mixed with the shared
-- dictionary.
--
--     LEXEME        words.translation_pl       global, admin-owned, shared
--     OCCURRENCE    user_text_annotations      "here it means powinniśmy"
--     PHRASE        user_text_annotations      "Angst machen → straszyć"
--     SENTENCE      user_sentence_notes        my translation, and "nie rozumiem"
--
-- THE FIVE INVARIANTS THIS SCHEMA EXISTS TO ENFORCE.
--
--   1. A PERSONAL ANNOTATION NEVER TOUCHES THE GLOBAL DICTIONARY. There is no
--      write path from any function below into `public.words`, and there must
--      never be one. A learner who decides *ziehen* means "wyciągnąć" has said
--      something about one sentence, not about every learner's dictionary.
--
--   2. CONTEXT IS AN OCCURRENCE, NOT A WORD. A contextual meaning is keyed on a
--      place in a chapter, so *ziehen* in "Er zog sein Schwert." and *ziehen* in
--      "Sie zogen den Wagen." can, and must be able to, mean different things.
--      Keying it on `(user_id, word_id)` would have made the second one silently
--      overwrite the first.
--
--   3. ANNOTATIONS ARE ANCHORED ON POSITIONS, NOT ON ROW IDS. Reprocessing a
--      chapter REPLACES its paragraphs, so every sentence and occurrence row is
--      deleted and reinserted with new ids (`replace_chapter_content`). Reading
--      progress survives that because it stores POSITIONS, and so does a
--      notebook: `(chapter_id, sentence_position)` and `token_position` are the
--      durable address, `sentence_id` / `occurrence_id` are fast pointers that
--      are allowed to go null. The German text is snapshotted alongside, so a
--      note can be shown — and detected as stale — even when the text moved.
--
--   4. A NOTE IS PRIVATE, AND SO IS ITS SOURCE. Every write below re-derives the
--      learner from `auth.uid()` and refuses a sentence the learner may not read
--      (`chapter_is_readable`, which is Phase 4's `library_item_readable`). So a
--      learner cannot annotate someone else's private import by guessing an id,
--      and deleting a private book takes its annotations with it — the snapshot
--      of somebody's book does not outlive the book.
--
--   5. THERE IS ONE SCHEDULER. Phrases and contextual meanings can be reviewed,
--      and they are scheduled by the SAME SM-2 in `src/lib/sm2.ts` and recorded
--      in the SAME `review_events` log as word cards. `user_notebook_reviews`
--      is a second STORAGE table, because `saved_words` is keyed
--      `(user_id, word_id)` and structurally cannot hold a phrase; it is not a
--      second algorithm, and nothing here re-implements an interval.
--
-- NO AI. Nothing in this phase calls a model. Every meaning stored below was
-- typed by the learner, which is also why none of it is ever presented as
-- verified truth — the UI says "Twoje tłumaczenie", and the column is called
-- `translation` on a table whose name starts with `user_`.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SENTENCE NOTES — my translation, and "nie rozumiem".
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY ONE TABLE FOR TWO FEATURES. They are the same grain — one learner, one
-- sentence — and they are the same act: "I stopped at this sentence and did
-- something about it". A learner who translates a sentence and also flags it
-- unclear has one note about one sentence, not two rows that have to be kept
-- consistent with each other. Splitting them would also mean two round trips
-- every time the reader wants to know what the learner has said about a
-- sentence, which is the one query the word sheet makes on every tap.
--
-- `is_unclear` IS CURRENT STATE, NOT HISTORY. Flipping it writes a
-- `sentence_marked_unclear` / `sentence_marked_understood` row into
-- `learning_events`, which is append-only, so the sequence survives while the
-- flag tells the notebook what is true NOW. A learner who works a sentence out
-- is not carrying a permanent failure around; the fact that they once could not
-- read it is still worth having.
create table if not exists public.user_sentence_notes (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- THE DURABLE ADDRESS. `chapter_id` cascades because a note about a deleted
  -- book is not a note, it is a private copy of a fragment of that book left
  -- behind — see invariant 4 and the privacy rules of Phase 5.5.
  chapter_id        uuid not null references public.chapters(id) on delete cascade,
  library_item_id   uuid not null references public.library_items(id) on delete cascade,
  -- `sentences.chapter_position`: the sentence's index in reading order, which
  -- the content pipeline assigns deterministically and which survives a
  -- reprocessing pass. This — not `sentence_id` — is the identity of a note.
  sentence_position int  not null check (sentence_position >= 0),

  -- The fast pointer. Nullable, and allowed to become null: reprocessing deletes
  -- the row this points at, and losing the pointer must not lose the note.
  sentence_id bigint references public.sentences(id) on delete set null,

  -- The German, copied at write time. Two jobs: the notebook renders an entry
  -- without touching the chapter at all, and comparing it against the live
  -- sentence is how a note that now points at different text is DETECTED rather
  -- than silently shown against the wrong prose.
  sentence_text text not null,
  -- Which processor produced the text this note was taken against.
  content_version text not null default 'content_v1',

  -- The learner's own Polish. NEVER presented as a correct translation, and
  -- deliberately not called `translation_pl` — that column name belongs to the
  -- shared dictionary and means something else.
  translation text check (translation is null or length(translation) <= 2000),

  is_unclear  boolean not null default false,
  unclear_at  timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A row with neither a translation nor a flag is not a note. Deleting the last
  -- thing a note says deletes the note, which is what keeps the notebook honest
  -- about how much is in it.
  constraint user_sentence_notes_not_empty
    check (translation is not null or is_unclear)
);

-- IDENTITY IS THE POSITION. This is what makes "save my translation" an upsert
-- rather than a duplicate, and it keeps holding after a chapter is reprocessed,
-- when `sentence_id` has gone null on every row.
create unique index if not exists user_sentence_notes_anchor_idx
  on public.user_sentence_notes (user_id, chapter_id, sentence_position);

-- "What has this learner said about the sentence I just tapped?" — the reader's
-- only notebook read, and it must cost one index probe.
create index if not exists user_sentence_notes_sentence_idx
  on public.user_sentence_notes (user_id, sentence_id)
  where sentence_id is not null;

-- The notebook's three listings: everything, one book, and the unresolved pile.
create index if not exists user_sentence_notes_recent_idx
  on public.user_sentence_notes (user_id, created_at desc, id desc);
create index if not exists user_sentence_notes_item_idx
  on public.user_sentence_notes (user_id, library_item_id, created_at desc, id desc);
create index if not exists user_sentence_notes_unclear_idx
  on public.user_sentence_notes (user_id, unclear_at desc)
  where is_unclear;

comment on table public.user_sentence_notes is
  'One learner''s own translation of, and difficulty flag on, one sentence. Private, never global, anchored on (chapter_id, sentence_position) so it survives reprocessing.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TEXT ANNOTATIONS — a word in this place, or a phrase.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY WORDS AND PHRASES SHARE A TABLE, when the lexeme / occurrence / phrase
-- levels must never be mixed. The levels being distinct is a statement about
-- MEANING — a contextual gloss must never overwrite a dictionary entry — and
-- that is enforced by there being no write path into `public.words` at all.
-- Storage is a different question: a contextual word meaning and a phrase are
-- both "a span of tokens inside one sentence, with the learner's own meaning
-- on it", down to every column. Two tables would be the same eight columns
-- twice, two sets of indexes, and two queries every time the reader or the
-- notebook wants "what have I written down here?".
--
-- A single-token span is a WORD annotation; two or more tokens is a PHRASE. The
-- span is always inside ONE sentence (`sentence_position` is scalar, and
-- `save_text_annotation` refuses anything else) — a "phrase" spanning two
-- sentences is a selection accident, not a unit of language.
--
-- A PERSONAL WORD is a `word` annotation with `word_id is null`: a token the
-- shared dictionary does not know, written down anyway. That is the whole
-- feature — it needs no second table, and crucially no row in `public.words`,
-- because a learner's guess at a headword is not dictionary content.
create table if not exists public.user_text_annotations (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (kind in ('word', 'phrase')),

  -- The same durable address as a sentence note, plus the token span.
  chapter_id        uuid not null references public.chapters(id) on delete cascade,
  library_item_id   uuid not null references public.library_items(id) on delete cascade,
  sentence_position int  not null check (sentence_position >= 0),
  sentence_id       bigint references public.sentences(id) on delete set null,

  -- `word_occurrences.position` — the index among the sentence's LEXICAL tokens,
  -- which is why it survives punctuation edits and why a cloze built from it
  -- blanks the right *sollten* when the sentence contains two.
  start_position int not null check (start_position >= 0),
  end_position   int not null check (end_position >= 0),

  -- Fast pointers to the endpoint occurrences. Null for a personal word (no
  -- occurrence row exists for a token the dictionary could not match) and after
  -- a reprocessing pass.
  start_occurrence_id bigint references public.word_occurrences(id) on delete set null,
  end_occurrence_id   bigint references public.word_occurrences(id) on delete set null,

  -- Character offsets INTO `sentence_text`, so the reader and the review layer
  -- can highlight or blank the exact span without searching for it. §66: a cloze
  -- is never `text.replace(surface, '____')`.
  char_start int not null default 0 check (char_start >= 0),
  char_end   int not null default 0 check (char_end >= 0),

  -- Snapshots: the span as written ("sollten", "Angst machen") and the sentence
  -- it sat in. Same two jobs as on a sentence note.
  surface       text not null check (length(surface) between 1 and 400),
  sentence_text text not null,
  content_version text not null default 'content_v1',

  -- The shared dictionary entry this span resolved to, when it resolved to one.
  -- A REFERENCE, never a target: nothing below writes through it.
  word_id bigint references public.words(id) on delete set null,
  -- The learner's own headword, if they chose to give one ("sollten → sollen").
  -- Optional by design: demanding a lemma from someone who is still working out
  -- what the word is would make the feature unusable exactly when it is needed.
  lemma text check (lemma is null or length(lemma) <= 200),

  -- Optional: "I want to come back to this" is a legitimate reason to save a
  -- phrase, and refusing to store it would send the learner to a paper notebook.
  meaning text check (meaning is null or length(meaning) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_text_annotations_span check (end_position >= start_position),
  -- A `word` annotation is exactly one token, by definition of the two kinds.
  constraint user_text_annotations_kind_span
    check (kind <> 'word' or start_position = end_position)
);

-- ONE annotation per learner per span. Re-saving the same span is an edit, not a
-- duplicate; §42's overlapping phrases ("Angst machen" and "jemandem Angst
-- machen") are different spans and both exist, which is the intended behaviour
-- and the reason this is not keyed on `surface`.
create unique index if not exists user_text_annotations_anchor_idx
  on public.user_text_annotations
     (user_id, chapter_id, sentence_position, start_position, end_position);

create index if not exists user_text_annotations_sentence_idx
  on public.user_text_annotations (user_id, sentence_id)
  where sentence_id is not null;

create index if not exists user_text_annotations_recent_idx
  on public.user_text_annotations (user_id, kind, created_at desc, id desc);
create index if not exists user_text_annotations_item_idx
  on public.user_text_annotations (user_id, library_item_id, created_at desc, id desc);
create index if not exists user_text_annotations_chapter_idx
  on public.user_text_annotations (user_id, chapter_id, sentence_position);
-- "Everything I have written about this lexeme, across every book."
create index if not exists user_text_annotations_word_idx
  on public.user_text_annotations (user_id, word_id)
  where word_id is not null;

comment on table public.user_text_annotations is
  'One learner''s own meaning for a span of tokens inside one sentence: a single token is a contextual word meaning (a personal word when word_id is null), two or more is a phrase. Never written into public.words.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REVIEWING A NOTE — opt in, one scheduler.
-- ─────────────────────────────────────────────────────────────────────────────
-- NOT EVERY NOTE IS A FLASHCARD. Translating a sentence is a way of reading it;
-- turning all of them into scheduled reviews would bury the learner in cards
-- they never asked for and make translating a sentence feel expensive. So a note
-- enters the review queue only when the learner says so, and this table exists
-- only for the ones that did.
--
-- WHY IT IS NOT `saved_words`. That table's primary key is `(user_id, word_id)`:
-- it can hold one schedule per dictionary entry, and a phrase has no dictionary
-- entry at all. This is the same schedule for a different kind of item — the
-- SM-2 columns are named identically on purpose, they are computed by the same
-- `src/lib/sm2.ts`, and the grading goes through the same `review_events` log.
-- The database owns the transaction; it does not own the arithmetic.
create table if not exists public.user_notebook_reviews (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Exactly one parent. Two typed columns rather than a polymorphic
  -- `(item_type, item_id)` pair, so the foreign keys are real: deleting a phrase
  -- takes its card with it instead of leaving a schedule pointing at nothing.
  annotation_id    bigint references public.user_text_annotations(id) on delete cascade,
  sentence_note_id bigint references public.user_sentence_notes(id)  on delete cascade,

  -- SM-2 state. Same columns, same meanings, same defaults as `saved_words`.
  interval    int     not null default 0,
  repetitions int     not null default 0,
  ease_factor numeric not null default 2.5,
  due_at      timestamptz not null default now(),
  is_mastered boolean not null default false,

  created_at timestamptz not null default now(),

  constraint user_notebook_reviews_one_parent
    check ((annotation_id is null) <> (sentence_note_id is null))
);

create unique index if not exists user_notebook_reviews_annotation_idx
  on public.user_notebook_reviews (annotation_id)
  where annotation_id is not null;
create unique index if not exists user_notebook_reviews_note_idx
  on public.user_notebook_reviews (sentence_note_id)
  where sentence_note_id is not null;
create index if not exists user_notebook_reviews_due_idx
  on public.user_notebook_reviews (user_id, due_at)
  where not is_mastered;

comment on table public.user_notebook_reviews is
  'SM-2 schedule for notebook items the learner explicitly added to review. Same algorithm as saved_words (src/lib/sm2.ts), different item.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ONE REVIEW HISTORY, NOT TWO.
-- ─────────────────────────────────────────────────────────────────────────────
-- `review_events` is the training data a better memory model will one day be
-- fitted to. A parallel `notebook_review_events` would split that corpus in half
-- and guarantee the two halves disagree, so the existing table learns about the
-- new item kinds instead: `word_id` becomes nullable and two typed references
-- join it. Every row written before this migration is a `word` row with a
-- `word_id`, which is exactly what the default and the check below say.
alter table public.review_events
  alter column word_id drop not null;

alter table public.review_events
  add column if not exists item_type text not null default 'word';

alter table public.review_events
  add column if not exists annotation_id bigint
    references public.user_text_annotations(id) on delete set null;

alter table public.review_events
  add column if not exists sentence_note_id bigint
    references public.user_sentence_notes(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_events'::regclass
      and conname  = 'review_events_item_type_check'
  ) then
    alter table public.review_events
      add constraint review_events_item_type_check
        check (item_type in ('word', 'word_meaning', 'phrase', 'sentence_translation'));
  end if;

  -- A word card names a word; a notebook card names a note. Neither may be
  -- anonymous, or the log stops being self-contained training data.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_events'::regclass
      and conname  = 'review_events_item_target_check'
  ) then
    alter table public.review_events
      add constraint review_events_item_target_check check (
        case item_type
          when 'word' then word_id is not null
          when 'sentence_translation' then sentence_note_id is not null
          else annotation_id is not null
        end
      );
  end if;

  -- Widened, never narrowed — re-running this file on a provisioned database
  -- must not reinstate a shorter whitelist. Same guard as every other phase.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.review_events'::regclass
      and conname  = 'review_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''notebook''%'
  ) then
    alter table public.review_events drop constraint if exists review_events_source_kind_check;
    alter table public.review_events
      add constraint review_events_source_kind_check check (source_kind in (
        'review', 'reader', 'book', 'import', 'notebook'
      ));
  end if;
end $$;

create index if not exists review_events_user_annotation_idx
  on public.review_events (user_id, annotation_id, reviewed_at desc)
  where annotation_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE CLOZE NEEDS OFFSETS, NOT A STRING SEARCH.
-- ─────────────────────────────────────────────────────────────────────────────
-- A contextual card for a saved word blanks the word out of the sentence it was
-- met in:
--
--     Wir ______ umkehren.
--
-- Doing that with `replace(context, surface, '______')` is wrong whenever the
-- surface occurs twice ("Er sah sie an, und sie sah ihn an") — it blanks the
-- first one, which may not be the one that was saved. `saved_words` already
-- copies the sentence text; these two columns copy WHERE IN IT the word was, so
-- the blank is exact and stays exact after the occurrence row is gone.
alter table public.saved_words
  add column if not exists origin_char_start int;
alter table public.saved_words
  add column if not exists origin_char_end int;

-- Backfill for cards saved before this migration, from the occurrence they still
-- point at. Cards whose occurrence has since been reprocessed away keep NULL
-- offsets and are simply presented as an ordinary card — a missing cloze is a
-- fallback, never a wrong one.
update public.saved_words s
   set origin_char_start = o.char_start,
       origin_char_end   = o.char_end
  from public.word_occurrences o
 where o.id = s.origin_occurrence_id
   and s.origin_char_start is null
   and s.origin_context is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE EVIDENCE TAXONOMY LEARNS THE NOTEBOOK.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THESE ARE LEARNING EVENTS AT ALL. "Nie rozumiem tego zdania" is the
-- strongest voluntary signal a reader can give: unlike a lookup, which people
-- also make out of curiosity or by accident, it is an explicit report that
-- comprehension failed. It belongs in the same append-only log as every other
-- observation, or the Today engine would need a second place to look.
--
-- AND WHY THEY MOVE NO KNOWLEDGE STATE. A sentence is not a skill, a concept or
-- a word. Attributing "I don't understand this sentence" to `grammar`, or to
-- whichever concepts happen to appear in it, would be the model inventing a
-- weakness from a gesture — precisely what the learning engine forbids. So these
-- events carry no `skill_code`, no concepts and no `word_id`, `foldEvidence`
-- moves nothing, and the signal is used for RANKING (what to revisit) rather
-- than for mastery. The same judgement `chapterReadingEvidence` already makes.
--
-- The `*_updated` types are accepted but produced by nothing: editing a note is
-- correcting what you already said, not a new observation. They are listed so
-- that a later phase which does want to record edits needs an exercise, not a
-- migration — the same convention this whitelist has followed since Phase 2.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_event_type_check'
      and pg_get_constraintdef(oid) like '%''sentence_marked_unclear''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_event_type_check;
    alter table public.learning_events
      add constraint learning_events_event_type_check check (event_type in (
        'test_answer', 'calibration_answer', 'review', 'practice_answer',
        'reading_lookup', 'reading_chapter_started', 'reading_chapter_completed',
        'reading_sentence_help', 'reading_resume',
        'chapter_preparation_answer', 'chapter_assessment_answer',
        -- Phase 5.6 — the notebook.
        'sentence_translation_created', 'sentence_translation_updated',
        'sentence_marked_unclear', 'sentence_marked_understood',
        'context_meaning_created', 'context_meaning_updated',
        'phrase_saved', 'phrase_meaning_updated',
        'notebook_review',
        'typed_recall', 'listening_answer', 'speaking_answer', 'writing_answer'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''notebook''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_source_kind_check;
    alter table public.learning_events
      add constraint learning_events_source_kind_check check (source_kind in (
        'reading_test', 'placement_test', 'review', 'practice',
        'reader', 'book', 'story', 'import', 'notebook'
      ));
  end if;
end $$;

-- "Which sentences is this learner stuck on?" — the Today engine's read, and the
-- notebook's "Do wyjaśnienia" tab, both of which filter by sentence.
create index if not exists learning_events_user_sentence_idx
  on public.learning_events (user_id, sentence_id, occurred_at desc)
  where sentence_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. WRITE PATHS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Same contract as every other write in Fluent: the linguistics live in
-- TypeScript (`src/lib/notebook/`, `src/lib/content/tokenize.ts`), where they are
-- pure and unit-tested; these functions own the TRANSACTION and the three things
-- TypeScript cannot own — who the caller is, whether they may read the source,
-- and that the span really is the text it claims to be.
--
-- NOTHING HERE ACCEPTS A USER ID. Every function derives the learner from
-- `auth.uid()`, which is what makes it safe to grant them to `authenticated`:
-- passing someone else's id is not a thing a caller can do.

drop trigger if exists user_sentence_notes_touch on public.user_sentence_notes;
create trigger user_sentence_notes_touch
  before update on public.user_sentence_notes
  for each row execute function public.touch_updated_at();

drop trigger if exists user_text_annotations_touch on public.user_text_annotations;
create trigger user_text_annotations_touch
  before update on public.user_text_annotations
  for each row execute function public.touch_updated_at();

-- Resolve a sentence id to the durable anchor, refusing anything the caller may
-- not read.
--
-- THIS IS THE PRIVACY CHECK FOR THE WHOLE PHASE. A learner who types another
-- learner's private-import sentence id into a request gets FL404 here, before a
-- single row is written — `chapter_is_readable` is Phase 4's
-- `library_item_readable`, under which an owned item is invisible to everyone
-- but its owner, admins included.
create or replace function public.notebook_sentence_anchor(p_sentence_id bigint)
returns table (
  sentence_id       bigint,
  chapter_id        uuid,
  library_item_id   uuid,
  sentence_position int,
  sentence_text     text,
  content_version   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select s.id, s.chapter_id, c.library_item_id, s.chapter_position, s.text,
           coalesce(c.processor_version, 'content_v1')
    from public.sentences s
    join public.chapters c on c.id = s.chapter_id
    where s.id = p_sentence_id
      and public.chapter_is_readable(s.chapter_id);

  if not found then
    raise exception 'Nie znaleźliśmy tego zdania.' using errcode = 'FL404';
  end if;
end;
$$;

comment on function public.notebook_sentence_anchor(bigint) is
  'Sentence id -> (chapter, item, chapter_position, text), refusing content the caller may not read. The single privacy gate for every notebook write.';

-- ── sentence translations ────────────────────────────────────────────────────

-- Save (or replace) the learner's own Polish for one sentence.
--
-- THE EVENT FIRES ONCE, EVER. `p_evidence` carries a DETERMINISTIC event key
-- derived from the anchor, so the unique constraint on
-- `learning_events (user_id, event_key)` makes every later edit a no-op in the
-- log. Editing a translation is correcting what you already said; it is not a
-- second observation, and counting it as one would let a learner manufacture
-- history by retyping.
create or replace function public.save_sentence_translation(
  p_sentence_id bigint,
  p_translation text,
  p_evidence    jsonb
)
returns table (
  note_id     bigint,
  was_new     boolean,
  translation text,
  is_unclear  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_anchor record;
  v_text   text := nullif(btrim(coalesce(p_translation, '')), '');
  v_id     bigint;
  v_stored text;
  v_flag   boolean;
  -- WHETHER THE ROW WAS INSERTED, read from the system column rather than
  -- inferred from the timestamps. `created_at = updated_at` is also true for an
  -- update that happens in the SAME transaction as the insert — which is what a
  -- test, a batch and a retry all look like. `xmax = 0` is the upsert's own
  -- answer about what it just did, and it cannot be wrong.
  v_new    boolean;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  -- §102: whitespace is not a translation. Refused rather than stored, so the
  -- notebook never shows an entry with nothing in it.
  if v_text is null then
    raise exception 'Tłumaczenie nie może być puste.' using errcode = 'FL422';
  end if;
  if length(v_text) > 2000 then
    raise exception 'Tłumaczenie jest za długie.' using errcode = 'FL422';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  insert into public.user_sentence_notes as n (
    user_id, chapter_id, library_item_id, sentence_position, sentence_id,
    sentence_text, content_version, translation
  ) values (
    v_user, v_anchor.chapter_id, v_anchor.library_item_id,
    v_anchor.sentence_position, v_anchor.sentence_id,
    v_anchor.sentence_text, v_anchor.content_version, v_text
  )
  on conflict (user_id, chapter_id, sentence_position) do update
    set translation     = excluded.translation,
        -- Re-anchor on every write: a note taken before a reprocessing pass gets
        -- its pointer and its snapshot refreshed the next time the learner
        -- touches it, rather than drifting further from the text for ever.
        sentence_id     = excluded.sentence_id,
        sentence_text   = excluded.sentence_text,
        content_version = excluded.content_version
    returning id, translation, is_unclear, (xmax = 0)
    into v_id, v_stored, v_flag, v_new;

  perform public.apply_learning_evidence(v_user, p_evidence);

  return query select v_id, v_new, v_stored, v_flag;
end;
$$;

-- Remove the learner's translation. §13: the SENTENCE is untouched — this is a
-- note about the text, not the text. A note that also carries "nie rozumiem"
-- survives as that flag; a note that carried nothing else disappears, because a
-- row with neither a translation nor a flag says nothing.
create or replace function public.delete_sentence_translation(p_sentence_id bigint)
returns table (note_id bigint, deleted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_anchor record;
  v_note   public.user_sentence_notes%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  select * into v_note from public.user_sentence_notes n
   where n.user_id = v_user
     and n.chapter_id = v_anchor.chapter_id
     and n.sentence_position = v_anchor.sentence_position;

  if v_note.id is null then
    return query select null::bigint, false;
    return;
  end if;

  if v_note.is_unclear then
    update public.user_sentence_notes set translation = null where id = v_note.id;
    return query select v_note.id, false;
  else
    delete from public.user_sentence_notes where id = v_note.id;
    return query select v_note.id, true;
  end if;
end;
$$;

-- ── "nie rozumiem" / "już rozumiem" ──────────────────────────────────────────

-- Flag a sentence as not understood, or clear the flag.
--
-- REVERSIBLE BY CONSTRUCTION (§18). The flag is current state; the log keeps the
-- sequence. `p_evidence` carries an INTERACTION-scoped event key — one per tap,
-- not one per sentence — precisely so that marking a sentence unclear in chapter
-- three and understood a week later leaves two rows in `learning_events` and one
-- row here. A retried request replays the same key and changes nothing.
create or replace function public.set_sentence_unclear(
  p_sentence_id bigint,
  p_unclear     boolean,
  p_evidence    jsonb
)
returns table (note_id bigint, is_unclear boolean, deleted boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user   uuid := (select auth.uid());
  v_anchor record;
  v_note   public.user_sentence_notes%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  if p_unclear then
    insert into public.user_sentence_notes as n (
      user_id, chapter_id, library_item_id, sentence_position, sentence_id,
      sentence_text, content_version, is_unclear, unclear_at
    ) values (
      v_user, v_anchor.chapter_id, v_anchor.library_item_id,
      v_anchor.sentence_position, v_anchor.sentence_id,
      v_anchor.sentence_text, v_anchor.content_version, true, now()
    )
    on conflict (user_id, chapter_id, sentence_position) do update
      set is_unclear      = true,
          unclear_at      = now(),
          resolved_at     = null,
          sentence_id     = excluded.sentence_id,
          sentence_text   = excluded.sentence_text,
          content_version = excluded.content_version
      returning * into v_note;

    perform public.apply_learning_evidence(v_user, p_evidence);
    return query select v_note.id, true, false;
    return;
  end if;

  select * into v_note from public.user_sentence_notes n
   where n.user_id = v_user
     and n.chapter_id = v_anchor.chapter_id
     and n.sentence_position = v_anchor.sentence_position;

  if v_note.id is null then
    return query select null::bigint, false, false;
    return;
  end if;

  perform public.apply_learning_evidence(v_user, p_evidence);

  -- Understanding a sentence you never translated leaves nothing to keep.
  if v_note.translation is null then
    delete from public.user_sentence_notes where id = v_note.id;
    return query select v_note.id, false, true;
  else
    update public.user_sentence_notes
       set is_unclear = false, resolved_at = now()
     where id = v_note.id;
    return query select v_note.id, false, false;
  end if;
end;
$$;

-- ── word meanings and phrases ────────────────────────────────────────────────

-- Save a contextual word meaning, a personal word, or a phrase.
--
-- WHAT THE CALLER SUPPLIES AND WHAT THIS RE-DERIVES. The caller sends token
-- positions and the span's character range, computed in the Server Action from
-- the chapter's own tokenizer (`src/lib/content/tokenize.ts` — the ONE tokenizer;
-- there is not going to be a second one). This function does not believe the
-- surface: it slices the stored sentence text at the given offsets and refuses
-- the write unless the result is exactly what the caller claimed. So a forged
-- request can save a span of somebody's readable book, and cannot save a span
-- that says something the book does not.
--
-- `word_id` AND THE OCCURRENCE POINTERS ARE LOOKED UP, NEVER ACCEPTED. A learner
-- must not be able to attach their gloss to an arbitrary dictionary entry: the
-- link is whatever the content pipeline actually matched at that token, or
-- nothing at all. Nothing at all is a normal outcome — an unmatched token has no
-- `word_occurrences` row, and writing it down anyway is exactly the personal-word
-- feature (§82).
--
-- THE SPAN STAYS INSIDE ONE SENTENCE because a sentence id is a scalar argument.
-- `p_max_tokens` is passed in from `src/lib/notebook/constants.ts` rather than
-- hard-coded, so the UI and the database cannot disagree about how long a phrase
-- may be (§32).
create or replace function public.save_text_annotation(
  p_sentence_id    bigint,
  p_kind           text,
  p_start_position int,
  p_end_position   int,
  p_char_start     int,
  p_char_end       int,
  p_surface        text,
  p_meaning        text,
  p_lemma          text,
  p_max_tokens     int,
  p_evidence       jsonb
)
returns table (
  annotation_id bigint,
  was_new       boolean,
  word_id       bigint,
  surface       text,
  meaning       text,
  lemma         text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user     uuid := (select auth.uid());
  v_anchor   record;
  v_meaning  text := nullif(btrim(coalesce(p_meaning, '')), '');
  v_lemma    text := nullif(btrim(coalesce(p_lemma, '')), '');
  v_word     bigint;
  v_start_id bigint;
  v_end_id   bigint;
  v_id       bigint;
  v_stored   text;
  v_gloss    text;
  v_head     text;
  v_new      boolean;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_kind not in ('word', 'phrase') then
    raise exception 'Nieznany rodzaj notatki.' using errcode = 'FL422';
  end if;
  if p_start_position is null or p_end_position is null
     or p_start_position < 0 or p_end_position < p_start_position then
    raise exception 'Nieprawidłowy zakres zaznaczenia.' using errcode = 'FL422';
  end if;
  if p_kind = 'word' and p_start_position <> p_end_position then
    raise exception 'Notatka o słowie obejmuje jeden token.' using errcode = 'FL422';
  end if;
  if p_end_position - p_start_position + 1 > greatest(1, coalesce(p_max_tokens, 1)) then
    raise exception 'Zaznaczenie jest za długie.' using errcode = 'FL422';
  end if;
  if v_meaning is not null and length(v_meaning) > 1000 then
    raise exception 'Znaczenie jest za długie.' using errcode = 'FL422';
  end if;
  if v_lemma is not null and length(v_lemma) > 200 then
    raise exception 'Forma podstawowa jest za długa.' using errcode = 'FL422';
  end if;

  select * into v_anchor from public.notebook_sentence_anchor(p_sentence_id);

  -- THE SURFACE IS VERIFIED AGAINST THE BOOK, not trusted. `substring` is 1-based;
  -- the offsets are the pipeline's 0-based character positions.
  if p_char_start is null or p_char_end is null
     or p_char_start < 0 or p_char_end <= p_char_start
     or p_char_end > length(v_anchor.sentence_text)
     or substring(v_anchor.sentence_text from p_char_start + 1 for p_char_end - p_char_start)
        is distinct from p_surface then
    raise exception 'Zaznaczenie nie pasuje do tekstu.' using errcode = 'FL422';
  end if;

  select o.word_id, o.id into v_word, v_start_id
    from public.word_occurrences o
   where o.sentence_id = v_anchor.sentence_id and o.position = p_start_position;

  select o.id into v_end_id
    from public.word_occurrences o
   where o.sentence_id = v_anchor.sentence_id and o.position = p_end_position;

  -- A phrase is a unit of its own; pinning it to the dictionary entry of its
  -- first token would make "Angst machen" a note about *Angst* (§71).
  if p_kind = 'phrase' then
    v_word := null;
  end if;

  insert into public.user_text_annotations as a (
    user_id, kind, chapter_id, library_item_id, sentence_position, sentence_id,
    start_position, end_position, start_occurrence_id, end_occurrence_id,
    char_start, char_end, surface, sentence_text, content_version,
    word_id, lemma, meaning
  ) values (
    v_user, p_kind, v_anchor.chapter_id, v_anchor.library_item_id,
    v_anchor.sentence_position, v_anchor.sentence_id,
    p_start_position, p_end_position, v_start_id, v_end_id,
    p_char_start, p_char_end, p_surface, v_anchor.sentence_text,
    v_anchor.content_version, v_word, v_lemma, v_meaning
  )
  on conflict (user_id, chapter_id, sentence_position, start_position, end_position)
  do update set
    meaning             = coalesce(excluded.meaning, a.meaning),
    lemma               = coalesce(excluded.lemma, a.lemma),
    sentence_id         = excluded.sentence_id,
    start_occurrence_id = excluded.start_occurrence_id,
    end_occurrence_id   = excluded.end_occurrence_id,
    char_start          = excluded.char_start,
    char_end            = excluded.char_end,
    surface             = excluded.surface,
    sentence_text       = excluded.sentence_text,
    content_version     = excluded.content_version,
    word_id             = excluded.word_id
  returning id, word_id, surface, meaning, lemma, (xmax = 0)
  into v_id, v_word, v_stored, v_gloss, v_head, v_new;

  perform public.apply_learning_evidence(v_user, p_evidence);

  return query select v_id, v_new, v_word, v_stored, v_gloss, v_head;
end;
$$;

-- Correct what a note says. Ownership comes from the WHERE clause, not from a
-- claim in the payload.
create or replace function public.update_text_annotation(
  p_annotation_id bigint,
  p_meaning       text,
  p_lemma         text
)
returns table (annotation_id bigint, meaning text, lemma text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user    uuid := (select auth.uid());
  v_meaning text := nullif(btrim(coalesce(p_meaning, '')), '');
  v_lemma   text := nullif(btrim(coalesce(p_lemma, '')), '');
  v_row     public.user_text_annotations%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if v_meaning is not null and length(v_meaning) > 1000 then
    raise exception 'Znaczenie jest za długie.' using errcode = 'FL422';
  end if;
  if v_lemma is not null and length(v_lemma) > 200 then
    raise exception 'Forma podstawowa jest za długa.' using errcode = 'FL422';
  end if;

  update public.user_text_annotations
     set meaning = v_meaning, lemma = v_lemma
   where id = p_annotation_id and user_id = v_user
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Nie znaleźliśmy tej notatki.' using errcode = 'FL404';
  end if;

  return query select v_row.id, v_row.meaning, v_row.lemma;
end;
$$;

-- §41: removing a note from the notebook, never from the book.
create or replace function public.delete_text_annotation(p_annotation_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   bigint;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  delete from public.user_text_annotations
   where id = p_annotation_id and user_id = v_user
   returning id into v_id;

  return v_id is not null;
end;
$$;

-- ── the review queue ─────────────────────────────────────────────────────────

-- Put a notebook item into the review queue, or take it out.
--
-- EXPLICIT, ALWAYS (§72). Saving a translation does not schedule anything. The
-- alternative — every translated sentence becomes a card — turns the most
-- valuable reading habit Fluent has into a punishment, and the learner stops
-- translating sentences within a week.
create or replace function public.set_notebook_review(
  p_annotation_id    bigint,
  p_sentence_note_id bigint,
  p_enabled          boolean
)
returns table (review_id bigint, enabled boolean, due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row  public.user_notebook_reviews%rowtype;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if (p_annotation_id is null) = (p_sentence_note_id is null) then
    raise exception 'Wskaż dokładnie jedną notatkę.' using errcode = 'FL422';
  end if;

  -- Ownership is proved by reading the parent as this learner, never asserted.
  if p_annotation_id is not null then
    if not exists (
      select 1 from public.user_text_annotations a
      where a.id = p_annotation_id and a.user_id = v_user
    ) then
      raise exception 'Nie znaleźliśmy tej notatki.' using errcode = 'FL404';
    end if;
  else
    if not exists (
      select 1 from public.user_sentence_notes n
      where n.id = p_sentence_note_id and n.user_id = v_user
        and n.translation is not null
    ) then
      raise exception 'Nie znaleźliśmy tego tłumaczenia.' using errcode = 'FL404';
    end if;
  end if;

  if not p_enabled then
    delete from public.user_notebook_reviews r
     where r.user_id = v_user
       and r.annotation_id is not distinct from p_annotation_id
       and r.sentence_note_id is not distinct from p_sentence_note_id;
    return query select null::bigint, false, null::timestamptz;
    return;
  end if;

  select * into v_row from public.user_notebook_reviews r
   where r.user_id = v_user
     and r.annotation_id is not distinct from p_annotation_id
     and r.sentence_note_id is not distinct from p_sentence_note_id;

  if v_row.id is null then
    insert into public.user_notebook_reviews (user_id, annotation_id, sentence_note_id)
    values (v_user, p_annotation_id, p_sentence_note_id)
    returning * into v_row;
  end if;

  return query select v_row.id, true, v_row.due_at;
end;
$$;

-- Grade one notebook card.
--
-- A COPY OF `apply_review`'s CONTRACT, FOR A DIFFERENT ITEM. Same idempotency
-- (one `interaction_id` per card presentation, enforced by the unique index on
-- `review_events`, not by a JavaScript guard), same optimistic-concurrency guard
-- on the schedule it was computed from, same single transaction for the event,
-- the schedule and the learning evidence. The SM-2 numbers arrive already
-- computed by `src/lib/sm2.ts`: the database owns the transaction, the
-- application owns the arithmetic, and neither does the other's job.
--
-- WHAT MOVES KNOWLEDGE, AND WHAT DOES NOT, is decided by the caller's folded
-- payload, exactly as everywhere else — this function only commits it. The rule
-- the caller applies is the evidence map's: a contextual cloze makes the learner
-- produce the German form with nothing to pick from, so a card for a word
-- annotation LINKED to a dictionary entry is real active-vocabulary evidence
-- about that word. A phrase card is not: "Angst machen" is its own unit, and
-- crediting *Angst* for recalling it would be the transfer §71 forbids. A
-- sentence-translation card names no word at all.
create or replace function public.apply_notebook_review(
  p_user_id          uuid,
  p_interaction_id   text,
  p_annotation_id    bigint,
  p_sentence_note_id bigint,
  p_item_type        text,
  p_rating           text,
  p_mode             text,
  p_direction        text,
  p_response_ms      int,
  p_srs              jsonb,
  p_evidence         jsonb
)
returns table (
  review_event_id bigint,
  due_at          timestamptz,
  is_mastered     boolean,
  already_applied boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_existing public.review_events%rowtype;
  v_card     public.user_notebook_reviews%rowtype;
  v_before   jsonb := coalesce(p_srs -> 'before', '{}'::jsonb);
  v_after    jsonb := coalesce(p_srs -> 'after', '{}'::jsonb);
  v_event    bigint;
begin
  if p_user_id is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_interaction_id is null or length(btrim(p_interaction_id)) = 0 then
    raise exception 'Brak identyfikatora powtórki.' using errcode = 'FL422';
  end if;

  select * into v_existing from public.review_events e
   where e.user_id = p_user_id and e.interaction_id = p_interaction_id;

  -- A replay. Report what the first request decided; change nothing.
  if v_existing.id is not null then
    select * into v_card from public.user_notebook_reviews r
     where r.user_id = p_user_id
       and r.annotation_id is not distinct from p_annotation_id
       and r.sentence_note_id is not distinct from p_sentence_note_id;
    return query select v_existing.id, coalesce(v_card.due_at, v_existing.due_after),
                        coalesce(v_card.is_mastered, false), true;
    return;
  end if;

  select * into v_card from public.user_notebook_reviews r
   where r.user_id = p_user_id
     and r.annotation_id is not distinct from p_annotation_id
     and r.sentence_note_id is not distinct from p_sentence_note_id
   for update;

  if v_card.id is null then
    raise exception 'Ta notatka nie jest w powtórkach.' using errcode = 'FL404';
  end if;

  -- The caller computed the next schedule FROM a state it read a moment ago. If
  -- that state moved meanwhile (a second tab, a queued request) the arithmetic is
  -- stale and applying it would overwrite a review that already happened.
  if v_card.interval    is distinct from (v_before ->> 'interval')::int
     or v_card.repetitions is distinct from (v_before ->> 'repetitions')::int then
    raise exception 'Powtórka się zmieniła.' using errcode = 'FL423';
  end if;

  update public.user_notebook_reviews
     set interval    = (v_after ->> 'interval')::int,
         repetitions = (v_after ->> 'repetitions')::int,
         ease_factor = (v_after ->> 'ease_factor')::numeric,
         due_at      = (v_after ->> 'due_at')::timestamptz,
         is_mastered = (v_after ->> 'is_mastered')::boolean
   where id = v_card.id
   returning * into v_card;

  insert into public.review_events (
    user_id, word_id, item_type, annotation_id, sentence_note_id,
    interaction_id, rating, mode, direction,
    repetitions_before, interval_before, ease_before, due_before,
    repetitions_after, interval_after, ease_after, due_after,
    response_ms, source_kind
  ) values (
    p_user_id, null, p_item_type, p_annotation_id, p_sentence_note_id,
    p_interaction_id, p_rating, p_mode, p_direction,
    (v_before ->> 'repetitions')::int, (v_before ->> 'interval')::int,
    (v_before ->> 'ease_factor')::numeric, (v_before ->> 'due_at')::timestamptz,
    v_card.repetitions, v_card.interval, v_card.ease_factor, v_card.due_at,
    p_response_ms, 'notebook'
  )
  returning id into v_event;

  perform public.apply_learning_evidence(p_user_id, p_evidence);

  return query select v_event, v_card.due_at, v_card.is_mastered, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. EXECUTE GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Narrow on purpose. Everything a learner does to their own notebook derives the
-- learner from `auth.uid()` and is therefore safe to grant to `authenticated`.
-- `apply_notebook_review` is the one exception: it takes `p_user_id`, exactly
-- like `apply_review` and `apply_reading_lookup`, because the Server Action has
-- already established the user from the cookie-bound client and folded the
-- knowledge payload. A browser that could call it could grade somebody else's
-- card, so it is service_role only.
revoke all on function public.notebook_sentence_anchor(bigint) from public;
revoke all on function public.save_sentence_translation(bigint, text, jsonb) from public;
revoke all on function public.delete_sentence_translation(bigint) from public;
revoke all on function public.set_sentence_unclear(bigint, boolean, jsonb) from public;
revoke all on function public.save_text_annotation(bigint, text, int, int, int, int, text, text, text, int, jsonb) from public;
revoke all on function public.update_text_annotation(bigint, text, text) from public;
revoke all on function public.delete_text_annotation(bigint) from public;
revoke all on function public.set_notebook_review(bigint, bigint, boolean) from public;
revoke all on function public.apply_notebook_review(uuid, text, bigint, bigint, text, text, text, text, int, jsonb, jsonb) from public;

grant execute on function public.save_sentence_translation(bigint, text, jsonb)   to authenticated;
grant execute on function public.delete_sentence_translation(bigint)              to authenticated;
grant execute on function public.set_sentence_unclear(bigint, boolean, jsonb)     to authenticated;
grant execute on function public.save_text_annotation(bigint, text, int, int, int, int, text, text, text, int, jsonb) to authenticated;
grant execute on function public.update_text_annotation(bigint, text, text)       to authenticated;
grant execute on function public.delete_text_annotation(bigint)                   to authenticated;
grant execute on function public.set_notebook_review(bigint, bigint, boolean)     to authenticated;

grant execute on function public.apply_notebook_review(uuid, text, bigint, bigint, text, text, text, text, int, jsonb, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- READ YOUR OWN, WRITE NOTHING — the rule every learner-owned table in Fluent
-- has followed since Phase 1, and the answer to §8 and §107: two learners
-- reading the same public book each see their own notes and nothing of each
-- other's. There is no admin exception, because a personal notebook is not
-- content.
--
-- No INSERT, UPDATE or DELETE policy exists on any of these tables. Every write
-- goes through a SECURITY DEFINER function above, which is what makes
-- `user_id`, the anchor columns and the snapshots unforgeable: a client cannot
-- claim a sentence it may not read, cannot claim a surface the book does not
-- contain, and cannot attach its gloss to an arbitrary dictionary entry.
alter table public.user_sentence_notes    enable row level security;
alter table public.user_text_annotations  enable row level security;
alter table public.user_notebook_reviews  enable row level security;

drop policy if exists "own sentence notes read" on public.user_sentence_notes;
create policy "own sentence notes read" on public.user_sentence_notes
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own text annotations read" on public.user_text_annotations;
create policy "own text annotations read" on public.user_text_annotations
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own notebook reviews read" on public.user_notebook_reviews;
create policy "own notebook reviews read" on public.user_notebook_reviews
  for select using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. THE NOTEBOOK'S READ SURFACE.
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE QUERY, NOT FIFTY-ONE (§146). The notebook shows a mixed list — words,
-- phrases, translations, unclear sentences — and each entry needs its book and
-- chapter to say "Gra o tron · Prolog". Fetched from the two annotation tables
-- and then joined per row in JavaScript, a page of 25 entries is 26 round trips
-- and the number grows with the page. This view is the join, done once, in the
-- database, over indexes that already exist.
--
-- `security_invoker` IS THE WHOLE SECURITY STORY. The view runs as the caller, so
-- the `own …` policies on the underlying tables apply exactly as they would to a
-- direct select: a learner sees their own notes and no one else's, and the
-- `library_items` / `chapters` joins are filtered by `library_item_readable` —
-- so even the book TITLE of somebody else's private import is unreachable
-- through here. Without `security_invoker` a view runs as its owner and would
-- have handed every learner every other learner's notebook.
--
-- ONE ROW PER NOTE, NOT ONE PER FEATURE. A sentence that is both translated and
-- flagged unclear is one thing the learner did, so it is one entry carrying two
-- booleans, and the tabs filter on those. Emitting it twice would double-count it
-- in every summary.
create or replace view public.notebook_entries
with (security_invoker = on) as
  select
    a.kind::text                as entry_type,
    a.id                        as entry_id,
    a.user_id,
    a.library_item_id,
    i.slug                      as item_slug,
    i.title                     as item_title,
    a.chapter_id,
    c.position                  as chapter_position,
    c.title                     as chapter_title,
    a.sentence_position,
    a.sentence_id,
    a.start_position,
    a.end_position,
    a.surface,
    a.lemma,
    a.word_id,
    a.meaning,
    a.sentence_text,
    a.char_start,
    a.char_end,
    a.content_version,
    false                       as is_unclear,
    false                       as has_translation,
    (r.id is not null)          as in_review,
    a.created_at,
    a.updated_at
  from public.user_text_annotations a
  join public.library_items i on i.id = a.library_item_id
  join public.chapters c      on c.id = a.chapter_id
  left join public.user_notebook_reviews r on r.annotation_id = a.id

  union all

  select
    'sentence'                  as entry_type,
    n.id                        as entry_id,
    n.user_id,
    n.library_item_id,
    i.slug                      as item_slug,
    i.title                     as item_title,
    n.chapter_id,
    c.position                  as chapter_position,
    c.title                     as chapter_title,
    n.sentence_position,
    n.sentence_id,
    null::int                   as start_position,
    null::int                   as end_position,
    null::text                  as surface,
    null::text                  as lemma,
    null::bigint                as word_id,
    n.translation               as meaning,
    n.sentence_text,
    null::int                   as char_start,
    null::int                   as char_end,
    n.content_version,
    n.is_unclear,
    (n.translation is not null) as has_translation,
    (r.id is not null)          as in_review,
    n.created_at,
    n.updated_at
  from public.user_sentence_notes n
  join public.library_items i on i.id = n.library_item_id
  join public.chapters c      on c.id = n.chapter_id
  left join public.user_notebook_reviews r on r.sentence_note_id = n.id;

comment on view public.notebook_entries is
  'Every personal note of the calling learner, with its book and chapter, as one list. security_invoker so the underlying own-row policies decide what is visible.';

grant select on public.notebook_entries to authenticated;
