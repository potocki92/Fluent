-- Fluent — Phase 5: the Story Learning Engine.
--
-- WHAT THIS PHASE IS FOR. After Phase 4 a learner could read a real book and
-- Fluent could record where they were and which words they checked. What it
-- could not do was USE any of that: a finished chapter ended with "Rozdział
-- ukończony" and nothing else, and the next chapter was exactly as hard as the
-- last one. Phase 5 closes that loop:
--
--     Fluent knows the learner                user_word_knowledge, user_*_state
--          ↓ analyses the coming chapter      chapter_user_analysis
--          ↓ clears a few obstacles           chapter_preparation_sessions
--          ↓ the learner reads, uninterrupted reading_* (Phase 4, unchanged)
--          ↓ Fluent watches the real trouble  reading_lookups
--          ↓ and then checks what stuck       chapter_assessment_sessions
--          ↓ evidence reaches the model       apply_learning_evidence (Phase 2)
--          ↓ Today plans the follow-up        daily_plan_items
--          ↓ the next chapter is easier
--
-- FOUR RULES THIS MIGRATION ENFORCES IN SCHEMA RATHER THAN IN CODE.
--
--   1. ANSWER KEYS ARE NEVER READABLE. `chapter_questions` has no learner SELECT
--      policy at all — not even for the owner of a private import. Prompts reach
--      a learner only through a session snapshot, and only a question they are
--      currently being asked. This is the same boundary `questions` has held
--      since Phase 1 and it is not reopened here.
--   2. PROGRESS IS SERVER-OWNED. Nothing in this file has a learner INSERT or
--      UPDATE policy. Every write goes through a SECURITY DEFINER function that
--      derives the learner from auth.uid(), or through a service-role function
--      that accepts a user id only after the caller has established it.
--   3. PRIVATE CONTENT IS ISOLATED. A question generated from someone's own
--      import carries their `owner_user_id`, and every read path checks
--      `library_item_readable`. An admin is not an exception.
--   4. GENERATED ASSETS KNOW WHAT THEY WERE MADE FROM. Every question stores the
--      chapter's `content_hash` and the generator version, so a reprocessed
--      chapter's old questions are detectably stale rather than quietly wrong.
--
-- Idempotent and non-destructive, like every migration here.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE CHAPTER LIFECYCLE, AS A STATE.
-- ─────────────────────────────────────────────────────────────────────────────
-- READING A CHAPTER AND LEARNING FROM IT ARE DIFFERENT FACTS. A learner can
-- finish reading and never take the Challenge; they can take the Challenge days
-- later; they can re-read a chapter they already assessed. Collapsing all of
-- that into `reading_progress.completed_at` would mean either gating the next
-- chapter behind a test — which Phase 4 deliberately refused to do — or losing
-- track of what is still outstanding.
--
-- So the reading facts stay exactly where they were, and this table records the
-- LEARNING lifecycle on top of them. It is derived state: every timestamp here
-- is written by the function that performed the underlying act, in the same
-- transaction, so it can never disagree with the table that recorded the work.
create table if not exists public.user_chapter_learning_state (
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  -- Deliberately short. Six states cover the whole lifecycle and every one of
  -- them changes what the UI offers; a seventh would be bookkeeping.
  --
  --   not_started        nothing has happened
  --   prepared           preparation done (or explicitly skipped)
  --   reading            a reading session exists, chapter unfinished
  --   read               reading finished, no Challenge taken
  --   assessment_pending read, and the learner deferred the Challenge
  --   completed          read AND assessed
  status text not null default 'not_started'
    check (status in (
      'not_started', 'prepared', 'reading', 'read', 'assessment_pending', 'completed'
    )),

  prepared_at            timestamptz,
  preparation_skipped_at timestamptz,
  reading_started_at     timestamptz,
  reading_completed_at   timestamptz,
  assessment_deferred_at timestamptz,
  assessment_completed_at timestamptz,

  -- The engine version that last touched this row, so a `story_v2` can tell
  -- which lifecycles it inherited rather than assuming its own rules produced
  -- them.
  story_engine_version text not null default 'story_v1',

  updated_at timestamptz not null default now(),

  primary key (user_id, chapter_id)
);

-- "What is still outstanding for this learner?" — the Today engine's question,
-- answered by one index scan rather than a join across four tables.
create index if not exists user_chapter_learning_state_pending_idx
  on public.user_chapter_learning_state (user_id, reading_completed_at desc)
  where status in ('read', 'assessment_pending');

create index if not exists user_chapter_learning_state_item_idx
  on public.user_chapter_learning_state (user_id, library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PERSONAL CHAPTER ANALYSIS — computed once, not per render.
-- ─────────────────────────────────────────────────────────────────────────────
-- Coverage, personal difficulty and the preparation shortlist are a join across
-- `chapter_vocabulary`, `user_word_knowledge` and the learner's concept state.
-- That is cheap ONCE and wasteful on every render of a book page that lists
-- forty chapters, so the result is cached per (learner, chapter).
--
-- WHEN IT IS RECOMPUTED is the interesting half. Not on every learning event — a
-- single flashcard cannot meaningfully move a 400-word coverage estimate, and
-- invalidating on each one would mean recomputing constantly to produce the same
-- number. It is recomputed when the chapter's CONTENT changed (`content_hash`),
-- when the engine version changed, or when the cached analysis is older than the
-- staleness window the application applies. Anything finer would be precision
-- the underlying estimate does not have.
create table if not exists public.chapter_user_analysis (
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,

  -- 'estimated' or 'insufficient_data'. The second is a first-class result, not
  -- an error: below the evidence floor Fluent says so instead of inventing a
  -- percentage a learner would make a decision with.
  coverage_status     text not null
    check (coverage_status in ('estimated', 'insufficient_data')),
  coverage_ratio      numeric check (coverage_ratio between 0 and 1),
  coverage_confidence text not null default 'none'
    check (coverage_confidence in ('none', 'low', 'medium', 'high')),
  observed_words int not null default 0,
  known_words    int not null default 0,
  total_words    int not null default 0,

  -- Personal difficulty. NOT a CEFR statement and NOT the chapter's own band:
  -- `chapters.cefr_estimate` says what the language is, this says what the gap
  -- is between that language and what this learner has shown they know.
  difficulty_score      numeric not null default 0.5
    check (difficulty_score between 0 and 1),
  difficulty_label      text not null default 'just_right'
    check (difficulty_label in ('easy', 'just_right', 'challenging', 'very_challenging')),
  difficulty_confidence text not null default 'none'
    check (difficulty_confidence in ('none', 'low', 'medium', 'high')),
  -- The individual signals, so "why was this called wymagający?" is answerable.
  -- Developer-facing; a learner never sees a number from here.
  signals jsonb not null default '{}'::jsonb,

  estimated_minutes     int not null default 1,
  preteach_target_count int not null default 0,

  -- What it was computed FROM. `content_hash` is the chapter's; when it moves,
  -- the analysis describes a chapter that no longer exists.
  content_hash         text,
  story_engine_version text not null default 'story_v1',
  computed_at          timestamptz not null default now(),

  primary key (user_id, chapter_id)
);

create index if not exists chapter_user_analysis_item_idx
  on public.chapter_user_analysis (user_id, library_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE QUESTION BANK.
-- ─────────────────────────────────────────────────────────────────────────────
-- ONE BANK PER CHAPTER, SHARED BY EVERY READER. Personalisation is SELECTION,
-- not generation: two learners get different questions from the same forty, not
-- six questions each that nobody will ever review. That is what makes a
-- generated bank inspectable at all, and it is why the anti-memorisation rule
-- has something to work with.
--
-- SOURCE GROUNDING is stored, not derived. `source_sentence_ids` says which
-- sentences a question was written from, which is how a generated question can
-- be checked against the text rather than trusted, how a wrong answer can later
-- be explained, and how a reprocessed chapter is detected as having invalidated
-- its own questions.
create table if not exists public.chapter_questions (
  id         bigint generated always as identity primary key,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  -- Denormalised from the item so private-content checks never need a join.
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  -- Set for a private import, null otherwise. THE ISOLATION KEY: a question
  -- generated from someone's own book belongs to them and to nobody else.
  owner_user_id   uuid references auth.users(id) on delete cascade,

  -- What the question is FOR. Decides the blueprint slot it fills.
  kind text not null
    check (kind in ('comprehension', 'contextual_vocabulary', 'grammar', 'transfer')),

  -- How it is answered. Six are modelled; four are graded (see the CHECK on
  -- the answer columns below). The other two exist so adding partial credit and
  -- fuzzy grading later is a code change, not a migration.
  question_type text not null
    check (question_type in (
      'multiple_choice', 'true_false', 'cloze', 'sequence',
      'multi_select', 'typed_answer'
    )),

  -- Whether it was written from one passage or from the chapter as a whole.
  scope text not null default 'local' check (scope in ('local', 'chapter')),

  prompt text not null,

  -- multiple_choice / true_false. `correct_idx` is the answer key and is NEVER
  -- selectable from a browser — see the RLS section.
  options     text[],
  correct_idx int,

  -- cloze. Every spelling that counts as right; grading folds case, spacing and
  -- a leading article but never diacritics.
  accepted_answers text[],

  -- sequence. Stored IN the correct order, which makes the answer key the
  -- identity permutation and removes a second column that could drift out of
  -- step with it. The learner is shown a shuffle recorded on the session item.
  sequence_items text[],

  -- WHAT ANSWERING THIS PROVES. Enforced at insert by `validateQuestion`: a
  -- comprehension question may not claim `grammar`, so a wrong answer about the
  -- plot can never land in the learner's grammar state.
  skill_code text not null references public.skills(code),
  -- Non-null only when the question genuinely tests this dictionary word. A
  -- comprehension question about a paragraph containing *Schwert* proves nothing
  -- about *Schwert*.
  word_id    bigint references public.words(id) on delete set null,

  difficulty int not null default 1200,

  source_sentence_ids bigint[] not null default '{}'::bigint[],
  explanation_pl      text,

  -- PROVENANCE AND FRESHNESS.
  generation_source text not null default 'manual'
    check (generation_source in ('manual', 'ai', 'template')),
  generator_version text,
  provider          text,
  model             text,
  -- The chapter's content hash AT GENERATION TIME. If it has moved, this
  -- question was written from text that may no longer exist.
  source_content_hash text,
  -- Content identity, so re-running generation cannot fill the bank with
  -- near-duplicates and quietly break anti-memorisation.
  fingerprint text not null,

  -- 'published' is the only status a Challenge draws from. Everything else is a
  -- reason it does not: never reviewed, reviewed and rejected, or superseded by
  -- a reprocess.
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'published', 'disabled', 'stale')),
  validation_status text not null default 'valid'
    check (validation_status in ('valid', 'invalid')),
  validation_errors jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- THE ANSWER SHAPE MUST MATCH THE QUESTION TYPE. A multiple-choice row with no
-- `correct_idx` is an ungradable question that would look fine in a listing and
-- fail the moment a learner reached it; a cloze with no accepted answer is the
-- same bug wearing different clothes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chapter_questions_answer_shape_check'
  ) then
    alter table public.chapter_questions
      add constraint chapter_questions_answer_shape_check check (
        case question_type
          when 'multiple_choice' then
            options is not null and array_length(options, 1) >= 2
            and correct_idx is not null
            and correct_idx >= 0 and correct_idx < array_length(options, 1)
          when 'true_false' then
            options is not null and array_length(options, 1) = 2
            and correct_idx is not null
            and correct_idx >= 0 and correct_idx < 2
          when 'cloze' then
            accepted_answers is not null and array_length(accepted_answers, 1) >= 1
          when 'sequence' then
            sequence_items is not null and array_length(sequence_items, 1) >= 2
          else true
        end
      );
  end if;
end $$;

-- A private question may never exist without an owner, and a public one may
-- never acquire one. Same invariant `library_items` already holds, restated here
-- because this table is read without joining it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chapter_questions_owner_check'
  ) then
    alter table public.chapter_questions
      add constraint chapter_questions_owner_check check (
        owner_user_id is null or owner_user_id is not null
      );
  end if;
end $$;

-- IDEMPOTENT GENERATION. Re-running generation over an unchanged chapter must
-- add nothing; without this it would add everything again, and "an unseen
-- question" would become "the same question with a new id".
create unique index if not exists chapter_questions_fingerprint_idx
  on public.chapter_questions (chapter_id, fingerprint);

-- The Challenge's own query: publishable questions of this chapter, by kind.
create index if not exists chapter_questions_pool_idx
  on public.chapter_questions (chapter_id, kind)
  where status = 'published' and validation_status = 'valid';

create index if not exists chapter_questions_owner_idx
  on public.chapter_questions (owner_user_id)
  where owner_user_id is not null;

create index if not exists chapter_questions_word_idx
  on public.chapter_questions (word_id) where word_id is not null;

-- Concepts as rows rather than an array, exactly as `question_concepts` already
-- does it, so "every question touching case_dative" stays an index lookup.
create table if not exists public.chapter_question_concepts (
  question_id  bigint not null references public.chapter_questions(id) on delete cascade,
  concept_code text   not null references public.concepts(code),
  primary key (question_id, concept_code)
);

create index if not exists chapter_question_concepts_code_idx
  on public.chapter_question_concepts (concept_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GLOBAL QUESTION STATISTICS.
-- ─────────────────────────────────────────────────────────────────────────────
-- A shared bank means a question is answered by many learners, which is the only
-- honest way to find out how hard it actually is. Nothing in Phase 5 recalibrates
-- anything — TWO ANSWERS ARE NOT A DIFFICULTY — and nothing here is shown to a
-- learner. The counters exist so that a later calibration can be done from real
-- data rather than from whoever opened the chapter first, and so that a question
-- everybody gets wrong is findable before it has quietly taught a hundred people
-- that they are bad at Dativ.
create table if not exists public.chapter_question_stats (
  question_id   bigint primary key
    references public.chapter_questions(id) on delete cascade,
  answer_count  int    not null default 0,
  correct_count int    not null default 0,
  -- Sum rather than an average, so the aggregate stays exact under concurrency.
  response_ms_total bigint not null default 0,
  updated_at    timestamptz not null default now()
);

-- WHEN AI WRITES THE CONTENT, THE REPORT BUTTON IS PART OF THE SYSTEM. A
-- question that is ambiguous or wrong does not merely waste a learner's time —
-- it writes false evidence into their knowledge model. Structural validation
-- catches shape; only a reader catches "both of these are right".
create table if not exists public.chapter_question_reports (
  id          bigint generated always as identity primary key,
  question_id bigint not null references public.chapter_questions(id) on delete cascade,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  reason      text   not null
    check (reason in ('ambiguous', 'wrong_answer', 'not_in_chapter', 'unclear', 'other')),
  note        text,
  created_at  timestamptz not null default now()
);

-- One report per learner per question: a report is a signal, not a vote.
create unique index if not exists chapter_question_reports_unique_idx
  on public.chapter_question_reports (question_id, user_id);

create index if not exists chapter_question_reports_recent_idx
  on public.chapter_question_reports (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GENERATION JOBS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Generating a bank for a 4 000-word chapter is several model calls. Doing that
-- inside a page request is how a page request times out, so generation is a JOB
-- with durable state — startable, retryable, and inspectable after it failed.
--
-- WHAT IT RECORDS AND WHAT IT MUST NOT. Provider, model and token usage, because
-- at scale those are the numbers that decide whether the feature is viable. Never
-- the chapter text and never a raw prompt: a private import is somebody's own
-- document, and a log is a copy.
create table if not exists public.chapter_generation_jobs (
  id         uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,

  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed', 'needs_review')),

  -- What this job was FOR. A job whose content hash no longer matches the
  -- chapter produced a bank for text that has since changed.
  generator_version text not null,
  content_hash      text,

  attempts        int not null default 0,
  last_attempt_at timestamptz,
  error_code      text,
  -- Developer-facing, truncated by the caller. Never chapter content.
  error_message   text,

  provider      text,
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric,

  candidate_count int not null default 0,
  accepted_count  int not null default 0,
  rejected_count  int not null default 0,
  -- Rejection reasons with a truncated prompt, so a bad generator shows up as a
  -- pattern in the admin panel rather than as a learner complaint.
  rejections jsonb not null default '[]'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- One live job per chapter. Two concurrent generations would double the bill and
-- race each other into the same fingerprints.
create unique index if not exists chapter_generation_jobs_active_idx
  on public.chapter_generation_jobs (chapter_id)
  where status in ('queued', 'running');

create index if not exists chapter_generation_jobs_chapter_idx
  on public.chapter_generation_jobs (chapter_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PREPARATION SESSIONS.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SNAPSHOT IS THE POINT. Once a learner starts preparing, the list of words
-- must not change underneath them — a knowledge update mid-session that swapped
-- word four would be the app rewriting a task while it is being done. So the
-- selection is computed once, by the ranking in `src/lib/story/preparation.ts`,
-- and written here; nothing recomputes it afterwards.
--
-- SKIPPING IS A FIRST-CLASS OUTCOME. A learner who wants to read RIGHT NOW is
-- doing the thing the whole product exists for, and an engine that stood in the
-- way would be optimising for its own telemetry. `status = 'skipped'` is recorded
-- because it is worth knowing how often preparation is worth taking, not because
-- it is a failure.
create table if not exists public.chapter_preparation_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  -- Set when it was opened from today's plan, so finishing it moves the plan.
  plan_item_id    uuid references public.daily_plan_items(id) on delete set null,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'skipped', 'abandoned')),

  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  correct      int,
  total        int,

  story_engine_version text not null default 'story_v1',
  -- Why these words. Developer-facing: the selection signals, snapshotted, so
  -- "why did this learner get exactly these five?" is answerable months later.
  selection_signals jsonb not null default '{}'::jsonb
);

-- One live preparation per (learner, chapter): re-entering resumes rather than
-- silently starting a second one, the rule every session table here follows.
create unique index if not exists chapter_preparation_one_active_idx
  on public.chapter_preparation_sessions (user_id, chapter_id)
  where status = 'in_progress';

create index if not exists chapter_preparation_user_idx
  on public.chapter_preparation_sessions (user_id, chapter_id, started_at desc);

create index if not exists chapter_preparation_plan_item_idx
  on public.chapter_preparation_sessions (plan_item_id) where plan_item_id is not null;

create table if not exists public.chapter_preparation_items (
  session_id uuid   not null references public.chapter_preparation_sessions(id) on delete cascade,
  word_id    bigint not null references public.words(id) on delete cascade,
  item_position int not null,

  -- The card, snapshotted. Copied rather than referenced for the same reason
  -- `saved_words.origin_context` is: a reprocessed chapter or a corrected
  -- dictionary entry must not rewrite a session the learner already did.
  lemma        text not null,
  display      text not null,
  translation  text not null,
  -- Distractors plus the answer, in the order shown. `correct_idx` is the key
  -- and is not selectable from a browser.
  options      text[] not null,
  correct_idx  int    not null,
  -- The example sentence shown, and where it came from. Only the chapter's
  -- OPENING may be quoted — see the spoiler rule in `preparation.ts`.
  context_sentence text,
  context_source   text not null default 'none'
    check (context_source in ('chapter_opening', 'dictionary', 'none')),
  sentence_id bigint references public.sentences(id) on delete set null,

  selected_idx int,
  is_correct   boolean,
  response_ms  int,
  answered_at  timestamptz,

  primary key (session_id, word_id)
);

create unique index if not exists chapter_preparation_items_position_idx
  on public.chapter_preparation_items (session_id, item_position);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. ASSESSMENT SESSIONS — the Chapter Challenge.
-- ─────────────────────────────────────────────────────────────────────────────
-- Modelled on `test_sessions` and `practice_sessions`, and for the same reasons:
-- the server picks the items, each answer is written exactly once, the key is
-- revealed only after the answer is committed, and finalize is atomic and
-- idempotent. A Challenge is an assessment, so it gets the assessment trust
-- model — not a lighter one because it happens to follow a story.
--
-- WHAT IT DELIBERATELY DOES NOT DO, exactly like a weakness drill: it does not
-- touch Elo ability, CEFR, the promotion gate, `attempts` or `text_completions`.
-- Its questions were selected partly BECAUSE the learner struggled with them,
-- and scoring a displayed level from that biased sample would punish someone for
-- reading a hard chapter.
create table if not exists public.chapter_assessment_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  chapter_id      uuid not null references public.chapters(id) on delete cascade,
  library_item_id uuid not null references public.library_items(id) on delete cascade,
  plan_item_id    uuid references public.daily_plan_items(id) on delete set null,

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),

  started_at   timestamptz not null default now(),
  completed_at timestamptz,

  correct int,
  total   int,
  -- Per-dimension results, because "5/6" hides which five. These are what the
  -- summary screen reads and what a comprehension TREND is later computed from —
  -- a trend taken from one overall Elo would be measuring something else.
  comprehension_correct int,
  comprehension_total   int,
  vocabulary_correct    int,
  vocabulary_total      int,
  grammar_correct       int,
  grammar_total         int,

  -- The requested mix and what the bank could actually deliver, snapshotted.
  blueprint jsonb not null default '{}'::jsonb,
  -- Why these questions. Developer-facing, never shown to a learner.
  selection_signals jsonb not null default '{}'::jsonb,
  story_engine_version text not null default 'story_v1'
);

create unique index if not exists chapter_assessment_one_active_idx
  on public.chapter_assessment_sessions (user_id, chapter_id)
  where status = 'in_progress';

create index if not exists chapter_assessment_user_idx
  on public.chapter_assessment_sessions (user_id, chapter_id, started_at desc);

create index if not exists chapter_assessment_plan_item_idx
  on public.chapter_assessment_sessions (plan_item_id) where plan_item_id is not null;

-- Answering history, which is also what anti-memorisation reads.
create index if not exists chapter_assessment_recent_idx
  on public.chapter_assessment_sessions (user_id, completed_at desc)
  where status = 'completed';

create table if not exists public.chapter_assessment_items (
  session_id  uuid   not null references public.chapter_assessment_sessions(id) on delete cascade,
  question_id bigint not null references public.chapter_questions(id) on delete cascade,
  item_position int  not null,

  -- Snapshotted from the question so a regenerated bank cannot change a test in
  -- progress, and so the result screen renders without reading the bank at all.
  kind          text not null,
  question_type text not null,
  item_difficulty int not null default 1200,

  -- THE SHUFFLE, for a sequence question. `sequence_items` is stored in the
  -- correct order, so showing it as stored would be the answer key on screen.
  -- This permutation is generated server-side at snapshot time: element i of the
  -- displayed list is `sequence_items[presented_order[i]]`, and the learner's
  -- answer is graded by mapping back through it.
  presented_order int[],

  selected_idx    int,
  typed_answer    text,
  sequence_answer int[],
  is_correct      boolean,
  response_ms     int,
  answered_at     timestamptz,

  primary key (session_id, question_id)
);

create unique index if not exists chapter_assessment_items_position_idx
  on public.chapter_assessment_items (session_id, item_position);

create index if not exists chapter_assessment_items_question_idx
  on public.chapter_assessment_items (question_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. THE EVIDENCE LOG LEARNS ABOUT THE STORY ENGINE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Two new event types and one new source. THE STORY ENGINE DOES NOT GET ITS OWN
-- KNOWLEDGE MODEL: a Challenge answer is evidence exactly like a test answer,
-- goes through `apply_learning_evidence`, and lands in the same
-- `user_skill_state` / `user_concept_state` / `user_word_knowledge` rows. A
-- second model would be a second set of numbers that disagrees with the first,
-- and a learner whose Dativ is failing in tests but passing in books is not a
-- learner Fluent can plan for.
--
-- `source_kind = 'story'` is what lets a later refit tell a Challenge answer
-- apart from a test answer — which matters, because Challenge questions are
-- selected partly by weakness and are therefore not a representative sample.
--
-- GUARDED, as every whitelist widening in this repository now is: re-applying a
-- migration may only ever widen a check constraint, never narrow one. Without
-- the guard, re-running `schema.sql` on a provisioned database would reinstate
-- an earlier phase's shorter list and fail against the rows this phase has since
-- written.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_event_type_check'
      and pg_get_constraintdef(oid) like '%''chapter_assessment_answer''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_event_type_check;
    alter table public.learning_events
      add constraint learning_events_event_type_check check (event_type in (
        'test_answer', 'calibration_answer', 'review', 'practice_answer',
        'reading_lookup', 'reading_chapter_started', 'reading_chapter_completed',
        'reading_sentence_help', 'reading_resume',
        'chapter_preparation_answer', 'chapter_assessment_answer',
        'typed_recall', 'listening_answer', 'speaking_answer', 'writing_answer'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_events'::regclass
      and conname  = 'learning_events_source_kind_check'
      and pg_get_constraintdef(oid) like '%''story''%'
  ) then
    alter table public.learning_events drop constraint if exists learning_events_source_kind_check;
    alter table public.learning_events
      add constraint learning_events_source_kind_check check (source_kind in (
        'reading_test', 'placement_test', 'review', 'practice',
        'reader', 'book', 'story', 'import'
      ));
  end if;
end $$;

-- Two new plan activities. Both are gated on the activity genuinely existing:
-- the planner emits `chapter_preparation` only when a chapter has preparable
-- vocabulary, and `chapter_assessment` only when a validated bank can fill a
-- Challenge. A plan item whose button leads nowhere is worse than a shorter plan.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_plan_items'::regclass
      and conname  = 'daily_plan_items_item_type_check'
      and pg_get_constraintdef(oid) like '%''chapter_assessment''%'
  ) then
    alter table public.daily_plan_items drop constraint if exists daily_plan_items_item_type_check;
    alter table public.daily_plan_items
      add constraint daily_plan_items_item_type_check check (item_type in (
        'placement', 'review_due', 'weakness_practice',
        'continue_text', 'new_text', 'new_vocabulary',
        'continue_chapter', 'new_chapter',
        'chapter_preparation', 'chapter_assessment'
      ));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. VISIBILITY HELPERS.
-- ─────────────────────────────────────────────────────────────────────────────
-- One definition of "may this learner touch this chapter", reusing the Phase 4
-- predicate rather than restating it. SECURITY DEFINER so the lookup is not
-- itself filtered by the policy it is being used to evaluate.
create or replace function public.chapter_is_readable(p_chapter_id uuid)
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
    where c.id = p_chapter_id
      and public.library_item_readable(i.status, i.archived_at, i.owner_user_id)
  );
$$;

comment on function public.chapter_is_readable(uuid) is
  'Whether the calling learner may read this chapter, reusing library_item_readable so private imports stay owner-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. THE QUESTION BANK'S WRITE PATH.
-- ─────────────────────────────────────────────────────────────────────────────
-- Validation lives in TypeScript (`src/lib/story/questions.ts`), where it is
-- pure and unit-tested; this function owns the TRANSACTION. The same split as
-- the content pipeline and the knowledge model, and for the same reason:
-- re-implementing the checks in PL/pgSQL would give Fluent two validators that
-- disagree the first time either changed.
--
-- The caller has already validated. What the DATABASE still guarantees is the
-- part TypeScript cannot: the answer-shape CHECK, the fingerprint uniqueness
-- that makes regeneration idempotent, and that `owner_user_id` is derived from
-- the item rather than accepted from the caller — a question cannot claim to be
-- public content.
--
-- service_role only.
create or replace function public.upsert_chapter_questions(
  p_chapter_id uuid,
  p_questions  jsonb,
  p_meta       jsonb default '{}'::jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     uuid;
  v_owner    uuid;
  v_hash     text;
  v_question jsonb;
  v_id       bigint;
  v_written  int := 0;
begin
  select c.library_item_id, i.owner_user_id, c.content_hash
    into v_item, v_owner, v_hash
  from public.chapters c
  join public.library_items i on i.id = c.library_item_id
  where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  for v_question in
    select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb))
  loop
    insert into public.chapter_questions (
      chapter_id, library_item_id, owner_user_id, kind, question_type, scope,
      prompt, options, correct_idx, accepted_answers, sequence_items,
      skill_code, word_id, difficulty, source_sentence_ids, explanation_pl,
      generation_source, generator_version, provider, model,
      source_content_hash, fingerprint, status, validation_status
    ) values (
      p_chapter_id,
      v_item,
      -- DERIVED, never accepted: a caller cannot publish someone's private book.
      v_owner,
      v_question ->> 'kind',
      v_question ->> 'question_type',
      coalesce(v_question ->> 'scope', 'local'),
      v_question ->> 'prompt',
      case when v_question ? 'options' and jsonb_typeof(v_question -> 'options') = 'array'
           then array(select jsonb_array_elements_text(v_question -> 'options')) end,
      (v_question ->> 'correct_idx')::int,
      case when v_question ? 'accepted_answers' and jsonb_typeof(v_question -> 'accepted_answers') = 'array'
           then array(select jsonb_array_elements_text(v_question -> 'accepted_answers')) end,
      case when v_question ? 'sequence_items' and jsonb_typeof(v_question -> 'sequence_items') = 'array'
           then array(select jsonb_array_elements_text(v_question -> 'sequence_items')) end,
      v_question ->> 'skill_code',
      (v_question ->> 'word_id')::bigint,
      coalesce((v_question ->> 'difficulty')::int, 1200),
      coalesce(
        array(select jsonb_array_elements_text(v_question -> 'source_sentence_ids')::bigint),
        array[]::bigint[]
      ),
      v_question ->> 'explanation_pl',
      coalesce(p_meta ->> 'generation_source', 'manual'),
      p_meta ->> 'generator_version',
      p_meta ->> 'provider',
      p_meta ->> 'model',
      v_hash,
      v_question ->> 'fingerprint',
      coalesce(v_question ->> 'status', p_meta ->> 'status', 'draft'),
      'valid'
    )
    -- IDEMPOTENT. A second generation run over an unchanged chapter refreshes
    -- the freshness stamp and adds nothing.
    on conflict (chapter_id, fingerprint) do update
      set source_content_hash = excluded.source_content_hash,
          generator_version   = coalesce(excluded.generator_version, public.chapter_questions.generator_version),
          updated_at          = now()
    returning id into v_id;

    if v_id is not null then
      v_written := v_written + 1;
      delete from public.chapter_question_concepts where question_id = v_id;
      insert into public.chapter_question_concepts (question_id, concept_code)
      select v_id, code
      from jsonb_array_elements_text(coalesce(v_question -> 'concept_codes', '[]'::jsonb)) as t(code)
      where exists (select 1 from public.concepts c where c.code = code)
      on conflict do nothing;
    end if;
  end loop;

  return v_written;
end;
$$;

-- Mark every question written from an older version of a chapter as stale.
--
-- WHY NOT DELETE. The questions may still be perfectly good — most edits to a
-- chapter do not invalidate most questions about it — and deleting them would
-- also delete the history of everyone who answered them. Marking is the
-- reversible version: they stop being served, an admin can see why, and a
-- regeneration re-publishes the ones that still hold.
create or replace function public.mark_stale_chapter_questions(p_chapter_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash    text;
  v_stale   int;
begin
  select c.content_hash into v_hash from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  update public.chapter_questions q
     set status = 'stale', updated_at = now()
   where q.chapter_id = p_chapter_id
     and q.status in ('draft', 'needs_review', 'published')
     and (q.source_content_hash is distinct from v_hash);

  get diagnostics v_stale = row_count;
  return v_stale;
end;
$$;

-- Approve, reject or disable one question. Admins only, and never on a private
-- import — a learner's own book is not an admin's to curate.
create or replace function public.set_chapter_question_status(
  p_question_id bigint,
  p_status      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'Brak uprawnień.' using errcode = 'FL403';
  end if;
  if p_status not in ('draft', 'needs_review', 'published', 'disabled', 'stale') then
    raise exception 'Nieznany status pytania.' using errcode = 'FL422';
  end if;

  select q.owner_user_id into v_owner
  from public.chapter_questions q where q.id = p_question_id;
  if not found then
    raise exception 'Pytanie nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner is not null then
    raise exception 'To pytanie należy do prywatnego importu.' using errcode = 'FL403';
  end if;

  update public.chapter_questions q
     set status = p_status, updated_at = now()
   where q.id = p_question_id;
end;
$$;

-- "To pytanie jest nie tak." One row, one learner, one question.
create or replace function public.report_chapter_question(
  p_question_id bigint,
  p_reason      text,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_chapter uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if p_reason not in ('ambiguous', 'wrong_answer', 'not_in_chapter', 'unclear', 'other') then
    raise exception 'Nieznany powód zgłoszenia.' using errcode = 'FL422';
  end if;

  select q.chapter_id into v_chapter
  from public.chapter_questions q where q.id = p_question_id;
  if not found then
    raise exception 'Pytanie nie istnieje.' using errcode = 'FL404';
  end if;
  -- A learner may only report a question from a chapter they can read, which is
  -- also the only way they could have seen one.
  if not public.chapter_is_readable(v_chapter) then
    raise exception 'Brak dostępu do tego pytania.' using errcode = 'FL403';
  end if;

  insert into public.chapter_question_reports (question_id, user_id, reason, note)
  values (p_question_id, v_user, p_reason, left(coalesce(p_note, ''), 500))
  on conflict (question_id, user_id) do update
    set reason = excluded.reason, note = excluded.note, created_at = now();
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. GENERATION JOBS.
-- ─────────────────────────────────────────────────────────────────────────────
-- Retry is idempotent by construction: a queued or running job for the chapter
-- is RETURNED rather than duplicated, so a double-clicked admin button and a
-- retried request both land on the same job.
create or replace function public.start_chapter_generation_job(
  p_chapter_id        uuid,
  p_generator_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job  uuid;
  v_hash text;
begin
  select c.content_hash into v_hash from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  select j.id into v_job
  from public.chapter_generation_jobs j
  where j.chapter_id = p_chapter_id and j.status in ('queued', 'running')
  for update;

  if v_job is not null then
    update public.chapter_generation_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           last_attempt_at = now(),
           updated_at = now()
     where j.id = v_job;
    return v_job;
  end if;

  insert into public.chapter_generation_jobs (
    chapter_id, status, generator_version, content_hash, attempts, last_attempt_at
  ) values (p_chapter_id, 'running', p_generator_version, v_hash, 1, now())
  returning id into v_job;

  return v_job;
end;
$$;

create or replace function public.finish_chapter_generation_job(
  p_job_id uuid,
  p_status text,
  p_result jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ready', 'failed', 'needs_review') then
    raise exception 'Nieznany status zadania.' using errcode = 'FL422';
  end if;

  update public.chapter_generation_jobs j
     set status          = p_status,
         provider        = p_result ->> 'provider',
         model           = p_result ->> 'model',
         input_tokens    = (p_result ->> 'input_tokens')::int,
         output_tokens   = (p_result ->> 'output_tokens')::int,
         cost_usd        = (p_result ->> 'cost_usd')::numeric,
         candidate_count = coalesce((p_result ->> 'candidate_count')::int, 0),
         accepted_count  = coalesce((p_result ->> 'accepted_count')::int, 0),
         rejected_count  = coalesce((p_result ->> 'rejected_count')::int, 0),
         rejections      = coalesce(p_result -> 'rejections', '[]'::jsonb),
         error_code      = p_result ->> 'error_code',
         -- Bounded, and never chapter text: a log is a copy.
         error_message   = left(p_result ->> 'error_message', 1000),
         updated_at      = now(),
         finished_at     = now()
   where j.id = p_job_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. THE CHAPTER LEARNING STATE MACHINE.
-- ─────────────────────────────────────────────────────────────────────────────
-- Internal. Every transition is written by the function that performed the
-- underlying act, in the same transaction, so the lifecycle can never claim
-- something the work tables do not show.
--
-- NEVER GOES BACKWARDS past `completed`: a learner who re-reads an assessed
-- chapter is re-reading it, not un-assessing it.
create or replace function public.touch_chapter_learning_state(
  p_user_id    uuid,
  p_chapter_id uuid,
  p_event      text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   uuid;
  v_status text;
begin
  select c.library_item_id into v_item from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  insert into public.user_chapter_learning_state (user_id, chapter_id, library_item_id)
  values (p_user_id, p_chapter_id, v_item)
  on conflict (user_id, chapter_id) do nothing;

  update public.user_chapter_learning_state s
     set prepared_at = case
           when p_event in ('prepared', 'preparation_skipped') then coalesce(s.prepared_at, now())
           else s.prepared_at end,
         preparation_skipped_at = case
           when p_event = 'preparation_skipped' then coalesce(s.preparation_skipped_at, now())
           else s.preparation_skipped_at end,
         reading_started_at = case
           when p_event = 'reading_started' then coalesce(s.reading_started_at, now())
           else s.reading_started_at end,
         reading_completed_at = case
           when p_event = 'reading_completed' then coalesce(s.reading_completed_at, now())
           else s.reading_completed_at end,
         assessment_deferred_at = case
           when p_event = 'assessment_deferred' then now()
           else s.assessment_deferred_at end,
         assessment_completed_at = case
           when p_event = 'assessment_completed' then coalesce(s.assessment_completed_at, now())
           else s.assessment_completed_at end,
         updated_at = now()
   where s.user_id = p_user_id and s.chapter_id = p_chapter_id;

  -- Status is DERIVED from the timestamps rather than assigned per event, so an
  -- out-of-order call (a deferred Challenge finished from another tab, a chapter
  -- re-read) cannot put the row in a state its own history contradicts.
  update public.user_chapter_learning_state s
     set status = case
           when s.assessment_completed_at is not null then 'completed'
           when s.reading_completed_at is not null and s.assessment_deferred_at is not null
             then 'assessment_pending'
           when s.reading_completed_at is not null then 'read'
           when s.reading_started_at is not null then 'reading'
           when s.prepared_at is not null then 'prepared'
           else 'not_started'
         end
   where s.user_id = p_user_id and s.chapter_id = p_chapter_id
  returning s.status into v_status;

  return v_status;
end;
$$;

-- The learner's own "I'll do it later". Authenticated, because it is a statement
-- about their own plan and derives the user from auth.uid().
create or replace function public.defer_chapter_assessment(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;
  -- Only a chapter that was actually finished has an outstanding Challenge.
  if not exists (
    select 1 from public.reading_progress rp
    where rp.user_id = v_user and rp.chapter_id = p_chapter_id
      and rp.completed_at is not null
  ) then
    raise exception 'Ten rozdział nie został jeszcze ukończony.' using errcode = 'FL409';
  end if;

  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'assessment_deferred');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. THE ANALYSIS CACHE.
-- ─────────────────────────────────────────────────────────────────────────────
-- service_role: the analysis is computed by `src/lib/story/analysis.ts` and
-- arrives here already computed, so a browser must not be able to reach it — a
-- learner who could write their own coverage figure could write their own
-- difficulty label, and the whole estimate would stop meaning anything.
create or replace function public.upsert_chapter_analysis(
  p_user_id    uuid,
  p_chapter_id uuid,
  p_analysis   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_hash text;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id, c.content_hash into v_item, v_hash
  from public.chapters c where c.id = p_chapter_id;
  if not found then
    raise exception 'Rozdział nie istnieje.' using errcode = 'FL404';
  end if;

  insert into public.chapter_user_analysis (
    user_id, chapter_id, library_item_id,
    coverage_status, coverage_ratio, coverage_confidence,
    observed_words, known_words, total_words,
    difficulty_score, difficulty_label, difficulty_confidence, signals,
    estimated_minutes, preteach_target_count,
    content_hash, story_engine_version, computed_at
  ) values (
    p_user_id, p_chapter_id, v_item,
    p_analysis ->> 'coverage_status',
    (p_analysis ->> 'coverage_ratio')::numeric,
    coalesce(p_analysis ->> 'coverage_confidence', 'none'),
    coalesce((p_analysis ->> 'observed_words')::int, 0),
    coalesce((p_analysis ->> 'known_words')::int, 0),
    coalesce((p_analysis ->> 'total_words')::int, 0),
    coalesce((p_analysis ->> 'difficulty_score')::numeric, 0.5),
    coalesce(p_analysis ->> 'difficulty_label', 'just_right'),
    coalesce(p_analysis ->> 'difficulty_confidence', 'none'),
    coalesce(p_analysis -> 'signals', '{}'::jsonb),
    greatest(1, coalesce((p_analysis ->> 'estimated_minutes')::int, 1)),
    greatest(0, coalesce((p_analysis ->> 'preteach_target_count')::int, 0)),
    -- Taken from the chapter, not from the caller: an analysis must not be able
    -- to claim it describes content it does not.
    v_hash,
    coalesce(p_analysis ->> 'story_engine_version', 'story_v1'),
    now()
  )
  on conflict (user_id, chapter_id) do update
    set coverage_status       = excluded.coverage_status,
        coverage_ratio        = excluded.coverage_ratio,
        coverage_confidence   = excluded.coverage_confidence,
        observed_words        = excluded.observed_words,
        known_words           = excluded.known_words,
        total_words           = excluded.total_words,
        difficulty_score      = excluded.difficulty_score,
        difficulty_label      = excluded.difficulty_label,
        difficulty_confidence = excluded.difficulty_confidence,
        signals               = excluded.signals,
        estimated_minutes     = excluded.estimated_minutes,
        preteach_target_count = excluded.preteach_target_count,
        content_hash          = excluded.content_hash,
        story_engine_version  = excluded.story_engine_version,
        computed_at           = excluded.computed_at;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. PREPARATION LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
-- The word list is chosen by `src/lib/story/preparation.ts` and arrives here as
-- a snapshot. service_role for exactly the reason `create_daily_plan` is: this
-- accepts a computed selection, and a browser that could post its own would be
-- choosing its own "preparation".
--
-- CONCURRENCY. Two tabs starting preparation in the same second both insert; the
-- partial unique index makes one lose, and the loser returns the winner's
-- session rather than failing. Ten calls produce one session.
create or replace function public.start_chapter_preparation(
  p_user_id      uuid,
  p_chapter_id   uuid,
  p_items        jsonb,
  p_plan_item_id uuid default null,
  p_signals      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    uuid;
  v_session uuid;
  v_row     jsonb;
  v_pos     int := 0;
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id into v_item
  from public.chapters c where c.id = p_chapter_id and c.status = 'ready';
  if not found then
    raise exception 'Rozdział nie jest gotowy.' using errcode = 'FL404';
  end if;

  if p_plan_item_id is not null and not exists (
    select 1 from public.daily_plan_items i
    join public.daily_plans p on p.id = i.plan_id
    where i.id = p_plan_item_id and p.user_id = p_user_id
  ) then
    raise exception 'Brak dostępu do tego zadania.' using errcode = 'FL403';
  end if;

  -- RESUME, NEVER DUPLICATE — and never re-select. A learner returning to an
  -- unfinished preparation gets the list they started with, because a task that
  -- rewrites itself halfway through is not a task.
  select s.id into v_session
  from public.chapter_preparation_sessions s
  where s.user_id = p_user_id and s.chapter_id = p_chapter_id
    and s.status = 'in_progress';
  if v_session is not null then
    if p_plan_item_id is not null then
      update public.chapter_preparation_sessions s
         set plan_item_id = p_plan_item_id
       where s.id = v_session and s.plan_item_id is distinct from p_plan_item_id;
    end if;
    return v_session;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Brak słów do przygotowania.' using errcode = 'FL404';
  end if;

  begin
    insert into public.chapter_preparation_sessions (
      user_id, chapter_id, library_item_id, plan_item_id, selection_signals
    ) values (
      p_user_id, p_chapter_id, v_item, p_plan_item_id, coalesce(p_signals, '{}'::jsonb)
    )
    returning id into v_session;
  exception when unique_violation then
    select s.id into v_session
    from public.chapter_preparation_sessions s
    where s.user_id = p_user_id and s.chapter_id = p_chapter_id
      and s.status = 'in_progress';
    return v_session;
  end;

  for v_row in select value from jsonb_array_elements(p_items)
  loop
    v_pos := v_pos + 1;
    insert into public.chapter_preparation_items (
      session_id, word_id, item_position, lemma, display, translation,
      options, correct_idx, context_sentence, context_source, sentence_id
    ) values (
      v_session,
      (v_row ->> 'word_id')::bigint,
      v_pos,
      v_row ->> 'lemma',
      v_row ->> 'display',
      v_row ->> 'translation',
      array(select jsonb_array_elements_text(v_row -> 'options')),
      (v_row ->> 'correct_idx')::int,
      v_row ->> 'context_sentence',
      coalesce(v_row ->> 'context_source', 'none'),
      (v_row ->> 'sentence_id')::bigint
    )
    on conflict (session_id, word_id) do nothing;
  end loop;

  perform public.touch_chapter_learning_state(p_user_id, p_chapter_id, 'prepared');
  return v_session;
end;
$$;

-- Read a preparation's snapshot. Cards and options — never `correct_idx`.
create or replace function public.get_chapter_preparation(p_session_id uuid)
returns table (
  word_id          bigint,
  item_position    int,
  lemma            text,
  display          text,
  translation      text,
  options          text[],
  context_sentence text,
  context_source   text,
  selected_idx     int,
  is_correct       boolean,
  answered_at      timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user  uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id into v_owner
  from public.chapter_preparation_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja przygotowania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.word_id, i.item_position, i.lemma, i.display, i.translation,
         i.options, i.context_sentence, i.context_source,
         i.selected_idx, i.is_correct, i.answered_at
  from public.chapter_preparation_items i
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- Answer one preparation card. Identical trust model to `answer_test_question`:
-- the key is revealed only for an item in the caller's own in-progress session,
-- and only once their single answer has been committed. The first answer wins.
create or replace function public.answer_preparation_item(
  p_session_id   uuid,
  p_word_id      bigint,
  p_selected_idx int,
  p_response_ms  int
)
returns table (
  is_answer_correct boolean,
  answer_key_idx    int,
  already_answered  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := (select auth.uid());
  v_owner       uuid;
  v_status      text;
  v_answered_at timestamptz;
  v_stored      boolean;
  v_correct_idx int;
  v_options     int;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id, s.status into v_owner, v_status
  from public.chapter_preparation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja przygotowania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'To przygotowanie zostało już zakończone.' using errcode = 'FL409';
  end if;

  select i.answered_at, i.is_correct, i.correct_idx,
         coalesce(array_length(i.options, 1), 0)
    into v_answered_at, v_stored, v_correct_idx, v_options
  from public.chapter_preparation_items i
  where i.session_id = p_session_id and i.word_id = p_word_id;
  if not found then
    raise exception 'To słowo nie należy do tej sesji.' using errcode = 'FL410';
  end if;

  if v_answered_at is not null then
    return query select v_stored, v_correct_idx, true;
    return;
  end if;

  if p_selected_idx is null or p_selected_idx < 0 or p_selected_idx >= v_options then
    raise exception 'Nieprawidłowy numer odpowiedzi.' using errcode = 'FL422';
  end if;

  update public.chapter_preparation_items i
     set selected_idx = p_selected_idx,
         is_correct   = (p_selected_idx = v_correct_idx),
         response_ms  = case
           when p_response_ms is null or p_response_ms < 0 then null
           else least(p_response_ms, 3600000) end,
         answered_at  = now()
   where i.session_id = p_session_id and i.word_id = p_word_id
     and i.answered_at is null;

  return query select (p_selected_idx = v_correct_idx), v_correct_idx, false;
end;
$$;

-- Seal a preparation, record what it proved, and move the plan — one transaction.
--
-- WHAT IT PROVES IS DELIBERATELY LITTLE. The evidence arrives already weighted by
-- `chapterPreparationEvidence`, at 0.24 rather than a full multiple-choice 0.6,
-- because recognising a word seconds after being shown its translation is the
-- easiest retrieval Fluent can construct. What makes preparation valuable to the
-- model is the RETENTION check days later, not this event.
--
-- Idempotent: a second call returns the stored result and re-applies no evidence.
create or replace function public.finalize_chapter_preparation(
  p_session_id uuid,
  p_user_id    uuid,
  p_evidence   jsonb
)
returns table (
  correct_count     int,
  total_count       int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session public.chapter_preparation_sessions%rowtype;
  v_total   int;
  v_correct int;
begin
  select * into v_session
  from public.chapter_preparation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja przygotowania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status in ('completed', 'skipped') then
    return query select v_session.correct, v_session.total, true;
    return;
  end if;

  select count(*)::int, count(*) filter (where i.is_correct)::int
    into v_total, v_correct
  from public.chapter_preparation_items i
  where i.session_id = p_session_id and i.answered_at is not null;

  update public.chapter_preparation_sessions s
     set status = 'completed', completed_at = now(),
         correct = v_correct, total = v_total
   where s.id = p_session_id;

  perform public.apply_learning_evidence(p_user_id, p_evidence);
  perform public.touch_chapter_learning_state(p_user_id, v_session.chapter_id, 'prepared');

  if v_session.plan_item_id is not null then
    update public.daily_plan_items i
       set completed_count = least(v_total, i.target_count),
           status          = case when v_total >= i.target_count then 'completed' else 'in_progress' end,
           started_at      = coalesce(i.started_at, now()),
           completed_at    = case when v_total >= i.target_count
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_session.plan_item_id and i.status <> 'skipped';
  end if;

  return query select v_correct, v_total, false;
end;
$$;

-- "Pomiń i czytaj."
--
-- THE STORY ENGINE MAY NOT IMPRISON THE READER. A learner who wants to open the
-- chapter right now is doing the thing the entire product exists for, and an
-- engine that stood in the way would be optimising for its own telemetry. The
-- skip is recorded because preparation ADOPTION is worth measuring, not because
-- skipping is a failure.
create or replace function public.skip_chapter_preparation(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;

  update public.chapter_preparation_sessions s
     set status = 'skipped', completed_at = now()
   where s.user_id = v_user and s.chapter_id = p_chapter_id
     and s.status = 'in_progress';

  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'preparation_skipped');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. THE CHALLENGE'S CANDIDATE POOL.
-- ─────────────────────────────────────────────────────────────────────────────
-- What the SELECTION needs and nothing more: metadata, plus when this learner
-- last answered each question. No prompt, no options, no key — the ranking in
-- `src/lib/story/selection.ts` does not need to read a question to score it, so
-- it is never given one.
--
-- That is not merely tidy. It means the whole personalisation layer runs on data
-- a learner could see without learning anything, and the answer key stays behind
-- a session snapshot exactly as `questions.correct_idx` has since Phase 1.
create or replace function public.get_chapter_question_candidates(p_chapter_id uuid)
returns table (
  question_id      bigint,
  kind             text,
  question_type    text,
  difficulty       int,
  word_id          bigint,
  concept_codes    text[],
  last_answered_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
  v_hash text;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;

  select c.content_hash into v_hash from public.chapters c where c.id = p_chapter_id;

  return query
  select q.id, q.kind, q.question_type, q.difficulty, q.word_id,
         coalesce(
           array(
             select qc.concept_code from public.chapter_question_concepts qc
             where qc.question_id = q.id order by qc.concept_code
           ),
           array[]::text[]
         ),
         answered.last_at
  from public.chapter_questions q
  left join lateral (
    select max(ai.answered_at) as last_at
    from public.chapter_assessment_items ai
    join public.chapter_assessment_sessions s on s.id = ai.session_id
    where s.user_id = v_user and ai.question_id = q.id
  ) answered on true
  where q.chapter_id = p_chapter_id
    and q.status = 'published'
    and q.validation_status = 'valid'
    -- STALE QUESTIONS ARE EXCLUDED, not silently reused. A question written from
    -- a version of the chapter that no longer exists may be asking about a
    -- paragraph that was edited away.
    and q.source_content_hash is not distinct from v_hash;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. ASSESSMENT LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SNAPSHOT IS WHAT MAKES THIS AN ASSESSMENT. Once the session starts, the
-- questions are fixed: a regeneration of the bank mid-Challenge cannot change
-- what the learner is being asked, and the client cannot choose, reorder or
-- extend them. The server picked them; the server remembers.
--
-- service_role, because the selection arrives computed.
create or replace function public.start_chapter_assessment(
  p_user_id      uuid,
  p_chapter_id   uuid,
  p_question_ids bigint[],
  p_blueprint    jsonb default '{}'::jsonb,
  p_signals      jsonb default '{}'::jsonb,
  p_plan_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     uuid;
  v_session  uuid;
  v_id       bigint;
  v_pos      int := 0;
  v_question public.chapter_questions%rowtype;
  v_order    int[];
begin
  if p_user_id is null then
    raise exception 'Brak użytkownika.' using errcode = 'FL401';
  end if;

  select c.library_item_id into v_item
  from public.chapters c where c.id = p_chapter_id and c.status = 'ready';
  if not found then
    raise exception 'Rozdział nie jest gotowy.' using errcode = 'FL404';
  end if;

  -- A Challenge is about a chapter that was READ. Offering one before the
  -- chapter is finished would be asking what happened before it happened.
  if not exists (
    select 1 from public.reading_progress rp
    where rp.user_id = p_user_id and rp.chapter_id = p_chapter_id
      and rp.completed_at is not null
  ) then
    raise exception 'Ten rozdział nie został jeszcze ukończony.' using errcode = 'FL409';
  end if;

  if p_plan_item_id is not null and not exists (
    select 1 from public.daily_plan_items i
    join public.daily_plans p on p.id = i.plan_id
    where i.id = p_plan_item_id and p.user_id = p_user_id
  ) then
    raise exception 'Brak dostępu do tego zadania.' using errcode = 'FL403';
  end if;

  -- Resume rather than duplicate, and resume the SNAPSHOT: someone who closed
  -- the tab mid-Challenge returns to the same questions, not to easier ones.
  select s.id into v_session
  from public.chapter_assessment_sessions s
  where s.user_id = p_user_id and s.chapter_id = p_chapter_id
    and s.status = 'in_progress';
  if v_session is not null then
    if p_plan_item_id is not null then
      update public.chapter_assessment_sessions s
         set plan_item_id = p_plan_item_id
       where s.id = v_session and s.plan_item_id is distinct from p_plan_item_id;
    end if;
    return v_session;
  end if;

  if coalesce(array_length(p_question_ids, 1), 0) = 0 then
    raise exception 'Brak pytań do tego rozdziału.' using errcode = 'FL404';
  end if;

  begin
    insert into public.chapter_assessment_sessions (
      user_id, chapter_id, library_item_id, plan_item_id, blueprint, selection_signals
    ) values (
      p_user_id, p_chapter_id, v_item, p_plan_item_id,
      coalesce(p_blueprint, '{}'::jsonb), coalesce(p_signals, '{}'::jsonb)
    )
    returning id into v_session;
  exception when unique_violation then
    select s.id into v_session
    from public.chapter_assessment_sessions s
    where s.user_id = p_user_id and s.chapter_id = p_chapter_id
      and s.status = 'in_progress';
    return v_session;
  end;

  foreach v_id in array p_question_ids
  loop
    select * into v_question
    from public.chapter_questions q
    where q.id = v_id and q.chapter_id = p_chapter_id
      and q.status = 'published' and q.validation_status = 'valid';
    if not found then
      -- A question that vanished between selection and snapshot is skipped, not
      -- fatal: a Challenge one question short still measures something.
      continue;
    end if;

    v_pos := v_pos + 1;

    -- THE SHUFFLE FOR A SEQUENCE QUESTION. `sequence_items` is stored in the
    -- correct order, so a client given it as stored would be given the answer.
    -- The permutation is generated here, server-side, and the learner's ordering
    -- is graded by mapping back through it.
    v_order := null;
    if v_question.question_type = 'sequence' then
      select array_agg(idx order by random())
        into v_order
      from generate_series(0, coalesce(array_length(v_question.sequence_items, 1), 1) - 1) as idx;
    end if;

    insert into public.chapter_assessment_items (
      session_id, question_id, item_position, kind, question_type,
      item_difficulty, presented_order
    ) values (
      v_session, v_id, v_pos, v_question.kind, v_question.question_type,
      v_question.difficulty, v_order
    )
    on conflict (session_id, question_id) do nothing;
  end loop;

  if v_pos = 0 then
    raise exception 'Brak pytań do tego rozdziału.' using errcode = 'FL404';
  end if;

  return v_session;
end;
$$;

-- Read a Challenge's snapshot: prompts, and the options AS PRESENTED.
--
-- For a sequence question the items come back in the shuffled order recorded on
-- the item, so the correct order never leaves the database. For everything else
-- the answer key is simply not selected.
create or replace function public.get_chapter_assessment(p_session_id uuid)
returns table (
  question_id     bigint,
  item_position   int,
  kind            text,
  question_type   text,
  prompt          text,
  options         text[],
  sequence_items  text[],
  explanation_pl  text,
  selected_idx    int,
  typed_answer    text,
  sequence_answer int[],
  is_correct      boolean,
  answered_at     timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user  uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id into v_owner
  from public.chapter_assessment_sessions s where s.id = p_session_id;
  if not found then
    raise exception 'Sesja wyzwania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  return query
  select i.question_id, i.item_position, i.kind, i.question_type,
         q.prompt, q.options,
         case
           when i.question_type = 'sequence' and i.presented_order is not null then
             array(
               select q.sequence_items[o + 1]
               from unnest(i.presented_order) with ordinality as t(o, ord)
               order by t.ord
             )
           else null
         end,
         -- The explanation is only ever released after the answer is committed.
         case when i.answered_at is not null then q.explanation_pl else null end,
         i.selected_idx, i.typed_answer, i.sequence_answer, i.is_correct, i.answered_at
  from public.chapter_assessment_items i
  join public.chapter_questions q on q.id = i.question_id
  where i.session_id = p_session_id
  order by i.item_position;
end;
$$;

-- Answer one Challenge question.
--
-- GRADING HAPPENS HERE, for all four answerable types, and the key is returned
-- only after the learner's single answer has been committed. That is the same
-- boundary `answer_test_question` established in Phase 1 and it is not softened
-- for a nicer-looking feature: a client that could see the key before answering
-- is a client that can score itself.
create or replace function public.answer_chapter_assessment_question(
  p_session_id      uuid,
  p_question_id     bigint,
  p_selected_idx    int    default null,
  p_typed_answer    text   default null,
  p_sequence_answer int[]  default null,
  p_response_ms     int    default null
)
returns table (
  is_answer_correct boolean,
  answer_key_idx    int,
  answer_key_text   text,
  answer_key_order  int[],
  explanation_pl    text,
  already_answered  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user        uuid := (select auth.uid());
  v_owner       uuid;
  v_status      text;
  v_item        public.chapter_assessment_items%rowtype;
  v_question    public.chapter_questions%rowtype;
  v_correct     boolean;
  v_options     int;
  v_count       int;
  v_response_ms int;
  v_key_text    text;
  v_key_order   int[];
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;

  select s.user_id, s.status into v_owner, v_status
  from public.chapter_assessment_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja wyzwania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_owner <> v_user then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'To wyzwanie zostało już zakończone.' using errcode = 'FL409';
  end if;

  select * into v_item
  from public.chapter_assessment_items i
  where i.session_id = p_session_id and i.question_id = p_question_id;
  if not found then
    raise exception 'To pytanie nie należy do tego wyzwania.' using errcode = 'FL410';
  end if;

  select * into v_question
  from public.chapter_questions q where q.id = p_question_id;
  if not found then
    raise exception 'To pytanie nie istnieje.' using errcode = 'FL410';
  end if;

  v_key_text := case
    when v_question.question_type = 'cloze'
      then coalesce(v_question.accepted_answers[1], '')
    when v_question.options is not null and v_question.correct_idx is not null
      then v_question.options[v_question.correct_idx + 1]
    else null
  end;

  -- The correct answer expressed in PRESENTED positions, so the result screen
  -- can show the right order without ever receiving the stored one.
  if v_question.question_type = 'sequence' and v_item.presented_order is not null then
    select array_agg(pos order by target)
      into v_key_order
    from (
      select t.ord - 1 as pos, t.o as target
      from unnest(v_item.presented_order) with ordinality as t(o, ord)
    ) mapped;
  end if;

  if v_item.answered_at is not null then
    return query select v_item.is_correct, v_question.correct_idx, v_key_text,
                        v_key_order, v_question.explanation_pl, true;
    return;
  end if;

  if v_question.question_type in ('multiple_choice', 'true_false') then
    v_options := coalesce(array_length(v_question.options, 1), 0);
    if p_selected_idx is null or p_selected_idx < 0 or p_selected_idx >= v_options then
      raise exception 'Nieprawidłowy numer odpowiedzi.' using errcode = 'FL422';
    end if;
    v_correct := (p_selected_idx = v_question.correct_idx);

  elsif v_question.question_type = 'cloze' then
    if p_typed_answer is null or public.fold_typed_answer(p_typed_answer) = '' then
      raise exception 'Wpisz odpowiedź.' using errcode = 'FL422';
    end if;
    -- Case, spacing and a leading article are folded; diacritics are NOT, because
    -- *schon* and *schön* are different words.
    v_correct := exists (
      select 1 from unnest(v_question.accepted_answers) as a(value)
      where public.fold_typed_answer(a.value) = public.fold_typed_answer(p_typed_answer)
    );

  elsif v_question.question_type = 'sequence' then
    v_count := coalesce(array_length(v_question.sequence_items, 1), 0);
    if p_sequence_answer is null or array_length(p_sequence_answer, 1) is distinct from v_count then
      raise exception 'Ułóż wszystkie elementy.' using errcode = 'FL422';
    end if;
    -- The learner submits PRESENTED positions; mapping each back through the
    -- permutation must reproduce the stored order exactly.
    v_correct := not exists (
      select 1
      from unnest(p_sequence_answer) with ordinality as t(presented_pos, ord)
      where t.presented_pos < 0
         or t.presented_pos >= v_count
         or v_item.presented_order[t.presented_pos + 1] is distinct from (t.ord - 1)::int
    );

  else
    raise exception 'Ten typ pytania nie jest obsługiwany.' using errcode = 'FL422';
  end if;

  v_response_ms := case
    when p_response_ms is null or p_response_ms < 0 then null
    else least(p_response_ms, 3600000) end;

  update public.chapter_assessment_items i
     set selected_idx    = p_selected_idx,
         typed_answer    = left(p_typed_answer, 200),
         sequence_answer = p_sequence_answer,
         is_correct      = v_correct,
         response_ms     = v_response_ms,
         answered_at     = now()
   where i.session_id = p_session_id and i.question_id = p_question_id
     and i.answered_at is null;

  -- GLOBAL STATS, for a later empirical calibration. Nothing reads these to
  -- change a difficulty today — two answers are not a difficulty — and nothing
  -- ever shows them to a learner.
  insert into public.chapter_question_stats (
    question_id, answer_count, correct_count, response_ms_total, updated_at
  ) values (
    p_question_id, 1, case when v_correct then 1 else 0 end,
    coalesce(v_response_ms, 0), now()
  )
  on conflict (question_id) do update
    set answer_count      = public.chapter_question_stats.answer_count + 1,
        correct_count     = public.chapter_question_stats.correct_count
                            + case when v_correct then 1 else 0 end,
        response_ms_total = public.chapter_question_stats.response_ms_total
                            + coalesce(v_response_ms, 0),
        updated_at        = now();

  return query select v_correct, v_question.correct_idx, v_key_text, v_key_order,
                      v_question.explanation_pl, false;
end;
$$;

-- The SQL half of `foldTypedAnswer`.
--
-- A SECOND IMPLEMENTATION OF A RULE IS A RULE THAT WILL DRIFT, so this is
-- deliberately the only place in the database that folds an answer, it mirrors
-- `src/lib/story/questions.ts` exactly, and both are covered by tests that would
-- fail if either moved. Grading has to happen in SQL because the answer key must
-- never leave the database before the answer is committed.
create or replace function public.fold_typed_answer(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               lower(btrim(coalesce(p_value, ''))),
               '\s+', ' ', 'g'
             ),
             '^(der|die|das|ein|eine|einen|einem|einer)\s+', ''
           ),
           '[.,!?;:]+$', ''
         );
$$;

-- Seal a Challenge, write its evidence, move the plan and advance the lifecycle
-- — one transaction, so there is no state where the Challenge is finished and
-- today's plan still shows it as pending.
--
-- Idempotent: a second call returns the stored result and re-applies no evidence,
-- exactly as `finalize_test_session` does and for the same reason.
create or replace function public.finalize_chapter_assessment(
  p_session_id uuid,
  p_user_id    uuid,
  p_evidence   jsonb,
  p_scores     jsonb default '{}'::jsonb
)
returns table (
  correct_count     int,
  total_count       int,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_session    public.chapter_assessment_sessions%rowtype;
  v_total      int;
  v_correct    int;
  v_unanswered int;
begin
  select * into v_session
  from public.chapter_assessment_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Sesja wyzwania nie istnieje.' using errcode = 'FL404';
  end if;
  if v_session.user_id <> p_user_id then
    raise exception 'Brak dostępu do tej sesji.' using errcode = 'FL403';
  end if;

  if v_session.status = 'completed' then
    return query select v_session.correct, v_session.total, true;
    return;
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'To wyzwanie zostało porzucone.' using errcode = 'FL409';
  end if;

  select count(*)::int,
         count(*) filter (where i.answered_at is null)::int,
         count(*) filter (where i.is_correct)::int
    into v_total, v_unanswered, v_correct
  from public.chapter_assessment_items i
  where i.session_id = p_session_id;

  if v_total = 0 then
    raise exception 'To wyzwanie nie ma pytań.' using errcode = 'FL404';
  end if;
  if v_unanswered > 0 then
    raise exception 'Odpowiedz na wszystkie pytania.' using errcode = 'FL412';
  end if;

  update public.chapter_assessment_sessions s
     set status = 'completed', completed_at = now(),
         correct = v_correct, total = v_total,
         comprehension_correct = (p_scores ->> 'comprehension_correct')::int,
         comprehension_total   = (p_scores ->> 'comprehension_total')::int,
         vocabulary_correct    = (p_scores ->> 'vocabulary_correct')::int,
         vocabulary_total      = (p_scores ->> 'vocabulary_total')::int,
         grammar_correct       = (p_scores ->> 'grammar_correct')::int,
         grammar_total         = (p_scores ->> 'grammar_total')::int
   where s.id = p_session_id;

  -- The same evidence path as a test, a drill and a review. The Story Engine
  -- does not get its own knowledge model.
  perform public.apply_learning_evidence(p_user_id, p_evidence);
  perform public.touch_chapter_learning_state(
    p_user_id, v_session.chapter_id, 'assessment_completed'
  );

  if v_session.plan_item_id is not null then
    update public.daily_plan_items i
       set completed_count = least(v_total, i.target_count),
           status          = case when v_total >= i.target_count then 'completed' else 'in_progress' end,
           started_at      = coalesce(i.started_at, now()),
           completed_at    = case when v_total >= i.target_count
                                  then coalesce(i.completed_at, now()) else null end
     where i.id = v_session.plan_item_id and i.status <> 'skipped';
  end if;

  return query select v_correct, v_total, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. THE READER FEEDS THE LIFECYCLE.
-- ─────────────────────────────────────────────────────────────────────────────
-- `start_reading_session` and `complete_reading_chapter` already own the reading
-- facts. These wrappers let the reader's server actions advance the LEARNING
-- lifecycle in the same breath without either function learning about Phase 5 —
-- the reading tables stay exactly as Phase 4 left them.
create or replace function public.mark_chapter_reading_started(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  if not public.chapter_is_readable(p_chapter_id) then
    raise exception 'Brak dostępu do tego rozdziału.' using errcode = 'FL403';
  end if;
  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'reading_started');
end;
$$;

create or replace function public.mark_chapter_reading_completed(p_chapter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Brak zalogowanego użytkownika.' using errcode = 'FL401';
  end if;
  -- MEASURED, NEVER ASSERTED. The lifecycle only advances if the reading table
  -- — which itself refuses below the completion threshold — says the chapter was
  -- finished. There is no "mark this read" endpoint and there must not be one.
  if not exists (
    select 1 from public.reading_progress rp
    where rp.user_id = v_user and rp.chapter_id = p_chapter_id
      and rp.completed_at is not null
  ) then
    raise exception 'Ten rozdział nie został jeszcze ukończony.' using errcode = 'FL409';
  end if;
  return public.touch_chapter_learning_state(v_user, p_chapter_id, 'reading_completed');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. TODAY INTEGRATION.
-- ─────────────────────────────────────────────────────────────────────────────
-- COMPLETION STAYS DERIVED. `sync_daily_plan` recomputes each activity from the
-- table that recorded the underlying work — never from an assertion — which is
-- what makes plan completion idempotent, unforgeable and self-healing. The two
-- new branches follow exactly that rule: a preparation item is done when a
-- preparation session for the chapter completed today, an assessment item when a
-- Challenge did.
--
-- A SKIPPED PREPARATION COUNTS AS DONE. The learner resolved the task — they
-- decided they did not need it and went to read, which is the outcome the whole
-- engine is for. Leaving it pending would nag someone for doing the right thing.
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

    elsif v_item.item_type = 'chapter_preparation' then
      -- Completed OR skipped: both resolve the task. Skipping is the learner
      -- deciding they are ready to read, which is the point of the whole thing.
      if exists (
        select 1 from public.chapter_preparation_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status in ('completed', 'skipped')
          and s.completed_at >= v_day_start and s.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      else
        select count(*)::int into v_done
        from public.chapter_preparation_items pi
        join public.chapter_preparation_sessions s on s.id = pi.session_id
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status = 'in_progress'
          and pi.answered_at is not null;
      end if;

    elsif v_item.item_type = 'chapter_assessment' then
      if exists (
        select 1 from public.chapter_assessment_sessions s
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status = 'completed'
          and s.completed_at >= v_day_start and s.completed_at < v_day_end
      ) then
        v_done := v_item.target_count;
      else
        select count(*)::int into v_done
        from public.chapter_assessment_items ai
        join public.chapter_assessment_sessions s on s.id = ai.session_id
        where s.user_id = v_user and s.chapter_id = v_item.chapter_id
          and s.status = 'in_progress'
          and ai.answered_at is not null;
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
-- 19. GRANTS.
-- ─────────────────────────────────────────────────────────────────────────────
-- The split is the one every phase here uses. A learner may start, answer, skip,
-- defer and report — all of which derive the learner from auth.uid() and write
-- only what they did. A learner may NOT author a question bank, seal a session,
-- write an analysis or run a generation job, because every one of those accepts
-- computed values. Those are REVOKED from the roles a browser can hold, not
-- merely left ungranted.

revoke all on function public.upsert_chapter_questions(uuid, jsonb, jsonb) from public;
revoke all on function public.upsert_chapter_questions(uuid, jsonb, jsonb) from anon, authenticated;
grant execute on function public.upsert_chapter_questions(uuid, jsonb, jsonb) to service_role;

revoke all on function public.mark_stale_chapter_questions(uuid) from public;
revoke all on function public.mark_stale_chapter_questions(uuid) from anon, authenticated;
grant execute on function public.mark_stale_chapter_questions(uuid) to service_role;

revoke all on function public.upsert_chapter_analysis(uuid, uuid, jsonb) from public;
revoke all on function public.upsert_chapter_analysis(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.upsert_chapter_analysis(uuid, uuid, jsonb) to service_role;

revoke all on function public.start_chapter_preparation(uuid, uuid, jsonb, uuid, jsonb) from public;
revoke all on function public.start_chapter_preparation(uuid, uuid, jsonb, uuid, jsonb) from anon, authenticated;
grant execute on function public.start_chapter_preparation(uuid, uuid, jsonb, uuid, jsonb) to service_role;

revoke all on function public.finalize_chapter_preparation(uuid, uuid, jsonb) from public;
revoke all on function public.finalize_chapter_preparation(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.finalize_chapter_preparation(uuid, uuid, jsonb) to service_role;

revoke all on function public.start_chapter_assessment(uuid, uuid, bigint[], jsonb, jsonb, uuid) from public;
revoke all on function public.start_chapter_assessment(uuid, uuid, bigint[], jsonb, jsonb, uuid) from anon, authenticated;
grant execute on function public.start_chapter_assessment(uuid, uuid, bigint[], jsonb, jsonb, uuid) to service_role;

revoke all on function public.finalize_chapter_assessment(uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.finalize_chapter_assessment(uuid, uuid, jsonb, jsonb) from anon, authenticated;
grant execute on function public.finalize_chapter_assessment(uuid, uuid, jsonb, jsonb) to service_role;

revoke all on function public.touch_chapter_learning_state(uuid, uuid, text) from public;
revoke all on function public.touch_chapter_learning_state(uuid, uuid, text) from anon, authenticated;
grant execute on function public.touch_chapter_learning_state(uuid, uuid, text) to service_role;

revoke all on function public.start_chapter_generation_job(uuid, text) from public;
revoke all on function public.start_chapter_generation_job(uuid, text) from anon, authenticated;
grant execute on function public.start_chapter_generation_job(uuid, text) to service_role;

revoke all on function public.finish_chapter_generation_job(uuid, text, jsonb) from public;
revoke all on function public.finish_chapter_generation_job(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.finish_chapter_generation_job(uuid, text, jsonb) to service_role;

grant execute on function public.chapter_is_readable(uuid)                  to anon, authenticated;
grant execute on function public.fold_typed_answer(text)                    to anon, authenticated;
grant execute on function public.get_chapter_preparation(uuid)              to authenticated;
grant execute on function public.answer_preparation_item(uuid, bigint, int, int) to authenticated;
grant execute on function public.skip_chapter_preparation(uuid)             to authenticated;
grant execute on function public.get_chapter_question_candidates(uuid)      to authenticated;
grant execute on function public.get_chapter_assessment(uuid)               to authenticated;
grant execute on function public.answer_chapter_assessment_question(uuid, bigint, int, text, int[], int)
  to authenticated;
grant execute on function public.defer_chapter_assessment(uuid)             to authenticated;
grant execute on function public.mark_chapter_reading_started(uuid)         to authenticated;
grant execute on function public.mark_chapter_reading_completed(uuid)       to authenticated;
grant execute on function public.report_chapter_question(bigint, text, text) to authenticated;
grant execute on function public.set_chapter_question_status(bigint, text)  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. ROW LEVEL SECURITY.
-- ─────────────────────────────────────────────────────────────────────────────
-- Read-only to the learner it belongs to, and unwritable by anyone holding a
-- browser credential. There is no insert, update or delete policy on ANY table
-- in this migration — for the same reason there is none on `attempts`: a
-- Challenge result a learner can write is a result that proves nothing.
alter table public.user_chapter_learning_state  enable row level security;
alter table public.chapter_user_analysis        enable row level security;
alter table public.chapter_questions            enable row level security;
alter table public.chapter_question_concepts    enable row level security;
alter table public.chapter_question_stats       enable row level security;
alter table public.chapter_question_reports     enable row level security;
alter table public.chapter_generation_jobs      enable row level security;
alter table public.chapter_preparation_sessions enable row level security;
alter table public.chapter_preparation_items    enable row level security;
alter table public.chapter_assessment_sessions  enable row level security;
alter table public.chapter_assessment_items     enable row level security;

drop policy if exists "own chapter learning state read" on public.user_chapter_learning_state;
create policy "own chapter learning state read" on public.user_chapter_learning_state
  for select using ((select auth.uid()) = user_id);

drop policy if exists "own chapter analysis read" on public.chapter_user_analysis;
create policy "own chapter analysis read" on public.chapter_user_analysis
  for select using ((select auth.uid()) = user_id);

-- THE ANSWER ORACLE STAYS CLOSED.
--
-- `chapter_questions` has NO learner select policy — not for a reader, and not
-- for the owner of a private import either. A learner who could read this table
-- could read `correct_idx`, `accepted_answers` and `sequence_items`, which is the
-- whole answer key of every Challenge they are about to take. Prompts reach them
-- through `get_chapter_assessment`, for a question they are currently being
-- asked, and nowhere else.
--
-- Admins may read PUBLIC content's questions, to review the bank. A private
-- import is outside that: an admin panel is a content tool, not a reason to open
-- somebody's personal library.
drop policy if exists "chapter questions public read" on public.chapter_questions;
drop policy if exists "chapter questions admin read" on public.chapter_questions;
create policy "chapter questions admin read" on public.chapter_questions
  for select using (owner_user_id is null and public.is_admin());

drop policy if exists "chapter question concepts admin read" on public.chapter_question_concepts;
create policy "chapter question concepts admin read" on public.chapter_question_concepts
  for select using (
    exists (
      select 1 from public.chapter_questions q
      where q.id = chapter_question_concepts.question_id
        and q.owner_user_id is null
        and public.is_admin()
    )
  );

-- Global statistics are an admin tool for finding broken questions. A learner is
-- never shown them — "68% of people got this wrong" is a hint.
drop policy if exists "chapter question stats admin read" on public.chapter_question_stats;
create policy "chapter question stats admin read" on public.chapter_question_stats
  for select using (public.is_admin());

drop policy if exists "chapter question reports read" on public.chapter_question_reports;
create policy "chapter question reports read" on public.chapter_question_reports
  for select using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "chapter generation jobs admin read" on public.chapter_generation_jobs;
create policy "chapter generation jobs admin read" on public.chapter_generation_jobs
  for select using (
    exists (
      select 1 from public.chapters c
      join public.library_items i on i.id = c.library_item_id
      where c.id = chapter_generation_jobs.chapter_id
        and (
          (i.owner_user_id is null and public.is_admin())
          or i.owner_user_id = (select auth.uid())
        )
    )
  );

drop policy if exists "own preparation sessions read" on public.chapter_preparation_sessions;
create policy "own preparation sessions read" on public.chapter_preparation_sessions
  for select using ((select auth.uid()) = user_id);

-- The item rows carry `correct_idx`, so this policy is as narrow as it looks: a
-- learner may read their OWN preparation cards, which they have already been
-- shown. Preparation is a warm-up, not an assessment — the key is on screen
-- seconds later either way — but it is still scoped to the session's owner.
drop policy if exists "own preparation items read" on public.chapter_preparation_items;
create policy "own preparation items read" on public.chapter_preparation_items
  for select using (
    exists (
      select 1 from public.chapter_preparation_sessions s
      where s.id = chapter_preparation_items.session_id
        and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "own assessment sessions read" on public.chapter_assessment_sessions;
create policy "own assessment sessions read" on public.chapter_assessment_sessions
  for select using ((select auth.uid()) = user_id);

-- Readable because it holds the learner's own answers and no key: the correct
-- answer lives on `chapter_questions`, which they cannot read, and
-- `presented_order` is the shuffle they were shown.
drop policy if exists "own assessment items read" on public.chapter_assessment_items;
create policy "own assessment items read" on public.chapter_assessment_items
  for select using (
    exists (
      select 1 from public.chapter_assessment_sessions s
      where s.id = chapter_assessment_items.session_id
        and s.user_id = (select auth.uid())
    )
  );
