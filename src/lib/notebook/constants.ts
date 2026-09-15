/**
 * Every number the personal notebook uses, in one file.
 *
 * Same rule as `src/lib/learning/planner/constants.ts`, `src/lib/reading/
 * constants.ts`, `src/lib/story/constants.ts` and `src/lib/import/constants.ts`,
 * for the same reason: a limit that exists as `slice(0, 300)` in a component and
 * `length > 300` in a Server Action is a limit that will disagree with itself
 * within a month, and a maximum phrase length hard-coded separately in the UI
 * and in SQL is exactly the bug §32 of this phase was written to prevent. The
 * database is PASSED `MAX_PHRASE_TOKENS`; it does not have its own copy.
 */

// ─────────────────────────────────────────────────────────────────────────────
// WHAT A PHRASE MAY BE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The longest span that may be saved as one phrase, in lexical tokens.
 *
 * A phrase is a unit of language — *Angst machen*, *sich auf etwas einlassen*,
 * *es kommt darauf an*. Eight tokens comfortably covers the longest separable
 * construction a learner is likely to want, and refuses the thing selection on a
 * phone makes far too easy: a drag that swallows half a paragraph and turns into
 * a "phrase" nobody can review.
 *
 * A span longer than this is not truncated. Truncating would save something the
 * learner did not choose; the selection is refused and the reader says why.
 */
export const MAX_PHRASE_TOKENS = 8;

/**
 * A selection covering ONE token is a word, not a phrase.
 *
 * Not a tuning knob, a definition — it is here so that the one place that turns
 * a span into a `kind` reads as a rule rather than as `count === 1`.
 */
export const PHRASE_MIN_TOKENS = 2;

// ─────────────────────────────────────────────────────────────────────────────
// HOW MUCH THE LEARNER MAY WRITE
// ─────────────────────────────────────────────────────────────────────────────
// These are the PRODUCT limits, enforced in the Server Actions. The columns also
// carry CHECK constraints, deliberately more generous: those protect the
// storage, these protect the experience. A learner who pastes an essay into a
// meaning field gets a clear refusal from the app rather than a Postgres error.

/** A learner's own Polish for one sentence. Long enough for a complex period. */
export const MAX_TRANSLATION_LENGTH = 1000;

/** A contextual meaning or a phrase meaning: a gloss, not an essay. */
export const MAX_MEANING_LENGTH = 300;

/** An optional personal headword ("sollten → sollen"). */
export const MAX_LEMMA_LENGTH = 80;

// ─────────────────────────────────────────────────────────────────────────────
// THE NOTEBOOK LISTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entries fetched per page.
 *
 * A learner who reads three novels has tens of thousands of notes, so the
 * notebook is paginated from the first commit rather than "once it gets slow" —
 * by which point the fix is a rewrite. Keyset pagination on
 * `(created_at desc, id desc)`, which every listing index is built for.
 */
export const NOTEBOOK_PAGE_SIZE = 25;

// ─────────────────────────────────────────────────────────────────────────────
// PRESENTATION
// ─────────────────────────────────────────────────────────────────────────────

/** What a cloze blank looks like. One definition, used by every card. */
export const CLOZE_BLANK = "______";

/**
 * How much of a sentence is shown around a cloze blank, in characters per side.
 *
 * A whole paragraph-length sentence in a flashcard is unreadable on a phone and
 * gives the answer away by sheer context. Null-safe: a sentence shorter than
 * this is shown whole, which is the common case.
 */
export const CLOZE_CONTEXT_CHARS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discount applied to "Nie rozumiem tego zdania", on top of the `self_rated`
 * response weight.
 *
 * WHERE THIS SITS IN THE HIERARCHY, and why (§16, §74):
 *
 *     validated wrong answer   0.6   a graded item, marked by Fluent
 *     "Nie rozumiem"           0.25  ← this: the learner's own report
 *     a repeated lookup        0.1 × n
 *     a single lookup          0.1
 *
 * Stronger than a lookup, because tapping a word is ambiguous — people also tap
 * to confirm a guess, out of curiosity, or by accident — while flagging a
 * sentence is a deliberate statement that comprehension failed. Weaker than a
 * graded answer, because nothing verified it: a learner can be wrong about what
 * they do and do not understand, in both directions.
 *
 * It is not "a failed test" in the other sense either: the event carries no
 * skill, no concept and no word, so it moves no mastery estimate at all. Its job
 * is to RANK what is worth revisiting.
 */
export const UNCLEAR_EVIDENCE_DISCOUNT = 0.5;

/**
 * Weight of a graded notebook card, relative to the same retrieval elsewhere.
 *
 * A contextual cloze is a real production exercise — the learner types the
 * German with nothing to pick from — so it is NOT discounted. What the learner
 * chose to put in their notebook is biased (they saved the words they found
 * hard), and that biases WHICH items get asked, not what answering one proves;
 * `source_kind = 'notebook'` is how a later refit tells the two apart, exactly as
 * `'practice'` does for weakness drills.
 */
export const NOTEBOOK_REVIEW_WEIGHT = 1;
