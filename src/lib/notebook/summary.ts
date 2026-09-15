/**
 * Counting what a learner wrote down in a chapter.
 *
 * ONE DEFINITION, DERIVED FROM THE ENTRIES THE READER ALREADY HAS. A SQL
 * function returning the same five numbers would be a second source of truth for
 * something that is already in memory — and the first time the two disagree
 * (because "personal word" was redefined in one of them and not the other) the
 * learner sees a summary that contradicts the list underneath it.
 *
 * WHAT IS COUNTED, and what deliberately is not. A sentence that is both
 * translated and flagged counts once in each column, because they are two
 * different facts about it — but it is still ONE note, which is why the notebook
 * lists it once. A phrase is never counted as words; a personal word is a word
 * that also happens to be outside the dictionary, so it is counted in both
 * `words` and `personalWords` rather than as a fourth category the learner has
 * to reconcile.
 */

/** The minimum an entry has to carry to be counted. */
export interface CountableEntry {
  entry_type: "word" | "phrase" | "sentence";
  word_id: number | null;
  has_translation: boolean;
  is_unclear: boolean;
}

export interface NotebookSummary {
  words: number;
  /** Of those, the ones the shared dictionary does not know. */
  personalWords: number;
  phrases: number;
  translations: number;
  unclear: number;
  /** Whether there is anything at all worth showing a summary for. */
  total: number;
}

export const EMPTY_SUMMARY: NotebookSummary = {
  words: 0,
  personalWords: 0,
  phrases: 0,
  translations: 0,
  unclear: 0,
  total: 0,
};

export function summarizeNotebook(
  entries: readonly CountableEntry[],
): NotebookSummary {
  const summary = { ...EMPTY_SUMMARY };

  for (const entry of entries) {
    if (entry.entry_type === "word") {
      summary.words += 1;
      if (entry.word_id === null) summary.personalWords += 1;
    } else if (entry.entry_type === "phrase") {
      summary.phrases += 1;
    } else {
      if (entry.has_translation) summary.translations += 1;
      if (entry.is_unclear) summary.unclear += 1;
    }
  }

  summary.total = entries.length;
  return summary;
}
