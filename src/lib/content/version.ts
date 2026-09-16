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
