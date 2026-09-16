# ADR: the Today engine

**Status:** accepted · **Builds on:** [`test-sessions.md`](./test-sessions.md),
[`learning-engine.md`](./learning-engine.md)

## Context

After the learning-engine work, Fluent knew a great deal about a learner and did
nothing with it. It could say that Dativ after prepositions had failed four times
out of seven, that eleven cards were overdue, that a passage had been opened and
abandoned — and then it showed the learner a menu and asked them to decide.

That is the wrong division of labour. Choosing what to study is a planning
problem that depends on spaced-repetition schedules, concept-level evidence,
content difficulty and time available, and the person least equipped to solve it
is the person still learning the language. A learner opening Fluent should be
answering "do I have ten minutes?", not "am I better off reviewing or reading?".

So this phase adds the thing that answers it: a **daily plan**, generated once
per learning day from the learner's own data, with a single button that starts
it.

What it deliberately is **not**: books, chapters, EPUB import, an AI tutor,
speaking, listening, FSRS, social features, or an XP economy. Those are later
work and several are explicitly out of scope. Phase 3 is personalisation,
prioritisation and weakness practice.

## Decision

```
 LEARNING DATA                    (Phase 2 aggregates — never the event log)
 saved_words · user_concept_state · text_completions · text_progress · words
        │
        ▼
 CANDIDATE GENERATORS             src/lib/learning/planner/candidates.ts
 reviews · weaknesses · reading · vocabulary · onboarding
        │        each emits a PlanCandidate: type, minutes, signals, reason
        ▼
 PRIORITY ENGINE                  src/lib/learning/planner/priority.ts
        │        deterministic weighted sum over named signals
        ▼
 PLANNER                          src/lib/learning/planner/select.ts
        │        budget, per-type caps, category balance, flow order
        ▼
 DAILY PLAN                       daily_plans + daily_plan_items
        │        written once per learning day; never rebuilt
        ▼
 SESSIONS                         review · practice · reading test
        │
        ▼
 NEW EVIDENCE  →  knowledge model updates  →  tomorrow's plan is better
```

The loop at the bottom is the point of the whole phase. Everything above it
exists to make it turn.

---

## 1. The daily plan

`daily_plans` holds one row per (learner, learning day); `daily_plan_items` holds
its activities.

A plan stores what was decided **and why**: `algorithm_version` (which planner
produced it), `evidence_level` (how much data it had), `target_minutes` vs
`estimated_minutes`, and per item a `reason_code` + `reason_data`, the individual
`signals`, and a `payload` snapshot of the labels it should render with.

That last part matters more than it looks. Yesterday's plan must keep showing
what was recommended yesterday. If the view were rebuilt from today's live
weakness ranking, plan history would silently rewrite itself every time the
learner practised — and plan history is the only way to ever tell whether a
change to the planner helped.

### Item types

Six, and every one has a screen behind it today:

| Type | Opens | Completed when |
| --- | --- | --- |
| `placement` | `/calibration` | `profiles.level_source` is no longer `default` |
| `review_due` | `/review` | enough `review_events` inside the learner's day |
| `weakness_practice` | `/practice/[concept]` | a completed `practice_sessions` row for the item |
| `continue_text` | `/learn/[id]` | a `text_completions` row written inside the day |
| `new_text` | `/learn/[id]` | likewise |
| `new_vocabulary` | `/review?words=…` | `review_events` for the specific words recommended |

There is no `listening` or `typed_recall` waiting for a feature that does not
exist. A plan item whose button leads nowhere is worse than a shorter plan.

## 2. Stability: generated once, never rebuilt

Opening the app at 08:00 and again at 08:10 shows the same plan. A home screen
that reshuffles because a card came due in between is not a plan, it is a feed,
and it destroys the one thing a plan is for — knowing what "done" means today.

`getOrCreateTodayPlan()` therefore never regenerates an existing plan. It only
reconciles its progress.

**The single documented exception is onboarding.** A learner with no level gets a
plan containing only the placement test; the moment that test gives them a level,
holding them to that stub until midnight would be absurd. So a plan may be
replaced when **all** of the following hold, and the check lives in
`create_daily_plan` rather than in TypeScript, because a rule that protects
history belongs next to the data:

- every item in it is a `placement` item, and
- none of them has been started or completed, and
- the caller passes `p_replace_onboarding`.

Nothing else is ever replaceable. There is deliberately no "generate a new plan"
button for learners: it would turn the planner into a slot machine for the
easiest available task. A rebuild for tuning is an admin/debug affordance.

## 3. Idempotency

`unique (user_id, learning_date)` on `daily_plans`.

That constraint, not a JavaScript existence check, is what makes ten concurrent
calls produce one plan — two tabs opening the app in the same second both pass
`if (!exists)`. `create_daily_plan` inserts, catches `unique_violation`, and
returns the winner's plan. The database test calls it ten times and asserts one
row.

Item completion is idempotent for a different and stronger reason: see §7.

## 4. The learning day

Supabase runs in UTC, so `current_date` is the **server's** day. For a learner in
Europe/Warsaw that is the wrong day for one to two hours out of every 24: at
23:30 local on 14 September the database still says the 13th.

That is not cosmetic. `unique (user_id, learning_date)` makes the date the plan's
identity, so a wrong date hands the learner yesterday's plan *and* makes today's
impossible to create.

Every date in this engine therefore comes from `profiles.timezone`:

- SQL — `learning_day(tz, at)` and `learning_day_start(date, tz)`, used inside
  transactions to scope "did this happen today?".
- TypeScript — `learningDateFor(tz, now)` in `planner/learning-day.ts`, used by
  the action that builds the plan.

Both mean the same thing and neither may be replaced by `current_date`. An
unresolvable zone falls back to UTC rather than raising — a plan on the wrong day
boundary is a far smaller failure than a home screen that 500s — and a
`BEFORE INSERT OR UPDATE` trigger keeps an unresolvable zone out of the column in
the first place, for every caller.

`profiles.timezone` and `profiles.daily_learning_minutes` are ordinary
learner-editable preferences, like `display_name` and `daily_word_goal`. They
express what someone *wants*, not what they have proved, so the progress guard
leaves them alone.

## 5. The priority engine

Planner V1 is a deterministic weighted sum over named signals:

```
priority = Σ weight(signal) · signal   +   small per-type tiebreak
```

Every weight lives in `planner/constants.ts`. There are no bare coefficients
anywhere else in the planner — a scoring function with `* 0.35` scattered through
it cannot be tuned, because nobody can see what it currently believes.

### The signals

**`dueUrgency`** (weight 1.0) — the strongest ordinary signal, because delay
actively destroys the value of a review in a way it does not for anything else.
Two things make a queue urgent and the signal is the **larger** of them, each
saturating on its own scale: how late the oldest card is (saturating at a week)
and how many are waiting (saturating at 20). Saturation is the important part:
without it, a learner returning after a year would have a review urgency no
weakness and no passage could ever outrank, and the plan would be a review queue
forever.

**`weaknessSeverity`** (0.85) — `weaknessPriority` from the knowledge model,
i.e. `(1 − score) · confidence`. It is not re-derived here; a second copy of that
arithmetic would drift.

**`weaknessRecency`** (0.35) — a 30-day half-life on the last actual failure,
floored at 0.2. This is what lets a fixed weakness fade out of the plan on its own
without anyone marking it resolved, and the floor is what stops an old weakness
being erased rather than de-prioritised.

**`continuation`** (0.6) — 1.0 for a test left half-finished (they were one
screen from a result), fading over about a week for a passage that was merely
opened.

**`difficultyMatch`** (0.45) — peaks at `ability + 75` Elo and falls to zero at
±250. Comfortably readable is not learning; a B2 passage for an A1 learner is not
either.

**`vocabularyFit`** (0.4) — batch size × how much of it is at the right level.

**`onboarding`** (3.0) — outranks everything, and short-circuits the rest of the
pipeline entirely.

### Cognitive load and balance

Handled at selection rather than in the score, because they are constraints on
the *plan*, not properties of a *candidate*:

- at most one review batch, one reading task, one vocabulary batch;
- at most **two** drills (two different weaknesses are two different problems);
- at most two items from one category;
- at most five items.

## 6. The budget

`target_minutes` comes from `profiles.daily_learning_minutes` (default 12, range
5–60). Activities are taken in priority order while they fit within
`target × 1.2`.

A candidate that overflows does **not** stop the loop — a long reading task must
not block a two-minute drill that would have fitted underneath it. And a plan is
never empty when work exists: if the budget rejects everything, the single
highest-priority activity is taken anyway.

Estimates are deliberately coarse (`REVIEW_CARDS_PER_MINUTE = 2.5`,
`READING_WORDS_PER_MINUTE = 55`, 45 s per drill question). Predicting to the
second is impossible, and pretending otherwise puts a number on screen that is
always wrong.

### Reviews: the 300-overdue problem

A learner coming back from a break faces a queue that is, in the scheduler's
terms, entirely due. Telling them "300 kart do zrobienia" is how they close the
app for good.

So the batch is sized by the time they asked for
(`target × 0.45 × cards-per-minute`), clamped to 4–12, and capped by what is
actually due. The rest stays in the scheduler — not lost, not forgiven, just not
today's problem. The learner is told what today holds, never what the backlog
totals.

## 7. Completion is derived, never asserted

**There is no "mark this done" write path anywhere in Fluent.**

`sync_daily_plan(plan_id)` recomputes every item's status from the table that
authoritatively recorded the underlying activity — `review_events`,
`practice_sessions`, `text_completions`, `profiles.level_source`. Three
properties fall out of recomputing rather than incrementing:

- **Idempotent.** Refreshing the page, or calling it twenty times, produces the
  same numbers. There is no counter to double.
- **Unforgeable.** A learner cannot complete a drill they did not do. The only
  way to move an item is to do the work, which writes to tables they cannot write
  to either.
- **Self-healing.** A session that committed while the plan write failed is
  reconciled on the next page load — and reconciliation touches no knowledge
  state, so nothing is re-applied.

It runs on every Today load rather than only after an activity, because the
alternative is trusting that every exit path from every session remembered to
call it, and the one that forgets leaves a finished drill pending forever.

Partial progress is real: four of eight cards shows as `4 / 8`, `in_progress`,
not complete.

`finalize_practice_session` additionally moves the plan item inside the drill's
**own transaction**, so there is no window in which the drill is finished and the
plan disagrees. `sync_daily_plan` would have caught it anyway; the transaction
means nobody has to notice.

### Skipping

`skip_daily_plan_item` sets `skipped` — never `completed`. A plan finishes when
nothing is left pending **and at least one item was genuinely completed**, so
skipping everything is not a day of learning. Planner V1 does not replace a
skipped item; quietly refilling the slot would turn "pomiń" into "give me an
easier one".

### Plan status

`pending` → `in_progress` → `completed`, all three derived by
`sync_daily_plan` from the items.

## 8. The weakness engine

`src/lib/learning/weakness.ts` is a **layer over** `weaknessPriority`, not a
second copy of it. The knowledge model already decides whether a concept may be
called a weakness at all (≥3 observations, ≥2 failures, confidence ≥ 0.3) and
produces the base priority. This module adds the two things the aggregate cannot
express: recency, and a word a human can read.

### Why not sort by score

| concept | score | confidence | evidence |
| --- | --- | --- | --- |
| A | 0.20 | 0.03 | 1 |
| B | 0.45 | 0.90 | 20 |

Sorting by score puts A first on the strength of one answer that could have been
a misclick. B is the real problem — twenty observations agree. Confidence is a
multiplier inside `weaknessPriority`, which is what makes B win; ranking here
multiplies recency on top:

```
severityScore = weaknessPriority(state) × recency(lastFailureAt)
severity      = high ≥ 0.4 · medium ≥ 0.2 · low otherwise
```

Severity is an **internal learning metric** for choosing the next exercise. It is
not a CEFR statement and is never shown as a percentage — the learner sees
"Wymaga uwagi", "Ćwicz dalej", "Prawie stabilne".

`getTopWeaknesses` over-fetches before ranking, because the database can only
order by the un-aged priority and aging reshuffles the list.

**Strengths** use the same aggregate and the same confidence gate
(`conceptStrengths`): a product that can only say what is wrong with someone
teaches them that opening it feels bad.

## 9. Weakness practice

A weakness has to be practisable, or naming it is just a complaint.

`practice_sessions` / `practice_session_items` are modelled on `test_sessions`
rather than reusing them: a drill has no text, must not overwrite a text
completion, and must not move the learner's level. What is shared is the part
that matters — the server picks the items, each answer is written at most once,
and the key is revealed only after the answer is committed.

**What a drill deliberately does not touch:** Elo ability, CEFR, the promotion
gate, `attempts`, `text_completions`, the reading streak. Its items were chosen
*because* the learner keeps failing them, so it is a biased sample by
construction; scoring a level from it would punish someone for practising.

### Item selection and anti-memorisation

Five Dativ questions drilled every morning teach the position of the right
button. So items are ordered by how long ago the learner last **saw** them —
never-seen first, then the stalest — with a random tiebreak so two runs of the
same bank are not the same run. `learning_events_user_question_idx` backs the
lookup, so it stays a bounded read per candidate rather than a scan of history.

This is not psychometrics and is not meant to be. When items are eventually
generated rather than drawn from a fixed bank, this ordering is what gets
replaced.

### No content, no task

A weakness with no questions behind it produces **no candidate**. The planner
checks `concept_practice_pool` (published questions per concept) before ever
proposing a drill, and `start_practice_session` refuses outright if the bank
changed underneath a plan.

The gap is not silent: `/admin/planner` lists concepts with no tagged items, and
flags the learner's own weaknesses that fall in that gap. That list is the real
ceiling on how good a plan can get.

### Evidence

A drill answer is a `practice_answer` learning event with
`source_kind = 'practice'`, weighted exactly like any other multiple-choice
answer — the item is the same item, asked the same way. It is its own event type
so that anything later refitting the model can tell a biased drill sample apart
from a test.

This is the step that closes the loop: the answers update `user_concept_state`
through the same `apply_learning_evidence` a test uses, so tomorrow's ranking
already reflects them.

## 10. Reading

"Continue what you started" needed a fact nothing recorded. `text_completions`
only knows about finished tests, and an in-progress `test_session` only exists
once the learner reached the test — so a learner who read a passage and stopped
left no trace at all, which is exactly the learner the planner most needs to
notice.

`text_progress` is that fact and deliberately nothing more: an open marker, not a
reader session. Scroll position, per-paragraph progress and a resumable reader
belong to later reading work, and inventing half of them now would guarantee they
are rebuilt.

"Started" is three facts in descending strength: a test left mid-way, a test that
did not pass, a passage merely opened. A new passage is chosen by
`difficultyMatch` from a range bounded around the learner's ability, and a
passage already **passed** is never offered as new.

## 11. New vocabulary

The review screen's "ucz się dalej" deck was `order by cefr asc` — the alphabet
of levels, with no reference to the learner. Two exclusions replace it, for two
different reasons:

- **already enrolled** (`saved_words`) — it is in the deck; teaching it as new
  would duplicate the card;
- **already known receptively** (`user_word_knowledge`, score ≥ 0.75 and
  confidence ≥ 0.4) — "naucz się *Schwert* od początku" to someone who has
  recognised it fifteen times is the fastest way to lose their trust in the
  recommendation.

Note what the second exclusion does **not** claim. A strong receptive score does
not mean the word is finished; it means the right exercise is active recall, and
Fluent has none yet. The word is set aside rather than re-taught, and it is
waiting when that exercise ships. This is the receptive/active split from the
learning engine being honoured rather than collapsed.

Factors that were **not** faked: whether a word appeared in a passage the learner
read (the link exists only as `<mark data-lemma>` inside HTML), topical relevance
to their goals, and frequency. Inventing them would be fictional
personalisation — see §65 of the brief.

## 12. Security

| Learner may | Learner may never |
| --- | --- |
| read their own plan, items, drills | write any of them |
| `sync_daily_plan` on their own plan | author a plan or set a `priority_score` |
| `skip_daily_plan_item` on their own item | mark an item completed |
| `start_practice_session`, `answer_practice_question` | `finalize_practice_session` |
| `mark_text_opened` for themselves | write `text_progress` directly |
| set `timezone`, `daily_learning_minutes` | anything the progress guard covers |

No table added here has an insert, update or delete policy — the same rule as
`attempts`. `create_daily_plan` and `finalize_practice_session` accept computed
values, so `EXECUTE` is revoked from `anon`/`authenticated` and granted to
`service_role` alone. Everything a learner *can* call derives the user from
`auth.uid()` and writes only what it measured.

`supabase/tests/03_today_engine_security.sql` asserts each of these against a
real PostgreSQL, because none of them is enforceable in the application layer.

## 13. Performance

Today is the most-opened screen in the app, so:

- every query reads an **aggregate**, indexed and limited; nothing scans the
  event log to build a summary;
- the generators run in parallel (`Promise.all`), so the page costs one round of
  queries rather than five in sequence;
- a plan that already exists costs two reads and one reconciliation, not a
  rebuild;
- onboarding short-circuits to a single query;
- `countObservations` reads at most eight rows, because the skill catalog is
  fixed.

Cost does not grow with how long someone has used Fluent. The page is
`cookies()`-dynamic, so nothing about one learner's plan can be cached for
another.

## 14. Metrics

Everything the product needs to tune the planner is already a column: plan
created (`created_at`), started (`started_at`), completed (`completed_at`), the
same three per item, `status` (including `skipped`), `estimated_minutes`,
`algorithm_version`, `evidence_level`, `priority_score` and `signals`. Plans are
kept, never deleted, so the history is the dataset.

**Actual study time is not recorded**, because Fluent cannot measure it honestly.
A page open for four hours is not four hours of learning, and writing that number
down would poison every estimate derived from it later. Per-answer `response_ms`
already exists where it is genuinely measured.

That has a consequence for copy, and it is binding: **no screen may render a
minutes figure as time spent learning.** The finished-day card shows
`completedEstimatedMinutes(items)` — the planner's estimate for the activities
that were actually COMPLETED, so skipping cannot inflate it — worded through
`renderEstimatedTime` as "Szacowany czas: ok. 12 min". It previously showed the
whole plan's `estimated_minutes` as "12 min nauki", which was wrong twice over:
an estimate presented as a measurement, and the estimate for tasks the learner
may never have done. Summing what *is* measured would not fix it either —
`reading_sessions.active_seconds` is honest but exists only for the chapter
reader, and per-answer `response_ms` is a browser clock covering only the seconds
a question was on screen — so a mixed total would mean a different thing per
activity, and the learner could not tell which.

No external analytics SDK was added.

## 15. Algorithm version

Every plan stores `algorithm_version` (`planner_v1`). Changing the scoring means
a new version string and a comparison against stored plans — which is possible
precisely because `signals` and `priority_score` were snapshotted per item rather
than recomputed on read.

## Consequences

**Fluent now has an opinion.** The learner is asked "do you have twelve
minutes?", not "which of nine features would you like?".

**Progress remains server-owned**, and the trust boundary now covers plans and
drills as well as evidence and knowledge state.

**The loop is closed.** A wrong answer becomes evidence, evidence becomes a
ranked weakness, a weakness becomes tomorrow's drill, and the drill produces
evidence. Nothing in that cycle depends on the learner noticing anything.

**The item bank is now the bottleneck.** The planner is only as good as the
concepts its questions are tagged with, and today almost none are. `/admin/planner`
makes that visible; filling it in is content work, not engineering.

## Not decided here

- **Whether a skipped item should be replaced.** Planner V1 moves on. Doing
  better needs a dynamic planner, and a dynamic planner needs data about what
  people actually skip.
- **Mid-day rebalancing.** Deliberately absent; stability was worth more.
- **Whether the completed-day streak should become a stored counter.** It is
  derived from `daily_plans` today, which is enough and adds no third definition
  of "active day" alongside `streak_days` and `word_streak_days`.
- **Whether reading should get a real session model.** `text_progress` is the
  minimum the planner needed; a resumable reader is its own piece of work.
- **How `actual` vs `estimated` minutes should feed back into the estimates.**
  Possible once there is enough plan history; not attempted on zero data.
