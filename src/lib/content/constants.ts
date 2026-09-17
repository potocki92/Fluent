/**
 * Every number the content pipeline and its dictionary layer tune themselves
 * with, in one file.
 *
 * Same rule as `src/lib/reading/constants.ts` and
 * `src/lib/learning/planner/constants.ts`: a bare `* 0.35` or a `slice(0, 400)`
 * anywhere else in `src/lib/content/` is a bug. These are the knobs; the code
 * around them should read as prose.
 */

/**
 * How long a loaded dictionary index is trusted before its revision is checked
 * again.
 *
 * THE COST OF BEING WRONG IS SECONDS, NOT HOURS. The index is cached per server
 * instance, so a curator adding *ziehen* must not have to wait for a redeploy —
 * but asking the database "has the dictionary changed?" on every single chapter
 * render would be a query per page view for an answer that changes weekly.
 *
 * Thirty seconds is the compromise, and it is only an upper bound: the write
 * paths call `invalidateDictionarySnapshot()` directly, so the instance that
 * accepted the new word sees it immediately.
 */
export const DICTIONARY_REVISION_TTL_MS = 30_000;

/**
 * How many sentences one reconciliation call works through.
 *
 * A serverless function cannot hold a whole novel, and a 20 000-sentence chapter
 * is not a unit of work. The caller loops on the cursor, exactly as the importer
 * does — and because the pass is idempotent, a loop that stops halfway simply
 * resumes later.
 */
export const DICTIONARY_SYNC_SENTENCE_BATCH = 600;

/**
 * How many occurrence rows one `sync_chapter_dictionary` payload carries.
 *
 * Bounded so the jsonb envelope stays a request body rather than a document, and
 * so a partial failure costs one chunk rather than a chapter.
 */
export const DICTIONARY_SYNC_ROW_BATCH = 1000;
