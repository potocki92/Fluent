/**
 * WHAT A GESTURE IN THE READER MEANS — decided in one place, without a DOM.
 *
 * TWO CHANNELS, AND THEY DO NOT NEGOTIATE. This is the whole design, and the
 * third attempt at it:
 *
 *   A TAP is handled on `click`, and it asks ONE question — what is under the
 *     finger? A tap on a word opens that word. Always.
 *   A SELECTION is handled on `selectionchange`, by `observeReaderSelection`,
 *     and it never involves a click at all.
 *
 * THE BUG THIS EXISTS TO KILL. On iOS a plain tap on *Wir* could open the
 * SENTENCE action bar — "Przetłumacz / Nie rozumiem" — instead of the word
 * sheet. The first two fixes both tried to make the tap smarter about the
 * selection: ignore a stale range, ignore a committed one, ignore one the
 * pointer is outside of. It kept coming back, because on a phone those tests are
 * not decisive:
 *
 *   * a multi-line range's bounding rectangle is the UNION of its lines, so
 *     "the pointer is inside the selection" is true for any tap on those lines;
 *   * a tap's own `selectionchange` — Safari moving or dropping the caret — makes
 *     the leftover range look uncommitted again, before the settle timer runs;
 *   * and Safari can still be holding the range when `click` fires anyway.
 *
 * Two guards, both true, on a gesture that was plainly a tap. So the tap no
 * longer reads the selection AT ALL. There is nothing left to get wrong: if the
 * gesture resolves to a `.reader-word`, it is a word.
 *
 * WHAT STILL HAS TO BE DECIDED IS "WAS THIS A TAP?", and that is answered from
 * the POINTER — how far it travelled between going down and coming up — not from
 * what the browser has selected. A drag that ends on a word fires a click there;
 * that click is the end of a selection the other channel already owns, so it is
 * ignored. Every uncertain case resolves to "tap": a click we cannot attribute to
 * a pointer gesture (iOS delivers the callout-dismissing tap with no
 * `pointerdown` of its own) is a tap.
 *
 * THE HIERARCHY, IN ORDER, AND IT IS ABSOLUTE:
 *
 *   1. a drag's trailing click                           → nothing; it is not a tap
 *   2. a tap resolving to `.reader-word`                 → the word sheet, always
 *   3. a tap inside `.reader-sentence` but not on a word → the sentence's actions
 *   4. anything else                                     → dismiss what is open
 *
 * Rules 2 and 3 are also where the reader stops asking the browser for
 * millimetre precision it was never given: see {@link distanceToRect} and
 * `WORD_TAP_SNAP_PX`.
 *
 * A leftover range is IGNORED, never cleared. Fluent does not clear a native
 * selection to win an argument with it (§30): the learner may be mid-copy, and
 * taking that away to show a button would be the worse bug.
 *
 * PURE, AND DELIBERATELY DOM-FREE. Nothing here touches a node, a `Range` or a
 * `window`. The caller resolves its event into the small descriptions below and
 * this decides what they mean — which is what makes the one part of the reader
 * that an automated test cannot drive (native selection on a phone) testable
 * anyway, in `reader-interaction.test.ts`.
 */

import { MAX_PHRASE_TOKENS } from "@/lib/notebook/constants";
import {
  annotationKindForSpan,
  spanFromCharRange,
  type SentenceSpan,
} from "@/lib/notebook/selection";

/**
 * A selection, in the reader's terms and without its geometry.
 *
 * `ReaderSelection` in `sentence-selection.ts` is this plus the rectangle the
 * action bar is anchored to. The split is what keeps every rule below decidable
 * without a browser.
 */
export interface SelectedRange {
  sentenceId: number;
  sentenceText: string;
  /** Character offsets into {@link sentenceText}. */
  charStart: number;
  charEnd: number;
  /** True when the selection started and ended in different sentences. */
  crossSentence: boolean;
}

/** A `.reader-word` under a gesture, read straight off the span's attributes. */
export interface ReaderWordHit {
  /** `data-occurrence-id`. The only attribute a word cannot do without. */
  occurrenceId: string | null;
  /** `data-word-id` — empty for a token the shared dictionary does not know. */
  wordId: string | null;
  sentenceId: string | null;
  /** `data-position` — the token's index among the sentence's lexical tokens. */
  position: string | null;
  lemma: string | null;
  /** The word exactly as the page shows it. */
  surface: string;
}

/** What the reader knows about the word that was tapped. */
export interface GlossTarget {
  occurrenceId: number;
  wordId: number | null;
  sentenceId: number | null;
  /** The token's index among the sentence's lexical tokens. The note's anchor. */
  tokenPosition: number | null;
  lemma: string;
  surface: string;
  /** The sentence the word appeared in — the thing that makes it mean something. */
  sentence: string;
}

/** Everything the DOM had to say about one gesture. */
export interface ReaderGesture {
  /** The `.reader-word` under the gesture, when there is one. */
  word: ReaderWordHit | null;
  /** The `.reader-sentence` under the gesture, when there is one. */
  sentenceId: number | null;
  /**
   * The pointer travelled far enough that this was a drag, not a tap.
   *
   * The ONLY thing the tap channel is allowed to know about selections, and it
   * is expressed in pointer movement rather than in ranges — see
   * {@link isDragGesture}. Nothing else about the browser's selection reaches
   * this function, by design.
   */
  isDrag: boolean;
}

/** What the reader should do about a gesture. */
export type ReaderIntent =
  /** Open the word sheet. Rule 2, and it is absolute. */
  | { kind: "word"; word: ReaderWordHit }
  /** Offer what can be done with a whole sentence. Rule 3. */
  | { kind: "sentence"; sentenceId: number }
  /**
   * Leave everything exactly as it is. Rule 1.
   *
   * NOT the same as "none": a drag's trailing click must not dismiss the action
   * bar that the drag's own selection just opened.
   */
  | { kind: "ignore" }
  /** Nothing to do but dismiss what is open. Rule 4. */
  | { kind: "none" };

/**
 * Is there actually something selected?
 *
 * A collapsed range, a zero-width range and a range Safari reports over
 * whitespace are all "no". This is the difference between a caret and a
 * selection, and a caret is not something to show an action bar for.
 */
export function isUsableSelection(selection: SelectedRange | null): boolean {
  if (!selection) return false;
  // A cross-sentence drag has no usable offsets but IS a selection — the learner
  // gets told why it cannot be saved rather than nothing happening (§131).
  if (selection.crossSentence) return true;
  return selection.charEnd > selection.charStart;
}

/**
 * The hierarchy, applied. Four lines, and no way for a word tap to lose.
 */
export function resolveReaderIntent(gesture: ReaderGesture): ReaderIntent {
  if (gesture.isDrag) return { kind: "ignore" };
  if (gesture.word) return { kind: "word", word: gesture.word };
  if (gesture.sentenceId !== null) return { kind: "sentence", sentenceId: gesture.sentenceId };
  return { kind: "none" };
}

/** One pointer gesture, as far as the click that may follow it is concerned. */
export interface PointerTrack {
  startX: number;
  startY: number;
  /** Where the pointer came up, and when. Null while it is still down. */
  endX: number | null;
  endY: number | null;
  endedAt: number | null;
  /** `PointerEvent.pointerType` — what decides whether a near miss is snapped. */
  pointerType: string;
}

/**
 * Was the gesture behind this click a drag rather than a tap?
 *
 * MEASURED IN PIXELS, NOT IN RANGES. "Did the browser select something?" cannot
 * answer this on iOS — Safari's answer at click time is about a gesture that may
 * be two paragraphs and one callout ago. How far the finger moved is about THIS
 * gesture and nothing else.
 *
 * EVERY UNCERTAIN CASE IS A TAP. No pointer went down (a synthetic click, a
 * keyboard, or iOS dismissing its own selection callout), the pointer is still
 * down, or the gesture is too old to be this click's: all of them mean the word
 * under the finger opens. That is the safe answer on this screen, and it is the
 * one behaviour the reader is not allowed to get wrong.
 */
export function isDragGesture(
  track: PointerTrack | null,
  at: number,
  slopPx: number,
  pairingMs: number,
): boolean {
  if (!track || track.endedAt === null) return false;
  if (at - track.endedAt > pairingMs) return false;

  const dx = (track.endX ?? track.startX) - track.startX;
  const dy = (track.endY ?? track.startY) - track.startY;
  return Math.hypot(dx, dy) > slopPx;
}

/** The corner of a box, in the only terms this file needs to know about one. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far a point is from a box. Zero inside it.
 *
 * WHY THE READER NEEDS THIS AT ALL. A `.reader-word` is an inline box about two
 * millimetres tall and the gap between two words is four or five pixels wide,
 * while a fingertip is nine millimetres across and `elementFromPoint` answers to
 * the pixel. The result is a tap the learner is certain landed on *sollten*
 * being delivered to the sentence around it — and answered with the SENTENCE's
 * actions, which is the bug this whole rewrite is about.
 *
 * So on a touch screen a near miss is resolved to the nearest word instead of
 * being treated as a deliberate tap on the space between two of them. This is
 * the measurement that "nearest" is made of; `WORD_TAP_SNAP_PX` is how near is
 * near enough.
 */
export function distanceToRect(box: Box, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.right);
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  return Math.hypot(dx, dy);
}

/**
 * A tapped word, turned into what the sheet needs.
 *
 * A TOKEN WITHOUT A `wordId` STILL OPENS THE SHEET. "Not in Fluent's dictionary"
 * is a fact about the dictionary, not about the learner's interest in the word —
 * the sheet is where they add it to their own (§4, §82). Only a missing
 * occurrence id is fatal, because without it there is no place to anchor
 * anything.
 */
export function glossTargetFrom(
  word: ReaderWordHit,
  sentenceText: string,
): GlossTarget | null {
  const occurrenceId = toNumber(word.occurrenceId);
  if (occurrenceId === null) return null;

  return {
    occurrenceId,
    wordId: toNumber(word.wordId),
    sentenceId: toNumber(word.sentenceId),
    tokenPosition: toNumber(word.position),
    lemma: word.lemma || word.surface,
    surface: word.surface,
    sentence: sentenceText.trim(),
  };
}

/** What the action bar is currently about. */
export type ReaderBarSubject =
  | { mode: "selection"; selection: SelectedRange }
  | { mode: "sentence"; sentenceId: number; sentenceText: string };

/** What the action bar should offer for it. */
export interface ReaderBarPlan {
  sentenceId: number;
  sentenceText: string;
  /** The span to annotate, when the selection is one saveable span. */
  span: { span: SentenceSpan; kind: "word" | "phrase" } | null;
  /** Shown INSTEAD of the actions when the selection cannot be used (§131). */
  note: string | null;
  /** "Nie rozumiem" — offered where the subject is the sentence as a whole. */
  offersUnclear: boolean;
}

/**
 * CONTEXTUAL, NEVER THE WHOLE MENU (§44).
 *
 * One token offers to record what it means HERE; two or more offer to save a
 * phrase; a drag past the end of a sentence offers an explanation and nothing
 * else, because half a paragraph is not a phrase. "Przetłumacz zdanie" is
 * offered in every case (the sentence is always there) and it says *zdanie*
 * because a bare "Przetłumacz" next to a selected phrase reads as an offer to
 * translate the phrase, which is a different note in a different table (§3);
 * "Nie rozumiem" only when the subject IS the sentence, so a learner saving a
 * phrase is not handed an unrelated admission of defeat.
 */
export function readerBarPlan(
  subject: ReaderBarSubject,
  maxPhraseTokens: number = MAX_PHRASE_TOKENS,
): ReaderBarPlan {
  if (subject.mode === "sentence") {
    return {
      sentenceId: subject.sentenceId,
      sentenceText: subject.sentenceText,
      span: null,
      note: null,
      offersUnclear: true,
    };
  }

  const { selection } = subject;
  const base = {
    sentenceId: selection.sentenceId,
    sentenceText: selection.sentenceText,
    span: null,
    offersUnclear: false,
  } as const;

  if (selection.crossSentence) {
    return { ...base, note: "Zaznacz fragment jednego zdania, aby zapisać zwrot." };
  }

  const result = spanFromCharRange(
    selection.sentenceText,
    selection.charStart,
    selection.charEnd,
    maxPhraseTokens,
  );

  if (!result.ok) {
    return {
      ...base,
      note:
        result.reason === "too_long"
          ? `Zwrot może mieć najwyżej ${maxPhraseTokens} słów.`
          : "Zaznacz co najmniej jedno słowo.",
    };
  }

  return {
    ...base,
    span: { span: result.span, kind: annotationKindForSpan(result.span) },
    note: null,
  };
}

/** `""`, `undefined` and anything unparseable all mean "not set". */
function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
