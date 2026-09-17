-- Fluent — Phase 5.7: deleting a book must not scan the whole database.
--
-- THE BUG THIS FIXES. "Usuń książkę" on a real private import failed with
-- `database_error` — the taxonomy's generic "Coś poszło nie tak" — and it failed
-- reproducibly, on the books that most needed deleting. Nothing was wrong with
-- the permission model, the cascade shape or the function: the delete simply
-- could not finish inside the 8-second statement budget PostgREST gives
-- `authenticated`, so Postgres cancelled it and the learner was told to try
-- again later, forever.
--
-- WHY. `delete_private_library_item` deletes one row. Everything else goes by
-- referential action:
--
--     library_items ─╴cascade╶─▶ chapters ─╴cascade╶─▶ paragraphs
--                                                  └─▶ sentences
--                                                        └─▶ word_occurrences
--
-- and every one of those child rows carries its own referential actions OUT to
-- the tables that merely POINT at content — `learning_events`, `saved_words`,
-- `reading_lookups`, `user_text_annotations`, `user_sentence_notes` — all of
-- which are `on delete set null`, because a learner's history must survive the
-- book it was made in.
--
-- Postgres implements those actions with a per-row trigger. Deleting one
-- `word_occurrences` row runs, once per referencing column:
--
--     update <child> set <fk> = null where <fk> = $1
--
-- If `<fk>` has no index, that statement is a sequential scan. A short chapter
-- has a few hundred occurrences; a 175-chapter book has tens of thousands; five
-- referencing columns turn that into hundreds of thousands of sequential scans
-- over the learner's entire history, and the whole thing is one statement, so
-- there is no partial progress to keep. It times out and rolls back.
--
-- The same arithmetic applies to `replace_chapter_content`, which deletes a
-- chapter's paragraphs wholesale before reinserting them — which is to say
-- "Odśwież słownictwo" on the same screen was walking towards the identical
-- wall from the other direction.
--
-- WHAT THIS MIGRATION DOES. Nothing but indexes. Every foreign key that points
-- INTO the content graph gets a btree with that column leading, so each of those
-- per-row referential statements is an index probe against nothing instead of a
-- table scan. The fix is boring on purpose: no function changes, no new
-- behaviour, no state machine, and no SQL that could be wrong about the domain.
--
-- WHY THEY WERE MISSING. Postgres indexes the REFERENCED side of a foreign key
-- automatically (it must, to enforce uniqueness) and the REFERENCING side never.
-- Every one of these columns was added to answer a read — "this learner's events
-- for this chapter", "this learner's notes in this book" — and every one of
-- those reads leads with `user_id`, which is the right index for the read and
-- useless to a referential check that knows only the content id. Both indexes
-- are needed, for different questions.
--
-- Partial (`where … is not null`) wherever the column is nullable: the
-- referential statement always searches for a concrete id, so the planner can
-- use the partial index, and a column that is null on the overwhelming majority
-- of rows — `learning_events.chapter_id` is null for every test answer ever
-- recorded — should not pay for an entry on each of them.
--
-- Safe to re-run, and safe on a live database: these are `if not exists`, they
-- add no constraint and drop nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE EVIDENCE LOG AND THE VOCABULARY IT PRODUCED.
-- ─────────────────────────────────────────────────────────────────────────────
-- The two biggest tables a learner owns, and the two that point at the finest
-- grain of content — an occurrence is one token in one sentence, so these are
-- the columns that turn a book deletion from slow into impossible.
create index if not exists learning_events_library_item_fk_idx
  on public.learning_events (library_item_id) where library_item_id is not null;
create index if not exists learning_events_chapter_fk_idx
  on public.learning_events (chapter_id) where chapter_id is not null;
create index if not exists learning_events_sentence_fk_idx
  on public.learning_events (sentence_id) where sentence_id is not null;
create index if not exists learning_events_occurrence_fk_idx
  on public.learning_events (word_occurrence_id) where word_occurrence_id is not null;
create index if not exists learning_events_reading_session_fk_idx
  on public.learning_events (reading_session_id) where reading_session_id is not null;

create index if not exists saved_words_origin_item_fk_idx
  on public.saved_words (origin_library_item_id) where origin_library_item_id is not null;
create index if not exists saved_words_origin_chapter_fk_idx
  on public.saved_words (origin_chapter_id) where origin_chapter_id is not null;
create index if not exists saved_words_origin_sentence_fk_idx
  on public.saved_words (origin_sentence_id) where origin_sentence_id is not null;
create index if not exists saved_words_origin_occurrence_fk_idx
  on public.saved_words (origin_occurrence_id) where origin_occurrence_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE READER'S OWN TABLES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Progress and sessions cascade from both ends — the chapter and the book — and
-- every existing index on them leads with `user_id` (or IS the `(user_id,
-- chapter_id)` primary key), which a referential check cannot use.
create index if not exists reading_progress_chapter_fk_idx
  on public.reading_progress (chapter_id);
create index if not exists reading_progress_item_fk_idx
  on public.reading_progress (library_item_id);

create index if not exists reading_sessions_chapter_fk_idx
  on public.reading_sessions (chapter_id);
create index if not exists reading_sessions_item_fk_idx
  on public.reading_sessions (library_item_id);

create index if not exists reading_lookups_chapter_fk_idx
  on public.reading_lookups (chapter_id);
create index if not exists reading_lookups_item_fk_idx
  on public.reading_lookups (library_item_id);
create index if not exists reading_lookups_sentence_fk_idx
  on public.reading_lookups (sentence_id) where sentence_id is not null;
create index if not exists reading_lookups_occurrence_fk_idx
  on public.reading_lookups (occurrence_id) where occurrence_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE STORY ENGINE.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists user_chapter_learning_state_chapter_fk_idx
  on public.user_chapter_learning_state (chapter_id);
create index if not exists user_chapter_learning_state_item_fk_idx
  on public.user_chapter_learning_state (library_item_id);

create index if not exists chapter_user_analysis_chapter_fk_idx
  on public.chapter_user_analysis (chapter_id);
create index if not exists chapter_user_analysis_item_fk_idx
  on public.chapter_user_analysis (library_item_id);

create index if not exists chapter_questions_item_fk_idx
  on public.chapter_questions (library_item_id);

create index if not exists chapter_preparation_sessions_chapter_fk_idx
  on public.chapter_preparation_sessions (chapter_id);
create index if not exists chapter_preparation_sessions_item_fk_idx
  on public.chapter_preparation_sessions (library_item_id);
create index if not exists chapter_preparation_items_sentence_fk_idx
  on public.chapter_preparation_items (sentence_id) where sentence_id is not null;

create index if not exists chapter_assessment_sessions_chapter_fk_idx
  on public.chapter_assessment_sessions (chapter_id);
create index if not exists chapter_assessment_sessions_item_fk_idx
  on public.chapter_assessment_sessions (library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE NOTEBOOK.
-- ─────────────────────────────────────────────────────────────────────────────
-- Notes are anchored on `(chapter_id, sentence_position)` and keep `sentence_id`
-- and the occurrence ids as nullable POINTERS, by design — which is exactly the
-- shape whose referential upkeep this migration is paying for.
create index if not exists user_sentence_notes_chapter_fk_idx
  on public.user_sentence_notes (chapter_id);
create index if not exists user_sentence_notes_item_fk_idx
  on public.user_sentence_notes (library_item_id);
create index if not exists user_sentence_notes_sentence_fk_idx
  on public.user_sentence_notes (sentence_id) where sentence_id is not null;

create index if not exists user_text_annotations_chapter_fk_idx
  on public.user_text_annotations (chapter_id);
create index if not exists user_text_annotations_item_fk_idx
  on public.user_text_annotations (library_item_id);
create index if not exists user_text_annotations_sentence_fk_idx
  on public.user_text_annotations (sentence_id) where sentence_id is not null;
create index if not exists user_text_annotations_start_occurrence_fk_idx
  on public.user_text_annotations (start_occurrence_id) where start_occurrence_id is not null;
create index if not exists user_text_annotations_end_occurrence_fk_idx
  on public.user_text_annotations (end_occurrence_id) where end_occurrence_id is not null;

-- A notebook card cascades from the note it belongs to, and a book deletion
-- deletes notes in bulk — so this is the same per-row cost one level further
-- out. `review_events_user_annotation_idx` leads with `user_id` and answers the
-- review screen's question, not this one.
create index if not exists review_events_annotation_fk_idx
  on public.review_events (annotation_id) where annotation_id is not null;
create index if not exists review_events_sentence_note_fk_idx
  on public.review_events (sentence_note_id) where sentence_note_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE PLANNER AND THE IMPORTER.
-- ─────────────────────────────────────────────────────────────────────────────
-- `daily_plan_items.chapter_id` was already indexed; its book was not.
create index if not exists daily_plan_items_item_fk_idx
  on public.daily_plan_items (library_item_id) where library_item_id is not null;

-- `delete_private_library_item` reads `book_imports` by exactly this column to
-- collect the Storage paths, and then deletes by it. Both were sequential scans.
create index if not exists book_imports_final_item_fk_idx
  on public.book_imports (final_library_item_id) where final_library_item_id is not null;
create index if not exists book_import_chapters_chapter_fk_idx
  on public.book_import_chapters (chapter_id) where chapter_id is not null;
