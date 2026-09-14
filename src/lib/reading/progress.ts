/**
 * Reading progress arithmetic — pure, so the rules can be tested without a
 * reader, a browser or a database.
 *
 * THE ONE IDEA THIS MODULE EXISTS FOR: **resume position and furthest position
 * are different facts.** A learner who scrolls back to re-read the opening of a
 * chapter is at paragraph 3; they have still READ up to paragraph 80. Storing
 * one number for both means either the bookmark is wrong or the progress bar
 * falls from 80% to 4% because someone looked something up. So:
 *
 *   - `resume*` follows the learner and may move in either direction,
 *   - `furthest*` only ever increases, and is the only input to progress and
 *     completion.
 *
 * The database enforces the monotonicity as well (`greatest(...)` in
 * `record_reading_progress`); this module is where the rule is stated, tested
 * and explained.
 */

import {
  CHAPTER_COMPLETION_RATIO,
  MAX_ACTIVE_SECONDS_PER_REPORT,
  MIN_CHAPTER_MINUTES,
  READER_WORDS_PER_MINUTE,
} from "@/lib/reading/constants";

/** Where a learner is in a chapter, as stored in `reading_progress`. */
export interface ReadingPosition {
  /** Paragraph position the learner is looking at now. Moves both ways. */
  resumeParagraph: number;
  /** Highest paragraph position ever reached. Never decreases. */
  furthestParagraph: number;
  /** 0–1, derived from `furthestParagraph`. Never decreases. */
  ratio: number;
}

/** One report from the reader: "I can see paragraph N". */
export interface ProgressReport {
  paragraphPosition: number;
  /** Paragraphs in the chapter. Needed to turn a position into a ratio. */
  paragraphCount: number;
}

export const INITIAL_POSITION: ReadingPosition = {
  resumeParagraph: 0,
  furthestParagraph: 0,
  ratio: 0,
};

/**
 * Fold a report into a stored position.
 *
 * Note what happens on a scroll back: `resumeParagraph` follows, `ratio` does
 * not. That asymmetry IS the feature — see the module comment.
 */
export function advanceProgress(
  current: ReadingPosition,
  report: ProgressReport,
): ReadingPosition {
  const paragraphCount = Math.max(1, Math.trunc(report.paragraphCount));
  const reported = clampIndex(report.paragraphPosition, paragraphCount);
  const furthest = Math.max(current.furthestParagraph, reported);

  return {
    resumeParagraph: reported,
    furthestParagraph: furthest,
    // The learner has read THROUGH the furthest paragraph they reached, so the
    // last one puts the ratio at exactly 1 rather than (n-1)/n.
    ratio: Math.max(current.ratio, round((furthest + 1) / paragraphCount)),
  };
}

/**
 * May this chapter be marked finished?
 *
 * Deliberately not "the last element rendered": a sticky footer, a short final
 * line or a layout shift can put the end of a chapter on screen without anyone
 * having read it. Completion needs the learner to have genuinely got there —
 * and then it is still an explicit action in the UI, not a side effect of
 * scrolling.
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

function clampIndex(value: number, count: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
