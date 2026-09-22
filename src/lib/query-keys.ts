/**
 * Every TanStack Query key, in one place.
 *
 * WHY. `["adminTexts"]` was written out at nine call sites, `["words"]` at
 * four, `["saved_words"]` at four, `["notebook"]` at three. A key that exists
 * in nine copies is a key whose ninth copy eventually says something slightly
 * different — and an invalidation that misses is invisible: nothing errors, the
 * screen simply keeps showing what it showed before, and the learner concludes
 * their edit did not save.
 *
 * It is also how a prefetch and its hook drift apart. A Server Component that
 * primes `["words", filters]` while the hook reads `["words", "list", filters]`
 * does not fail; it silently refetches on mount, and the prefetch becomes a
 * round trip that buys nothing.
 *
 * ── WHAT IS NOT HERE, ON PURPOSE ────────────────────────────────────────────
 *
 * **The user id.** Every key below is identity-free, and that is a decision
 * rather than an omission — see `src/lib/auth/client-state.ts`. When the
 * signed-in learner changes, the whole QueryClient is ABANDONED and replaced,
 * which is a stronger guarantee than key scoping: a request already in flight
 * for learner A can only ever resolve into the abandoned client, which nothing
 * is subscribed to, so it cannot reach B's screen even as a flash. Threading a
 * user id through thirty keys and every `invalidateQueries` that references
 * them would be the weaker version of that, and one missed call site would be a
 * leak of somebody's private data.
 *
 * ── HOW TO READ A KEY ───────────────────────────────────────────────────────
 *
 * `all` is the invalidation PREFIX: invalidating it matches every key beneath
 * it, which is why the narrower factories start with the same segment. Keep
 * that property when adding one.
 */

import type { WordFilters } from "@/lib/dictionary/contracts";
import { dictionaryKeys } from "@/lib/dictionary/queries";

/** The learner's own state: profile, role, decks, progress, preferences. */
export const learnerKeys = {
  profile: () => ["profile"] as const,
  isAdmin: () => ["isAdmin"] as const,
  completedTexts: () => ["completedTexts"] as const,
  wordGoal: () => ["word-goal"] as const,
  learningPreferences: () => ["learning-preferences"] as const,
  calibrationQuestions: () => ["calibration-questions"] as const,
} as const;

/** The learner's deck. `all` is the prefix that also matches the due slice. */
export const savedWordKeys = {
  all: ["saved_words"] as const,
  due: () => ["saved_words", "due"] as const,
} as const;

/** Passages. */
export const textKeys = {
  all: ["texts"] as const,
  detail: (textId: number) => ["texts", textId] as const,
} as const;

/**
 * The dictionary.
 *
 * Re-exported from `@/lib/dictionary/queries` rather than redefined, so the
 * adapter and the factory cannot disagree about what a list key looks like.
 */
export const wordKeys = {
  ...dictionaryKeys,
  cursor: (filters: WordFilters) => ["words", "cursor", filters] as const,
  /** The hover gloss in a passage, keyed on the lemma it resolved. */
  tooltip: (lemma: string) => ["word-tooltip", lemma] as const,
  /** The reader's own gloss, keyed on the normalised surface token. */
  readerWord: (token: string) => ["reader-word", token] as const,
  /**
   * Distractor pool for the quiz, keyed on the CEFR bands it draws from.
   * `null` is a band in its own right here — an untagged word — so it stays in
   * the key rather than being filtered out of it.
   */
  quizDistractors: (cefrs: readonly (string | null)[]) =>
    ["quiz-distractors", cefrs] as const,
} as const;

/** The personal notebook. `all` covers entries, books and both scoped views. */
export const notebookKeys = {
  all: ["notebook"] as const,
  entries: (query: {
    filter: string;
    libraryItemId?: string | null;
    chapterId?: string | null;
    search?: string | null;
  }) =>
    [
      "notebook",
      "entries",
      query.filter,
      query.libraryItemId ?? null,
      query.chapterId ?? null,
      query.search?.trim() || null,
    ] as const,
  books: () => ["notebook", "books"] as const,
  sentence: (sentenceId: number | null) =>
    ["notebook", "sentence", sentenceId ?? 0] as const,
  chapter: (chapterId: string | null) =>
    ["notebook", "chapter", chapterId ?? ""] as const,
} as const;

/** The admin panel. Nine copies of `["adminTexts"]` lived here. */
export const adminKeys = {
  texts: () => ["adminTexts"] as const,
  text: (textId: number) => ["adminText", textId] as const,
  words: (filters?: unknown) =>
    (filters === undefined ? ["adminWords"] : ["adminWords", filters]) as
      | readonly ["adminWords"]
      | readonly ["adminWords", unknown],
  wordsMissingCount: () => ["adminWords", "missingCount"] as const,
  questions: (textId: number) => ["adminQuestions", textId] as const,
  suggestions: () => ["adminSuggestions"] as const,
} as const;
