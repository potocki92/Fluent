# ADR: test sessions are server-owned

**Status:** accepted · **Supersedes:** the `submit-answer` / `complete-test` flow

## Context

A comprehension test used to exist only in the browser. The test page fetched the
questions, `TestRunner` collected the answers in a `useRef`, and at the end
`completeTest({ textId, answers })` posted that array back to be scored. Nothing
about the test was persisted until the moment it was over.

That produced four problems, none of which could be fixed in React:

1. **A public answer oracle.** `grade_question(questionId, selectedIdx)` was
   `SECURITY DEFINER`, granted to `authenticated`, and returned `correct_idx`
   for *any* question id — no session, no ownership check, no limit. The answer
   key to the entire app was one `rpc()` call away from the public anon key.
   `grade_calibration` was the same for the placement bank.
2. **The client defined the test.** `completeTest` scored whatever question ids
   it was given. Send one easy question, or the same question five times, and
   that was the test.
3. **Progress was directly writable.** `attempts` had an insert policy for its
   own owner, `text_completions` had insert *and* update, and the `profiles`
   update policy covered every column — so `update profiles set ability = 1900`
   was a legitimate request. There was no forgery to detect; it was the API.
4. **Scoring was not atomic and not idempotent.** Four independent statements
   (attempts → completion → profile → streak) meant a failure in the middle left
   the database half-written, and a double tap or a retried request scored the
   same test twice.

## Decision

A test is a **persisted session** the server owns end to end.

```
startTestSession(textId)
        │  server picks the questions and snapshots them
        ▼
test_sessions (in_progress) + test_session_items (one row per question)
        │
        ▼
answerTestQuestion(sessionId, questionId, selectedIdx)   ← once per item
        │  writes the answer, then reveals that item's key
        ▼
all items answered
        │
        ▼
finalizeTestSession(sessionId)
        │  ONE transaction, service-role only
        ▼
attempts + text_completions + profiles + streak + session sealed
        │
        ▼
test_sessions (completed) — immutable; the results page reads this row
```

### Why the Elo maths stays in TypeScript

The obvious way to make finalization atomic is to compute everything in
PL/pgSQL. We deliberately did not: `scoreTest`, `gatePromotion` and `abilityToCefr`
live in `src/lib/` with unit tests, and a second implementation in SQL would
drift the first time either changed.

Instead the responsibilities are split:

- **`src/lib/` owns the arithmetic.** `finalizeTestSession` reads the session's
  committed answers, computes the new rating, and passes the *result* down.
- **`finalize_test_session` owns the transaction.** It recounts `correct` and
  `total` from the stored items (the numbers are never passed in), verifies the
  session's owner, locks the row, applies every write together, and returns the
  stored result unchanged if the session is already completed.

The obvious objection — "then a client can just call the function with
`ability = 2000`" — is answered by the grant: `EXECUTE` is revoked from `anon`
and `authenticated` and given only to `service_role`, a credential that exists
only on the server. The browser cannot reach the function at all.

The one rule duplicated in SQL is `cefr_for_ability`, a table of band floors with
no arithmetic in it, needed so `set_manual_level` can stamp a band. It is
commented as such in the migration.

### Why calibration is replayed rather than reported

`finishCalibration({ ability, rd, items })` accepted the browser's own estimate,
so "set my level to B2" was a single fetch call. The adaptive test still runs in
the browser — choosing an easier item only makes the estimate worse for the
learner, so item *selection* is not security-sensitive — but every answer is now
committed to a `calibration_sessions` row, and `finalizeCalibrationSession` takes
**only a session id**. The server replays the stored answers through the same
`updateAbility` the client used, in `item_position` order.

Because both sides run identical arithmetic over identical inputs, the replay
reproduces the number the learner watched being built. The security fix is
invisible in the UI, and `replayCalibration` is unit-tested against exactly that
property.

### Why the answer key can still be revealed

Immediate feedback is the product. What changed is that the key is now bound to a
commitment: `answer_test_question` returns `correct_idx` only for a question in
the caller's own **in-progress** session, and only after that session's single
answer for it has been written. Learning the key costs the attempt it belongs to.

A learner can still retake a text and see the keys again — but a retake is a real
retake: a new session, a new Elo step, an overwritten completion. Forbidding that
would break a legitimate feature to close a hole that only lets someone cheat
themselves.

### Why the profile guard is `SECURITY INVOKER`

Learners must keep editing `display_name` and `daily_word_goal`, so the
"own profile update" policy has to stay. `guard_profile_server_fields` narrows
what it permits by asking *where the write came from*: PostgREST runs a request
as `authenticated` / `anon`, while a `SECURITY DEFINER` function runs as its
owner and the service role runs as `service_role`.

This only works because the trigger itself is **`SECURITY INVOKER`**. Making it
`DEFINER` switches `current_user` to the owner before the body runs, so the check
reports "trusted" for every caller and silently allows exactly the writes it
exists to block. That bug was written, caught by the security suite, and fixed —
hence the comment on the function.

## Consequences

**Data ownership is now explicit.**

| User-editable | Server-owned (engine only) |
| ------------- | -------------------------- |
| `profiles.display_name`, `profiles.daily_word_goal` | `profiles.ability`, `rd`, `answered`, `cefr_estimate`, `promotion_streak`, `level_source`, `streak_days`, `last_active`, `words_reviewed_today`, `word_streak_days`, `last_word_review` |
| `saved_words` (the learner's own deck) | `attempts`, `text_completions`, `test_sessions`, `test_session_items`, `calibration_sessions`, `calibration_session_items` — readable by their owner, writable by nobody outside the engine |

**`level_source` separates claimed from proven.** `manual` is a level someone
typed in (clamped, `rd` reset to full uncertainty, `answered` untouched);
`placement` is a replayed placement test; `test` is earned through reading tests.
The product can now treat them differently instead of guessing.

**The service-role key becomes required at runtime.** It was already documented
in `.env.example` and the README, but finalization now fails with a clear
`config_error` if it is missing rather than silently degrading.

**Concurrency is handled where it happens.** A session is locked for the duration
of an answer and of finalization; a rating computed from a profile that moved in
another tab is rejected (`FL423`) and recomputed once, rather than overwriting.

**Resume is possible because the session exists.** A learner who closes the tab
mid-test returns to the same session at the first unanswered question, with the
answers they already committed intact.

## Not decided here

- Whether `saved_words` SRS columns should become server-owned too. They are
  currently user-writable; the only thing a learner gains by editing them is a
  worse schedule for themselves.
- Whether `attempts` should stay one row per question now that a session row
  carries the summary. Keeping it preserves the existing stats chart and history.
