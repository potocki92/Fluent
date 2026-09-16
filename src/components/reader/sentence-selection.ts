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

import {
  distanceToRect,
  type ReaderWordHit,
  type SelectedRange,
} from "@/components/reader/reader-interaction";
import { SELECTION_SETTLE_MS } from "@/lib/reading/constants";

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

/**
 * Drop the selection without moving the page (§93).
 *
 * CALLED WHEN THE LEARNER IS FINISHED WITH IT, AND ONLY THEN — they chose an
 * action, so the selection has done its job. It is deliberately NOT called when
 * the bar merely goes away (a scroll, a tap elsewhere): someone who selected a
 * passage to copy it out of the book is mid-gesture, and taking that away to
 * tidy up a toolbar is precisely what §30 says never to do.
 */
export function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
}

/** A live view of what the learner has selected inside the reader. */
export interface ReaderSelectionObserver {
  stop(): void;
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
 * IT ONLY EVER REPORTS NEWS. Two guards, and they are the other half of the iOS
 * fix. A selection is read only when `selectionchange` actually fired, so a tap
 * that changed nothing cannot surface a range left over from a gesture two
 * paragraphs ago; and a reading identical to the last one already shown is
 * dropped, so a range Safari is still holding after the learner has finished
 * with it never comes back as a fresh offer. What the browser is holding is
 * never, by itself, a request.
 *
 * ONE LISTENER, AND NO PER-FRAME WORK. `selectionchange` fires continuously
 * during a drag, so nothing is read until the pointer is up and the selection
 * has stopped moving.
 */
export function observeReaderSelection(
  getRoot: () => HTMLElement | null,
  onSelection: (selection: ReaderSelection | null) => void,
): ReaderSelectionObserver {
  let pointerDown = false;
  /** `selectionchange` has fired since the last reading. */
  let changed = false;
  /** What the learner was last shown, so the same range is not re-offered. */
  let reported: string | null = null;
  let timer = 0;

  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };

  const schedule = () => {
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      changed = false;

      const selection = readReaderSelection(getRoot());
      const signature = selectionSignature(selection);
      if (signature === reported) return;

      reported = signature;
      onSelection(selection);
    }, SELECTION_SETTLE_MS);
  };

  const onSelectionChange = () => {
    changed = true;
    // Mid-drag the answer is not final yet; the pointer coming up schedules it.
    if (!pointerDown) schedule();
  };

  const onPointerDown = () => {
    pointerDown = true;
    cancel();
  };

  const onPointerUp = () => {
    pointerDown = false;
    // A tap that selected nothing is not a selection gesture, and must not be
    // answered with whatever the browser happens to still be holding.
    if (changed) schedule();
  };

  document.addEventListener("selectionchange", onSelectionChange);
  // Capture, so a handler that stops propagation cannot leave this observer
  // believing a gesture is still in progress.
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);

  return {
    stop() {
      cancel();
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
    },
  };
}

/** Identity of a reading, so an unchanged selection is not reported twice. */
function selectionSignature(selection: ReaderSelection | null): string | null {
  if (!selection) return null;
  return [
    selection.sentenceId,
    selection.charStart,
    selection.charEnd,
    selection.crossSentence,
  ].join(":");
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
 * `event.target` IS NOT ENOUGH ON A PHONE, AND NEITHER IS THE POINT. Three
 * answers are tried, in order, and each one is less literal than the last:
 *
 *   1. `event.target` — right on a mouse, right on most taps;
 *   2. `elementFromPoint` — for the tap iOS delivered to the sentence although
 *      the point itself is inside a word's box;
 *   3. THE NEAREST WORD within `snapPx`, which is the one that matters.
 *
 * Step 3 is the fix for the bug that survived two previous attempts. A
 * `.reader-word` is an inline box about two millimetres tall; the gap between
 * two words is four or five pixels wide; a comma is glued to the word before it
 * with no gap at all. A fingertip is nine millimetres across, and every hit test
 * above answers to the pixel. So a tap the learner is certain landed on
 * *sollten* lands in the space beside it, resolves to `.reader-sentence`, and
 * gets answered with "Przetłumacz zdanie / Nie rozumiem" — a bar about something
 * they did not ask about. Asking which word is NEAREST is the question they
 * actually posed.
 *
 * `snapPx` IS 0 ON A MOUSE, and the caller decides from the pointer type. A
 * mouse can deliberately click the space between two words, and on a mouse that
 * is how the sentence's own actions are reached. A finger cannot, so on a phone
 * the word wins the whole line — which is safe precisely because everything the
 * sentence bar offers is also on the word sheet (§14).
 *
 * The search is scoped to the tapped paragraph and only runs on a tap that
 * missed, so it costs one bounded pass over inline boxes on the rare gesture
 * that needs it, and nothing at all on the common one.
 */
export function readerHitAt(
  root: HTMLElement | null,
  pointer: ReaderPointer,
  snapPx = 0,
): ReaderHit {
  const empty: ReaderHit = { word: null, sentence: null, sentenceId: null };
  const target = pointer.target as HTMLElement | null;
  if (!root || !target?.closest) return empty;

  let word = target.closest<HTMLElement>(".reader-word");
  let sentence = target.closest<HTMLElement>(".reader-sentence");

  if (!word && hasCoordinates(pointer)) {
    const { clientX: x, clientY: y } = pointer;
    const atPoint =
      document.elementFromPoint(x, y)?.closest<HTMLElement>(".reader-word") ??
      nearestWord(
        // The tapped sentence when there is one, the paragraph when the tap fell
        // in the leading between two lines — where no inline box reaches.
        sentence ?? target.closest<HTMLElement>("[data-paragraph-position]"),
        x,
        y,
        snapPx,
      );

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

/**
 * The closest `.reader-word` to a point, or null if none is close enough.
 *
 * Measured against each word's own CLIENT RECTS rather than its bounding box: a
 * word broken across two lines (German compounds, hyphenation) has a bounding
 * box spanning the whole column, and a tap anywhere on either line would
 * otherwise land on it.
 */
function nearestWord(
  scope: HTMLElement | null,
  x: number,
  y: number,
  snapPx: number,
): HTMLElement | null {
  if (!scope || snapPx <= 0) return null;

  let best: HTMLElement | null = null;
  let bestDistance = snapPx;

  for (const candidate of scope.querySelectorAll<HTMLElement>(".reader-word")) {
    for (const rect of candidate.getClientRects()) {
      const distance = distanceToRect(rect, x, y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }

  return best;
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
