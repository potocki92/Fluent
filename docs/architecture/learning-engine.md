# ADR: the learning data engine

**Status:** accepted · **Builds on:** [`test-sessions.md`](./test-sessions.md)

## Context

After the test-session work, Fluent could state two things about a learner: that
a particular answer was right or wrong, and that their Elo rating was, say, 1387.

Neither is knowledge. "1387" cannot tell you whether someone recognises
*Schwert* but could never produce it, whether they keep losing Dativ after
prepositions, whether their reading is carrying a weak grammar, or how long ago
any of it was last true. Every feature the product wants next — a weakness
engine, a daily plan, an adaptive reader, a tutor — needs those answers, and
none of them can be reconstructed after the fact. Evidence not recorded while
the learning happens is gone.

So this phase records it. It adds no learner-facing feature; it makes the next
ones possible.

## Decision

Two layers, kept strictly apart.

```
 EVIDENCE (append-only)                      STATE (aggregated)
 ─────────────────────                       ──────────────────
 learning_events      one row per            user_skill_state     per skill
 review_events        interaction,           user_concept_state   per concept
                      never rewritten        user_word_knowledge  per word
        │                                            ▲
        └──────────── folded by knowledge_v1 ────────┘
```

Keeping both is the whole point. State alone cannot answer "why do you think
that?" and gives a better algorithm nothing to be fitted to. Evidence alone
cannot be read on every page render without scanning a learner's entire history,
which grows without bound.

```
answer / review / placement item
        │
        ▼
authoritative answer persisted        (test_session_items, calibration_session_items, saved_words)
        │
        ▼
learning_event                        one per interaction, deduped by event_key
        │
        ├── skill evidence            user_skill_state
        ├── concept evidence          user_concept_state   (only where the item is tagged)
        └── word evidence             user_word_knowledge  (only where the item tested that word)
```

---

## 1. What a learning event is

One row per meaningful learning interaction: what was asked, how it was
answered, whether it was right, when, how long it took, and where it came from.
Written once, never updated.

The columns that matter are columns — `skill_code`, `is_correct`,
`response_mode`, `retrieval_type`, `occurred_at`, the typed source ids. `metadata`
exists for genuinely auxiliary detail and must not become the place the important
fields live: a jsonb blob cannot be indexed, constrained, or migrated with any
confidence.

Event types produced today are `test_answer`, `calibration_answer` and `review`.
The check constraint also admits `reading_lookup`, `reading_sentence_help`,
`typed_recall`, `listening_answer`, `speaking_answer` and `writing_answer`, so
shipping one of those needs an exercise rather than a migration. **None of them
is implemented.** Empty features were not created to fill the list.

## 2. How state differs from an event

An event is a fact: "on 13 September, this answer was wrong". A state row is a
belief: "grammar is probably around 0.42, and we are moderately sure".

State is derived, recomputable, and small. It is the only thing the app reads on
a normal render. The query layer (`src/lib/learning/queries.ts`) touches
aggregates exclusively; nothing in the product reads the event log to build a
summary, and nothing should.

## 3. The skill model

Eight dimensions (`src/lib/learning/skills.ts`, mirrored in `public.skills`):
reading comprehension, receptive vocabulary, active vocabulary, grammar,
listening, writing, speaking, pronunciation.

Each catalog row carries `is_assessed` — whether any current Fluent exercise
produces evidence for it. Today that is true for exactly three: reading
comprehension, receptive vocabulary and grammar. The other five are catalogued so
the model needs no rebuilding when they ship, **not** because we have any idea
how well anyone speaks.

> A learner who has never said a word in German has `speaking = unknown`. That is
> more accurate than `speaking = B1` inferred from their reading, and the schema
> makes the honest answer the easy one: no evidence, no row.

### These scores are not CEFR

`score` is an internal heuristic mastery estimate on 0–1, produced by
`knowledge_v1`. It is deliberately **not** mapped onto CEFR. The global Elo
rating and `profiles.cefr_estimate` remain the only thing that claims a level,
exactly as before. Mapping the new model onto CEFR is a separate, deliberate
piece of work and should not be done by picking thresholds that look plausible.

## 4. Vocabulary: `saved_words` vs `user_word_knowledge`

They answer different questions and have different lifetimes.

| | `saved_words` | `user_word_knowledge` |
| --- | --- | --- |
| Question | When should this card come back? | Does the learner know this word, and how do we know? |
| Owner | SM-2 scheduling | the knowledge model |
| Written by | `apply_review` | `apply_learning_evidence` |
| Exists when | the learner enrolled the word | the learner was actually tested on it |

A word can be known without ever entering the review deck, and can sit in the
deck for months without being known. Collapsing both into one table would make
"is in my deck" and "I know this" the same fact, which they are not.

## 5. Receptive vs active

`user_word_knowledge` keeps two independent channels, each a full knowledge
state of its own:

- **receptive** — "I recognise *Schwert* when I see it"
- **active** — "I can recall that *miecz* is *Schwert*"

What decides which channel an observation feeds is the **retrieval the exercise
demanded**, never the button the learner pressed:

| Exercise | Retrieval | Channel |
| --- | --- | --- |
| Flashcard DE → PL, self-graded | recognition | receptive |
| Quiz DE → PL, four options | recognition | receptive |
| Multiple-choice vocabulary item, either direction | recognition | receptive |
| Typed PL → DE *(not built)* | cued recall | active |
| Spoken production *(not built)* | free production | active |

Pressing "Łatwe" on a flashcard is a confident *recognition*, not a
*production*. Nothing in the code path lets receptive evidence raise the active
score — `foldEvidence` touches exactly one channel per observation, and the
database test suite asserts it directly. Consequently Fluent currently reports
active vocabulary as unknown for everyone, which is true.

## 6. Weakness concepts

`public.concepts` is a catalog of ~30 stable codes — `preposition_case`,
`case_dative`, `article_gender`, `main_idea`, … — each with a skill, a category
and a Polish label, so the eventual UI reads one translation instead of
hardcoding ten.

Items are tagged through `question_concepts` / `calibration_question_concepts`,
and the tags reach the learner's own client through the answer-free
`questions_public` view (a concept code is not an answer key; `questions` itself
stays unreadable from a browser). The concepts an event was attributed to are
snapshotted onto the event, so retagging a question later does not silently
rewrite history.

**Existing items were not guessed at.** Every `questions` row defaulted to
`skill_code = 'reading_comprehension'`, because each one hangs off a passage and
asks about it; placement items were mapped from their existing coarse `skill`.
No concepts were assigned to anything. Deciding that a wrong answer "was probably
about adjective endings" would put fiction into the exact model whose only value
is being trustworthy.

**A weakness is a pattern, not a mistake.** `weaknessPriority` requires at least
three observations, at least two failures, and enough confidence to mean
something, before a concept can be ranked at all. Someone who muddles Dativ once
has not got a Dativ problem.

## 7. Review history: why before *and* after

`saved_words` holds the current schedule and nothing else — after a review it has
forgotten that there was ever a previous interval. That is fine for scheduling
and useless for everything else.

`review_events` records the whole interaction: rating, mode, direction, response
time, and the SM-2 state **before and after** (`repetitions`, `interval`, `ease`,
`due`). The pair makes each row self-contained training data — *"at ease 2.4 with
a 6-day interval, this learner pressed Dobrze"*.

That is the point. In a year Fluent may want FSRS or another memory model. If all
we had stored was `interval = 21, ease = 2.5`, that decision would be made blind.
**Phase 2 does not implement FSRS**; it makes the data exist so the choice can
later be made on evidence.

## 8. Idempotency

Every producer derives a deterministic key from the thing that happened:

| Interaction | `event_key` |
| --- | --- |
| Test answer | `test:<session_id>:<question_id>` |
| Placement answer | `calibration:<session_id>:<question_id>` |
| Review | `review:<interaction_id>` |
| Backfilled attempt | `legacy-attempt:<attempt_id>` |

`unique (user_id, event_key)` is what enforces "one authoritative answer → one
learning event". A JavaScript `if (!exists)` cannot: two concurrent requests both
pass it.

Reviews carry a second guarantee at the interaction level. The client mints one
`interaction_id` per card presentation; `unique (user_id, interaction_id)` on
`review_events` means a double tap on "Dobrze" settles the *same* review and
returns the stored outcome, rather than pushing the interval out twice. A request
that loses that race is told what the winner recorded, not handed an error it
cannot act on.

Finalizing an already-completed session deliberately does **not** re-apply
evidence: it was written by the call that completed the session, and re-folding
it against a snapshot taken afterwards would count the same answers twice.

## 9. Security: who may create evidence

The rule for every table added here: a learner may **read** their own learning
history and their own knowledge state, and may write **none** of it. There is no
insert, update or delete policy on any of them.

- Evidence a learner can author is not evidence.
- A mastery score a learner can set is not a measurement.
- User A never sees user B's profile — every policy is `auth.uid() = user_id`.

Writes arrive only through `SECURITY DEFINER` functions that run as the table
owner. `apply_learning_evidence` and `apply_word_review_counter` are revoked from
every role *including* `service_role`: they are internal steps, not an API.
`apply_review` is granted to `service_role` alone — it takes a user id, which is
exactly why no role a browser can hold may reach it. The catalogs (`skills`,
`concepts`) are world-readable reference data and admin-writable, because a
learner who can rewrite the taxonomy can rewrite what their own weaknesses are
called.

`supabase/tests/02_learning_engine_security.sql` asserts each of these against a
real PostgreSQL, because none of them is enforceable in the application layer.

## 10. Algorithm V1

`src/lib/learning/knowledge-model.ts`, stamped `knowledge_v1` on every row it
writes. Each state keeps two decayed accumulators and derives the rest:

```
score      = (PRIOR·PRIOR_WEIGHT + successWeight) / (PRIOR_WEIGHT + evidenceWeight)
confidence = 1 − e^(−evidenceWeight / CONFIDENCE_SCALE)
```

Four properties matter more than the constants:

1. **One answer is never proof.** Blending against a neutral 0.5 prior puts a
   single correct four-option answer near 0.69 with confidence near 0.14. No
   input produces certainty from one event.
2. **Estimate and trust are separate.** Below `MIN_CONFIDENCE_FOR_VERDICT` the
   model refuses to name a level at all and reports `insufficient` — set so that
   no single answer of any kind clears it.
3. **Not all evidence is equal.** Weights live in `evidence.ts`, the one module
   that decides what an interaction proves: multiple choice 0.6 (a quarter of
   them are right by accident), self-rated 0.5, typed or spoken 1.0, a passive
   lookup 0.2; `Trudne` is a hedged success and counts 0.8 of its mode.
4. **Recency.** Accumulated weight has a 120-day half-life, so old evidence
   lowers *confidence* without inventing a drop in *ability* — we do not know the
   learner forgot, only that we are less sure. `confidenceAt(state, now)` applies
   the same decay at read time.

Confidence is additionally capped at 0.85 while every observation comes from one
kind of exercise: a learner who has only ever clicked flashcards has shown us one
thing many times, not many things.

### Where the maths lives, and why that is safe

The model is TypeScript, unit-tested, with no database access — the same split
the Elo work established. `src/lib/learning/` owns the arithmetic; the database
owns the transaction and the constraints. A second implementation in PL/pgSQL
would drift the first time either changed.

The obvious objection — "then a client can post whatever state it likes" — is
answered by the grants: every function that accepts a computed state is
unreachable from `anon` and `authenticated`.

Concurrency is handled with optimistic versioning. Each state row carries a
`version`; the writer sends the version it computed from, and the update applies
only if nothing moved meanwhile. A lost update raises `FL423` and the action
re-reads and recomputes (bounded retries, not a loop) rather than overwriting a
concurrent write. `apply_review` additionally re-checks the locked `saved_words`
row against the SM-2 state the caller computed from, so a schedule derived from a
stale read is refused rather than applied on top.

### Transaction boundaries

One educational interaction is one transaction.

- **Review** → `apply_review`: lock the card, write `review_events`, move the
  SM-2 schedule, advance the daily counter, write the learning event and the
  word/skill/concept state. Any failure rolls all of it back; there is no state
  where the interval moved but nothing recorded why.
- **Test** → `finalize_test_session`: attempts, completion, profile, streak,
  **and** evidence, in the transaction that already existed.
- **Placement** → `finalize_calibration_session`: the same.

## 11. Backfill: what was recovered, what was not

**Recovered.** `attempts` already holds one row per answered comprehension
question with correctness, timing and its passage. Those are real learning events
and were reconstructed, marked `origin = 'legacy_backfill'` so nothing downstream
mistakes reconstructed history for a first-class record. The backfill matches on
the answer itself, so re-running the migration adds nothing and an answer
recorded natively afterwards is never shadowed by a legacy duplicate.

**Not recovered — deliberately.** Review history. `saved_words` keeps only the
latest SM-2 state: `repetitions = 5` says five reviews happened and nothing about
when, how they were graded, or what the intervals were. Fabricating five
plausible review events would put invented data into the one table whose entire
value is being trustworthy training data later. Existing schedules are untouched;
review history begins now.

**Aggregated state was not backfilled either.** The V1 model lives in TypeScript,
and re-implementing it in SQL to replay history would create exactly the second
implementation this design avoids. The events are in place, so a replay job can
build state from them whenever that is wanted. Until then an existing learner's
profile reads "brak danych", which is true.

## 12. Future migration

- **Books and other sources.** Nothing here assumes an event came from a DTZ
  test. `source_kind` already admits `book` and `reader`; a chapter lookup needs
  one nullable id column, not a redesign. The book tables themselves are
  explicitly *not* created yet.
- **FSRS.** `review_events` is the training set. Swapping the scheduler means
  changing `src/lib/sm2.ts` and the `after` half of one payload; knowledge state
  is not coupled to it, because scheduling and knowledge were separated on
  purpose.
- **Speaking and listening.** Both are already skills in the catalog with
  `is_assessed = false`, and both have event types the log accepts. Shipping one
  means writing the exercise and giving its evidence a weight in `evidence.ts`.
- **Active vocabulary.** A typed PL → DE drill needs no schema change at all:
  `reviewRetrievalType` already returns `cued_recall` for it and the active
  channel is waiting, empty.
- **`knowledge_v2`.** Every state row records `model_version`, so a later model
  can tell which rows it inherited and recompute them from the event log rather
  than guessing at provenance.

## Consequences

**A knowledge model now exists, and it is honest about its gaps.** Fluent can say
"reading: strong evidence, active vocabulary: insufficient evidence" rather than
one number. It says "za mało danych" often, and that is the feature.

**Progress remains server-owned.** The Phase 1 trust boundary is unchanged and
now covers evidence and knowledge state as well.

**The review path costs one more round trip.** Grading a card reads its schedule
and the knowledge rows it will touch (at most three), then commits once. It is
bounded by the interaction, not by history size.

**`updateSrs` returns a classified result instead of throwing.** Next redacts
thrown Server Action errors in production, so the review UI could not previously
distinguish a stale schedule from a dead connection. It now surfaces the Polish
message from `src/lib/errors.ts`.

## Not decided here

- **How the knowledge model maps onto CEFR.** Deliberately open; see §3.
- **Whether concepts should be assignable from the admin panel.** The schema and
  the public views support tagging; there is no UI for it yet, so the weakness
  model will stay empty for concepts until items are tagged.
- **Whether `attempts` should survive now that `learning_events` covers the same
  answers.** Keeping it preserves the stats chart and the existing history; the
  duplication is deliberate and bounded.
- **When to replay the event log into aggregated state for existing learners.**
  The replay is possible; nothing schedules it.
