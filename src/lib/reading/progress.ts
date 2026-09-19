/**
 * Reading progress arithmetic — pure, so the rules can be tested without a
 * reader, a browser or a database.
 *
 * THE ONE IDEA THIS MODULE EXISTS FOR: **resume position and furthest position
 * are different facts.** A learner who scrolls back to re-read the opening of a
 * chapter is at 31%; they have still READ up to 42%. Storing one number for both
 * means either the bookmark is wrong or the progress bar falls from 42% to 31%
 * because someone looked something up. So:
 *
 *   - `resume*` follows the learner and may move in either direction,
 *   - `furthest*` only ever increases, and is the only input to progress and
 *     completion.
 *
 * **AND PROGRESS IS COUNTED IN WORDS.** It used to be
 * `(furthestParagraph + 1) / paragraphCount`, which weighs an eight-word line of
 * dialogue exactly like a four-hundred-word description. In a novel that is not
 * a rounding error — it is the difference between "you have read half this
 * chapter" and "you have read the first two lines of it". The unit is therefore
 * the lexical token, and where each position falls on that scale is
 * `src/lib/reading/position.ts`.
 *
 * The database enforces the same two rules (`greatest(...)` in
 * `record_reading_progress`, and the same division); this module is where they
 * are stated, tested and explained.
 */

import {
  CHAPTER_COMPLETION_RATIO,
  MAX_ACTIVE_SECONDS_PER_REPORT,
  MIN_CHAPTER_MINUTES,
  READER_WORDS_PER_MINUTE,
} from "@/lib/reading/constants";

/** Where a learner is in a chapter, as stored in `reading_progress`. */
export interface ReadingPosition {
  /** Words before the place the learner is looking at. Moves both ways. */
  resumeWordOffset: number;
  /** Words before the furthest place genuinely read. Never decreases. */
  furthestWordOffset: number;
  /** 0–1, derived from `furthestWordOffset`. Never decreases. */
  ratio: number;
}

/**
 * One report from the reader.
 *
 * TWO POSITIONS, NOT ONE, and that is the shape of the fix. The reader tells the
 * server where the learner IS and, separately, how far they have CONFIRMED
 * reading — the second lags the first by a dwell, so a fling to the end of the
 * chapter moves the bookmark without moving the progress bar.
 */
export interface ProgressReport {
  resumeWordOffset: number;
  furthestWordOffset: number;
  /** Lexical tokens in the chapter. The denominator. */
  totalWords: number;
}

export const INITIAL_POSITION: ReadingPosition = {
  resumeWordOffset: 0,
  furthestWordOffset: 0,
  ratio: 0,
};

/**
 * Fold a report into a stored position.
 *
 * Note what happens on a scroll back: `resumeWordOffset` follows, `ratio` does
 * not. That asymmetry IS the feature — see the module comment.
 */
export function advanceProgress(
  current: ReadingPosition,
  report: ProgressReport,
): ReadingPosition {
  const totalWords = Math.max(0, Math.trunc(report.totalWords));
  const resume = clampOffset(report.resumeWordOffset, totalWords);
  const furthest = Math.max(
    current.furthestWordOffset,
    clampOffset(report.furthestWordOffset, totalWords),
  );

  return {
    resumeWordOffset: resume,
    furthestWordOffset: furthest,
    ratio:
      totalWords === 0
        ? current.ratio
        : Math.max(current.ratio, round(furthest / totalWords)),
  };
}

/**
 * May this chapter be marked finished?
 *
 * Deliberately not "the last element rendered": a sticky footer, a short final
 * line or a layout shift can put the end of a chapter on screen without anyone
 * having read it. Completion needs the learner's FURTHEST position — which only
 * advances after a dwell, so a fling to the bottom does not buy it — to have
 * genuinely got there, and then it is still an explicit action in the UI.
 */
export function canCompleteChapter(position: ReadingPosition): boolean {
  return position.ratio >= CHAPTER_COMPLETION_RATIO;
}

/**
 * Accumulate active reading time.
 *
 * `elapsed` is what the client believes happened since its last report. It is
 * clamped rather than trusted: a slept machine, a paused debugger or a forged
 * request can all produce an implausible jump, and one report may never add more
 * than {@link MAX_ACTIVE_SECONDS_PER_REPORT}.
 */
export function accumulateActiveSeconds(current: number, elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return current;
  const capped = Math.min(Math.trunc(elapsed), MAX_ACTIVE_SECONDS_PER_REPORT);
  return current + capped;
}

/** Estimated minutes to read a chapter of `wordCount` words. */
export function estimatedChapterMinutes(wordCount: number | null): number {
  if (!wordCount || wordCount <= 0) return MIN_CHAPTER_MINUTES;
  return Math.max(MIN_CHAPTER_MINUTES, Math.round(wordCount / READER_WORDS_PER_MINUTE));
}

/**
 * A library item's overall progress, weighted by chapter length.
 *
 * WHY NOT `completedChapters / chapterCount`. A book whose first chapter is 500
 * words and whose second is 20 000 would report 50% after ten minutes. Progress
 * a learner can feel has to track the words, not the headings — so each
 * chapter contributes in proportion to its length, and a chapter with no word
 * count falls back to counting as one unit rather than distorting the rest.
 *
 * The same argument one level down is why `ratio` itself is word-based now: a
 * word-weighted average of paragraph-counted ratios was still only half honest.
 */
export function itemProgressRatio(
  chapters: readonly { wordCount: number | null; ratio: number }[],
): number {
  if (chapters.length === 0) return 0;

  const weights = chapters.map((chapter) => Math.max(1, chapter.wordCount ?? 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const done = chapters.reduce(
    (sum, chapter, i) => sum + weights[i] * clampRatio(chapter.ratio),
    0,
  );

  return round(done / total);
}

/** Words a learner has read, from their furthest position. Used for lookup rate. */
export function wordsRead(ratio: number, wordCount: number | null): number {
  if (!wordCount || wordCount <= 0) return 0;
  return Math.round(clampRatio(ratio) * wordCount);
}

function clampOffset(value: number, totalWords: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(totalWords, Math.max(0, Math.trunc(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
