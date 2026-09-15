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
 */

/** What the learner currently has selected, in the reader's terms. */
export interface ReaderSelection {
  sentenceId: number;
  sentenceText: string;
  /** Character offsets into {@link sentenceText}. */
  charStart: number;
  charEnd: number;
  /** True when the drag started and ended in different sentences. */
  crossSentence: boolean;
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

function sentenceElementOf(node: Node, root: HTMLElement): HTMLElement | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const sentence = element?.closest<HTMLElement>(".reader-sentence") ?? null;
  return sentence && root.contains(sentence) ? sentence : null;
}
