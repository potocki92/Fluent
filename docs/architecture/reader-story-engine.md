# Reader & Story Engine

> Phase 4. Read this before touching library content, chapters, structured text,
> reading progress, reading sessions, word occurrences, the content pipeline, or
> anything that writes `reading_*` tables.
>
> Its neighbours: [`learning-engine.md`](./learning-engine.md) owns evidence and
> knowledge state — the reader *feeds* it and must not bypass it;
> [`today-engine.md`](./today-engine.md) owns plans — the reader adds one
> candidate generator and one completion rule to it, and changes nothing else.

## The point of this phase

The mistake Phase 4 was most at risk of making was building a nicer book reader.

A reader is an interface. The thing worth building is the loop behind it:

```
 A learner reads a real story
        ↓
 Fluent knows exactly where they are          reading_progress
        ↓
 …which words they had to check               reading_lookups + learning_events
        ↓
 …and the sentence each one was in            word_occurrences → sentences
        ↓
 evidence reaches the knowledge model         apply_learning_evidence
        ↓
 the model gets more accurate                 user_word_knowledge
        ↓
 Today plans better                           daily_plan_items.chapter_id
        ↓
 the next chapter can be chosen better
```

Every decision below is in service of that loop. Where a decision made the
reader nicer but the loop weaker, the loop won.

## What was there before

One column: `texts.body`, an HTML string with `<mark data-lemma="X">`
annotations, parsed in the browser with `DOMParser` and rebuilt into React nodes
by `BodyContent` on every render.

For a 200-word A1 passage that is fine. As a foundation for books it fails in
four distinct ways, and they are worth naming because they are why the model
changed rather than the styling:

1. **Nothing to point at.** No paragraph, sentence or word occurrence exists as a
   thing, so a resume position, a contextual gloss, a sentence-level exercise or
   a per-sentence translation has nowhere to attach. Every one of those would
   have had to re-split stored text later and hope the boundaries matched.
2. **The book is one value.** Opening chapter 12 of a 300 000-word novel means
   loading 300 000 words.
3. **The markup is the data.** Changing how vocabulary is detected means
   rewriting stored content; the browser re-parses HTML on every render before a
   single word is interactive; and the text does not exist in the document until
   hydration, so an SSR fallback had to be rendered first to avoid a mismatch.
4. **Nothing is observable.** There is no record that a chapter was opened, how
   long it was read, or which words were checked — so the loop above cannot
   start.

## The model

```
library_items          a book, a story, an article, or a Fluent passage
    └── chapters       the unit of reading, of loading, and of progress
          └── paragraphs      plain text; positions are the bookmark
                └── sentences        the anchor for contextual help
                      └── word_occurrences   this word, in this sentence, here
```

Plus, per learner: `reading_progress` (where they are), `reading_sessions` (one
sitting), `reading_lookups` (what they checked), and
`chapter_vocabulary` (what the chapter demands, aggregated once).

### Library items

One model for everything readable. A story, a book, an article and today's
graded passages are the same thing to a reader — titled content made of chapters
— and modelling them separately would have meant two readers, two progress
models and two sets of analytics for the same act of reading. That is the
duplication this phase exists to remove, not to create.

**Content rights are a column, not a policy document.** `rights` decides who may
see an item at all:

| `rights` | Who may read it | Why it exists |
| --- | --- | --- |
| `first_party` | everyone, once published | written for Fluent |
| `public_domain` | everyone, once published | out of copyright |
| `licensed` | everyone, once published | publishable under a specific agreement, recorded in `rights_note` |
| `private_import` | **the owner, and nobody else** | someone's own file |

The rights model exists *before* there is an import feature on purpose. The
moment a learner can bring their own EPUB, "can Fluent show this to everyone?"
becomes a question the database has to answer, and retrofitting that answer onto
a public-by-default table is how content leaks. A `CHECK` constraint makes
"private implies an owner" an invariant rather than a convention.

Private is **absolute**, including for admins: `library_item_readable` returns
true for an owned item only for its owner, and the admin write policies exclude
owned items entirely. An admin panel is a content tool, not a reason to read
somebody's personal library.

**Soft delete, not delete.** Withdrawing a book sets `archived_at`; the rows
stay, so the reading history of everyone who read it stays joinable. See
[Deleting content](#deleting-content).

**Slugs are a convenience, ids are the identity.** A title can be corrected and a
slug can collide; neither may ever break a stored reading position. Slugs are
unique per owner-space, so two learners may both import *Der Prozess* without
colliding with each other or with the public library.

### Chapters

Chapters are a table, not an array on the item, because they are what a query is
scoped to: "give me chapter 12" must cost what "give me chapter 1" costs. They
are also what progress, sessions and plan items point at, so they need ids.

**Processing state lives on the chapter, not the item.** One unparseable chapter
must not take a whole book off the shelf: a failed chapter keeps its error for an
admin (`processing_error`) and is skipped by the reader, while every other
chapter stays readable.

`source_text` keeps the raw input, which is what makes reprocessing possible
without going back to wherever the text originally came from — and what makes
`content_hash` trustworthy, since it is computed from exactly that value.

### Paragraphs, sentences, occurrences

**Plain text, never stored HTML.** The reader renders structure; it never renders
stored markup. That is a security property (no sanitiser between the database and
the page), a portability property (the same rows can drive audio, exercises or an
export), and the reason a legacy `<mark>` body is parsed *back* to text on the way
in rather than copied across.

`bigint` identities rather than uuids: a 300 000-word book is roughly 20 000
sentences and a few hundred thousand occurrences, always read in position order,
so sequential keys keep those reads on adjacent index pages.

**Why sentences are their own table.** "Er zog sein Schwert." is where *ziehen*
means *wyciągnąć* rather than *ciągnąć*. Without a sentence id there is nothing
for a contextual translation, a grammar note, an audio clip, a bookmark or a
sentence exercise to hang off. The columns for those exist and are deliberately
`NULL` — Phase 4 builds the place, not the content, because generating
translations against a tokenizer that may still change is paying twice.

**Why occurrences.** `<mark data-lemma="Schwert">` was a rendering instruction.
A `word_occurrence` is the datum behind it: a specific token, at a specific
position, resolved to a specific dictionary entry. That is what lets a lookup be
recorded against *a place in a book* rather than against a string.

Only tokens that resolve to the dictionary get a row. An occurrence exists to be
interacted with, and a token Fluent cannot gloss has nothing to show; unmatched
content words are counted and sampled on the chapter instead
(`unmatched_sample`), which surfaces the dictionary gap without storing a row per
*"the"*.

**Towards lexeme → sense → occurrence.** Phase 4 does not build a lexical
database, and the current schema deliberately does not assume `lemma → exactly
one Polish translation` forever. An occurrence resolves to a `word_id` — a
headword, not a sense. A future sense layer attaches to the occurrence
(`word_occurrences.metadata`, or a `sense_id` column plus a `senses` table) with
no change to paragraphs, sentences, progress or the reader: the seam is already
where it needs to be.

## Reading progress: resume vs furthest

This is the single most important design decision in the phase.

A learner who scrolls back to re-read the opening of a chapter **is at**
paragraph 3 and **has read** up to paragraph 80. One number cannot be both.
Stored as one, either the bookmark is wrong or the progress bar collapses from
80% to 4% because someone checked something — and a progress bar that goes
backwards is one nobody believes again.

```
resume_paragraph_position     follows the learner, moves in both directions
furthest_paragraph_position   only ever increases
progress_ratio                derived from furthest; only ever increases
```

The monotonicity is enforced by `greatest(...)` inside
`record_reading_progress`, not by an application `if`: two tabs on the same
chapter can and do report different positions, and only the database sees both.
The pure version of the same rule — and its regression test — lives in
`src/lib/reading/progress.ts`.

**Positions, not foreign keys.** Reprocessing a chapter replaces its paragraph
rows, so a resume pointer that was a paragraph id would dangle or be nulled on
every reprocess. The pipeline is deterministic, so position 43 is position 43
before and after: a stable bookmark, for free.

**How position is observed.** Not scroll percent — that is a fact about a
viewport, not about a reader, and it is wrong the moment an image loads, a font
swaps or the window is resized. `useVisibleParagraph` takes the furthest
paragraph that was genuinely on screen (half of it, or most of the viewport for
a paragraph taller than the screen). This is not anti-cheat; someone determined
to fling the scrollbar can. It is about the number meaning something for the
reader who is not trying to game it.

**How often it is written.** Never per scroll event. At most one write every
`PROGRESS_FLUSH_MS`, an early one the first time the learner has genuinely moved
`PROGRESS_FLUSH_PARAGRAPHS` through the chapter, and a forced one when the page
is hidden (`visibilitychange` / `pagehide` — the mobile-safe replacements for
`unload`).

**Completion is an act.** A sticky footer, a short final line or a layout shift
can put the end of a chapter on screen without anyone having read it, so
finishing is an explicit button — and `complete_reading_chapter` refuses below
`CHAPTER_COMPLETION_RATIO` regardless of what the button does. Completing twice
returns the stored summary and writes nothing.

## Reading sessions and active time

`reading_sessions` is one sitting with a chapter. One active session per
(learner, chapter) — a unique partial index — because two tabs sharing a session
is the only way the chapter summary does not count everything twice.

**A tab open for two hours is not two hours of reading.** Recording it as such
would poison everything computed from it: reading speed, lookup rate, the chapter
summary, and eventually a per-learner time estimate. So `useActiveReadingClock`
accumulates seconds only while

- the document is visible, **and**
- something happened within `IDLE_TIMEOUT_MS`.

The idle window is a full minute on purpose: reading is mostly *not*
interacting, and a clock that stopped after ten seconds of stillness would
under-count the most engaged reading in the session.

The client's claim is never trusted: `record_reading_progress` caps what one
report may add (`MAX_ACTIVE_SECONDS_PER_REPORT`), which is the same answer to a
slept machine, a paused debugger and a forged request. The result is not
laboratory-accurate and does not try to be; it is the difference between a
number that is roughly true and one that is fiction.

## Contextual vocabulary

### A lookup is not a failed test

This is the judgement the reader most needed to get right, because getting it
wrong would quietly corrupt the knowledge model for every learner who reads a lot.

Tapping *Schwert* means "I was not sure enough to keep going". That is genuine
negative evidence about receptive knowledge of that word — and it is much weaker
than getting *Schwert* wrong in a graded item, because people also tap to confirm
a guess, out of curiosity, or by accident.

So `readingLookupEvidence` records it with the `passive` response weight (0.2)
discounted again by `LOOKUP_EVIDENCE_DISCOUNT` (0.5): **0.1**, a sixth of a
multiple-choice answer. One tap barely moves the estimate. The same word looked
up five times across five chapters moves it clearly — and that is exactly the
signal worth having.

**No concept is tagged.** A lookup says the word was unknown; it says nothing
about *why*. Attributing it to `lexical_recognition` would be the model inventing
a weakness from a gesture, which is the rule the learning engine already refuses
to break.

**Chapter started / chapter completed score nothing at all.** Those events carry
no skill, no concept and no word, so `foldEvidence` moves no state when it sees
one. Having read a chapter is not evidence that its language was understood, and
a reader that credited comprehension for scrolling would be inventing exactly the
knowledge Fluent refuses to claim. They are written because the reading *history*
is worth having.

### Two records, on purpose

| Table | What it is for |
| --- | --- |
| `learning_events` | evidence — what this says about the learner. Survives the book being deleted (`on delete set null`). |
| `reading_lookups` | behaviour — which word, in which sentence, in which chapter, when. Cascades with the chapter. |

`reading_lookups` is what "you have looked *Schwert* up five times, in five
different chapters" is computed from, and what makes the reader's eventual
headline metric possible:

> In chapter one you checked one word in nine. Now you check one in thirty-one.

Both halves of that ratio are already recorded: `reading_progress.lookup_count`
against `progress_ratio × chapters.word_count`. Nothing displays it yet — the
data has to exist before the feature can be honest about it.

**Idempotency.** `interaction_id` is minted per tap and unique per learner. Only
a genuinely new lookup applies evidence; a retried request returns the stored
state. Without that guard a flaky connection would slowly convince Fluent the
learner knows less than they do, because a lookup is negative evidence.

### A saved word remembers where it came from

`save_word_from_reader` derives the origin *from the occurrence* rather than
accepting it from the caller, so a card cannot claim a sentence the word never
appeared in — and the sentence text is **copied** onto `saved_words.origin_context`
rather than referenced. A reference would break the moment a private book is
deleted or a chapter reprocessed, and a flashcard losing its context because
someone tidied their library is exactly the kind of quiet data loss that makes a
feature untrusted.

Only a new card gets an origin: re-saving a word keeps the first place it was
met. The review UI does not show it yet; the data is there for when it does.

### Vocabulary coverage

`chapter_vocabulary` aggregates the chapter's distinct words once, at processing
time, so "how much of this do I know?" is a bounded join rather than a scan over
hundreds of thousands of occurrences.

`estimateCoverage` **refuses to quote a figure it cannot support.** Fluent knows
something about a few dozen of a learner's words; a chapter has hundreds of
distinct ones. Dividing across that gap produces a number that is confident and
false, and a learner will use it to decide whether to start a book. Below
`MIN_COVERAGE_OBSERVATIONS` observed words, or below `MIN_COVERAGE_SHARE` of the
chapter's vocabulary, the result is `insufficient_data` and the UI says so.

The estimate is weighted by how often each word appears, because knowing the word
that occurs forty times matters more to the experience of this chapter than
knowing one that occurs once. Words with no evidence are excluded from both sides
of the ratio rather than counted as unknown — counting them as unknown would tell
a new learner they know 0% of every chapter, which is not a measurement but the
absence of one.

`preReadingCandidates` is the other half of the same data: the words worth
learning *before* a chapter. Phase 4 produces it and shows it nowhere.

## The content pipeline

```
raw source
   ↓ normalize        strip markup, fix invisible characters   normalize.ts
   ↓ paragraphs       blank line = paragraph, stable positions paragraphs.ts
   ↓ sentences        German-aware splitting                   sentences.ts
   ↓ tokenize         words, not `split(" ")`                  tokenize.ts
   ↓ dictionary       token → word_id                          dictionary-match.ts
   = ProcessedChapter                                          process.ts
```

Every step is a separate module and every module is pure — no Supabase, no
clock, no randomness. Persisting is `src/actions/admin-library.ts`'s job, and
that split is what lets the whole pipeline be unit-tested on a fixture.

**Why the linguistics are TypeScript and the transaction is SQL.** The same
contract as everywhere else in Fluent: `src/lib/` owns the arithmetic and has the
tests, the database owns transactions. Re-implementing sentence splitting in
PL/pgSQL would give Fluent two tokenizers that disagree.

### German sentence splitting

`text.split(".")` breaks on the first page of any real book:

- abbreviations — *z. B.*, *Dr. Müller*, *usw.*, *Nr. 4*
- ordinals and numbers — *am 3. Mai 1988*, *ca. 2.500 Euro*
- dialogue — *»Warum?« fragte sie.* is **one** sentence
- the terminators themselves — `!`, `?`, `…`, runs like `?!`

The splitter accepts a boundary only when what follows looks like a new sentence
(whitespace, then an opening quote, a dash, a digit or a capital), which disposes
of most abbreviation cases on its own, and then checks an explicit abbreviation
list, single-letter initials and ordinals.

A statistical segmenter would be better and would also be a multi-megabyte
dependency, a model download and a source of non-determinism across versions.
`CONTENT_PROCESSOR_VERSION` is what makes replacing it later a decision rather
than a migration hazard.

### Determinism, hashing and reprocessing

The same source and dictionary always produce the same structure, down to every
position. That is not a nicety: positions are stored and pointed at, and
reprocessing must not move a learner's bookmark. `process.test.ts` asserts it
directly.

`content_hash` + `processor_version` together decide whether a reprocess would
change anything. If neither moved, the stored structure is already exactly what
the run would produce and **nothing is written** — every rewrite replaces
paragraph rows, and churn for zero gain is pure risk.

When a reprocess does run, `replace_chapter_content` replaces paragraphs
wholesale in one transaction (sentences and occurrences cascade). An upsert on
"position" would leave orphans behind whenever a chapter got shorter; wholesale
replacement is the only shape that cannot duplicate. The DB suite asserts that
processing twice leaves exactly the same row counts and the same positions.

**Bump `CONTENT_PROCESSOR_VERSION`** whenever the pipeline's output for the same
input could differ — a new abbreviation, a different token regex, a changed
normalisation rule. Not for comments or refactors that cannot move a boundary.

**The dictionary is the third input, and nothing hashes it.** `content_hash`
describes the source and `processor_version` describes the pipeline; neither
says anything about `words`. So a chapter processed yesterday keeps yesterday's
occurrences forever, and a word added today is in `/browse` but dead text in the
book — the pipeline only writes an occurrence for a token it could MATCH, and an
unmatched token is not a tappable span at all. Growing the dictionary therefore
needs an explicit reprocess: `force: true`, which is what `/admin/library`'s
"Przetwórz" passes for first-party content and what `refreshBookVocabulary`
passes for a private import, whose owner has no admin panel to reach (the admin
list filters owned items out by design). It is safe to run because the source is
unchanged and the pipeline is deterministic: every position comes back identical,
so bookmarks, notebook notes and saved words survive and only `word_id` changes.
Stamping a dictionary fingerprint on the chapter would let a plain reprocess
notice by itself; that is a schema change and a deliberate task, not a side
effect of importing a wordlist.

### Content quality

Processing produces a report per chapter, stored on it:

- `paragraph_count`, `sentence_count`, `word_count`
- `dictionary_match_rate` — share of content words Fluent can gloss
- `unmatched_sample` — the most frequent words it cannot, with counts

That last one is what turns a bad match rate into a task: it names the words the
dictionary is missing. `/admin/library` shows both.

**Compounds.** German compounding means no dictionary will ever match everything
(*Krankenversicherung*, *Fußgängerübergang*). Phase 4 does not attempt
decomposition. What it does is refuse to treat an unmatched token as a useless
one: it is counted, sampled, and reported, which is the input a compound splitter
or a dictionary expansion would be built from.

## Rendering

**The prose is a server component.** `ReaderProse` renders paragraphs, sentences
and interactive words as ordinary elements with `data-*` attributes. The chapter
is real document text in the first response — selectable, findable with the
browser's own search, correct with JavaScript disabled — and there is no
`DOMParser`, no plain-text fallback, and no hydration divergence, because the
server and the client render the same thing from the same rows.

**One listener, not a component per word.** A 15 000-word chapter would otherwise
mount thousands of components that never re-render. `ReaderShell` handles every
word with one delegated `click` / `keydown` handler on the container, and reads
the sentence text out of the DOM rather than shipping every sentence twice.

**No virtualization.** A chapter is text; a 15 000-word chapter is ~100 KB of
HTML, which browsers render well. Virtualizing it would break native text
selection, scroll anchoring and in-page search — the three things a reader must
not break — in exchange for a performance problem that does not exist at this
size. If a single chapter ever gets big enough to matter, the fix is to split it,
not to virtualize it.

**No whole-book queries.** Opening a chapter is three bounded queries
(paragraphs, sentences, occurrences), all keyed by `chapter_id`. The next
chapter's *route* is prefetched; its content is not.

### Accessibility, and one accepted cost

Interactive words are focusable `<span>`s, deliberately **not** `role="button"`.
A screen reader announcing "button" a thousand times a chapter turns continuous
prose into a list of controls, which breaks the thing the reader exists for. The
accepted cost is that keyboard users tab through many stops inside a chapter.
That is real, it is written down here rather than hidden, and the alternative was
worse. A better answer (a reading-mode roving focus, or a lookup triggered from a
text selection) is a deliberate future piece of work.

Text selection is never blocked: a learner may be copying a phrase, and phrase
lookup is a feature this reader must not have designed itself out of. The gloss
handler checks for an active selection before opening.

### Typography and theme

The reader has its own palette and measure because forty minutes of prose is a
different activity from eight minutes of answering questions. Rather than
touching the global theme, `.reader-surface` declares its own variables
(`--reader-bg`, `--reader-fg`, `--reader-accent`, …) and everything inside reads
those; `data-reader-theme` switches between dark, light and sepia.

Size, leading and font family are CSS custom properties set inline from the
learner's saved preferences, so changing them re-renders nothing and the chosen
size is on the **first paint** — the page is server-rendered with it, so there is
no flash of default type.

Preferences live on `profiles.reader_preferences` (jsonb), not in
`localStorage`: someone who sets 20px serif on their phone should not meet 17px
sans on their laptop. They are ordinary learner-owned preferences — nothing about
them is progress — so the profile write guard leaves them alone. They are stored
as one jsonb value because they are a single preference object that will grow and
none of it is ever queried or constrained; that is the opposite of the rule in
`learning_events`, where the columns that matter are columns.

The serif stack is whatever the device already has (Charter, Georgia, Iowan Old
Style…). Shipping a 200 KB display serif to make a reading screen prettier is a
cost the learner pays on every chapter.

**Interactive words look like words.** Roughly a quarter of the tokens on a page
resolve to the dictionary; giving each a background turns a book into a Christmas
tree and makes the text *harder* to read than the plain version. The resting
state is a faint dotted underline; colour arrives on hover, focus, or while that
word's gloss is open. LingQ-style per-word mastery colouring is explicitly not in
this phase.

**Loudness is a rendering decision; resolving is not.** `matchToken` used to
return null for closed-class words before it even looked them up, so that the
page would not fill with marks. That put a presentation rule inside the
linguistic layer, and it cost more than particles: `GERMAN_FUNCTION_WORDS`
contains *haben*, *sein*, *werden*, *können*, *müssen*, *sollen* and *wollen*, so
a learner could import *wir* into the dictionary, see it in `/browse`, and find
it dead in the book — on the Prolog fragment that silenced 64 of 423 imported
entries and one lexical token in five. The matcher resolves every token now, and
the reader decides how loudly to mark one: a closed-class word is tappable and
highlights, but carries no dotted underline (`data-function-word`, styled only
in the hover-capable media query — a touch device never drew underlines at all,
so the old rule was buying nothing there). The set still governs
`isReportableGap`, where "a missing *der* is not a curation task" is exactly
right. The cost is real and accepted: a chapter now stores an occurrence per
closed-class token, so `word_occurrences` grows and `dictionary_match_rate`
rises.

**And verbs left the set entirely.** It carried *haben*, *sein*, *werden* and
every modal, which made the word a German sentence turns on the one word a
learner could not look up — and the finite forms were inconsistent with it
anyway (*sollten* was marked, *sollen* was not). A verb form is a content word
in all of its forms. Taking them out alone would have been a regression,
though, because the set was quietly doubling as a false-positive shield: the
suffix rules cannot reach *sein* from *ist*, and they confidently strip *waren*
to *Ware* and *bist* to *bis*. So `IRREGULAR_BASE_FORMS`
(`german-morphology.ts`) now maps the auxiliaries' and modals' irregular forms
to their infinitives, and `matchToken` consults it BEFORE the surface lookup —
the surface is matched umlaut-folded, and folding is what turns *wäre* into
*Ware*. Measured on the Prolog fragment, matched surface forms went from 392 of
551 to 500. Strong verbs (*sah*, *saß*, *trug*, *begann*) and oblique pronouns
(*mir*, *ihn*) are the same class of problem and are deliberately NOT in that
table yet. `CONTENT_PROCESSOR_VERSION` is `content_v3`.

## Today integration

The Today engine was built so this would be additive, and it was: one candidate
generator, two item types, one completion rule.

- **`chapterCandidates`** (`planner/candidates.ts`) emits `continue_chapter` for
  the chapter already begun and `new_chapter` for the next one of something
  already being read — or, failing both, the best-fitting first chapter in the
  library. It excludes items with a `legacy_text_id`, because a migrated passage
  would otherwise produce two candidates for the same content (one from the
  passage generator, one from here) and a plan with the same task twice is a bug
  the learner can see.
- **Level fit is coarse on purpose.** A library item carries a CEFR estimate, not
  an Elo rating, because nobody has calibrated a novel against an item bank.
  `chapterLevelSignal` returns one of three values; pretending to Elo precision
  would be inventing a signal.
- **A reading task is a SEGMENT, not a chapter.** "Przeczytaj rozdział 12" in a
  twelve-minute plan is a task the learner cannot finish, which teaches them the
  plan does not mean anything. `chapterSegmentMinutes` sizes a slice from the
  daily budget, capped, and never longer than the chapter itself.
- **Completion is still measured, never asserted.** `sync_daily_plan` marks a
  reading item done when either the chapter was completed today
  (`reading_progress.completed_at`, which itself refuses below the threshold) or
  the learner put in `target_seconds` of *active* reading on it today. Opening a
  chapter moves the item to `in_progress` and no further — the two are different
  facts, measured from different columns.
- **`target_seconds` is computed by the planner**, from
  `src/lib/reading/constants.ts`, and written onto the item. The database only
  compares. That keeps the rule in one place and keeps it unit-tested.

## Migration and compatibility

Every `texts` row becomes a library item with exactly one chapter, linked by
`library_items.legacy_text_id`. Nothing is moved, renumbered or deleted: `texts`
keeps its `body`, its questions, its completions, its test sessions and its place
in today's plans.

**The migration creates shells, not content.** It has no tokenizer (see above),
so chapters land as `status = 'draft'` with their `source_text`, and the
TypeScript pipeline fills them in from `/admin/library`.

**Nothing breaks in the meantime.** `/learn/[textId]` redirects into the reader
*only* once the chapter is `ready`; until then it renders the legacy body exactly
as before. A project upgrading to Phase 4 therefore needs no content freeze, and
no learner is blocked on a migration. Once processed, `publish_processed_legacy_items`
re-publishes the item — the admin already made that decision when they published
the `texts` row and must not have to make it twice.

**`backfill_library_from_texts` is a function, not a one-off block**, because the
gap keeps reopening: an admin who writes a new passage tomorrow creates a `texts`
row with no library item. It runs again every time content is processed.

### Transition plan

| Now | Next | Eventually |
| --- | --- | --- |
| `texts` holds the source of truth for passages; the library mirrors them one-to-one | New passages are authored as library items directly; `texts` keeps only the rows that have questions attached | `texts` becomes a thin join table between a chapter and its comprehension questions, or questions move to `chapter_id` and `texts` is retired |

The one thing that must not happen is two readers. `/learn/[textId]` is a
redirect, not a second implementation, and it should stay that way.

## Security

| Table | Read | Write |
| --- | --- | --- |
| `library_items`, `chapters`, `paragraphs`, `sentences`, `word_occurrences`, `chapter_vocabulary` | `library_item_readable` — published content is public-read, private imports are owner-only, everything else admin-only | admins, and **never** a private import; content itself is written by `replace_chapter_content` (service role) |
| `reading_progress`, `reading_sessions`, `reading_lookups` | owner only | **nobody** — no insert/update policy exists |

Reading progress is progress, and progress in Fluent has no learner write path.
Every change goes through a `SECURITY DEFINER` function that derives the learner
from `auth.uid()` rather than believing a parameter:
`start_reading_session`, `record_reading_progress`, `complete_reading_chapter`,
`end_reading_session`, `save_word_from_reader`.

Functions that take a user id, accept computed state, or write content are
service-role only and are **revoked** from `anon`/`authenticated`, not merely
left ungranted: `replace_chapter_content`, `fail_chapter_processing`,
`apply_reading_lookup`, `apply_reading_event`, `backfill_library_from_texts`,
`publish_processed_legacy_items`.

**Privacy of content.** Private books can contain a learner's own documents. Log
ids, never sentences: nothing in the reader's server actions logs chapter text,
sentence text or a book's title, and the error boundary shows one Polish sentence
rather than a database message.

### Deleting content

Delete behaviour was chosen per table rather than set to `cascade` everywhere,
because library content has learning history attached to it:

- `chapters`, `paragraphs`, `sentences`, `word_occurrences`,
  `chapter_vocabulary`, `reading_progress`, `reading_sessions`,
  `reading_lookups` → **cascade**. Position in a chapter that no longer exists is
  meaningless.
- `learning_events.{library_item_id, chapter_id, sentence_id,
  word_occurrence_id, reading_session_id}` → **set null**. Deleting a private
  import must remove the *content*, not the learner's history of having learned
  from it.
- `saved_words.origin_*` → **set null**, with the sentence text already copied
  into `origin_context`, so the card survives intact.
- Public content is **archived**, not deleted (`archived_at`).

That split is the data-retention model: a learner can have their imported content
removed while their aggregate learning survives, detached from the book that is
gone. A full GDPR erasure story (export, per-table erasure, retention windows) is
not built and is not claimed.

## Deliberately not in this phase

EPUB/PDF/DOCX import · a public book marketplace · AI translation, AI grammar,
AI summaries · chapter question generation and chapter tests · spoiler guard ·
AI tutor · speaking and listening · FSRS · social reading · a highlights and
annotations system · a lexeme/sense dictionary rewrite · LingQ-style per-word
colouring · full-text search in a book · offline/PWA.

Two of those have data-model room already: a bookmark or highlight is a row
pointing at a sentence id, and search is an index on `sentences.text`. Neither is
built.

## Where to change what

| Change | File |
| --- | --- |
| sentence/word splitting rules | `src/lib/content/{sentences,tokenize}.ts` (bump `version.ts`) |
| what a lookup is worth | `src/lib/learning/evidence.ts` + `src/lib/reading/constants.ts` |
| completion threshold, idle timeout, flush cadence | `src/lib/reading/constants.ts` |
| coverage honesty floors | `src/lib/reading/constants.ts` |
| reading plan sizing | `src/lib/learning/planner/constants.ts` |
| reader typography/theme options | `src/lib/reading/preferences.ts` + `.reader-surface` in `globals.css` |
| how a chapter is persisted | `replace_chapter_content` (SQL) + `chapterPayload` (`src/actions/admin-library.ts`) |
