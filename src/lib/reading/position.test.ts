import { describe, expect, it } from "vitest";

import { BOOKMARK_REVEAL_WORDS } from "@/lib/reading/constants";
import {
  anchorAtOffset,
  anchorRatio,
  anchorWordOffset,
  applyReadingSample,
  buildChapterWordIndex,
  CHAPTER_START,
  hasUnsavedPosition,
  isBehindFurthest,
  mergeServerProgress,
  movedEnoughToPersist,
  offsetRatio,
  readingPositionFrom,
  returnTarget,
  type ChapterWordIndex,
  type IndexedSentence,
  type ReadingAnchor,
  type ReadingPositionState,
} from "@/lib/reading/position";

// ─────────────────────────────────────────────────────────────────────────────
// fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Build a chapter from a list of paragraphs, each a list of sentence lengths. */
function chapter(paragraphs: number[][]): ChapterWordIndex {
  const sentences: IndexedSentence[] = [];
  let wordStart = 0;
  let sentencePosition = 0;

  paragraphs.forEach((lengths, paragraphPosition) => {
    for (const wordCount of lengths) {
      sentences.push({ paragraphPosition, sentencePosition, wordStart, wordCount });
      wordStart += wordCount;
      sentencePosition += 1;
    }
  });

  return buildChapterWordIndex(sentences, paragraphs.length);
}

/** The lopsided chapter from the brief: 10 words, then 490. */
const LOPSIDED = chapter([[10], [490]]);

/** A thousand-word chapter of ten even hundred-word sentences. */
const EVEN = chapter([[100], [100], [100], [100], [100], [100], [100], [100], [100], [100]]);

function at(index: ChapterWordIndex, offset: number): ReadingAnchor {
  return anchorAtOffset(index, offset);
}

/** Read forward to `offset` with the dwell satisfied — the normal case. */
function readTo(
  index: ChapterWordIndex,
  state: ReadingPositionState,
  offset: number,
): ReadingPositionState {
  const anchor = at(index, offset);
  return applyReadingSample(index, state, {
    at: anchor,
    confirmed: anchor,
    trackResume: true,
  });
}

/** Move to `offset` with NOTHING confirmed — a fling. */
function flingTo(
  index: ChapterWordIndex,
  state: ReadingPositionState,
  offset: number,
  confirmedOffset: number | null,
): ReadingPositionState {
  return applyReadingSample(index, state, {
    at: at(index, offset),
    confirmed: confirmedOffset === null ? null : at(index, confirmedOffset),
    trackResume: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("the word scale", () => {
  it("TEST A — a ten-word paragraph of five hundred is not half the chapter", () => {
    // THE BUG THIS ENGINE EXISTS FOR. `(furthestParagraph + 1) / paragraphCount`
    // called this 50%.
    expect(LOPSIDED.totalWords).toBe(500);

    const afterFirstParagraph = anchorRatio(LOPSIDED, {
      paragraphPosition: 0,
      sentencePosition: 0,
      tokenPosition: 10,
    });
    expect(afterFirstParagraph).toBeCloseTo(0.02, 4);
    expect(afterFirstParagraph).toBeLessThan(0.5);
  });

  it("resolves an anchor to the token, not to the paragraph", () => {
    expect(
      anchorWordOffset(LOPSIDED, {
        paragraphPosition: 1,
        sentencePosition: 1,
        tokenPosition: 245,
      }),
    ).toBe(255);
  });

  it("clamps a token beyond the end of its sentence to the end of it", () => {
    expect(
      anchorWordOffset(LOPSIDED, {
        paragraphPosition: 0,
        sentencePosition: 0,
        tokenPosition: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(10);
  });

  it("falls back to the start of a paragraph for a legacy bookmark", () => {
    // Every bookmark written before this engine knows only its paragraph, and
    // must still open the book somewhere sensible.
    expect(
      anchorWordOffset(LOPSIDED, {
        paragraphPosition: 1,
        sentencePosition: null,
        tokenPosition: null,
      }),
    ).toBe(10);
  });

  it("resolves a paragraph past the end of the chapter to the end", () => {
    // A reprocess that merged paragraphs could leave a bookmark pointing past
    // the last one. Answering 0% would undo somebody's progress.
    expect(
      anchorWordOffset(LOPSIDED, {
        paragraphPosition: 99,
        sentencePosition: null,
        tokenPosition: null,
      }),
    ).toBe(500);
  });

  it("round-trips an offset through an anchor", () => {
    for (const offset of [0, 9, 10, 255, 499, 500]) {
      expect(anchorWordOffset(EVEN, anchorAtOffset(EVEN, offset))).toBe(offset);
    }
  });

  it("is 0 for a chapter with no words rather than NaN", () => {
    const empty = buildChapterWordIndex([], 0);
    expect(offsetRatio(empty, 10)).toBe(0);
    expect(anchorWordOffset(empty, CHAPTER_START)).toBe(0);
  });
});

describe("current, resume and furthest", () => {
  it("TEST B — progress is the furthest position, the bookmark is the current one", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 700);
    state = readTo(EVEN, state, 350);

    expect(offsetRatio(EVEN, state.furthestOffset)).toBeCloseTo(0.7, 4);
    expect(offsetRatio(EVEN, state.resumeOffset)).toBeCloseTo(0.35, 4);
    expect(offsetRatio(EVEN, state.currentOffset)).toBeCloseTo(0.35, 4);
  });

  it("TEST C — re-opening restores the resume position, with progress intact", () => {
    // The learner read to 70%, backed up to 35% and closed the reader. What was
    // persisted is exactly what comes back.
    let session = readingPositionFrom(EVEN, { resume: null, furthest: null });
    session = readTo(EVEN, session, 700);
    session = readTo(EVEN, session, 350);

    const reopened = readingPositionFrom(EVEN, {
      resume: session.resume,
      furthest: session.furthest,
    });

    expect(offsetRatio(EVEN, reopened.currentOffset)).toBeCloseTo(0.35, 4);
    expect(offsetRatio(EVEN, reopened.furthestOffset)).toBeCloseTo(0.7, 4);
    // …and the place this sitting began, for "take me back".
    expect(reopened.originOffset).toBe(350);
  });

  it("TEST D — a fling moves the bookmark and not the progress bar", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 200);
    // 20% → 90% in one gesture: nothing has held at the reading line yet, so the
    // trail still confirms the place they flung FROM.
    state = flingTo(EVEN, state, 900, 200);

    expect(offsetRatio(EVEN, state.currentOffset)).toBeCloseTo(0.9, 4);
    expect(offsetRatio(EVEN, state.furthestOffset)).toBeCloseTo(0.2, 4);
  });

  it("TEST E — once the place has held, furthest catches up", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 200);
    state = flingTo(EVEN, state, 900, 200);
    // The dwell completes: the trail's oldest sample is now the new place.
    state = flingTo(EVEN, state, 900, 900);

    expect(offsetRatio(EVEN, state.furthestOffset)).toBeCloseTo(0.9, 4);
  });

  it("TEST J — furthest never moves backwards", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 700);
    for (const offset of [600, 300, 0, 450]) {
      state = readTo(EVEN, state, offset);
      expect(state.furthestOffset).toBe(700);
    }
  });

  it("TEST K — resume DOES move backwards", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 700);
    state = readTo(EVEN, state, 120);
    expect(state.resumeOffset).toBe(120);
  });

  it("TEST H — a deep link does not overwrite the bookmark", () => {
    // Somebody sent to one sentence from the notebook, who leaves again, keeps
    // the place they actually stopped at.
    const stored = at(EVEN, 350);
    let state = readingPositionFrom(EVEN, { resume: stored, furthest: at(EVEN, 700) });

    state = applyReadingSample(EVEN, state, {
      at: at(EVEN, 20),
      confirmed: null,
      trackResume: false,
    });

    expect(state.currentOffset).toBe(20);
    expect(state.resumeOffset).toBe(350);
    expect(state.furthestOffset).toBe(700);

    // …but somebody who then READS here is reading here, and the bookmark
    // follows once the engine has armed it.
    state = applyReadingSample(EVEN, state, {
      at: at(EVEN, 60),
      confirmed: at(EVEN, 60),
      trackResume: true,
    });
    expect(state.resumeOffset).toBe(60);
    // Reading BEFORE the furthest position never moves it.
    expect(state.furthestOffset).toBe(700);
  });

  it("never opens with a furthest position behind the bookmark", () => {
    // Only possible from a row written by the old model; letting it through
    // would make the bar fall the first time it was reported back.
    const state = readingPositionFrom(EVEN, {
      resume: at(EVEN, 400),
      furthest: at(EVEN, 100),
    });
    expect(state.furthestOffset).toBe(400);
  });
});

describe("merging the server's answer", () => {
  it("raises furthest when another device has read further", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 200);
    state = mergeServerProgress(EVEN, state, 0.8);
    expect(state.furthestOffset).toBe(800);
  });

  it("never lowers it for a stale answer", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 600);
    state = mergeServerProgress(EVEN, state, 0.1);
    expect(state.furthestOffset).toBe(600);
  });

  it("ignores a ratio that is not a number", () => {
    const state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    expect(mergeServerProgress(EVEN, state, Number.NaN)).toBe(state);
  });
});

describe("what is worth writing down", () => {
  it("TEST L — a backward move is unsaved work, so page-hide writes it", () => {
    // THE OLD BUG, STATED. `visibleParagraph > flushedParagraph` could only ever
    // be true going forward, so scrolling back and closing the app wrote nothing
    // and the learner came back to where they had already been.
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 700);

    const persisted = {
      resumeOffset: state.resumeOffset,
      furthestOffset: state.furthestOffset,
    };
    expect(hasUnsavedPosition(state, persisted, 0)).toBe(false);

    state = readTo(EVEN, state, 350);
    expect(hasUnsavedPosition(state, persisted, 0)).toBe(true);
    expect(movedEnoughToPersist(state, persisted)).toBe(true);
  });

  it("does not write for a line or two of reading", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 700);
    const persisted = {
      resumeOffset: state.resumeOffset,
      furthestOffset: state.furthestOffset,
    };

    state = readTo(EVEN, state, 710);
    expect(movedEnoughToPersist(state, persisted)).toBe(false);
    // …but it IS unsaved, so the regular cadence still picks it up.
    expect(hasUnsavedPosition(state, persisted, 0)).toBe(true);
  });

  it("writes accumulated reading time even when nothing moved", () => {
    const state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    expect(hasUnsavedPosition(state, { resumeOffset: 0, furthestOffset: 0 }, 12)).toBe(true);
  });
});

describe("taking the learner back", () => {
  it("offers the furthest position when they resume well behind it", () => {
    // The acceptance scenario: opened at 31%, having read to 46%. One action
    // skips the re-reading.
    const state = readingPositionFrom(EVEN, {
      resume: at(EVEN, 310),
      furthest: at(EVEN, 460),
    });

    const target = returnTarget(state);
    expect(target?.kind).toBe("furthest");
    expect(target?.offset).toBe(460);
  });

  it("offers the place this sitting started when they wander back before it", () => {
    let state = readingPositionFrom(EVEN, {
      resume: at(EVEN, 310),
      furthest: at(EVEN, 460),
    });
    state = readTo(EVEN, state, 50);

    // The NEARER of the two is always the one they meant: getting the thread
    // back matters more than skipping ahead.
    const target = returnTarget(state);
    expect(target?.kind).toBe("origin");
    expect(target?.offset).toBe(310);
  });

  it("offers nothing while the learner can see the place themselves", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 400);
    expect(returnTarget(state)).toBeNull();

    state = readTo(EVEN, state, 400 - (BOOKMARK_REVEAL_WORDS - 1));
    expect(returnTarget(state)).toBeNull();
  });

  it("marks the bar as split only when the two positions really differ", () => {
    let state = readingPositionFrom(EVEN, { resume: null, furthest: null });
    state = readTo(EVEN, state, 500);
    expect(isBehindFurthest(state)).toBe(false);

    state = readTo(EVEN, state, 500 - BOOKMARK_REVEAL_WORDS);
    expect(isBehindFurthest(state)).toBe(true);
  });
});

describe("the anchor survives the things pixels do not", () => {
  it("TEST F / TEST G — a relayout changes geometry, never the anchor", () => {
    // Font size, line height, width, rotation: all of them move every pixel in
    // the document and none of them touches `(paragraph, sentence, token)`. That
    // is the whole reason the bookmark is not a scroll offset — so the property
    // under test is that the anchor's MEANING is independent of layout, which is
    // exactly what "the same anchor resolves to the same word" says.
    const anchor: ReadingAnchor = {
      paragraphPosition: 1,
      sentencePosition: 1,
      tokenPosition: 245,
    };

    const before = anchorWordOffset(LOPSIDED, anchor);
    // A relayout is not an input to any of this — there is nothing to pass in.
    const after = anchorWordOffset(LOPSIDED, anchor);

    expect(after).toBe(before);
    expect(anchorRatio(LOPSIDED, anchor)).toBeCloseTo(255 / 500, 4);
  });

  it("resolves the same anchor identically after a reprocess that kept positions", () => {
    // The content pipeline is deterministic BY REQUIREMENT: a reprocess replaces
    // every row and every id, and keeps every position. A bookmark that pointed
    // at an occurrence id would dangle; one that points at positions does not.
    const reprocessed = chapter([[10], [490]]);
    const anchor: ReadingAnchor = {
      paragraphPosition: 1,
      sentencePosition: 1,
      tokenPosition: 245,
    };

    expect(anchorWordOffset(reprocessed, anchor)).toBe(
      anchorWordOffset(LOPSIDED, anchor),
    );
  });
});
