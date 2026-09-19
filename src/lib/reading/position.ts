/**
 * The Reading Position Engine's arithmetic — pure, so every rule below can be
 * tested without a browser, a scroll container or a database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE POSITIONS, AND THEY ARE THREE DIFFERENT FACTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   current   where the learner is looking RIGHT NOW. Moves both ways.
 *   resume    where to put them when they come back. Moves both ways.
 *   furthest  the furthest text they have genuinely read. Forward only.
 *
 * Collapsing any two of them breaks something a reader notices immediately:
 *
 *   current = furthest   a fling to the end marks the chapter read
 *   resume  = furthest   backing up to re-read a page, then closing the app,
 *                        drops you back where you had ALREADY been — the exact
 *                        bug this engine replaces
 *   furthest = resume    the progress bar falls from 45% to 31% because somebody
 *                        checked an earlier paragraph, and a progress bar that
 *                        goes backwards is one nobody believes again
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BOOKMARK IS A PLACE IN THE TEXT, NEVER A PIXEL
 * ─────────────────────────────────────────────────────────────────────────────
 * `window.scrollY`, `scrollTop / scrollHeight` and "43% down the document" are
 * all facts about one viewport with one font at one width. Rotate the phone,
 * change the type size, open the book on a laptop, and every one of them points
 * somewhere else. A {@link ReadingAnchor} is `(paragraph, sentence, token)` —
 * stored positions the content pipeline guarantees are stable across a
 * reprocess — so it survives all of that by construction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROGRESS IS MEASURED IN WORDS, NOT PARAGRAPHS
 * ─────────────────────────────────────────────────────────────────────────────
 * The old model was `(furthestParagraph + 1) / paragraphCount`, which gives a
 * twelve-word line of dialogue and a four-hundred-word description exactly the
 * same weight. In a novel that is not a rounding error: reading the first two
 * lines of a chapter of dialogue could report 8%, and reading three pages of
 * prose could report 2%.
 *
 * So every position is converted to a WORD OFFSET — how many lexical tokens of
 * the chapter precede it — and progress is `furthestOffset / totalWords`. The
 * conversion is O(1): each sentence carries the running total of the words
 * before it (`sentences.word_start`), written by the database when the chapter
 * is stored.
 *
 * The same arithmetic exists in SQL (`record_reading_progress`), because the
 * server owns progress and must not take the client's word for a percentage.
 * This module is where the rule is stated, explained and tested.
 */

import {
  BOOKMARK_REVEAL_WORDS,
  PROGRESS_FLUSH_WORDS,
} from "@/lib/reading/constants";

/**
 * A place in a chapter's text.
 *
 * `sentencePosition` is the sentence's position within the CHAPTER
 * (`sentences.chapter_position`), not within its paragraph: it is unique per
 * chapter, so an anchor needs no join to be resolved, and it is what the reader
 * renders as `data-sentence-position`.
 *
 * WHY NOT AN OCCURRENCE ID. Reprocessing a chapter deletes and re-inserts every
 * sentence and occurrence row, so a bookmark identified by a row id would dangle
 * on every reprocess. Positions survive, because the pipeline is deterministic
 * by requirement — that is the same reason reading progress has always stored
 * `resume_paragraph_position` rather than a paragraph id.
 *
 * The two finer fields are NULLABLE, and that is what makes the whole thing
 * backward compatible: a bookmark saved before this engine existed knows only
 * its paragraph, and resolves to the start of it.
 */
export interface ReadingAnchor {
  paragraphPosition: number;
  /** `sentences.chapter_position`, or null for a paragraph-only bookmark. */
  sentencePosition: number | null;
  /** Lexical token index inside that sentence, or null. */
  tokenPosition: number | null;
}

/** One sentence, as the word index needs it. */
export interface IndexedSentence {
  paragraphPosition: number;
  /** `sentences.chapter_position`. */
  sentencePosition: number;
  /** Lexical tokens in the chapter BEFORE this sentence (`word_start`). */
  wordStart: number;
  /** Lexical tokens in this sentence. */
  wordCount: number;
}

/**
 * Everything needed to turn an anchor into a word offset in constant time.
 *
 * Built once per chapter, on the server, from rows the reader was loading
 * anyway. It is the reason resolving the reading line on every animation frame
 * costs nothing: no counting, no scanning, one binary search.
 */
export interface ChapterWordIndex {
  /** Ascending by `sentencePosition`, which is also reading order. */
  sentences: readonly IndexedSentence[];
  /** The denominator: every lexical token in the chapter. */
  totalWords: number;
  paragraphCount: number;
}

/** The start of a chapter — and what an unknown position resolves to. */
export const CHAPTER_START: ReadingAnchor = {
  paragraphPosition: 0,
  sentencePosition: null,
  tokenPosition: null,
};

export const EMPTY_WORD_INDEX: ChapterWordIndex = {
  sentences: [],
  totalWords: 0,
  paragraphCount: 0,
};

/**
 * Build the index from the chapter's sentences.
 *
 * `wordStart` is READ, not recomputed: it is written by the database so that the
 * server's own O(1) resolution and the reader's agree exactly. Deriving it here
 * as well would be a second definition of the same number, and the day they
 * disagreed the progress bar would jitter as reports came back.
 */
export function buildChapterWordIndex(
  sentences: readonly IndexedSentence[],
  paragraphCount: number,
): ChapterWordIndex {
  const ordered = [...sentences].sort(
    (a, b) => a.sentencePosition - b.sentencePosition,
  );

  let totalWords = 0;
  for (const sentence of ordered) {
    totalWords = Math.max(totalWords, sentence.wordStart + sentence.wordCount);
  }

  return { sentences: ordered, totalWords, paragraphCount };
}

/**
 * How many words of the chapter precede this anchor.
 *
 * Three levels of precision, in order, because a bookmark is allowed to be
 * vague and must never be wrong:
 *
 *   sentence + token   exact — the token the reading line was on
 *   sentence           the start of that sentence
 *   paragraph only     the start of that paragraph (the legacy bookmark)
 */
export function anchorWordOffset(
  index: ChapterWordIndex,
  anchor: ReadingAnchor | null,
): number {
  if (!anchor || index.sentences.length === 0) return 0;

  if (anchor.sentencePosition !== null) {
    const sentence = findSentence(index, anchor.sentencePosition);
    if (sentence) {
      const token = clampInt(anchor.tokenPosition ?? 0, 0, sentence.wordCount);
      return sentence.wordStart + token;
    }
  }

  return paragraphStart(index, anchor.paragraphPosition);
}

/** 0–1, clamped. The chapter's progress, from a word offset. */
export function offsetRatio(index: ChapterWordIndex, offset: number): number {
  if (index.totalWords <= 0) return 0;
  return round(clamp(offset / index.totalWords, 0, 1));
}

/** 0–1, clamped. The chapter's progress, from an anchor. */
export function anchorRatio(
  index: ChapterWordIndex,
  anchor: ReadingAnchor | null,
): number {
  return offsetRatio(index, anchorWordOffset(index, anchor));
}

/**
 * The anchor a word offset lands on — the inverse of {@link anchorWordOffset}.
 *
 * Used to turn a progress ratio that only the SERVER knows (another device, a
 * second tab) back into a place this reader can scroll to, and to state the
 * round trip in tests.
 */
export function anchorAtOffset(
  index: ChapterWordIndex,
  offset: number,
): ReadingAnchor {
  if (index.sentences.length === 0) return CHAPTER_START;

  const target = clamp(offset, 0, index.totalWords);
  let low = 0;
  let high = index.sentences.length - 1;
  let found = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.sentences[mid].wordStart <= target) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const sentence = index.sentences[found];
  return {
    paragraphPosition: sentence.paragraphPosition,
    sentencePosition: sentence.sentencePosition,
    tokenPosition: clampInt(target - sentence.wordStart, 0, sentence.wordCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// where the reading line actually sits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where to sample the text, given how much scrolling is left.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LINE GLIDES TO THE BOTTOM WHEN THE DOCUMENT RUNS OUT
 * ─────────────────────────────────────────────────────────────────────────────
 * A fixed line at 38% of the viewport has a blind spot nobody notices until they
 * open a short text: everything BELOW the line can only be brought up to it by
 * scrolling, so whatever is still below it when the document stops scrolling can
 * never be reached at all.
 *
 * For a chapter that fits on one screen — a page about Chopin, a short article,
 * the last screen of any chapter — that is most of the text, and the reader would
 * sit at 40% with nothing the learner could do about it. It is also why a long
 * chapter's final paragraphs used to depend on there happening to be enough
 * furniture (the completion card, the chapter nav) underneath the prose to push
 * them up past the line.
 *
 * So the line is not fixed. It stays at 38% while there is a screenful of scroll
 * left, and glides down to the bottom of the viewport exactly as fast as the
 * remaining scroll runs out. At the very bottom of a document — or in a document
 * that never scrolled at all — the sampling point is the bottom of the screen,
 * which says the obvious true thing: everything visible, with nowhere further to
 * go, has been reached.
 *
 * It is a glide rather than a jump on purpose; a line that teleported on the last
 * screen would make progress lurch just as the learner finished the chapter.
 *
 * Returns a position in CLIENT coordinates.
 */
export function readingLineY(viewport: {
  /** Top of the visible viewport — non-zero only while pinch-zoomed. */
  top: number;
  height: number;
  /** Pixels of scrolling left before the document ends. */
  scrollGap: number;
  ratio: number;
}): number {
  const height = Math.max(0, viewport.height);
  const line = height * clamp(viewport.ratio, 0, 1);
  // How much of the screen sits below the line, and is therefore unreachable
  // unless the line comes down to meet it.
  const below = height - line;
  const glide = Math.max(0, below - Math.max(0, viewport.scrollGap));

  // One pixel inside the viewport: a hit test exactly on the edge belongs to no
  // element in some browsers.
  return viewport.top + Math.min(height - 1, line + glide);
}

// ─────────────────────────────────────────────────────────────────────────────
// the position state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a learner is in a chapter, in all the senses that differ.
 *
 * `origin` is the fourth thing and it is not a position the engine maintains: it
 * is a memento of where this SITTING began, which is what lets the reader offer
 * "go back to where you were" after the learner has wandered off to check
 * something. It never moves.
 */
export interface ReadingPositionState {
  current: ReadingAnchor;
  currentOffset: number;
  resume: ReadingAnchor;
  resumeOffset: number;
  furthest: ReadingAnchor;
  furthestOffset: number;
  origin: ReadingAnchor;
  originOffset: number;
}

/** Open a chapter at the positions the server remembered. */
export function readingPositionFrom(
  index: ChapterWordIndex,
  stored: { resume: ReadingAnchor | null; furthest: ReadingAnchor | null },
): ReadingPositionState {
  const resume = stored.resume ?? CHAPTER_START;
  const resumeOffset = anchorWordOffset(index, resume);
  const furthest = stored.furthest ?? resume;
  // Defensive rather than trusting: a stored furthest BEHIND the stored resume
  // can only come from a row written by an older model, and letting it through
  // would make the progress bar fall the first time it was reported back.
  const furthestOffset = Math.max(anchorWordOffset(index, furthest), resumeOffset);

  return {
    current: resume,
    currentOffset: resumeOffset,
    resume,
    resumeOffset,
    furthest: furthestOffset === resumeOffset ? resume : furthest,
    furthestOffset,
    origin: resume,
    originOffset: resumeOffset,
  };
}

/** One observation of the reading line. */
export interface ReadingSample {
  /** The anchor at the reading line right now. */
  at: ReadingAnchor;
  /**
   * The anchor that has held long enough to count as READ, or null while
   * nothing has. See `READ_DWELL_MS` — this is what stops a fling from
   * marking half a chapter read.
   */
  confirmed: ReadingAnchor | null;
  /**
   * Whether the bookmark should follow.
   *
   * False while a deep link owns the position: somebody sent to one sentence by
   * the notebook, who leaves again, must not have their real reading place
   * overwritten by a visit (§24).
   */
  trackResume: boolean;
}

/**
 * Fold one observation into the position state.
 *
 * The three rules, and nothing else:
 *
 *   current   := wherever the reading line is
 *   resume    := the same, when the bookmark is following
 *   furthest  := max(furthest, confirmed)   ← the only monotonic one
 */
export function applyReadingSample(
  index: ChapterWordIndex,
  state: ReadingPositionState,
  sample: ReadingSample,
): ReadingPositionState {
  const currentOffset = anchorWordOffset(index, sample.at);

  let furthest = state.furthest;
  let furthestOffset = state.furthestOffset;
  if (sample.confirmed) {
    const confirmedOffset = anchorWordOffset(index, sample.confirmed);
    if (confirmedOffset > furthestOffset) {
      furthest = sample.confirmed;
      furthestOffset = confirmedOffset;
    }
  }

  return {
    ...state,
    current: sample.at,
    currentOffset,
    resume: sample.trackResume ? sample.at : state.resume,
    resumeOffset: sample.trackResume ? currentOffset : state.resumeOffset,
    furthest,
    furthestOffset,
  };
}

/**
 * Raise the furthest position to something the SERVER knows about.
 *
 * Another tab, another device, or simply this chapter's stored progress arriving
 * after the reader opened. Forward only, like every other write to `furthest`:
 * a server ratio BEHIND this session's reading is stale, not authoritative.
 */
export function mergeServerProgress(
  index: ChapterWordIndex,
  state: ReadingPositionState,
  ratio: number,
): ReadingPositionState {
  if (!Number.isFinite(ratio) || index.totalWords <= 0) return state;

  const offset = Math.round(clamp(ratio, 0, 1) * index.totalWords);
  if (offset <= state.furthestOffset) return state;

  return {
    ...state,
    furthest: anchorAtOffset(index, offset),
    furthestOffset: offset,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// persistence
// ─────────────────────────────────────────────────────────────────────────────

/** What the last successful write to the server said. */
export interface PersistedPosition {
  resumeOffset: number;
  furthestOffset: number;
}

/**
 * Is there anything the server does not know yet?
 *
 * NOTE THE `!==` ON RESUME. The old reader asked `visible > flushed`, which can
 * only ever be true going forward — so a learner who read to 42%, scrolled back
 * to 31% and closed the app wrote nothing on the way out, and came back to 42%.
 * The bookmark moves in both directions, so the test for "worth saving" has to
 * as well.
 */
export function hasUnsavedPosition(
  state: ReadingPositionState,
  persisted: PersistedPosition | null,
  pendingSeconds: number,
): boolean {
  if (pendingSeconds > 0) return true;
  if (!persisted) return state.resumeOffset > 0 || state.furthestOffset > 0;
  return (
    state.furthestOffset > persisted.furthestOffset ||
    state.resumeOffset !== persisted.resumeOffset
  );
}

/**
 * Has the learner moved far enough to be worth a write before the next tick?
 *
 * Again in both directions: somebody who reads for ten seconds and closes the
 * tab keeps their place, and so does somebody who backs up two pages and closes
 * the tab.
 */
export function movedEnoughToPersist(
  state: ReadingPositionState,
  persisted: PersistedPosition | null,
  words: number = PROGRESS_FLUSH_WORDS,
): boolean {
  if (!persisted) return state.resumeOffset > 0 || state.furthestOffset > 0;
  return (
    state.furthestOffset - persisted.furthestOffset >= words ||
    Math.abs(state.resumeOffset - persisted.resumeOffset) >= words
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "take me back"
// ─────────────────────────────────────────────────────────────────────────────

/** A place the reader can offer to return to, with the reason it is offering. */
export interface ReturnTarget {
  kind: "origin" | "furthest";
  anchor: ReadingAnchor;
  offset: number;
}

/**
 * Where, if anywhere, to offer to go back to.
 *
 * TWO DIFFERENT ERRANDS, ONE CONTROL. A learner who has scrolled back to check
 * something wants the place they were reading (`origin`, where this sitting
 * started). A learner who has just resumed at 31% with 42% read wants the front
 * of what they have read (`furthest`). Both are "ahead of here", so the nearer
 * one is always the one they meant — and `origin` is never past `furthest`.
 *
 * Returns null while the learner is near enough to see the place themselves: a
 * control that is always on screen is one nobody reads.
 */
export function returnTarget(
  state: ReadingPositionState,
  minWords: number = BOOKMARK_REVEAL_WORDS,
): ReturnTarget | null {
  const candidates: ReturnTarget[] = [];

  if (state.originOffset - state.currentOffset >= minWords) {
    candidates.push({
      kind: "origin",
      anchor: state.origin,
      offset: state.originOffset,
    });
  }
  if (state.furthestOffset - state.currentOffset >= minWords) {
    candidates.push({
      kind: "furthest",
      anchor: state.furthest,
      offset: state.furthestOffset,
    });
  }
  if (candidates.length === 0) return null;

  return candidates.reduce((nearest, candidate) =>
    candidate.offset < nearest.offset ? candidate : nearest,
  );
}

/**
 * Is the current position meaningfully behind the furthest one?
 *
 * The progress bar shows a second mark only when the answer is yes. While the
 * two agree — which is nearly always, because reading forward moves both — the
 * bar looks exactly like a plain progress bar, which is the point.
 */
export function isBehindFurthest(
  state: ReadingPositionState,
  minWords: number = BOOKMARK_REVEAL_WORDS,
): boolean {
  return state.furthestOffset - state.currentOffset >= minWords;
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/** Binary search by `sentencePosition`; positions are dense but not assumed so. */
function findSentence(
  index: ChapterWordIndex,
  sentencePosition: number,
): IndexedSentence | null {
  let low = 0;
  let high = index.sentences.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = index.sentences[mid].sentencePosition;
    if (value === sentencePosition) return index.sentences[mid];
    if (value < sentencePosition) low = mid + 1;
    else high = mid - 1;
  }

  return null;
}

/**
 * The word offset at the start of a paragraph.
 *
 * The legacy path, and the one a bookmark written before this engine takes. A
 * paragraph past the end of the chapter resolves to the end rather than to zero:
 * it means "read it all", and answering 0% would undo somebody's progress.
 */
function paragraphStart(index: ChapterWordIndex, paragraphPosition: number): number {
  if (index.sentences.length === 0) return 0;

  let low = 0;
  let high = index.sentences.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.sentences[mid].paragraphPosition >= paragraphPosition) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (found === -1) return index.totalWords;
  return index.sentences[found].wordStart;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
