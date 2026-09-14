# Story Learning Engine

> Phase 5. Read this before touching chapter analysis, preparation, the chapter
> question bank, the Chapter Challenge, question generation, or anything that
> writes `chapter_*` / `user_chapter_learning_state`.
>
> Its neighbours: [`reader-story-engine.md`](./reader-story-engine.md) owns the
> library, chapters and reading progress — this phase *consumes* them and changes
> none of them; [`learning-engine.md`](./learning-engine.md) owns evidence and
> knowledge state — the Challenge *feeds* it and must not bypass it;
> [`today-engine.md`](./today-engine.md) owns plans — this phase adds two
> candidate generators and two completion rules and nothing else.

## The point of this phase

After Phase 4 a learner could read a real book and Fluent could record where
they were and which words they checked. What it could not do was **use** any of
it. A finished chapter ended with "Rozdział ukończony" and a word count, and the
next chapter was exactly as hard as the last one.

The mistake Phase 5 was most at risk of making was

```
book → random quiz
```

which is a feature, not a loop. What it builds instead:

```
 Fluent knows the learner               user_word_knowledge, user_*_state
        ↓
 analyses the coming chapter            chapter_user_analysis
        ↓
 clears a few obstacles                 chapter_preparation_sessions
        ↓
 the learner reads, uninterrupted       reading_* (Phase 4, unchanged)
        ↓
 Fluent watches the real trouble        reading_lookups
        ↓
 and then checks what stuck             chapter_assessment_sessions
        ↓
 evidence reaches the model             apply_learning_evidence (Phase 2)
        ↓
 Today plans the follow-up              daily_plan_items
        ↓
 the next chapter is easier
```

Every decision below is in service of that loop. Where a decision made a screen
nicer but the loop weaker or less honest, the loop won.

## Chapter lifecycle: BEFORE, DURING, AFTER

The three stages are explicit in the domain, not just in the UI.

| Stage | What happens | Where it lives |
| --- | --- | --- |
| **BEFORE** | analysis, then an optional short preparation | `chapter_user_analysis`, `chapter_preparation_*` |
| **DURING** | reading, lookups, saved words — **unchanged from Phase 4** | `reading_*` |
| **AFTER** | the Chapter Challenge, evidence, follow-up targets | `chapter_assessment_*`, `learning_events` |

### Reading is not learning

`reading_progress.completed_at` says the chapter was read.
`user_chapter_learning_state.status` says what happened to the learning.

Collapsing these would force one of two bad outcomes: gate the next chapter
behind a test (which Phase 4 deliberately refused to do), or lose track of what
is still outstanding. So they are separate facts, and the lifecycle is *derived*
from timestamps rather than assigned per event — an out-of-order call (a deferred
Challenge finished in another tab, a chapter re-read) cannot put the row into a
state its own history contradicts.

```
not_started → prepared → reading → read → assessment_pending → completed
```

Six states, each of which changes what the UI offers. A seventh would be
bookkeeping.

## Chapter analysis

### Coverage

The percentage comes from `estimateCoverage` in `src/lib/reading/coverage.ts` —
**the same function the reader and the book page already use**. Coverage computed
three slightly different ways in three screens is three numbers a learner will
eventually watch disagree.

What this phase adds on top is the **confidence band**. `estimateCoverage`
already refuses outright below its evidence floor; `coverageConfidence` grades
what is left, on both the *share* of the chapter's vocabulary observed and the
*absolute number* of observed words — because those fail in opposite directions:
40 words out of 60 is a high share of a tiny sample, and 80 out of 900 is a
decent sample of almost nothing.

The figure is shown to the **nearest whole percent** and never finer.
`91,374%` is an estimate impersonating a measurement, and a learner reading three
decimal places will believe all three.

### Knowledge confidence

`src/lib/story/knowledge.ts` exists because the tempting reading of a missing
`user_word_knowledge` row is "unknown", and it is not — it means Fluent has never
watched this learner meet the word, which is a statement about Fluent. Five
verdicts, only two of which are claims:

| Verdict | Meaning |
| --- | --- |
| `known` | measured, high score, enough evidence |
| `likely_known` | measured, good score, thinner evidence |
| `uncertain` | measured, and the measurement does not say |
| `likely_unknown` | measured, low score |
| `no_evidence` | **never measured** — not a synonym for unknown |

`unknownProbability` is the continuous counterpart, and an unobserved word scores
`UNSEEN_WORD_UNKNOWN_PROBABILITY` (0.65), never 1 — so it sits below every word
Fluent has actually watched the learner fail.

### Personal difficulty

**Personal difficulty is not CEFR.** `chapters.cefr_estimate` says what the
language in the chapter is; `chapter_user_analysis.difficulty_score` says what
the gap is between that language and what one learner has shown they know. A
globally-B1 chapter is legitimately *łatwy* for one reader and *bardzo
wymagający* for another, and the two numbers live in different tables on purpose.

Four signals, weighted in `src/lib/story/constants.ts`:

| Signal | Weight | Why |
| --- | --- | --- |
| `vocabularyGap` | 1.0 | vocabulary is what actually stops a reader mid-page |
| `readingHistory` | 0.45 | the only **measured** signal — their real lookup rate in this book |
| `levelGap` | 0.5 | coarse, but the only signal that sees syntax at all |
| `weaknessPressure` | 0.35 | present only once the chapter has tagged questions |

**Signals with no data are ABSENT, not guessed**, and the weights of the present
ones are renormalised. A learner with no reading history is not penalised for the
absence; an analysis with no signals at all reports `confidence: 'none'` and the
neutral label, because "we do not know" must not render as "easy".

The learner sees one of four labels — Łatwy / W sam raz / Wymagający / Bardzo
wymagający — and never the score.

### Caching

Recomputing per render would mean a join across `chapter_vocabulary`,
`user_word_knowledge` and the concept state for each of forty chapters on a book
page. Recomputing per learning event would mean constantly recomputing to produce
the same number — one flashcard cannot meaningfully move a 400-word estimate.

So the analysis is cached per (learner, chapter) and invalidated on the two
things that genuinely change it: the chapter's `content_hash`, and
`STORY_ENGINE_VERSION`. The cache write goes through the service role, because a
learner who could author their own coverage figure could author their own
difficulty label.

## Preparation

**A chapter with 142 unknown words does not get 142 cards.** It gets between
three and eight, and everything else the learner meets in context — which is the
entire reason to read a book rather than a deck.

### How many

Not a constant five. Chapter length sets the base
(`WORDS_PER_PRETEACH_TARGET`), personal difficulty moves it one step in each
direction, and the learner's daily budget caps it
(`PREPARATION_BUDGET_SHARE` — preparation is the doorway, not the room).

### Which

A deterministic weighted sum, so "why did this learner get exactly these five
words?" is answerable six months from now:

| Signal | Weight |
| --- | --- |
| `unknownProbability` | 1.0 |
| `frequency` | 0.55 |
| `importance` (early + recurring) | 0.4 |
| `generalUsefulness` (CEFR band) | 0.35 |
| `weaknessRelevance` | 0.25 |

Words the model calls `known` or `likely_known` are **dropped, not
down-weighted**: a slot spent confirming *Haus* to a B1 reader is a fifth of the
learner's patience wasted.

**Narrative importance is deliberately absent.** Fluent has no model of what
happens in a chapter, and scoring *Schwert* above *Tisch* because swords feel
story-shaped would be inventing a fact. `lexicalImportance` claims only what it
can see: a word that appears early and keeps appearing is load-bearing for
*reading* the chapter. Real story relevance is a genuine future use for a model,
and it attaches at that function with nothing else changing.

### Spoiler safety, V1

A chapter sentence is quoted only when it is the word's **first** occurrence and
sits inside the opening `SPOILER_SAFE_PARAGRAPH_SHARE` of the chapter — the part
the learner is about to read anyway. Anything later falls back to a neutral
dictionary example, and a word with neither gets no sentence rather than a random
line from the middle.

This is a cheap, conservative rule, not a Spoiler Guard. It cannot tell that the
first paragraph contains a twist. What it can guarantee is that preparation never
quotes something the learner has not nearly reached.

### Skipping, and what preparation proves

"Pomiń i czytaj" is on **every card**, not buried at the end. A learner who wants
to read right now is doing the thing the product exists for, and an engine that
made that awkward would be optimising for its own completion rate. The skip is
recorded because *adoption* is worth measuring, not because it is a failure — and
`sync_daily_plan` treats a skipped preparation as a **completed** task, because
the learner resolved it.

**Preparation proves almost nothing.** Recognising a Polish translation seconds
after being shown it is the easiest retrieval Fluent can construct, so
`chapterPreparationEvidence` discounts the multiple-choice weight by
`PREPARATION_EVIDENCE_DISCOUNT` to **0.24** — real evidence, worth less than half
a graded item. Recording it at full weight would let someone "learn" forty words
a week by clicking through warm-ups, and the model would believe every one.
Receptive only: a recognition exercise never feeds active vocabulary.

## The question bank

### One bank per chapter, shared

Personalisation is **selection, not generation**. Two learners get different
questions out of the same forty, not six each that nobody will ever review. That
is the only version of personalisation that can also be validated once,
inspected, and improved for everybody at the same time — and it is what gives the
anti-memorisation rule something to work with.

### Source grounding

Every question stores `source_sentence_ids`. This is the cheapest defence there
is against a model inventing chapter content: a question about "the letter Anna
burned" must correspond to a sentence in which Anna burned a letter. It is also

- how a wrong answer can be explained later,
- how the admin panel shows an admin what a question was written from,
- how a reprocessed chapter is detected as having invalidated its own questions.

A **transfer** question is the one exception: it is asked in a new context on
purpose, so it is grounded by the word it transfers rather than by a sentence.

### Validation

`src/lib/story/questions.ts`. A candidate is guilty until validated.

**Structural** — prompt present and bounded; MCQ option count in range, no
duplicate options (the catchable form of "two correct answers"), answer key in
range; cloze has a blank and at least one accepted answer; sequence has 3–6
elements with no duplicates (identical events have no unique ordering).

**Evidence discipline** — a `comprehension` question may not claim the `grammar`
skill. This is not bookkeeping: a mislabelled row would send a wrong answer about
the plot into the learner's grammar state, breaking the learning engine's rule by
data rather than by code. A `contextual_vocabulary` question with no `word_id`
cannot write word knowledge and would silently be a comprehension question
wearing the wrong label.

**Grounding** — the cited sentences exist *and belong to this chapter*; a named
word occurs in this chapter.

Rejections keep their reason and a truncated prompt, so a bad generator shows up
as a pattern in `/admin/story` rather than as a learner complaint.

### Versioning and staleness

| Stamp | What it answers |
| --- | --- |
| `fingerprint` | is this the same question? (idempotent regeneration) |
| `source_content_hash` | was it written from the chapter as it stands now? |
| `generator_version` | which generator produced it? |
| `story_engine_version` | which engine produced this analysis/session? |

A reprocessed chapter has its questions marked **stale rather than deleted**.
Most are probably still fine, and deleting would take the answering history of
everyone who answered them. Stale questions are excluded from every Challenge by
`get_chapter_question_candidates`.

## Question generation and the AI boundary

```
chapter content
   ↓ chunk                    never mid-sentence          chunking.ts
   ↓ candidate generation     THE ONLY AI STEP            provider.ts
   ↓ schema validation        shape, options, answer key  questions.ts
   ↓ grounding validation     the cited sentences exist   questions.ts
   ↓ quality checks           duplicates, ceilings        pipeline.ts
 question bank
```

### What is and is not a job for a model

Almost everything Phase 5 computes is deterministic and cheap: word frequencies,
dictionary coverage, personal difficulty, which words to pre-teach, which
questions to ask. **None of it is sent anywhere.** Sending a solved arithmetic
problem to a language model buys nothing and costs money, latency and a privacy
surface.

The one thing Fluent cannot compute is what a chapter *means*, and therefore what
a comprehension question about it would be. That, and only that, is behind
`StoryQuestionProvider`.

### The model's output is a candidate, never a fact

A generated question that is ambiguous or has two right answers does not merely
waste thirty seconds — it writes **false evidence** into the knowledge model, and
Fluent then plans a learner's week around a weakness that never existed. So
nothing unvalidated is ever stored, and nothing unpublished is ever served.

### Provider abstraction

One interface, one registration point (`registerQuestionProvider`), and domain
code that has never heard of a provider. `openai.whatever()` sprayed across
twelve files is how a codebase acquires a vendor.

**Structured output is required**, not preferred: `checkProvider` refuses a
provider that cannot be held to a JSON schema, because parsing
`"Question: … Answer: …"` out of prose with a regular expression is how a pipeline
acquires silent, undetectable corruption. `QUESTION_CANDIDATE_SCHEMA` is exported
as data so it cannot drift from `QuestionCandidate`.

### Chunking, spoilers and chapter-level questions

Long chapters are chunked by **sentence**, never by character count, with an
overlap so a question straddling a boundary is still askable. Local questions
come from chunks; "what happened first" and "what was it mainly about" come from
an evenly spread `chapterOutline` of the whole chapter — a sample of the middle
cannot answer either.

**The spoiler boundary is free**: a chunk contains one chapter's sentences and
nothing else is ever loaded, so the generator for chapter 4 cannot leak chapter 5
because it has never seen it. That is the foundation a real Spoiler Guard is
built on, not a substitute for one.

### Privacy and cost

A `private_import` is somebody's own document. `checkProvider` **fails closed**:
private content is never sent to a provider that has not declared
`supportsPrivateContent`, whatever the admin clicked. The job row records
provider, model and token usage — at scale those are the numbers that decide
whether the feature is viable — and **never a sentence of the chapter**. A log is
a copy.

Cost controls in place: fingerprint-keyed idempotency (a re-run over an unchanged
chapter costs one call and stores nothing), one live job per chapter (a partial
unique index), `MAX_GENERATION_ATTEMPTS`, `MAX_QUESTIONS_PER_CHAPTER`, and
generation that is never triggered by a learner opening a page.

### Nothing is configured yet

No provider ships with this phase. With none registered, the deterministic half
of the pipeline still runs, `importChapterQuestions` lets an admin author a bank
by hand through **exactly the same validation**, and chapters without a bank
simply have no Challenge. Reading is unaffected either way.

## Personalisation: the blueprint and the selection

### Blueprint

The requested mix, tilted by weakness pressure and by what the learner actually
did while reading, then clamped and apportioned by largest remainder.

**The floor personalisation may not cross**: at least `MIN_COMPREHENSION_SHARE`
of every Challenge asks about the story. A learner with failing grammar who has
just finished a chapter of a novel is still owed "did you follow what happened?",
and a Challenge that stopped asking it would lose the only measurement it exists
to make. The floor is re-checked on the **integers** after rounding, because
shares can clear it and still round to zero in a three-question Challenge.

A chapter read without a single lookup, save or pre-taught word has its
contextual-vocabulary share halved: asking anyway would mean picking words at
random from a chapter the learner evidently handled.

### Selection

| Signal | Weight |
| --- | --- |
| `unseen` | 1.0 |
| `chapterInteraction` (looked up / saved / pre-taught) | 0.7 |
| `staleness` | 0.6 |
| `weaknessRelevance` (the **worst** concept, not the average) | 0.55 |
| `difficultyFit` | 0.35 |

**Anti-memorisation is the first signal, not a tie-break.** A question answered
within `QUESTION_COOLDOWN_DAYS` is held back entirely — unless the bank has
nothing else, in which case the **least recently answered** is served rather than
the Challenge failing. A shorter Challenge beats no Challenge; a repeat beats a
blank screen.

The Challenge asks its questions **story first** — a learner who has just closed
a chapter is still in it, and opening with a cloze on adjective endings reads as
a test that happens to follow a book.

Selection reads a candidate pool of **metadata only** — no prompt, no options, no
key. The whole personalisation layer therefore runs on data that could be shown
to a learner without teaching them anything.

## Assessment

The trust model is a test's, unchanged since Phase 1:

- the server picks the items and **snapshots** them — a regeneration mid-Challenge
  cannot change what is being asked, and the client cannot choose, reorder or
  extend them;
- each answer is written **exactly once**; a replayed request returns the stored
  result;
- the key is revealed **only after** the answer is committed, and so is the
  explanation (an explanation is a hint);
- `finalize_chapter_assessment` is **atomic and idempotent** — it seals the
  session, applies the evidence and moves the plan item in one transaction, so
  there is no state where the Challenge is finished and today's plan still shows
  it pending.

### The sequence shuffle

`sequence_items` is stored **in the correct order**, which makes the answer key
the identity permutation and removes a second column that could drift out of step
with it. Showing it as stored would be the answer key on screen, so
`start_chapter_assessment` generates a permutation per session item
(`presented_order`); the learner submits *presented positions* and grading maps
them back. **The correct order never leaves the database.**

### What a Challenge does NOT do

It does not touch Elo ability, CEFR, the promotion gate, `attempts` or
`text_completions` — exactly like a weakness drill, and for the same reason. Its
questions were selected partly *because* the learner struggled, and scoring a
displayed level from that biased sample would punish someone for reading a hard
chapter.

## Learning events

Every answer becomes a `learning_event` through `apply_learning_evidence` — the
same path a test, a drill and a review use. **The Story Engine does not get its
own knowledge model.** A second model is a second set of numbers that will
disagree with the first, and a learner whose Dativ is failing in tests but
passing in books is not a learner Fluent can plan for.

| Interaction | Skill | Channel | Weight |
| --- | --- | --- | --- |
| Preparation item (DE → PL, 4 options) | `receptive_vocabulary` | receptive | 0.24 |
| Challenge, comprehension | `reading_comprehension` | — | 0.6 |
| Challenge, contextual vocabulary (MCQ) | `receptive_vocabulary` | receptive | 0.6 |
| Challenge, cloze (typed) | as tagged | **active** | 1.0 |
| Challenge, grammar / transfer | `grammar` | — | 0.6 / 1.0 |

The rules that hold, exactly as `learning-engine.md` states them:

- the **skill** comes from the question's own tag, never from the fact that it
  was asked after a chapter;
- the **concepts** are the ones the item carries and no others;
- **word knowledge** moves only when the question genuinely tests one word — a
  comprehension question about a paragraph containing *Schwert* proves nothing
  about *Schwert*;
- the **channel** follows the retrieval the exercise demanded. A typed cloze is
  the one place the Challenge earns active-vocabulary evidence, and it earns it
  by making the learner produce the form.

`source_kind = 'story'` is what lets a later refit tell a Challenge answer apart
from a test answer — which matters, because Challenge questions are selected
partly by weakness and are therefore not a representative sample.

## Follow-up

A chapter is not finished teaching when the Challenge ends. The most valuable
signal Fluent can collect is not "did they know *plötzlich* on Tuesday" but "did
they still know it on Friday", and that measurement only exists if the chapter
hands targets to the thing that already schedules work.

| Signal | Weight |
| --- | --- |
| `assessmentFailure` (a graded observation, minutes old) | 1.0 |
| `preteachNotRetained` (shown before, still missed) | 0.85 |
| `repeatedLookup` (≥ 2 in one chapter) | 0.7 |
| `uncertainKnowledge` | 0.4 |

**Eighteen lookups do not become eighteen cards.** At most
`MAX_FOLLOW_UP_WORDS` (3) words and `MAX_FOLLOW_UP_CONCEPTS` (2) concepts, and a
single lookup scores nothing at all — tapping a word once is curiosity or a guess
being confirmed. The result may legitimately be **empty**: a learner who read
comfortably and answered cleanly has nothing to follow up, and inventing
something would be the app filling silence.

And it does **not** save cards by itself. A `saved_words` row is something the
learner chose; these are a recommendation the planner may act on. A deck the app
silently fills is a deck nobody trusts.

### Feedback

"Świetna robota!" alone is not feedback. Neither is a fabricated pattern: with
two answered questions there is no pattern to see, and
`challengeFeedback` says *"Za mało danych, żeby wskazać wyraźny wzorzec"* rather
than inventing one. A learner who acts on a fabricated analysis learns the wrong
thing; one who notices stops believing the rest.

## Today integration

Additive, as the Today engine was built to be: two candidate generators, two item
types, two completion rules.

- **`chapter_assessment`** — a chapter read within `ASSESSMENT_PROMPT_DAYS` whose
  bank can actually fill a Challenge. Urgency is high for
  `ASSESSMENT_FRESH_HOURS` and then fades: a chapter finished this morning is
  worth checking, one finished in March is archaeology.
- **`chapter_preparation`** — a chapter whose analysis has **already** been
  computed and found words worth clearing, and which has not been started.
  Deliberately conservative: computing a fresh analysis in the planner would mean
  a vocabulary join per chapter on the app's most-opened screen.

Both are gated on the activity genuinely existing. A plan item whose button leads
to "nie ma jeszcze ćwiczeń" is worse than a shorter plan.

**Completion stays derived.** `sync_daily_plan` recomputes each from the table
that recorded the work — a preparation session completed *or skipped* today, a
Challenge session completed today. There is no "mark this done" endpoint and
there must not be one.

In the flow order the Challenge sits **before** the next chapter: it closes the
book the learner was already in, and a plan that opened a new chapter first would
leave them answering questions about a story they had moved on from.

## Security

| Table | Read | Write |
| --- | --- | --- |
| `chapter_questions`, `chapter_question_concepts` | **admins only, public content only** | service role |
| `chapter_question_stats` | admins | `answer_chapter_assessment_question` |
| `chapter_user_analysis`, `user_chapter_learning_state` | owner | service role |
| `chapter_preparation_*`, `chapter_assessment_*` | owner | SECURITY DEFINER / service role |
| `chapter_generation_jobs` | admins (public), owner (private import) | service role |
| `chapter_question_reports` | owner + admins | `report_chapter_question` |

### The answer oracle stays closed

`chapter_questions` has **no learner SELECT policy at all** — not for a reader,
and not for the owner of the private import the questions were generated from.
`correct_idx`, `accepted_answers` and `sequence_items` are the answer key of
every Challenge that learner is about to take. Prompts reach them through
`get_chapter_assessment`, for a question they are currently being asked, and
nowhere else. This is the boundary Phase 1 established and it is not reopened.

### Private content is isolated

`chapter_questions.owner_user_id` is **derived** from the library item by
`upsert_chapter_questions`, never accepted from the caller — a caller cannot
publish someone's private book by asking to. Every read path checks
`chapter_is_readable`, which reuses Phase 4's `library_item_readable`. The admin
inspector uses the service role, which bypasses RLS, so it restates the
private-import exclusion as an explicit filter in every query rather than relying
on a policy.

### No client write path

There is no insert, update or delete policy on **any** table in this phase — the
same rule `attempts` has held since Phase 1. A Challenge result a learner can
write is a result that proves nothing.

## Performance

- **Analysis is cached**, and invalidated only by content or engine version.
- **One vocabulary read** serves both the analysis and the preparation shortlist;
  reading them separately would double the cost of every chapter card.
- **Coverage is capped** at `ANALYSIS_WORD_LIMIT` distinct words, and both sides
  of the ratio are sliced identically — slicing them differently would silently
  depress every estimate.
- **`chapter_vocabulary` is precomputed** at processing time (Phase 4), so
  "chapter → word ids + frequencies" is a bounded index scan rather than a scan
  over hundreds of thousands of occurrences.
- **The candidate pool is one RPC** returning metadata plus a lateral
  last-answered lookup, indexed by `chapter_questions_pool_idx`.
- **Generation never runs in a page request.**

## Deliberately not in this phase

An AI tutor chat · conversation roleplay · speech recognition · pronunciation
scoring · a listening course · EPUB/PDF import · social book clubs · a
marketplace · an achievements economy · FSRS · a lexeme/sense dictionary rewrite
· IRT · empirical difficulty recalibration · a full Spoiler Guard · sentence-level
help (the taxonomy is modelled, nothing produces it) · mid-chapter checkpoints.

Three of those have room in the model already: `chapter_question_stats`
accumulates what a calibration would be fitted to, the chunking boundary is where
a Spoiler Guard attaches, and `learning_events.event_type` already accepts
`reading_sentence_help`.

## Accepted debt

- **`multi_select` and free `typed_answer` are modelled but refused.** The column
  and the generator contract accept them; `validateQuestion` rejects them,
  because neither can be graded unambiguously without partial credit or fuzzy
  matching. Modelling them now means adding them later is a code change, not a
  migration.
- **`fold_typed_answer` exists twice** — once in TypeScript, once in PL/pgSQL.
  Grading must happen in SQL (the key cannot leave the database before the answer
  is committed) and the app must be able to predict it. Both are covered by tests
  that fail if either moves, which is the best available answer to a rule that
  genuinely has to exist in two places.
- **Weakness pressure is averaged over measured concepts only.** A chapter whose
  concepts are entirely unmeasured contributes no signal rather than a neutral
  one — correct, but it means the signal arrives late for new learners.
- **No retention job.** The follow-up targets are produced and surfaced; nothing
  yet schedules the "still correct three days later?" check specifically —
  SM-2 and the planner pick them up on their own cadence.

## Where to change what

| Change | File |
| --- | --- |
| coverage confidence bands, difficulty weights/labels | `src/lib/story/constants.ts` |
| what "known" means for one word | `src/lib/story/knowledge.ts` |
| how many words to pre-teach, and which | `src/lib/story/preparation.ts` + `constants.ts` |
| what makes a question admissible | `src/lib/story/questions.ts` |
| the Challenge mix, and its comprehension floor | `src/lib/story/blueprint.ts` + `constants.ts` |
| which questions this learner gets | `src/lib/story/selection.ts` |
| what a chapter leaves behind | `src/lib/story/follow-up.ts` |
| wiring an AI provider | `src/lib/story/generation/provider.ts` (register it; import it nowhere else) |
| chunk size and overlap | `src/lib/story/constants.ts` |
| what a Challenge answer proves | `src/lib/learning/evidence.ts` |
| plan urgency and flow order | `src/lib/learning/planner/constants.ts` |
| grading, snapshots, idempotency | `supabase/migrations/20260914180000_story_learning_engine.sql` |
