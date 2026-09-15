# The personal language notebook

**Read this before touching** `src/lib/notebook/**`, `src/actions/notebook.ts`,
`src/actions/review-notebook.ts`, the `user_sentence_notes` /
`user_text_annotations` / `user_notebook_reviews` tables, the
`notebook_entries` view, the reader's selection and word-sheet behaviour, or
anything under `/notebook`.

---

## 1. What problem this solves

Phase 4 gave Fluent a reader. Tapping a word showed its dictionary entry and
offered to save it. That is a good dictionary and a poor notebook, and the gap
shows the moment anyone reads real prose:

```
sollten          in   „Wir sollten umkehren“, drängte Gared.

what Fluent said:     sollen → powinien / mieć powinność
what was needed:      sollten → powinniśmy
                      Wir sollten umkehren. → Powinniśmy zawrócić.
```

Neither of the two useful answers belongs in `words.translation_pl`, because
neither is true of the lexeme. They are true of **this place in this book, for
this learner**. There was nowhere to put them, so learners did what learners do:
they kept a paper notebook next to the app, and everything they worked out there
was invisible to the learning engine for ever.

This phase builds the layer that was missing:

```
BOOK → CHAPTER → SENTENCE → OCCURRENCE / PHRASE
                     ↓            ↓
              my translation   my meaning        ← the learner's own words
              "nie rozumiem"
                     ↓
              learning events   ← evidence, ranked, never mastery
                     ↓
              contextual review ← the real sentence, not a headword
```

**The product test:** can a learner read a German novel without ever leaving the
book to write something down, and does what they wrote come back to them later as
practice? If they still need a separate notebook, this phase was not done.

**And it costs nothing.** Zero model calls, in the reader and in review. Every
meaning stored here was typed by the learner. That is not a limitation of V1 —
it is what makes the data a future tutor could be trusted with (§12).

---

## 2. What was already there (the audit)

| Already existed | Consequence for this phase |
| --- | --- |
| `sentences` with `chapter_position`, assigned deterministically by the pipeline | The durable anchor for a sentence note. Nothing new had to be stored to address a sentence. |
| `word_occurrences.position` — "index among the sentence's LEXICAL tokens" | The durable anchor for a span. The reason a contextual meaning can be about an occurrence rather than a word. |
| `sentences.translation_pl`, `simplified_de`, `grammar_notes` — reserved, empty | Deliberately **not** used. Those columns are global content; a learner's translation is not. See §5. |
| `replace_chapter_content` replaces paragraphs wholesale, so sentence and occurrence **ids change** on reprocessing | Forced the anchoring design: positions are the identity, ids are pointers that may go null (§4). |
| `CONTENT_PROCESSOR_VERSION`, stamped on every chapter | Gives a note a cheap staleness test without re-reading the chapter. |
| `saved_words` with `origin_context` / `origin_surface` / `origin_occurrence_id` | Word cards already carried their sentence. This phase adds the two offsets that make a **correct** cloze possible (§9). |
| `library_item_readable` / `chapter_is_readable` — private imports are owner-only, admins included | The whole privacy story. This phase adds no new visibility rule; it calls the existing one (§11). |
| `learning_events` — append-only, idempotent on `(user_id, event_key)`, tolerant of null skill/concept/word | Somewhere to record notebook signals without inventing a second event system (§8). |
| `apply_learning_evidence` (service role, one transaction) | Reused verbatim by every notebook write path. |
| `src/lib/sm2.ts`, `apply_review`, `review_events` | One scheduler and one review history. This phase adds a storage table, **not** a second algorithm (§9). |
| `src/lib/content/tokenize.ts` | The one tokenizer. A selection is snapped with it, so a phrase's positions line up with the occurrences the reader renders. |

---

## 3. The four data layers, and what each one may say

This is the distinction the entire phase rests on. Mixing any two of them
produces a bug that is invisible until a learner notices their dictionary has
been rewritten.

| Layer | Stored in | Whose claim | Example | Scope |
| --- | --- | --- | --- | --- |
| **Lexeme** | `words.translation_pl` | Fluent's (admin-curated) | *sollen → powinien / mieć powinność* | Global. Everyone sees it. |
| **Occurrence** | `user_text_annotations`, one token | The learner's | *sollten here → powinniśmy* | One learner, one place in one book. |
| **Phrase** | `user_text_annotations`, 2+ tokens | The learner's | *Angst machen → straszyć* | Same, and a unit of its own. |
| **Sentence** | `user_sentence_notes` | The learner's | *Wir sollten umkehren. → Powinniśmy zawrócić.* | Same. |

Four rules follow, and none of them is negotiable:

1. **No write path runs from a personal note into `public.words`.** Not through a
   Server Action, not through an RPC, not through a trigger. A learner who
   decides *ziehen* means *wyciągnąć* has said something about one sentence.
   `07_notebook_security.sql` asserts the dictionary is byte-identical after a
   contextual meaning is saved.
2. **A contextual meaning is keyed on a place, never on a word.** The unique
   index is `(user_id, chapter_id, sentence_position, start_position,
   end_position)`. Keying it on `(user_id, word_id)` would have made *ziehen* in
   "Er zog sein Schwert." silently overwrite *ziehen* in "Sie zogen den Wagen."
3. **A phrase is not its parts.** `save_text_annotation` nulls `word_id` for a
   multi-token span. Recalling *Angst machen* is not evidence about *Angst*, and
   a card for it never touches that word's knowledge.
4. **A personal word is a first-class note, not a failure.** A token the
   dictionary cannot match has no `word_occurrences` row at all — so it is an
   annotation with `word_id = null`, saved from a selection. No row is ever added
   to `words`.

### Why words and phrases share one table

The levels above are a statement about **meaning**, and that is enforced by rule
1. Storage is a different question. A contextual word meaning and a phrase are
both "a span of tokens inside one sentence, with the learner's own meaning on
it", down to every column — so two tables would be the same eight columns twice,
two sets of indexes, and two queries every time the reader or the notebook asks
"what have I written here?". The discriminator is `kind`, and it is derived from
the span length in exactly one place (`annotationKindForSpan`).

### Why the sentence note holds both the translation and the flag

They are the same grain — one learner, one sentence — and the same act: *I
stopped here and did something about it*. A learner who translates a sentence
**and** flags it has one note about one sentence, not two rows to keep
consistent. It also means the reader's per-tap query is one row, not two.

---

## 4. Anchoring: positions, not ids

`replace_chapter_content` deletes a chapter's paragraphs and reinserts them, so
**every sentence and occurrence id changes** when a chapter is reprocessed.
Reading progress survives that because it stores positions. A notebook has to do
the same, or a learner's work would quietly evaporate the first time the
tokenizer improved.

Every note therefore carries three things:

```
the DURABLE address   chapter_id + sentence_position ( + start/end_position )
the FAST pointer      sentence_id, start/end_occurrence_id   ← on delete set null
the SNAPSHOT          sentence_text, surface, content_version
```

* The unique index is on the **durable address**, so "save my translation" stays
  an upsert after a reprocessing pass has nulled every pointer.
* Every write **re-anchors**: touching a note refreshes its pointer, its snapshot
  and its version stamp, so a note drifts at most until the next time it is
  opened.
* The snapshot is what the notebook renders. It is the German the learner
  actually translated, which is the honest thing to show — and comparing it
  against the live text is how staleness is *detected* rather than hidden.

`isNoteStale` returns true when the processor version has moved (positions may
have shifted) or the live sentence differs from the snapshot (they demonstrably
have). A stale entry is **marked**, never silently repointed and never deleted.

Character offsets are stored too, but only as a rendering convenience — for
highlighting and for cutting a cloze. They are always offsets **into the
snapshot**, never into whatever the chapter says now.

---

## 5. Sentence translations

```
save_sentence_translation(sentence_id, translation, evidence)
delete_sentence_translation(sentence_id)
```

* Trimmed, and whitespace-only is **refused** (`FL422`) rather than stored — a
  note that renders as nothing still counts in every summary.
* `on conflict (user_id, chapter_id, sentence_position) do update` — one learner,
  one sentence, one note. A second save is an edit.
* Deleting the translation from a note that is also flagged unclear keeps the
  flag; deleting the last thing a note says deletes the note. A row with neither
  is refused by a CHECK constraint.
* **The sentence itself is never touched.** `sentences.translation_pl` stays
  null: that column is global content, and a learner's translation is not
  verified, not shared, and not Fluent's claim.

### It is theirs, and it is not the truth

A learner can write "Musimy iść do sklepu." under "Wir sollten umkehren." and
Fluent will store it. It is labelled **Twoje tłumaczenie** everywhere it appears,
the column is `translation` on a table whose name starts with `user_`, and
nothing presents it as a translation *of* the sentence. Checking it is a Phase 6
question; pretending to have checked it would be worse than not offering the
feature at all.

---

## 6. Phrases: from a selection to a span

Fluent does **not** implement a selection engine. On iOS the native handles, the
magnifier and the callout are better than anything this app would build, and
intercepting `selectstart` produces a reader where text cannot be copied. So the
browser selects, and `readReaderSelection` asks what it selected.

```
window.getSelection()
   ↓  Range, measured against the enclosing .reader-sentence
character offsets into the sentence text
   ↓  spanFromCharRange — the CONTENT PIPELINE's tokenizer
token positions + offsets + surface       ← the durable address
   ↓  Server Action re-derives all three from the STORED sentence
   ↓  SQL slices the stored text and refuses a surface that does not match
one row
```

Three properties matter:

* **Snapping.** A token is included when it *overlaps* the selection at all, so a
  sloppy drag ("ngst mache") saves *Angst machen*. A selection touching no token
  is refused rather than guessed at.
* **One sentence, always.** `sentence_id` is a scalar argument, and a selection
  that starts and ends in different sentences is reported to the learner instead
  of being trimmed to the first one. Half a paragraph is not a phrase.
* **Verified against the book.** The client sends positions; the action re-derives
  the surface from the sentence as the *database* has it; and
  `save_text_annotation` slices the stored text and refuses unless the result is
  exactly what was claimed. A crafted request can annotate a book the learner may
  read — it cannot make their notebook quote a sentence the book does not
  contain.

`MAX_PHRASE_TOKENS` is **passed into SQL** rather than duplicated there, so the
UI and the database cannot disagree about how long a phrase may be.

Overlapping phrases are allowed and expected: *Angst machen* and *jemandem Angst
machen* are different spans, so they are different rows. No overlap parser
exists, and none is wanted.

---

## 7. "Nie rozumiem"

The single most valuable thing a reader can tell a learning system, and the
easiest one to get wrong.

**It is current state plus history.** `user_sentence_notes.is_unclear` says what
is true now; `learning_events` keeps the sequence. The flag is reversible —
"Już rozumiem" — and reversing it writes a second event rather than deleting the
first, so a learner is never left carrying a failure they have already dealt
with, and Fluent never loses the fact that they once struggled there.

The event key is **per tap** (`notebook:sentence-help:<interactionId>`), which is
what makes the history a sequence; a retried request replays the same key and
changes nothing.

**It is not a failed test, and it is not a lookup.**

| Signal | Weight | Why |
| --- | --- | --- |
| A graded item Fluent marked wrong | 0.6 | Verified. |
| **"Nie rozumiem"** | **0.25** | Deliberate, and unverified. |
| A lookup, repeated | 0.1 × n | A pattern. |
| A single lookup | 0.1 | People also tap out of curiosity. |

That ordering lives in one place — `HELP_SIGNAL_STRENGTH` in
`src/lib/learning/evidence.ts` — because the notebook's sort, the Today engine's
ranking and whatever comes next would otherwise each re-invent it.

**No skill, no concept, no word.** A sentence is not a grammar point.
Attributing "I don't understand this" to `grammar`, or to whichever concepts
happen to be tagged on words inside it, would be the model manufacturing a
weakness from a gesture. The learner has told us **where** they are stuck, not
**why**, and the learning engine's rule when it does not know why is to say so.
So `foldEvidence` moves nothing, and the signal is used for *ranking what to
revisit*.

---

## 8. Learning events

Six event types, all `source_kind = 'notebook'`:

| Event | When | Moves knowledge? |
| --- | --- | --- |
| `sentence_translation_created` | first save for a sentence | no — history |
| `context_meaning_created` | first meaning for a span | no — history |
| `phrase_saved` | first meaning for a multi-token span | no — history |
| `sentence_marked_unclear` | each flag | no — ranking |
| `sentence_marked_understood` | each unflag | no — ranking |
| `notebook_review` | each graded card | **yes**, for a word-linked cloze |

`sentence_translation_updated`, `context_meaning_updated` and
`phrase_meaning_updated` are accepted by the whitelist and produced by nothing —
the same convention every phase has followed, so a later feature needs an
exercise rather than a migration.

### Why writing a note proves nothing

A learner who writes "sollten → powinniśmy" has looked something up and
understood it *with the answer in front of them*. Crediting that as knowledge of
*sollen* would mean a learner could master German by copying a dictionary, and
the model would have no way to tell the difference. What proves they know it is
being asked again, later, with nothing in front of them — which is what §9 is
for. Note events carry `word_id` so the history is searchable, and
`vocabularyChannel = null` so nothing folds.

The creation events use a **deterministic** key derived from the place, so
writing a note fires once and editing it never fires again. Correcting what you
already said is not a second observation.

---

## 9. Review: one scheduler, several presentations

### What a card is

| Kind | Front | Back | Retrieval |
| --- | --- | --- | --- |
| `context_cloze` | `Wir ______ umkehren.` + the learner's meaning as the cue | `sollten` | self-rated **recall** → active |
| `context_meaning` | the sentence + "Co oznacza tutaj *sollten*?" | the meaning | recognition |
| `phrase` | `Angst machen` | the meaning + its sentence | recognition |
| `sentence_translation` | the learner's Polish | the German sentence | cued recall |

A cloze is preferred whenever the stored offsets make one possible, because it is
by a distance the stronger exercise — the learner produces the inflected German
with nothing to pick from. When they do not (an older card, a reprocessed
chapter) the meaning question still works: a weaker honest card beats a cloze
with the wrong word blanked.

### The cloze is cut, never searched for

`text.replace(surface, '______')` is wrong in "Er sah sie an, und sie sah ihn
an." — it blanks the first *sah*, which may not be the one that was saved. Every
cloze in Fluent is cut at stored character offsets (`buildCloze`), and returns
`null` rather than a guess when the offsets do not describe the text. This is why
`saved_words` gained `origin_char_start` / `origin_char_end`, backfilled from the
occurrence for cards saved earlier.

### One scheduler

```
src/lib/sm2.ts          the arithmetic          ← ONE implementation
review_events           the history             ← ONE table, item_type says which
saved_words             schedule for a WORD
user_notebook_reviews   schedule for a NOTE
```

`saved_words` is keyed `(user_id, word_id)` and structurally cannot hold a
phrase, so a second storage table was unavoidable. A second *algorithm* was not,
and there isn't one: `gradeNotebookCard` calls the same `review()` and
`GRADE_QUALITY`, and `apply_notebook_review` is `apply_review`'s contract for a
different item — same idempotency by unique constraint, same optimistic
concurrency guard, same single transaction.

`review_events.word_id` became nullable and gained `item_type`, `annotation_id`
and `sentence_note_id`. A parallel `notebook_review_events` would have split the
corpus a future memory model has to be fitted to, in half, permanently.

### Review is opt-in

Saving a translation schedules nothing (`set_notebook_review`). Every translated
sentence silently becoming a flashcard punishes the most valuable reading habit
this phase is trying to build; a learner who gets forty unasked-for cards stops
translating sentences within a week.

### What a graded card proves

A contextual cloze on a **word-linked** annotation is real active-vocabulary
evidence — the first exercise in Fluent that legitimately feeds the active
channel, because the prompt is Polish and the answer is German with nothing to
pick from. It is weighted as `self_rated`, not `typed`, because the card is
revealed and graded by the learner rather than typed and checked: overstating it
would be the evidence map lying about its own exercise. A typed, checked cloze
would earn the full weight, and is not built. A phrase card moves no word knowledge (rule 3 of §3). A
sentence-translation card names no word at all. `source_kind = 'notebook'` marks
the sample as self-selected, exactly as `'practice'` does for weakness drills.

---

## 10. The reader

Everything below is an extension of the Phase 4 reader. No Reader V3, no route
group, no change to progress, resume or typography.

### The interaction hierarchy

It is ABSOLUTE, it is in this order, and it is decided in one pure function —
`resolveReaderIntent` in `src/components/reader/reader-interaction.ts`:

| # | Gesture | Result |
| --- | --- | --- |
| 1 | tap on `.reader-word`, no **live** selection | the word sheet, always |
| 2 | live selection, one lexical token | „Zapisz znaczenie" |
| 3 | live selection, 2+ tokens in one sentence | „Zapisz zwrot" |
| 4 | live selection across sentences | an explanation, and nothing else |
| 5 | tap inside `.reader-sentence`, not on a word | the sentence's own actions |
| 6 | anything else | dismiss |

**Rule 1 was the bug.** On iOS a plain tap on *Wir* could open the SENTENCE
action bar — „Przetłumacz / Nie rozumiem" — instead of the word sheet. Two
causes, and the fix closes both:

* *The click handler read the selection first and let anything win.* Safari does
  not clear a selection on the schedule that assumes: the callout from a
  long-press two paragraphs ago is still in the document when the next tap's
  `click` fires, and the tap that dismisses it is delivered to the word
  underneath. Chromium collapses it on `touchstart`, which is why this only ever
  showed up on a phone. **A selection now counts only while it is LIVE** — the
  browser changed it between this gesture's `pointerdown` and its `click`. A
  leftover range is ignored, never cleared: the learner may be mid-copy, and
  taking that away to win an argument would be the worse bug (§30).
* *A word is a few millimetres of inline box.* A tap a pixel above the ascender
  is delivered to the enclosing sentence. So when `event.target` is not a word,
  `readerHitAt` asks the POINT as well, which is the question the learner posed.

**A selection announces itself; it is not discovered by a tap.**
`observeReaderSelection` watches `selectionchange` and reports once the pointer
is up and the selection has settled. This is not a refinement — on iOS a
long-press that selects a word emits **no click at all**, so a reader that only
looked during a click could not show anything for the commonest way a phrase is
selected on a phone, until the *next* tap came along and got answered with the
*previous* gesture's selection. Both halves of the bug were the same mistake.

Nothing here implements selection: no `selectstart` handler, no custom handles,
no `removeAllRanges` to force an outcome. The browser selects; Fluent asks.

**The action bar is not gone and is not demoted.** It remains the alternative
route to a sentence's actions (§9, §97) — it simply cannot outrank a word tap. A
selection and a tapped sentence are now two variants of one state rather than a
tapped sentence faked as a zero-width selection, which is how a word tap could
render offers nobody asked for.

### The word sheet

It used to lead with the dictionary. For someone reading a novel that is
backwards, so the order is now:

```
sollten              the word as written, the headword beside it
W TYM MIEJSCU        powinniśmy                 ← or "+ Dodaj znaczenie"
„Wir sollten umkehren…"
Twoje tłumaczenie    Powinniśmy zawrócić.       ← or "Przetłumacz zdanie"
[ Nie rozumiem tego zdania ]                    ← or "Już rozumiem"
SŁOWNIK              powinien / mieć powinność  ← dropped if it repeats the above
Du sollst mehr schlafen.
[ Dodaj do powtórek ]
```

Two labelled sections, never one line: they are different claims by different
authors. An empty section is one quiet line with a plus on it, not half a screen
of nothing.

**„Nie rozumiem" is here as well as on the action bar.** The sentence is already
quoted on this sheet, so the flag about it belongs on this sheet. Requiring the
learner to close the word sheet and then hit the few millimetres of space
*between* two words is asking for a gesture a phone will not reliably deliver —
the browser's own tap adjustment snaps a near-miss onto the word, which is rule 1
working. Two ways in, one piece of state, one `setSentenceUnclear` behind both.

**A token with no `wordId` still opens the sheet.** "Not in Fluent's dictionary"
is a fact about the dictionary, not about the learner's interest in the word; the
sheet offers „Dodaj do mojego słownika" and the note becomes an annotation with
`word_id = null` (§3, rule 4). Only a missing occurrence id refuses, because
without it a note has nowhere to anchor.

**One editor per job.** The translation editor is opened from the word sheet
*and* from a sentence tap; both mount `SentenceNoteSheet`. The meaning editor is
opened from the word sheet *and* from a selection; both mount `AnnotationSheet`.
Both wrap `NoteSheet`, which owns the mobile behaviour.

**Marks in the prose.** Three data attributes, applied in one pass over the
chapter's notes, styled as a change of ink rather than a highlighter: a saved
span gets a solid accent underline, a translated sentence the faintest rule, an
unclear one a dotted rule. A quarter of the tokens on a page are already
interactive; a book must not become a Christmas tree.

**Deep links.** `?sentence=<id>` beats resume. Arriving from the notebook means
"take me to *this* sentence", which is a different request from "take me back to
where I stopped".

### Mobile

| Problem | Answer |
| --- | --- |
| iOS Safari does not shrink the layout viewport for the keyboard, so a bottom sheet ends up behind it | `useKeyboardInset` reads `visualViewport` and adds the covered strip as bottom padding — lifting the textarea **and** the save button |
| `100vh` is taller than the screen with the address bar showing | `max-h-[85svh]`, plus `env(safe-area-inset-bottom)` |
| iOS zooms the page when focusing a small input, throwing away the scroll position | every field is ≥ 16px |
| The native selection callout sits **above** the selection | the action bar sits **below** it |
| Losing the learner's place | the sheets are Radix dialogs (no document scroll, focus returns to the opener); the action bar is positioned in viewport coordinates and dismisses on scroll |
| A refetch overwriting a half-typed note | `NoteSheet` re-seeds only when `seedKey` changes, which the callers change only on opening a different note |

There is **no autosave**. A note is saved when the learner says so: debouncing a
write into a book someone is reading means storing half-typed thoughts, and "why
is there a note that says *powin*" is a worse failure than pressing a button.

---

## 11. Privacy

Three layers, and the first one is the only one that has to be right.

1. **Every write goes through `notebook_sentence_anchor`,** which refuses a
   sentence the caller may not read via `chapter_is_readable` →
   `library_item_readable`. A learner who types someone else's private-import
   sentence id into a request gets `FL404` before a row is written, and cannot
   even confirm the row exists.
2. **Read-own, write-nothing RLS.** No INSERT, UPDATE or DELETE policy exists on
   any of the three tables; every write is a `SECURITY DEFINER` function that
   derives the learner from `auth.uid()`. `user_id`, the anchors and the
   snapshots have no client write path at all.
3. **No admin exception.** A personal notebook is not content. An admin reading
   `user_sentence_notes` sees zero rows, which is the same judgement
   `library_item_readable` already makes about a private book.

The `notebook_entries` view is `security_invoker = on`, so it runs as the caller
and the underlying policies decide what it returns — including for the
`library_items` join, so even the *title* of somebody else's private import is
unreachable through it.

**Public books are shared; notes about them are not.** Two learners reading the
same published story each annotate freely and see only their own work.

**Deleting a private book takes its notes.** `chapter_id` and `library_item_id`
cascade, because a note holds a *copy* of a sentence of that book, and a copy of
a deleted private book is exactly what must not be left behind (Phase 5.5's rule,
applied here). What was **learned** is not source-specific and stays:
`user_word_knowledge` is untouched.

---

## 12. Phase 6 readiness (assessment only — nothing implemented)

Phase 5.6 contains **no AI**: no provider, no client, no prompt, no fallback
copy. That is a product decision, not an omission, and it is also what makes the
data worth having — every meaning in here was written by a learner who was trying.

A future Contextual Tutor needs seven things about a moment in a book. All seven
are already addressable from one sentence id:

| What the tutor needs | Where it already is |
| --- | --- |
| the current sentence | `sentences.text`, or the snapshot on any note |
| the selected occurrence | `word_occurrences` by `(sentence_id, position)` |
| the learner's contextual meaning | `user_text_annotations` at that span |
| the learner's sentence translation | `user_sentence_notes.translation` |
| saved phrases nearby | `user_text_annotations` where `kind = 'phrase'` |
| whether they said they were stuck | `user_sentence_notes.is_unclear`, plus the event history |
| relevant learning state | `user_skill_state`, `user_concept_state`, `user_word_knowledge` |

`useSentenceNotebook` already assembles the middle five in one query; a context
builder is a different shape of the same read. Two contracts have to survive into
Phase 6:

* **A learner's translation is never `official_translation`.** "Sprawdź moje
  tłumaczenie ✨" compares two things and must keep them distinguishable; a schema
  that had stored the learner's Polish as the sentence's translation could not.
* **Book content is data, never instructions.** An imported book may contain
  "ignore previous instructions", and so may a learner's own note. Both are
  delimited data in any prompt, exactly as Phase 5.5 requires.

Deliberately **not** designed for: crowdsourced or shared translations, votes,
public annotations. Nothing here is global, and nothing should be made global
without a deliberate decision — but nothing prevents a *separate* shared layer
later, because personal notes never claimed to be one.

---

## 13. What is deliberately not here

| Not built | Why |
| --- | --- |
| AI translation, checking, explanation, phrase detection | Phase 5.6 is free to run, and a wrong machine translation presented as help is worse than none |
| Autosave | §10 |
| Shared / community translations | §12 |
| Book-level notebook totals | Optional in the brief, and honest aggregation across a 73-chapter book is a query worth designing rather than bolting on |
| Notes on anything but a sentence (a paragraph, a chapter, free-floating) | No learner asked for it, and every grain added is a grain the review layer has to understand |
| Offline queue | Not built. The write paths are single idempotent calls with deterministic or interaction-scoped keys, which is what a queue would need — but nothing replays them yet |
| Reordering / merging phrases, an overlap parser | §6 |

---

## 14. Files

```
supabase/migrations/20260915180000_personal_language_notebook.sql
supabase/tests/07_notebook_security.sql

src/lib/notebook/constants.ts      every limit and weight, including the one SQL is passed
src/lib/notebook/selection.ts      selection → span, via the content tokenizer
src/lib/notebook/cloze.ts          cut at offsets, never searched for
src/lib/notebook/notes.ts          normalisation and staleness
src/lib/notebook/review.ts         a note → a card (presentation only)
src/lib/notebook/summary.ts        "Twoja nauka", derived
src/lib/notebook/queries.ts        the due deck, three bounded queries

src/actions/notebook.ts            translations, the flag, annotations, opt-in review
src/actions/review-notebook.ts     grading, through the same SM-2

src/hooks/useSentenceNotebook.ts   one request per tapped sentence
src/hooks/useChapterNotebook.ts    one request per opened chapter, for the marks
src/hooks/useNotebook.ts           the paginated listing
src/hooks/useKeyboardInset.ts      the iOS keyboard

src/components/notebook/           NoteSheet + the two editors, the list, the deck
src/components/reader/reader-interaction.ts   what a gesture MEANS — pure, tested
src/components/reader/sentence-selection.ts   what the browser SAYS — selection, hit test
src/components/reader/             the reordered word sheet, the action bar
src/app/notebook/page.tsx
src/app/review/notebook/page.tsx
```
