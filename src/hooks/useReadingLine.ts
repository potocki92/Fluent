"use client";

import { useMemo, type RefObject } from "react";

import { READING_LINE_RATIO } from "@/lib/reading/constants";
import { readingLineY, type ReadingAnchor } from "@/lib/reading/position";

/**
 * The bridge between the DOM and a reading position — and the only file in the
 * engine that touches geometry at all.
 *
 * THE READING LINE is one virtual horizontal line across the viewport, at
 * {@link READING_LINE_RATIO} of its height. It is never drawn. Whatever sentence
 * crosses it is where the learner is, and that single question replaces every
 * scroll-percentage heuristic the reader used to run on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT AN IntersectionObserver OVER PARAGRAPHS
 * ─────────────────────────────────────────────────────────────────────────────
 * That is what the old `useVisibleParagraph` did, and it can only answer "was
 * this paragraph on screen?" — a question with no resolution inside a paragraph
 * and no memory of direction. A 400-word paragraph is one bit of information,
 * which is exactly why a learner who stopped in the middle of one was returned
 * to the top of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS CHEAP
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolving the line is `elementsFromPoint` — ONE hit test, independent of the
 * chapter's length — plus a bounded scan of the words inside the sentence it
 * found, to say which token the line is on. A 15 000-word chapter costs exactly
 * what a 500-word one costs.
 *
 * `elementsFromPoint` rather than `elementFromPoint` because the reader has
 * overlays (the progress bar, the resume marker, the action bar) and the topmost
 * element at a point is not always prose.
 *
 * NOTHING IS CACHED, deliberately. Every measurement is read live, so a font
 * change, a rotation, a resize or a sheet opening needs no invalidation — there
 * is nothing to invalidate. The cost of that choice is a handful of
 * `getBoundingClientRect` calls per sample; the cost of the alternative is a
 * cache that is wrong exactly when the learner changes something.
 */
export interface ReadingLine {
  /**
   * Where the reading line is right now, in client coordinates.
   *
   * NOT A CONSTANT FRACTION OF THE SCREEN. It glides to the bottom of the
   * viewport as the document runs out of scroll — see {@link readingLineY} for
   * why, and for the short-text case that makes it necessary.
   */
  viewportY(): number;
  /** Where the line WOULD be with a screenful of scroll left — for placing. */
  restY(): number;
  /** The place in the text at the reading line, or null if there is none. */
  resolve(): ReadingAnchor | null;
  /** Document-space top of an anchor, or null when it is not rendered. */
  documentTop(anchor: ReadingAnchor): number | null;
  /** Put `anchor` at the reading line. Returns false if it could not be found. */
  scrollTo(anchor: ReadingAnchor, behavior: ScrollBehavior): boolean;
}

export function useReadingLine(
  contentRef: RefObject<HTMLElement | null>,
): ReadingLine {
  // A stable object: the sampling loop, the restore effect and the bookmark
  // control all hold on to it, and none of them should re-subscribe because a
  // parent re-rendered.
  return useMemo<ReadingLine>(() => {
    // `visualViewport` is what is ACTUALLY visible: on iOS the layout viewport
    // does not shrink when Safari's toolbars are showing, so measuring from
    // `innerHeight` puts the line behind the chrome. `offsetTop` matters only
    // while pinch-zoomed, and is zero the rest of the time.
    const visible = () => {
      const view = window.visualViewport;
      return {
        top: view?.offsetTop ?? 0,
        height: view?.height ?? window.innerHeight,
      };
    };

    /** Pixels of scrolling left before the document ends. */
    const scrollGap = () => {
      const doc = document.documentElement;
      // The LAYOUT viewport here, deliberately: this is scroll arithmetic, and
      // `scrollHeight` and `scrollY` are both in layout coordinates.
      return Math.max(0, doc.scrollHeight - window.scrollY - doc.clientHeight);
    };

    const viewportY = () => {
      const { top, height } = visible();
      return readingLineY({ top, height, scrollGap: scrollGap(), ratio: READING_LINE_RATIO });
    };

    // PLACING IS NOT SAMPLING. `scrollTo` has to put an anchor where the line
    // sits when there IS somewhere further to scroll — otherwise restoring a
    // bookmark near the end of a chapter would aim at the bottom of the screen
    // and the browser would clamp the scroll anyway, landing the learner a
    // screenful short of where they were.
    const restY = () => {
      const { top, height } = visible();
      return top + height * READING_LINE_RATIO;
    };

    const resolve = (): ReadingAnchor | null => {
      const root = contentRef.current;
      if (!root) return null;

      const bounds = root.getBoundingClientRect();
      if (bounds.width === 0) return null;

      const y = viewportY();
      const x = bounds.left + bounds.width / 2;

      // The common case: the line is inside a sentence.
      for (const element of document.elementsFromPoint(x, y)) {
        const sentence = element.closest<HTMLElement>(".reader-sentence");
        if (sentence && root.contains(sentence)) return anchorIn(sentence, y);
      }

      // Otherwise it is in a margin, between two paragraphs, or off the ends of
      // the prose entirely — above the first line or below the last.
      return anchorNear(root, y);
    };

    const documentTop = (anchor: ReadingAnchor): number | null => {
      const root = contentRef.current;
      if (!root) return null;

      const element = elementFor(root, anchor);
      if (!element) return null;
      return element.getBoundingClientRect().top + window.scrollY;
    };

    const scrollTo = (anchor: ReadingAnchor, behavior: ScrollBehavior): boolean => {
      const top = documentTop(anchor);
      if (top === null) return false;
      // THE ANCHOR GOES TO THE READING LINE, not to the top of the screen. Land
      // it at the top and the sentence the learner stopped on is the first thing
      // on the page with nothing above it, which reads as having lost the thread.
      window.scrollTo({ top: Math.max(0, top - restY()), behavior });
      return true;
    };

    return { viewportY, restY, resolve, documentTop, scrollTo };
  }, [contentRef]);
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The anchor for a sentence the reading line crosses, down to the token.
 *
 * A sentence can wrap over several lines, so "which word" is the first one whose
 * box reaches the line — that is the start of the visual line the learner is on.
 * Bounded by the sentence's own length and exits as soon as it has the answer.
 */
function anchorIn(sentence: HTMLElement, y: number): ReadingAnchor | null {
  const sentencePosition = numberFrom(sentence.dataset.sentencePosition);
  const paragraph = sentence.closest<HTMLElement>("[data-paragraph-position]");
  const paragraphPosition = numberFrom(paragraph?.dataset.paragraphPosition);
  if (paragraphPosition === null) return null;

  let tokenPosition: number | null = null;
  if (sentencePosition !== null) {
    for (const word of sentence.querySelectorAll<HTMLElement>(".reader-word")) {
      if (word.getBoundingClientRect().bottom >= y) {
        tokenPosition = numberFrom(word.dataset.position);
        break;
      }
    }
  }

  return { paragraphPosition, sentencePosition, tokenPosition };
}

/**
 * The anchor when the line is NOT on a sentence.
 *
 * Binary search over the paragraphs: their boxes are in document order and do
 * not overlap, so "the last paragraph that starts above the line" is decidable
 * in log(n) measurements — eleven of them for a two-thousand-paragraph chapter.
 *
 * The two ends matter more than they look. Above the first paragraph is the
 * start of the chapter. BELOW THE LAST is the end of it, all of it — that is
 * what lets a chapter reach exactly 100% instead of stalling wherever its final
 * paragraph happens to sit relative to the reading line.
 */
function anchorNear(root: HTMLElement, y: number): ReadingAnchor | null {
  const paragraphs = root.querySelectorAll<HTMLElement>("[data-paragraph-position]");
  if (paragraphs.length === 0) return null;

  let low = 0;
  let high = paragraphs.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (paragraphs[mid].getBoundingClientRect().top <= y) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (found === -1) {
    return { paragraphPosition: 0, sentencePosition: null, tokenPosition: null };
  }

  const paragraph = paragraphs[found];
  const paragraphPosition = numberFrom(paragraph.dataset.paragraphPosition);
  if (paragraphPosition === null) return null;

  const sentences = paragraph.querySelectorAll<HTMLElement>(".reader-sentence");
  if (sentences.length === 0) {
    return { paragraphPosition, sentencePosition: null, tokenPosition: null };
  }

  // Past the bottom of this paragraph: the learner has it all behind them, so
  // the anchor is its END rather than the start of its last sentence.
  const last = sentences[sentences.length - 1];
  if (last.getBoundingClientRect().bottom <= y) {
    return {
      paragraphPosition,
      sentencePosition: numberFrom(last.dataset.sentencePosition),
      // Past the end of every token in it. `anchorWordOffset` clamps to the
      // sentence's length, so this reads as "all of it".
      tokenPosition: Number.MAX_SAFE_INTEGER,
    };
  }

  for (const sentence of sentences) {
    if (sentence.getBoundingClientRect().bottom >= y) return anchorIn(sentence, y);
  }
  return { paragraphPosition, sentencePosition: null, tokenPosition: null };
}

/** The most precise element that represents an anchor, coarsest last. */
function elementFor(root: HTMLElement, anchor: ReadingAnchor): HTMLElement | null {
  // Positions go into attribute selectors, so anything that is not a plain
  // non-negative integer is dropped rather than allowed to build a selector
  // `querySelector` would throw on.
  if (isPosition(anchor.sentencePosition)) {
    const sentence = root.querySelector<HTMLElement>(
      `.reader-sentence[data-sentence-position="${anchor.sentencePosition}"]`,
    );
    if (sentence) {
      if (isPosition(anchor.tokenPosition)) {
        // The exact word, so resuming inside a long paragraph lands on the line
        // the learner stopped on rather than at the top of the sentence.
        const word = sentence.querySelector<HTMLElement>(
          `.reader-word[data-position="${anchor.tokenPosition}"]`,
        );
        if (word) return word;
      }
      return sentence;
    }
  }

  return root.querySelector<HTMLElement>(
    `[data-paragraph-position="${anchor.paragraphPosition}"]`,
  );
}

function isPosition(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function numberFrom(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
