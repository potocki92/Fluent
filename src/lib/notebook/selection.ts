/**
 * Turning a selection into a span of the book.
 *
 * THE PROBLEM THIS SOLVES. A learner drags across *Angst machen* on a phone.
 * What the browser hands back is a character range in rendered text — which is
 * the wrong unit for everything downstream. Character offsets move when a
 * chapter is reprocessed under a different tokenizer; token positions do not,
 * which is why `word_occurrences.position` is "the index among the sentence's
 * LEXICAL tokens" and why reading progress stores positions rather than ids.
 *
 * So a selection is snapped to whole tokens and stored as a POSITION RANGE, with
 * the character offsets kept alongside as a rendering convenience. The snapping
 * also fixes the thing native selection gets wrong roughly every second time on
 * iOS: a drag that ends one character into the next word, or one character short
 * of the end of this one.
 *
 * ONE TOKENIZER. `tokenize` here is the content pipeline's own tokenizer, the
 * same function that produced the occurrences in the database. That is not a
 * convenience — a second tokenizer would put a phrase's positions out of step
 * with the occurrence positions the reader renders and the cloze blanks, and the
 * repository forbids one for exactly that reason.
 *
 * PURE, AND DELIBERATELY DOM-FREE. Nothing here touches `window.getSelection()`
 * or a node: the caller resolves its selection to (sentence text, character
 * range) and this decides what that means. That keeps every rule below unit
 * tested without a browser — which matters, because native selection is the one
 * part of this phase an automated test cannot drive.
 */

import { tokenize } from "@/lib/content/tokenize";
import { MAX_PHRASE_TOKENS, PHRASE_MIN_TOKENS } from "@/lib/notebook/constants";

/** What a span of one sentence is, in both units. */
export interface SentenceSpan {
  /** Inclusive token positions — the DURABLE address. */
  startPosition: number;
  endPosition: number;
  /** Character offsets into the sentence text — for rendering and cloze. */
  charStart: number;
  charEnd: number;
  /** The text of the span, exactly as the sentence has it. */
  surface: string;
  tokenCount: number;
}

/** Why a selection could not become a span. Each maps to one Polish sentence. */
export type SpanRejection =
  /** The drag covered punctuation, whitespace, or nothing at all. */
  | "no_tokens"
  /** More tokens than one phrase may hold — see {@link MAX_PHRASE_TOKENS}. */
  | "too_long";

export type SpanResult =
  | { ok: true; span: SentenceSpan }
  | { ok: false; reason: SpanRejection };

/**
 * Snap a character range to whole tokens.
 *
 * A token is included when it OVERLAPS the range at all, which is what makes a
 * sloppy drag work: selecting "ngst mache" gets *Angst machen*. Selecting only
 * the space between two words touches no token and is refused rather than
 * guessed at — a phrase the learner did not choose is worse than no phrase.
 */
export function spanFromCharRange(
  sentenceText: string,
  from: number,
  to: number,
  maxTokens: number = MAX_PHRASE_TOKENS,
): SpanResult {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(sentenceText.length, Math.max(from, to));

  const tokens = tokenize(sentenceText);
  const covered = tokens.filter(
    (token) => token.charStart < end && token.charEnd > start,
  );

  if (covered.length === 0) return { ok: false, reason: "no_tokens" };
  return spanFrom(sentenceText, covered[0].position, covered.at(-1)!.position, maxTokens);
}

/**
 * Build a span from token positions that are already known.
 *
 * This is the path the SERVER takes. The reader sends positions; the action
 * re-derives the offsets and the surface from the sentence text held in the
 * database, so what gets stored is what the book says rather than what the
 * request claimed. The same re-derivation happens again inside
 * `save_text_annotation`, which refuses any span whose surface does not match
 * the stored text — belt and braces, because this is the one place a client
 * could otherwise write words into its own notebook that no book contains.
 */
export function spanFromTokenPositions(
  sentenceText: string,
  startPosition: number,
  endPosition: number,
  maxTokens: number = MAX_PHRASE_TOKENS,
): SpanResult {
  return spanFrom(sentenceText, startPosition, endPosition, maxTokens);
}

function spanFrom(
  sentenceText: string,
  startPosition: number,
  endPosition: number,
  maxTokens: number,
): SpanResult {
  const tokens = tokenize(sentenceText);
  const first = tokens[startPosition];
  const last = tokens[endPosition];
  if (!first || !last || endPosition < startPosition) {
    return { ok: false, reason: "no_tokens" };
  }

  const tokenCount = endPosition - startPosition + 1;
  if (tokenCount > Math.max(1, maxTokens)) return { ok: false, reason: "too_long" };

  return {
    ok: true,
    span: {
      startPosition,
      endPosition,
      charStart: first.charStart,
      charEnd: last.charEnd,
      // Sliced from the sentence, not joined from the tokens: the space,
      // apostrophe or hyphen BETWEEN two tokens is part of the phrase as
      // written, and rebuilding it with `join(" ")` would quietly normalise
      // "sich's" into "sich 's".
      surface: sentenceText.slice(first.charStart, last.charEnd),
      tokenCount,
    },
  };
}

/**
 * What kind of annotation a span is.
 *
 * The three language levels stay distinct where it matters — a contextual
 * meaning never touches the dictionary — but which of them a SELECTION is, is
 * simply how many tokens it covers. §43: one token is the word interaction the
 * reader already has, and inventing a one-word "phrase" for it would put the
 * same note in two places.
 */
export function annotationKindForSpan(span: SentenceSpan): "word" | "phrase" {
  return span.tokenCount >= PHRASE_MIN_TOKENS ? "phrase" : "word";
}
