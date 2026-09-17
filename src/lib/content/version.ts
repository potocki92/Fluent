/**
 * The content processor's version stamp.
 *
 * Every chapter records the processor that produced its paragraphs, sentences
 * and occurrences. Without that stamp a reprocessing pass a year from now has no
 * way to tell which chapters were built by which tokenizer — and "the sentence
 * boundaries moved" is exactly the kind of change that silently invalidates
 * stored positions, reading progress and occurrence ids.
 *
 * BUMP IT whenever the pipeline's OUTPUT for the same input could differ:
 * a new abbreviation in the sentence splitter, a different token regex, a
 * changed normalisation rule. Do not bump it for comments or refactors that
 * cannot move a boundary.
 */
export const CONTENT_PROCESSOR_VERSION = "content_v2";

// v1 → v2: `matchToken` no longer refuses closed-class words, so a chapter now
// carries occurrences for *wir*, *haben*, *sollen* and the rest. Same text,
// different occurrences — exactly the case this stamp exists for.

// NOT BUMPED for the dictionary-independence change (every lexical token now
// gets an occurrence), and the reasoning matters more than the decision.
//
// The stamp exists because a MOVED POSITION silently invalidates stored reading
// positions and notebook anchors. That change moves nothing: paragraph
// positions, sentence positions, token positions and character offsets are
// byte-for-byte what they were, and the difference is additional rows at
// positions that previously had none, plus a nullable column.
//
// Bumping it anyway would not have been "safely conservative". `isNoteStale`
// treats a version change as "the anchor may have moved", so every learner's
// notebook note would have been marked as possibly-about-different-text — a
// false alarm about their own work, raised by a change that cannot affect them.
// A legacy chapter is detected precisely instead, per sentence, by comparing its
// stored `word_count` with the occurrences it actually has.
