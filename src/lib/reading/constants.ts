/**
 * Every number the reader uses, in one file.
 *
 * Same rule as `src/lib/learning/planner/constants.ts`, for the same reason: a
 * reader whose thresholds are scattered as `* 0.95` and `> 60_000` across a
 * dozen components cannot be tuned, and nobody can say what it currently
 * believes. Components and server actions import from here; the database is
 * PASSED these values rather than hard-coding them, so there is exactly one
 * definition of "a chapter is finished".
 */

// ─────────────────────────────────────────────────────────────────────────────
// TIME ESTIMATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Words per minute assumed for a learner reading for pleasure.
 *
 * Deliberately lower than the planner's graded-passage figure: a passage is read
 * to answer questions about it, a chapter is read to find out what happens. A
 * native reads German prose at 200–250 wpm; an A2–B1 learner in a book they
 * chose is nearer 90.
 *
 * NOT HARD-CODED IN THE UI. `reading_sessions` records `active_seconds` against
 * `words_progressed`, which is precisely the data needed to replace this
 * constant with a per-learner measurement — see
 * `docs/architecture/reader-story-engine.md`.
 */
export const READER_WORDS_PER_MINUTE = 90;

/** Never advertise a chapter as taking less than this. */
export const MIN_CHAPTER_MINUTES = 1;

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE READING TIME
// ─────────────────────────────────────────────────────────────────────────────
// "Tab open for two hours" is not two hours of reading, and recording it as such
// would poison every metric built on top — reading speed, lookup rate, the
// chapter summary. Active time is therefore accumulated only while the document
// is visible AND something happened recently.

/** No scroll, tap or key for this long and the clock stops. */
export const IDLE_TIMEOUT_MS = 60_000;

/** How often the reader ticks its own clock. Cheap; nothing is sent. */
export const ACTIVE_TICK_MS = 5_000;

/**
 * Hard ceiling on one progress report's claim of elapsed time.
 *
 * Defends the metric against a machine that slept, a debugger paused on a
 * breakpoint, and a forged request: whatever the client says, one report can
 * only ever add this much. The database enforces it too.
 */
export const MAX_ACTIVE_SECONDS_PER_REPORT = 300;

// ─────────────────────────────────────────────────────────────────────────────
// TOUCHING THE TEXT
// ─────────────────────────────────────────────────────────────────────────────
// A finger is about 9mm across; a word in a book is about 2mm tall. Every number
// here exists because those two facts do not match, and because the browser
// answers "what is at this point?" with millimetre precision the learner does not
// have. They are the difference between a reader that opens the word you tapped
// and one that argues with you about it.

/**
 * How far from a word a touch may land and still BE that word.
 *
 * `elementFromPoint` is an exact hit test. The gap between two words is four or
 * five pixels wide and the punctuation is glued to the word before it, so a tap
 * the learner experiences as landing squarely on *sollten* routinely resolves to
 * the sentence around it — which is how a word tap ended up opening the
 * SENTENCE's action bar on a phone. So a near miss is resolved to the nearest
 * word instead, within this radius, measured from the word's own box.
 *
 * ONLY ON A COARSE POINTER. A mouse is precise, and on a mouse the gap between
 * two words is a place you can deliberately click — which is how the sentence's
 * own actions are reached. On a phone that gesture does not exist, so it is not
 * pretended to: everything the sentence bar offers is on the word sheet too.
 */
export const WORD_TAP_SNAP_PX = 12;

/**
 * Movement above which a gesture was a DRAG, and therefore not a tap.
 *
 * A drag that ends on a word still fires a click on it. That click is the end of
 * a selection, not a request to open the word — and the selection channel has
 * already handled it. Below this, a finger that wobbled is still a tap.
 */
export const TAP_SLOP_PX = 10;

/**
 * How long after the pointer came up a click may still be attributed to it.
 *
 * iOS delivers some clicks with no `pointerdown` of their own — notably the tap
 * that dismisses a selection callout. Such a click must not be paired with
 * whatever pointer gesture happened before it (a scroll, a drag that went
 * nowhere), so an origin this old is not this click's origin, and a click with
 * no origin is a TAP. Every uncertain case resolves to "tap", deliberately: on
 * this screen, opening the word the learner touched is the safe answer.
 */
export const CLICK_PAIRING_MS = 700;

/**
 * How long to wait after a gesture before believing what is selected.
 *
 * Safari finalises a selection just AFTER `touchend` — read it on the event and
 * you get the range as it was mid-drag. It is also the window in which a tap
 * collapses an old selection. 120ms is long enough for both and short enough
 * that the bar still feels attached to the finger that asked for it.
 */
export const SELECTION_SETTLE_MS = 120;

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS REPORTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How often progress is sent while reading.
 *
 * A request per scroll event is both useless and abusive. Progress is only worth
 * a round trip when the answer to "where is this learner?" has actually changed,
 * so the reader batches: at most one write every {@link PROGRESS_FLUSH_MS}, and
 * only when something moved. A flush is also forced when the page is hidden,
 * which is what makes closing the tab safe.
 */
export const PROGRESS_FLUSH_MS = 15_000;

/**
 * Paragraphs advanced before an early flush is worth it.
 *
 * Without this, a learner who reads for ten seconds and leaves loses their
 * position; with it, the first real movement is persisted almost immediately.
 */
export const PROGRESS_FLUSH_PARAGRAPHS = 5;

/**
 * Share of a paragraph that must be on screen before it counts as "reached".
 *
 * Guards the completion rule against layout: a last paragraph that renders one
 * pixel into the viewport is not a chapter that was read.
 */
export const PARAGRAPH_VISIBLE_RATIO = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Furthest progress a learner must reach before a chapter may be completed.
 *
 * Not 1.0: the final paragraph is often a single line, and demanding that it be
 * fully scrolled past makes finishing a chapter feel broken. Not 0.8 either —
 * that would let someone "finish" with a fifth of the chapter unread.
 */
export const CHAPTER_COMPLETION_RATIO = 0.95;

/**
 * Share of a planned reading task's estimate that counts as having done it.
 *
 * "Czytaj przez około 8 minut" is satisfied by eight minutes of reading, not by
 * finishing a chapter that happens to be twice that long. The planner writes the
 * resulting second count onto the plan item; the database only compares.
 */
export const READING_SEGMENT_COMPLETION_SHARE = 0.8;

// ─────────────────────────────────────────────────────────────────────────────
// VOCABULARY COVERAGE
// ─────────────────────────────────────────────────────────────────────────────
// "Znasz 91% słów w tym rozdziale" is a great feature and a terrible lie. It is
// only honest when the estimate rests on enough observed words; below that the
// reader says so instead of inventing a number.

/** Distinct chapter words we must have evidence about before quoting a figure. */
export const MIN_COVERAGE_OBSERVATIONS = 25;

/** …and that must be at least this share of the chapter's distinct vocabulary. */
export const MIN_COVERAGE_SHARE = 0.2;

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extra discount applied to a word lookup, on top of the `passive` response
 * weight.
 *
 * A LOOKUP IS NOT A FAILED TEST. Tapping *Schwert* says the learner was unsure
 * enough to check — which is real information, and much weaker information than
 * getting *Schwert* wrong in a graded item. People also tap out of curiosity, to
 * confirm a guess, or by accident. At 0.2 × 0.5 = 0.1 one lookup is worth a
 * sixth of a multiple-choice answer, so a single tap barely moves anything and
 * five taps across five chapters — the signal we actually want — clearly does.
 */
export const LOOKUP_EVIDENCE_DISCOUNT = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// THE GLOSS'S VIEW OF THE DICTIONARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long the gloss trusts a dictionary answer it already has.
 *
 * A lexeme's general translation is the same everywhere it appears, so caching it
 * across a whole book is free and obviously right.
 *
 * A MISS IS NOT CACHED AT ALL, and that asymmetry is the point — see
 * `useReaderWord`. "Fluent has no entry for this" is a statement about the
 * dictionary at one instant, and the whole purpose of this phase is that it stops
 * being true the moment somebody adds the word. Cached for five minutes it would
 * become exactly the stale negative the reader was rebuilt to get rid of: the
 * learner adds *ziehen*, taps *zog* again, and is told again that it is not in
 * the dictionary.
 */
export const GLOSS_DICTIONARY_STALE_MS = 5 * 60 * 1000;

/**
 * How many reconciliation calls the reader will make for one chapter.
 *
 * The pass is batched and resumable, so this is a ceiling on one page view, not
 * on the work: a chapter longer than this is finished the next time it is
 * opened, because the cursor is derived from the rows rather than remembered.
 * The bound exists so a pathological chapter cannot turn "open a book" into an
 * unbounded series of background requests.
 */
export const DICTIONARY_SYNC_MAX_CALLS = 8;
