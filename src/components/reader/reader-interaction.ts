/**
 * WHAT A GESTURE IN THE READER MEANS — decided in one place, without a DOM.
 *
 * THE BUG THIS EXISTS TO KILL. On iOS a plain tap on *Wir* could open the
 * SENTENCE action bar — "Przetłumacz / Nie rozumiem" — instead of the word
 * sheet. Two things conspired. The click handler read `window.getSelection()`
 * first and let anything it found win, and Safari does not clear a selection on
 * the schedule a naive reading assumes: the callout from a long-press two
 * paragraphs ago is still in the document when the next tap's `click` fires, and
 * the tap that dismisses it is delivered to the word underneath. So a stale
 * range — one the learner had already finished with — was being treated as an
 * answer to the tap that was happening now.
 *
 * A tap on a word is the gesture this whole reader is built around. It is not
 * allowed to lose to something the browser happened to still be holding.
 *
 * THE HIERARCHY, IN ORDER, AND IT IS ABSOLUTE:
 *
 *   1. a tap on `.reader-word` with no LIVE selection    → the word sheet, always
 *   2. a live selection covering one lexical token       → "Zapisz znaczenie"
 *   3. a live selection covering 2+ tokens, one sentence → "Zapisz zwrot"
 *   4. a live selection that ran past the sentence       → an explanation (§131)
 *   5. a tap inside `.reader-sentence` but not on a word → the sentence's actions
 *   6. anything else                                     → nothing
 *
 * LIVE IS THE WHOLE WORD, AND IT TAKES THREE THINGS. A selection outranks a tap
 * only when it is all of:
 *
 *   * USABLE — a caret and a zero-width range are not selections;
 *   * UNCOMMITTED — the browser has changed it and the reader has not yet shown
 *     the learner anything about it. Once the action bar is up for a selection,
 *     that selection has been dealt with, and the NEXT tap is a new gesture;
 *   * UNDER THE POINTER — a drag always ends inside its own selection. A tap on
 *     a word somewhere else is not that drag ending.
 *
 * Any one of those alone is not enough, and the second is the one iOS needed.
 * "Changed since this gesture's `pointerdown`" was the first attempt, and it is
 * wrong on a phone: iOS delivers the tap that dismisses a selection callout as a
 * click with NO pointerdown of its own, so the long-press's own selection change
 * still looked current and swallowed the tap. A committed selection can no
 * longer swallow anything, whether or not a pointerdown arrived.
 *
 * A leftover range is IGNORED, never cleared. Fluent does not clear a native
 * selection to win an argument with it (§30): the learner may be mid-copy, and
 * taking that away to show a button would be the worse bug.
 *
 * PURE, AND DELIBERATELY DOM-FREE. Nothing here touches a node, a `Range` or a
 * `window`. The caller resolves its event into the small description below and
 * this decides what it means — which is what makes the one part of the reader
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
  /** What the browser has selected inside the reader RIGHT NOW. */
  selection: SelectedRange | null;
  /**
   * The selection has changed and the reader has NOT yet acted on it.
   *
   * This is the stale-selection guard, and it is a one-shot: the moment
   * `observeReaderSelection` surfaces a selection, it stops being uncommitted,
   * so the next click is a fresh tap rather than that selection's echo. False
   * means "the learner already has whatever this selection was going to give
   * them" — which is not an answer to a tap happening now.
   */
  selectionIsUncommitted: boolean;
  /**
   * The gesture happened inside that selection's own rectangle.
   *
   * A drag ends where its selection is; a tap on a word elsewhere does not. No
   * coordinates (a keyboard or synthetic click) reads as false, which resolves
   * to the word — rule 1.
   */
  pointerInsideSelection: boolean;
}

/** What the reader should do about a gesture. */
export type ReaderIntent =
  /** Open the word sheet. Rule 1. */
  | { kind: "word"; word: ReaderWordHit }
  /** The learner selected something; the action bar is about that. Rules 2–4. */
  | { kind: "selection"; selection: SelectedRange }
  /** Offer what can be done with a whole sentence. Rule 5. */
  | { kind: "sentence"; sentenceId: number }
  /** Nothing to do but dismiss what is open. Rule 6. */
  | { kind: "none" };

/**
 * Is there actually something selected?
 *
 * A collapsed range, a zero-width range and a range Safari reports over
 * whitespace are all "no". This is the difference between a caret and a
 * selection, and a caret must never outrank a word tap.
 */
export function isUsableSelection(selection: SelectedRange | null): boolean {
  if (!selection) return false;
  // A cross-sentence drag has no usable offsets but IS a selection — the learner
  // gets told why it cannot be saved rather than nothing happening (§131).
  if (selection.crossSentence) return true;
  return selection.charEnd > selection.charStart;
}

/**
 * The hierarchy, applied.
 *
 * Read it top to bottom: the only thing that beats a word tap is a selection the
 * learner is making right now.
 */
export function resolveReaderIntent(gesture: ReaderGesture): ReaderIntent {
  const { selection } = gesture;

  if (
    selection !== null &&
    isUsableSelection(selection) &&
    gesture.selectionIsUncommitted &&
    gesture.pointerInsideSelection
  ) {
    return { kind: "selection", selection };
  }

  if (gesture.word) return { kind: "word", word: gesture.word };
  if (gesture.sentenceId !== null) return { kind: "sentence", sentenceId: gesture.sentenceId };
  return { kind: "none" };
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
 * else, because half a paragraph is not a phrase. "Przetłumacz" is offered in
 * every case (the sentence is always there); "Nie rozumiem" only when the
 * subject IS the sentence, so a learner saving a phrase is not handed an
 * unrelated admission of defeat.
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
