/**
 * Pure helpers for turning a persisted test session into a score.
 *
 * The session's stored items — not anything the client posted — are the input,
 * so these functions describe exactly what the database will be asked to commit.
 * Keeping them here (rather than inline in the Server Action) means the
 * arithmetic behind a learner's rating change is unit-tested, and the action
 * stays a thin sequence of "read, compute, commit".
 */

/** One question of a session, as stored in `test_session_items`. */
export interface StoredSessionItem {
  questionId: number;
  itemDifficulty: number;
  /** `null` until the question has been answered. */
  isCorrect: boolean | null;
  answeredAt: string | null;
}

/** What a session's answers add up to, before any Elo is applied. */
export interface SessionScore {
  total: number;
  correct: number;
  unanswered: number;
  /**
   * Mean Elo difficulty of the session's items, snapshotted when the session
   * started. Weights how much the result moves the learner's rating.
   */
  avgDifficulty: number;
}

/**
 * Count a session's stored answers.
 *
 * `unanswered` is reported rather than thrown on, so the caller can decide
 * whether an incomplete session is an error (finalizing) or simply the current
 * state (resuming). An empty session has an `avgDifficulty` of 0 and is only
 * ever reached through a text with no questions, which the start function
 * already refuses.
 */
export function scoreSessionItems(items: readonly StoredSessionItem[]): SessionScore {
  const total = items.length;
  let correct = 0;
  let unanswered = 0;
  let difficultySum = 0;

  for (const item of items) {
    difficultySum += item.itemDifficulty;
    if (item.answeredAt === null) unanswered += 1;
    else if (item.isCorrect) correct += 1;
  }

  return {
    total,
    correct,
    unanswered,
    avgDifficulty: total > 0 ? difficultySum / total : 0,
  };
}

/**
 * The index of the first unanswered question, or `items.length` when the session
 * is complete. This is what lets a learner who closed the tab mid-test resume at
 * the question they were on instead of starting over (or, worse, re-answering
 * questions that are already committed).
 */
export function firstUnansweredIndex(items: readonly StoredSessionItem[]): number {
  const index = items.findIndex((item) => item.answeredAt === null);
  return index === -1 ? items.length : index;
}
