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

**Every lexical token gets a row.** This is the invariant, and it replaced the
opposite one:

> Every lexical token gets an occurrence. Dictionary resolution is **optional**
> and may evolve independently of the immutable reading structure.

The original rule was "only tokens that resolve to the dictionary get a row",
which sounded like good hygiene and was in fact a coupling: it made the
*structure* of a book a function of the dictionary on the day it was imported.
See [The dictionary is the third input](#the-dictionary-is-the-third-input) for
what that cost and how it works now.

The four fields that carry the distinction:

| Field | What it is | Depends on the dictionary? |
| ----- | ---------- | -------------------------- |
| `surface` | the token exactly as written — *Bücher*, *zog*, *E-Mail-Adresse* | no |
| `normalized` | the lookup key: lowercased, apostrophes folded, umlauts kept | no |
| `lemma` | the dictionary headword, or — while there is none — the normalized surface, standing in **provisionally** | yes |
| `word_id` | the entry, or `NULL` meaning "no entry **today**" | yes |

`position`, `char_start` and `char_end` are structure and never move. `word_id`
and `lemma` are knowledge and are rewritten in place as the dictionary grows.

A `NULL` `word_id` is not a defect and never a reason to skip a row: the reader
renders such a token as an ordinary interactive word (quietly — see
[Loudness](#loudness-is-a-separate-question)), the learner can give it a
contextual meaning of their own, and the day somebody adds the entry it resolves
without the chapter changing at all.

The dictionary GAP is still reported on the chapter (`unmatched_sample`,
`dictionary_match_rate`, `chapter_vocabulary`). Those count **real matches**, not
rows, so growing the row set did not silently turn every chapter into a perfect
score.

**Towards lexeme → sense → occurrence.** Phase 4 does not build a lexical
database, and the current schema deliberately does not assume `lemma → exactly
one Polish translation` forever. An occurrence resolves to a `word_id` — a
headword, not a sense. A future sense layer attaches to the occurrence
(`word_occurrences.metadata`, or a `sense_id` column plus a `senses` table) with
no change to paragraphs, sentences, progress or the reader: the seam is already
where it needs to be.

## Reading progress: the Reading Position Engine

This is the single most important design decision in the phase, and it was
rebuilt once — see *What was wrong the first time* below.

### Three positions, and they are three different facts

```
current    where the learner is looking RIGHT NOW.      moves both ways
resume     where to put them when they come back.       moves both ways
furthest   the furthest text genuinely READ.            forward only
```

Collapsing any two of them breaks something a reader notices within a minute:

| collapsed | what breaks |
| --- | --- |
| `current = furthest` | a fling to the end marks the chapter read |
| `resume = furthest` | backing up to re-read a page, then closing the app, drops you back where you had already been |
| `furthest = resume` | the progress bar falls from 45% to 31% because somebody checked an earlier paragraph |

There is a fourth thing the reader remembers and the database does not: the
**origin**, where this sitting began. It never moves, and it is what
„Wróć do miejsca, gdzie skończyłeś" goes back to.

The monotonicity of `furthest` is enforced by `greatest(...)` inside
`record_reading_progress`, not by an application `if`: two tabs on the same
chapter can and do report different positions, and only the database sees both.
The pure version of every rule — and its regression tests — lives in
`src/lib/reading/position.ts` and `src/lib/reading/progress.ts`.

### A bookmark is a place in the text, never a pixel

`window.scrollY`, `scrollTop / scrollHeight` and "43% down the document" are all
facts about one viewport, with one font, at one width. Rotate the phone, change
the type size, open the book on a laptop, and every one of them points somewhere
else. So the bookmark is a **reading anchor**:

```ts
type ReadingAnchor = {
  paragraphPosition: number;
  sentencePosition: number | null;   // sentences.chapter_position
  tokenPosition: number | null;      // lexical token inside that sentence
};
```

**Positions, not foreign keys.** Reprocessing a chapter deletes and re-inserts
every paragraph, sentence and occurrence row, so an anchor identified by a row id
would dangle on every reprocess. The pipeline is deterministic by requirement, so
position 43 is position 43 before and after — a stable bookmark, for free. It is
the same argument that has always kept `resume_paragraph_position` a number
rather than a reference.

**The two finer fields are nullable on purpose.** A bookmark written before this
engine knows only its paragraph and resolves to the start of it. Nothing needs
resetting, and the first report after an upgrade writes a precise one.

### Progress is measured in words

```
progress_ratio = furthest_word_offset / chapters.reading_word_count
```

where a *word* is a lexical token — the unit the content pipeline already counts.
Each sentence carries `word_start`, the running total of the tokens before it, so
turning an anchor into an offset is one index seek:

```
sentence 126   word_start = 1841, word_count = 13
token 7        →  chapter word offset 1848
                  1848 / 4820 = 38.3%
```

`word_start` and `chapters.reading_word_count` are **derived by the database**
when content is stored (`replace_chapter_content`), not asserted by the payload.
That is why the pipeline itself is untouched by this work and
`CONTENT_PROCESSOR_VERSION` did not move: the same source still produces the same
paragraphs, sentences, tokens and positions.

`reading_word_count` is deliberately not `chapters.word_count`. The latter is
counted differently (`countWords` over paragraph text, for display and time
estimates) and is a few tokens off — enough to leave the last word of a chapter
at 99.7%.

### What was wrong the first time

The first version of this engine stored a paragraph index and nothing else.

1. **`(furthest_paragraph + 1) / paragraph_count`** gave an eight-word line of
   dialogue and a four-hundred-word description the same weight. In a novel that
   is not a rounding error: reading two lines of a chapter of dialogue could
   report 8%, and reading three pages of description could report 2%. A chapter
   of two paragraphs reported 50% after ten words.
2. **A paragraph is far too coarse to be a bookmark.** A learner who stopped in
   the middle of a 400-word paragraph was returned to the top of it, and
   `resume_sentence_position` — which existed — was never written by anything.
3. **`useVisibleParagraph` only ever increased.** It reported the furthest
   paragraph seen, so it could not tell "I am here" from "I have been here", and
   the flush condition `visible > flushed` could only fire going forward. Reading
   to 42%, scrolling back to 31% and closing the app wrote nothing on the way out
   and re-opened at 42%.

### How position is observed: the Reading Line

One virtual horizontal line across the viewport, at `READING_LINE_RATIO` (38%) of
its height. It is never drawn. Whatever sentence crosses it is where the learner
is — and that single question replaces every scroll-percentage heuristic.

38% rather than 50% because the sentence a reader is on sits above the middle of
the screen; the lines below it are the ones they are about to read. At the centre
every bookmark lands roughly a paragraph late.

**The line is not fixed, and that matters more than it sounds.** Everything
*below* it can only be brought up to it by scrolling — so whatever is still below
it when the document stops scrolling can never be reached at all. For a text that
fits on one screen (a short article, a migrated passage) that is most of the
chapter, and the bar would sit below half with nothing the learner could do about
it. It was also why a long chapter's last paragraphs depended on there happening
to be enough furniture under the prose to push them up.

So the line stays at 38% while there is a screenful of scroll left and **glides
down to the bottom of the viewport exactly as fast as the remaining scroll runs
out** (`readingLineY`). At the bottom of a document — or in one that never
scrolled — the sampling point is the bottom of the screen, which says the obvious
true thing: everything visible, with nowhere further to go, has been reached. A
glide rather than a jump, so progress does not lurch on the last screen.

Placing is not sampling: `scrollTo` always aims at the *resting* line, or
restoring a bookmark near the end of a chapter would aim at the bottom of the
screen, be clamped by the browser, and land a screenful short.

Resolving it is `document.elementsFromPoint` — **one hit test, independent of the
chapter's length** — plus a bounded scan of the words inside the sentence it
found, to say which token the line is on. A 15 000-word chapter costs what a
500-word one costs. `elementsFromPoint` rather than `elementFromPoint` because
the reader has overlays and the topmost element at a point is not always prose.
When the line falls in a margin or between paragraphs, a binary search over the
paragraph boxes answers instead, in log(n) measurements.

Nothing is cached, deliberately. Every measurement is read live, so a font
change, a rotation or a resize needs no invalidation — there is nothing to
invalidate.

**Sampling.** Scrolling schedules at most one resolve per animation frame; a
`READING_SAMPLE_MS` heartbeat keeps asking while the document is visible, because
dwell has to be able to complete after scrolling has *stopped*. No React state is
written for either: the position lives in a ref and the progress bar subscribes
to it, so a whole chapter of scrolling costs zero renders of the reader.

### Scrolled past is not read: dwell

`furthest` follows `current` with a delay measured in **active reading time**. The
engine keeps a short trail of samples and lets the furthest position advance only
as far as the sample that is `READ_DWELL_MS` (700ms) old.

Reading normally, the trail moves a line or two and the lag is invisible. A fling
from 20% to 90% outruns it completely: `current` is 90% immediately — that
genuinely is where the learner is looking — and `furthest` stays at 20% until the
new place has held. "Active" is `useActiveReadingClock.isActive()`, the same
predicate the clock runs on, so a hidden tab or an idle reader parked on the last
page confirms nothing at all.

This is not anti-cheat; someone determined to fling and wait can. It is about the
number meaning something for the reader who is not trying to game it.

### Restoring the position

The bookmark is read **on the server, in the page render** — not from
`startReadingSession`, which is a Server Action and answers after the page has
painted. That is the difference between opening a book at page 94 and opening it
at page 1 and being thrown to page 94.

```
full page load      <script> after the prose, during parsing → no paint at the top
client navigation   useLayoutEffect → React has committed, the browser has not painted
webfonts arrive     one silent correction, abandoned the moment the learner scrolls
```

The initial restore is always `behavior: "auto"`. A smooth scroll from the top to
31% is a two-second animation through text the learner has already read, and it
announces that the app had to go and look. Everything the *learner* asks for —
"take me back" — is smooth, because there the animation is feedback.

The inline script interpolates **nothing** into JavaScript: its body is a fixed
string, the anchor travels as a data attribute React escapes, and every field is
coerced with `Number` before it reaches a selector.

### Typography, rotation and resize

Changing the type size or rotating the phone moves every pixel in the document.
Because the bookmark is a place in the *text*, the fix is the same in all three
cases: remember the anchor, let the layout change, put the anchor back on the
reading line. The text then appears to have re-flowed **around** the sentence
being read.

A height-only resize is explicitly *not* a relayout: on a phone that is Safari's
toolbar collapsing or the keyboard opening, the text has not moved, and
re-anchoring there would fight the browser for the scroll position on every
gesture.

### A deep link beats the bookmark

`?sentence=` from the notebook means "take me to THIS sentence", which is a
different request from "take me back to where I stopped". The deep link wins, the
restore stands down entirely — and the bookmark does **not** follow, so somebody
who arrives, glances and leaves keeps the place they actually stopped at.
Somebody who arrives and then reads for `DEEP_LINK_RESUME_ARM_MS` of active time
is reading here, and the bookmark starts following again.

### How often it is written

Never per scroll event. One write every `PROGRESS_FLUSH_MS`, an early one once
the learner has moved `PROGRESS_FLUSH_WORDS` **in either direction**, and a forced
one when the page is hidden (`visibilitychange` / `pagehide` — the mobile-safe
replacements for `unload`).

*In either direction* is the whole bug fix. Live progress and persisted progress
are separate: the bar moves locally on every frame and waits for nothing, while
the server is updated in batches.

### What the learner sees

```
0% ━━━━━●━━━━━━━━│──────── 100%
         ↑        ↑
       teraz   przeczytane do
```

The fill is `furthest`; the dot is `current`. Reading forward moves both, so the
dot sits at the end of the fill and the bar looks like an ordinary progress bar —
which is the point. It separates only when the two facts genuinely differ. There
are no permanent labels; the words live in `aria-valuetext`, available on demand
and silent otherwise.

The header's percentage is **furthest, never current**: "24%" while the learner
is checking something they read twenty minutes ago contradicts the bar underneath
it.

On resuming, a thin „Tu skończyłeś" rule marks the place. It is an absolutely
positioned overlay with `pointer-events: none` — zero layout cost, which matters
because the reader has just scrolled to a place measured in that same layout. It
leaves after `RESUME_MARKER_MS` or the moment the learner scrolls.

One small floating control offers the two places a learner ever wants back — the
origin of this sitting, or the front of what they have read — whichever is
nearer, and nothing at all while they are within `BOOKMARK_REVEAL_WORDS` of both.

### Book progress

```
sum(chapter.wordCount × chapter.progressRatio) / sum(chapter.wordCount)
```

Never `completedChapters / chapterCount`: a book whose first chapter is 500 words
and whose second is 20 000 would report 50% after ten minutes. That has always
been true of `itemProgressRatio`; what changed is that the `progressRatio` it
weighs is now itself word-based, so the honesty goes all the way down.

### Completion is an act

A sticky footer, a short final line or a layout shift can put the end of a
chapter on screen without anyone having read it, so finishing is an explicit
button — and `complete_reading_chapter` refuses below `CHAPTER_COMPLETION_RATIO`
regardless of what the button does. The threshold is unchanged at 0.95, but it
now means 95% of the *words*, reached through dwell, so a fling to the bottom no
longer opens the gate. Completing twice returns the stored summary and writes
nothing.

### Migration and backward compatibility

Nothing was reset and nothing needs to be.

- `resume_paragraph_position` and `furthest_paragraph_position` stay, keep being
  written, and remain the fallback for an anchor with no sentence.
- Existing rows were converted in place: `furthest` to the END of the furthest
  paragraph reached ("read through it", which is what the old ratio claimed),
  `resume` to the START of the paragraph the learner was on, and
  `progress_ratio` recomputed on the word scale. A learner who had read through
  paragraph 80 still has; only its expression as a percentage is corrected.
- A **completed** chapter is pinned at 100%, so an arithmetic change cannot
  un-finish anything.
- A chapter with no word scale yet (stored before the migration, never
  reprocessed) falls back to the old paragraph ratio inside
  `record_reading_progress` rather than dividing by zero.
- The backfill is guarded on `furthest_word_offset = 0`, so re-running the
  migration — or re-applying `schema.sql` to a live database — is a no-op.

### Where the engine lives

| Concern | File |
| --- | --- |
| the position model, word offsets, the three rules | `src/lib/reading/position.ts` (pure) |
| the ratio, completion, book progress | `src/lib/reading/progress.ts` (pure) |
| every threshold, dwell, reading line, cadence | `src/lib/reading/constants.ts` |
| DOM → anchor, anchor → scroll | `src/hooks/useReadingLine.ts` |
| sampling, dwell, the live state | `src/hooks/useReadingPosition.ts` |
| restoring, and surviving a relayout | `src/hooks/useReadingRestore.ts` |
| the bar and the current marker | `src/components/reader/ReadingProgressBar.tsx` |
| „Tu skończyłeś" | `src/components/reader/ResumeMarker.tsx` |
| „Wróć…" | `src/components/reader/ReturnToBookmark.tsx` |
| the pre-paint jump | `src/components/reader/ReadingRestoreScript.tsx` |
| anchor → word offset, and the write | `reading_word_offset` + `record_reading_progress` (SQL) |

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

### The dictionary is the third input

`content_hash` describes the source and `processor_version` describes the
pipeline. Neither says anything about `words` — and for one phase, nothing did.

**What that cost.** A chapter processed yesterday kept yesterday's occurrences
forever. A word added today was in `/browse` and dead text in the book, because
the pipeline only wrote an occurrence for a token it could MATCH and an unmatched
token was not a tappable span at all. The only way to connect them was an explicit
reprocess — `force: true` from `/admin/library`, or "Odśwież słownictwo" for a
private import — which rewrote every paragraph, sentence and occurrence row in
the chapter to fill in one nullable column. Safe, because the pipeline is
deterministic, but enormous, manual, and for a 40-chapter novel absurd: the
learner's answer to "why is this word dead?" was a button labelled *rebuild my
book*.

**The third stamp.** `chapters.dictionary_revision` is now that missing input, and
`dictionary_revision` is a single row bumped by a statement-level trigger on
`words` — so "has the dictionary changed?" is a primary-key read, and an INSERT, an
UPDATE and a DELETE all move it. (A `count(*)` misses an update; a
`max(updated_at)` misses a delete.)

**Two layers, resolved at three moments.** The dictionary index is cached per
server instance and rebuilt only when the revision changes; the write paths that
touch `words` also drop it directly, so the instance that accepted a new entry
never even waits for the check. `DICTIONARY_REVISION_TTL_MS` (30 s) bounds how
long any other instance can be behind — the only staleness window in the system,
and a documented number rather than "until the next deploy".

1. **Processing** (`src/lib/content/process.ts`) resolves what it can and writes a
   row either way, stamping the chapter with the revision it used.
2. **Rendering** (`getReaderChapter`) compares that stamp with the current
   revision. If the chapter is behind, its unresolved tokens are offered to the
   current dictionary *in memory, for this render* — through the same
   `matchToken`, so the answer is identical to the one processing would have
   given. This is why a word added at any point works in an existing book on the
   next page view: no reprocessing, no refresh, no button. It is a READ: it
   writes nothing, because a GET that repairs the database is how a page view
   becomes a transaction.
3. **Reconciliation** (`src/lib/content/reconciler.ts` →
   `sync_chapter_dictionary`) persists the same conclusion, from a Server Action
   the reader fires and forgets. It exists for everything that reads the *stored*
   rows rather than the page — vocabulary coverage, chapter preparation, the
   question bank — because "the reader says *zog* is *ziehen* but preparation says
   the chapter has no *ziehen*" is a disagreement a learner notices and nobody can
   explain.

**Reconciling is not reprocessing**, and the difference is the whole point:

| | `replace_chapter_content` | `sync_chapter_dictionary` |
| --- | --- | --- |
| runs when | the TEXT changed | the DICTIONARY changed |
| paragraphs / sentences | deleted and re-inserted | untouched |
| occurrence rows | replaced, new ids | added where missing, never deleted |
| positions and offsets | recomputed (identical, because deterministic) | untouched |
| authority | admin, or the owner of a private import | anyone who may READ the chapter |
| cost | the whole chapter | one nullable column, or nothing at all |

It is idempotent — the insert conflicts on the unique `(sentence_id, position)`
index, the update only touches rows still unresolved — so the reader can fire it
blindly, a retry is free, and an interrupted run is simply redone. And because it
never deletes or renumbers anything, reading progress, notebook notes, saved
words and reading history survive by construction rather than by care.

**One matcher, everywhere.** `matchToken` is the single answer to "surface →
dictionary word": the processor asks it during an import, the reconciler asks it
months later for the tokens that had no answer then, and the gloss asks it for a
word tapped right now (through the `resolveReaderWord` Server Action, because
matching needs the whole dictionary and that lives on the server). The gloss used
to run its own `ilike("lemma", surface)` instead — a second, far weaker matcher
that could only find words spelled exactly like the token on the page, so *zog*
read "spoza słownika" on a page where the pipeline had resolved it perfectly
well.

**Legacy chapters need no migration of their own.** A chapter imported under the
old rule has gaps rather than wrong data. The reader detects them by comparing a
sentence's stored `word_count` (its lexical token count) with the occurrences it
actually has, re-tokenizes only the mismatched sentences, and renders the missing
tokens with no row id — fully interactive, anchored on `(sentence, token
position)` like every note is. Reconciliation then inserts the real rows. So the
backfill is the ordinary pass, batched, idempotent and driven by use, rather than
a one-off script that has to be remembered.

**`CONTENT_PROCESSOR_VERSION` was deliberately NOT bumped** for this change. The
rule is to bump it when the pipeline's output for the same input could differ in
a way that moves a stored position — a new abbreviation, a different token regex,
a changed normalisation rule. Here paragraph positions, sentence positions, token
positions and character offsets are all byte-for-byte what they were; the change
is purely additive rows plus a nullable column. Bumping it would have marked
every learner's notebook note stale (`isNoteStale` treats a version change as
"the anchor may have moved"), which would be a false alarm about their own work.

### Loudness is a separate question

Every lexical token being tappable does **not** mean every one is advertised.
`.reader-word[data-unknown]` and `.reader-word[data-function-word]` both drop the
dotted underline: the mark means "Fluent can gloss this", and tappability is not
a mark at all. Underlining every token would turn a novel into a page of
hyperlinks — and on a touch device the reader draws no underlines anyway, so the
tap works either way.
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
rises. `CONTENT_PROCESSOR_VERSION` moved to `content_v2` for it.

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

## Material artwork

A material may have a picture. It is recorded in **one** place —
`library_items.cover_url`, the column this phase already created. There is no
`texts.image_url`: two columns would be two answers to "what does this material
look like?", and they would disagree the first time a passage was renamed,
reprocessed or imported.

- **The library item is the SUBJECT, not just the storage.** Every artwork
  action takes a `library_item_id`: `prepareMaterialCoverUpload`,
  `commitMaterialCoverUpload`, `removeMaterialCover`. That is what owns the
  column, so that is what the API is keyed on. Keying it on `text_id` — which is
  what shipped first — quietly made artwork a feature only of materials that
  began life as a legacy passage, and left everything authored straight into the
  library (a story with chapters and no `texts` row, like „Der Schlüssel") with
  no screen that could give it a picture at all. The library-native case is the
  ordinary one; the passage is the one that needs translating.
- **A passage is an ADAPTER, not a second implementation.**
  `prepareTextCoverUpload` / `commitTextCoverUpload` / `removeTextCover` resolve
  `texts.id → library_items.legacy_text_id → library_items.id` — the same mapping
  questions, attempts and plans already travel — and then call the material
  actions. `/admin/texts/[id]` keeps working unchanged, and there is exactly one
  piece of code that validates, signs, sniffs bytes and deletes. The browser half
  is shared the same way: `useMaterialCover` owns the prepare → PUT → commit
  choreography for both admin screens, and `MaterialCoverField` is the one
  control.
- **An id from a browser is a claim.** Before anything is minted, the item is
  loaded and checked with `isAdminManagedMaterial`: `owner_user_id is null` and
  `rights <> 'private_import'`. A private import is refused *before* a signed
  upload URL into a public bucket exists, not after an update quietly matches no
  rows — and the database re-decides it anyway, through
  `library_item_writable` on the admin's own cookie-bound client.
- **The cover belongs to the ITEM, not the chapter.** A thirty-chapter novel
  stores one URL; a chapter inherits its book's artwork at read time. Editing
  chapter 12 never touches the book's picture, and `chapters` has no cover
  column — `supabase/tests/10_material_cover_security.sql` asserts that it has
  not acquired one.
- **The bucket is public to read, admin-only to write.** `content-covers`
  (`20260921120000_material_covers.sql`) is the opposite of the importer's
  bucket, and deliberately so: published teaching material is meant to be seen,
  a learner's own file is not. Insert, update and delete are gated on
  `public.is_admin()` in Storage policy, not by which button the admin panel
  renders.
- **The file never passes through Next.** `prepareMaterialCoverUpload` mints a
  short-lived signed URL for a path *it* chose
  (`library/<library_item_id>/<uuid>.<ext>`), the browser PUTs the bytes
  directly, and `commitMaterialCoverUpload` records the URL after checking what
  Storage says the object actually is. Same shape as `book-import.ts`, same
  reason: a Server Action body is capped around a megabyte.
- **A new UUID every time** is the whole cache story. Replacing a cover produces
  a different public URL, so no CDN or browser can serve the old picture; the
  previous object is deleted only once the new one is recorded, so a failed
  upload leaves the material with the artwork it already had.
- **A cover is presentation metadata, not plan data.** It is never snapshotted
  into `daily_plan_items.payload`. „Kontynuuj naukę" resolves it at render time
  through `planItemArtworkLookup` + `getMaterialArtwork` — one indexed row read,
  for the one card that shows a picture — so an admin replacing a photo at noon
  cannot invalidate a plan, move an item's status or trigger a regeneration.
  `supabase/tests/10_material_cover_security.sql` §C7 pins that.
- **The card is the picture, not a thumbnail beside one.** „Kontynuuj naukę"
  uses the shelf's illustrated treatment and the shelf's component
  (`MaterialCover` full bleed, `.cover-scrim`, a 40/42% left reservation for the
  content), because the two surfaces show the same materials and a learner
  should recognise a book on Today the way they recognise it on the shelf. The
  scrim is re-based onto `--panel-bg` with `.cover-scrim-panel` — one set of
  measured stops, two surfaces — and a cover that fails to load drops the card
  back to its plain icon form rather than leaving a 40% hole.
- **Only activities that NAME a material get one.** `continue_text`, `new_text`,
  `continue_chapter`, `new_chapter`, `chapter_preparation` and
  `chapter_assessment` all have a material behind them, and the card's kicker
  („CZYTANIE", „PRZYGOTOWANIE", „WYZWANIE") is what distinguishes the kind of
  work — withholding the picture from the two drills only made the card harder
  to recognise against the shelf that shows the same book. „Powtórki" has no
  material, and `PLAN_ITEM_ICONS` stays the answer for it — as it does for a
  material with no artwork, or a URL that fails to load.

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
| completion threshold, idle timeout, flush cadence, reading line, dwell | `src/lib/reading/constants.ts` |
| what `current` / `resume` / `furthest` mean | `src/lib/reading/position.ts` |
| how a position is observed in the DOM | `src/hooks/useReadingLine.ts` |
| coverage honesty floors | `src/lib/reading/constants.ts` |
| reading plan sizing | `src/lib/learning/planner/constants.ts` |
| reader typography/theme options | `src/lib/reading/preferences.ts` + `.reader-surface` in `globals.css` |
| how a chapter is persisted | `replace_chapter_content` (SQL) + `chapterPayload` (`src/lib/content/processor.ts`) |
| surface → dictionary word (the ONE matcher) | `src/lib/content/dictionary-match.ts` + `src/lib/german-morphology.ts` |
| how a chapter catches up with a newer dictionary | `src/lib/content/dictionary-sync.ts` (plan) + `reconciler.ts` (I/O) + `sync_chapter_dictionary` (SQL) |
| dictionary cache lifetime and sync batch sizes | `src/lib/content/constants.ts` |
| what the gloss asks, and how long it trusts the answer | `src/hooks/useReaderWord.ts` + `GLOSS_DICTIONARY_STALE_MS` |
| accepted cover formats, size cap, storage layout | `src/lib/library/covers.ts` (+ the bucket's own limits in the migration) |
| which materials an admin may redecorate | `isAdminManagedMaterial` in `src/lib/library/covers.ts` |
| upload/commit/remove of artwork | `src/actions/admin-covers.ts` (keyed on `library_item_id`) |
| the browser's upload choreography | `src/hooks/useMaterialCover.ts` + `src/components/admin/MaterialCoverField.tsx` |
| which plan activities show artwork | `src/lib/library/artwork.ts` |
