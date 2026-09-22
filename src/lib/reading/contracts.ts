/**
 * What the reader tells a screen — in a module neither side owns.
 *
 * Both shapes were exported from `src/actions/reading.ts`, which begins with
 * `"use server"`, so a completion card and a word-gloss hook each pulled a
 * Server Action module into their graph to borrow a type. Neither shape needs
 * Supabase to be true: one is a sentence's worth of numbers about a finished
 * chapter, the other is what a dictionary entry looks like in a gloss.
 *
 * Types only. Nothing here loads anything.
 */

/** What the learner is shown after finishing a chapter. Real numbers, no AI. */
export interface ChapterSummary {
  alreadyCompleted: boolean;
  wordsRead: number;
  activeSeconds: number;
  lookupCount: number;
  uniqueLookupCount: number;
  savedWordCount: number;
}

/** The dictionary entry behind a tapped word, exactly as the gloss shows it. */
export interface ReaderDictionaryWord {
  id: number;
  lemma: string;
  display: string;
  article: string | null;
  word_type: string;
  translation_pl: string | null;
  example_de: string | null;
  example_pl: string | null;
  ipa: string | null;
  plural: string | null;
}
