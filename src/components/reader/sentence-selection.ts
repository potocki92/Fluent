/**
 * Reading a browser selection as a span of one sentence.
 *
 * WHY THIS IS NOT A SELECTION ENGINE (§30). Fluent does not draw its own
 * handles, does not swallow `selectstart`, and does not reimplement dragging.
 * On iOS the native handles, the magnifier and the callout are better than
 * anything this app would build, and fighting them produces a reader where text
 * cannot be copied. So the browser selects, and this module only ASKS what was
 * selected.
 *
 * WHAT IT HAS TO GET RIGHT. The reader renders a sentence as a `<span
 * class="reader-sentence">` whose text content is byte-for-byte the `sentences.
 * text` the pipeline stored — that is what makes a DOM offset convertible into a
 * character offset the database can verify. The conversion is done with a
 * `Range`, not by counting nodes, so the interleaved `.reader-word` spans and
 * bare text nodes do not have to be walked by hand.
 *
 * A SELECTION THAT LEAVES THE SENTENCE IS REPORTED, NOT SILENTLY TRIMMED (§131).
 * "Half a paragraph" is not a phrase; the reader says so rather than saving the
 * first sentence's worth of it and pretending that is what was asked for.
 *
 * A SELECTION ANNOUNCES ITSELF — IT IS NOT DISCOVERED BY A TAP. See
 * {@link observeReaderSelection}. That is the difference between a reader where
 * a word tap works on iOS and one where it does not.
 *
 * AND WHAT A TAP LANDED ON is the other half of the same question, so
 * {@link readerHitAt} lives here too. Both answer "what did the browser just
 * tell us?"; what it MEANS is decided in `reader-interaction.ts`.
 */

import type {
  ReaderWordHit,
  SelectedRange,
} from "@/components/reader/reader-interaction";

/** What the learner currently has selected, in the reader's terms. */
export interface ReaderSelection extends SelectedRange {
  /** Where to put the action bar. Viewport coordinates. */
  rect: DOMRect;
}

/** Read the current selection, or `null` when there is nothing useful in it. */
export function readReaderSelection(root: HTMLElement | null): ReaderSelection | null {
  if (!root) return null;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (range.toString().trim().length === 0) return null;

  const start = sentenceElementOf(range.startContainer, root);
  const end = sentenceElementOf(range.endContainer, root);
  if (!start) return null;

  const sentenceId = Number(start.dataset.sentenceId);
  if (!Number.isFinite(sentenceId)) return null;

  const rect = range.getBoundingClientRect();

  if (start !== end) {
    return {
      sentenceId,
      sentenceText: start.textContent ?? "",
      charStart: 0,
      charEnd: 0,
      crossSentence: true,
      rect,
    };
  }

  // Measure from the start of the sentence to the start of the selection. A
  // Range's own `toString()` is the flattened text, which is exactly the unit
  // the stored offsets are in.
  const prefix = document.createRange();
  prefix.selectNodeContents(start);
  prefix.setEnd(range.startContainer, range.startOffset);
  const charStart = prefix.toString().length;

  return {
    sentenceId,
    sentenceText: start.textContent ?? "",
    charStart,
    charEnd: charStart + range.toString().length,
    crossSentence: false,
    rect,
  };
}

/** Drop the selection without moving the page (§93). */
export function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
}

/**
 * How long to wait after a gesture before believing what is selected.
 *
 * Safari finalises a selection just AFTER `touchend` — read it on the event and
 * you get the range as it was mid-drag. It is also the window in which a tap
 * collapses an old selection. 120ms is long enough for both and short enough
 * that the bar still feels attached to the finger that asked for it.
 */
const SELECTION_SETTLE_MS = 120;

/** A live view of what the learner has selected inside the reader. */
export interface ReaderSelectionObserver {
  /**
   * Has the selection changed without the reader having acted on it yet?
   *
   * This is the stale-selection guard the word tap depends on, and it is a
   * ONE-SHOT: committing a selection — showing the learner its action bar —
   * clears it. A leftover range answers `false`, so the tap goes to the word
   * under the finger where it belongs.
   *
   * IT IS NOT "CHANGED SINCE THIS GESTURE'S POINTERDOWN". That was the first
   * attempt and it is wrong on iOS: the tap that dismisses a selection callout
   * arrives as a click with no pointerdown of its own, so the long-press's own
   * change still looked current and swallowed the tap. Committing is the event
   * that ends a selection's claim on the next click, and it happens whether or
   * not a pointerdown ever arrives.
   */
  isUncommitted(): boolean;
  stop(): void;
}

/**
 * Did the gesture happen inside the selection it is being compared with?
 *
 * A drag ends where its own selection is. A tap on a word somewhere else does
 * not, and must never be read as that drag ending. The margin covers the
 * rounding at a selection's edge, where a mouseup legitimately lands.
 */
export function pointerInsideRect(
  rect: DOMRect | null | undefined,
  pointer: ReaderPointer,
  margin = 6,
): boolean {
  if (!rect || !hasCoordinates(pointer)) return false;
  const { clientX: x, clientY: y } = pointer;
  return (
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin
  );
}

/**
 * A synthetic click carries no coordinates, and (0, 0) is never a tap in the
 * prose — the reader's header is there.
 */
function hasCoordinates({ clientX: x, clientY: y }: ReaderPointer): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && !(x === 0 && y === 0);
}

/**
 * Watch the native selection, and report it when it settles.
 *
 * WHY THIS IS NOT DONE ON `click`. On iOS a long-press that selects a word emits
 * no click at all — the callout appears and that is the end of the gesture. A
 * reader that only looked at selections during a click therefore could not show
 * anything for the single most common way a phrase gets selected on a phone,
 * until the NEXT tap came along — at which point it showed the previous
 * gesture's selection instead of handling that tap. Both halves of the iOS bug
 * come from the same mistake. So selections are observed, taps are handled, and
 * the two never have to guess about each other.
 *
 * IT DOES NOT TOUCH THE SELECTION. No `preventDefault`, no `removeAllRanges`, no
 * `selectstart` handler: the learner can still copy, and the native callout
 * still works.
 *
 * ONE LISTENER, AND NO PER-FRAME WORK. `selectionchange` fires continuously
 * during a drag, so nothing is read until the pointer is up and the selection
 * has stopped moving.
 */
export function observeReaderSelection(
  getRoot: () => HTMLElement | null,
  onSelection: (selection: ReaderSelection | null) => void,
): ReaderSelectionObserver {
  let uncommitted = false;
  let pointerDown = false;
  let timer = 0;

  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const schedule = () => {
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      // COMMITTING ENDS THIS SELECTION'S CLAIM ON THE NEXT CLICK. From here the
      // learner can see what it offers, so the next tap is a new gesture.
      uncommitted = false;
      onSelection(readReaderSelection(getRoot()));
    }, SELECTION_SETTLE_MS);
  };

  const onSelectionChange = () => {
    uncommitted = true;
    // Mid-drag the answer is not final yet; the pointer coming up schedules it.
    if (!pointerDown) schedule();
  };

  const onPointerDown = () => {
    pointerDown = true;
    cancel();
  };

  const onPointerUp = () => {
    pointerDown = false;
    schedule();
  };

  document.addEventListener("selectionchange", onSelectionChange);
  // Capture, so a handler that stops propagation cannot leave this observer
  // believing a gesture is still in progress.
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);

  return {
    isUncommitted: () => uncommitted,
    stop() {
      cancel();
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
    },
  };
}

/** What the prose says is under a gesture. */
export interface ReaderHit {
  word: HTMLElement | null;
  sentence: HTMLElement | null;
  sentenceId: number | null;
}

/**
 * The parts of a click this needs.
 *
 * A native `MouseEvent` and React's synthetic one both satisfy it, which is what
 * keeps this function testable in a bare browser page with no React in it.
 */
export interface ReaderPointer {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
}

/**
 * Find the word and the sentence a tap landed on.
 *
 * `event.target` IS NOT ALWAYS ENOUGH ON A PHONE. A `.reader-word` is an inline
 * span a few millimetres tall; iOS resolves a touch against line boxes, and a
 * tap a pixel above the ascender or below the descender of *Wir* is delivered to
 * the enclosing sentence instead — which used to mean the learner got the
 * sentence's actions when they had plainly tapped a word. So when the target is
 * not a word, the POINT is asked as well, which is the question the learner
 * actually posed. `elementFromPoint` is a single hit test, not a walk, and it
 * only ever runs on the taps that missed.
 *
 * A synthetic click carries no coordinates, so it is left to `target` alone. The
 * test for that is the COORDINATES, not `event.detail`: iOS delivers real taps
 * with `detail === 0` often enough that gating on it loses exactly the taps this
 * fallback exists for.
 */
export function readerHitAt(
  root: HTMLElement | null,
  pointer: ReaderPointer,
): ReaderHit {
  const empty: ReaderHit = { word: null, sentence: null, sentenceId: null };
  const target = pointer.target as HTMLElement | null;
  if (!root || !target?.closest) return empty;

  let word = target.closest<HTMLElement>(".reader-word");
  let sentence = target.closest<HTMLElement>(".reader-sentence");

  if (!word && hasCoordinates(pointer)) {
    const atPoint = document
      .elementFromPoint(pointer.clientX, pointer.clientY)
      ?.closest<HTMLElement>(".reader-word");
    if (atPoint && root.contains(atPoint)) {
      word = atPoint;
      sentence = atPoint.closest<HTMLElement>(".reader-sentence") ?? sentence;
    }
  }

  if (word && !root.contains(word)) word = null;
  if (sentence && !root.contains(sentence)) sentence = null;

  const sentenceId = Number(sentence?.dataset.sentenceId);
  return {
    word,
    sentence,
    sentenceId: sentence && Number.isFinite(sentenceId) ? sentenceId : null,
  };
}

/** A `.reader-word` span, as the attributes `ReaderProse` wrote onto it. */
export function readerWordHit(element: HTMLElement): ReaderWordHit {
  return {
    occurrenceId: element.dataset.occurrenceId ?? null,
    // Empty for a token the shared dictionary does not know — which still opens
    // the sheet, where it can be added to the learner's own (§4).
    wordId: element.dataset.wordId ?? null,
    sentenceId: element.dataset.sentenceId ?? null,
    position: element.dataset.position ?? null,
    lemma: element.dataset.lemma ?? null,
    surface: element.textContent ?? "",
  };
}

function sentenceElementOf(node: Node, root: HTMLElement): HTMLElement | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const sentence = element?.closest<HTMLElement>(".reader-sentence") ?? null;
  return sentence && root.contains(sentence) ? sentence : null;
}
