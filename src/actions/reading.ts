"use server";

import { getDictionarySnapshot } from "@/lib/content/dictionary-snapshot";
import { matchToken } from "@/lib/content/dictionary-match";
import { reconcileChapterFully } from "@/lib/content/reconciler";
import {
  EMPTY_SNAPSHOT,
  evidenceJson,
  foldEvidence,
} from "@/lib/learning/aggregate";
import {
  chapterReadingEvidence,
  readingLookupEvidence,
} from "@/lib/learning/evidence";
import { prepareEvidence } from "@/lib/learning/commit-evidence";
import {
  CHAPTER_COMPLETION_RATIO,
  MAX_ACTIVE_SECONDS_PER_REPORT,
} from "@/lib/reading/constants";
import { toStoredPosition, type ReadingAnchor } from "@/lib/reading/position";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * The reader's server actions.
 *
 * Everything the reader writes is progress, and progress in Fluent is
 * server-owned: `reading_progress`, `reading_sessions` and `reading_lookups`
 * have no learner-writable RLS policy at all. Each action below either calls a
 * SECURITY DEFINER function that derives the learner from `auth.uid()`, or —
 * where learning evidence is involved — establishes the user from the
 * cookie-bound client first and only then reaches for the service role.
 *
 * Expected failures are RETURNED as {@link ActionResult}, never thrown: Next
 * redacts thrown Server Action errors in production, so a thrown one could not
 * be branched on by the UI.
 */

/**
 * Where to put the learner when a chapter opens — and how far they have read.
 *
 * TWO ANCHORS, BECAUSE THEY ARE TWO FACTS. `resume` is where to scroll to;
 * `furthest` is what the progress bar says and where "go back to where you
 * were" leads. A learner who read to 42%, backed up to 31% and closed the app
 * gets 31% for the first and 42% for the second, which is the entire point of
 * the Reading Position Engine.
 */
export interface ReadingSessionStart {
  sessionId: string;
  libraryItemId: string;
  resume: ReadingAnchor;
  furthest: ReadingAnchor;
  /** The chapter's length in lexical tokens — progress's denominator. */
  readingWordCount: number;
  progressRatio: number;
  completedAt: string | null;
  /** True when an existing open session was adopted (a second tab, a refresh). */
  resumed: boolean;
}

/**
 * Open a chapter.
 *
 * Also the authorisation check: the function refuses a chapter the learner may
 * not read and a chapter that is not processed yet, so the reader never has to
 * decide either question for itself.
 */
export async function startReadingSession(
  chapterId: string,
): Promise<ActionResult<ReadingSessionStart>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startReadingSession: no session");

  const { data, error } = await supabase.rpc("start_reading_session", {
    p_chapter_id: chapterId,
  });
  if (error) return failFrom(error, `startReadingSession: ${chapterId}`);

  const row = data?.[0];
  if (!row) return fail("not_found", `startReadingSession: empty ${chapterId}`);

  // "You started reading this" is history, not mastery: the event carries no
  // skill, no concept and no word, so the knowledge model moves nothing.
  if (!row.resumed) {
    await recordReadingEvent(user.id, {
      event: "started",
      readingSessionId: row.session_id,
      libraryItemId: row.library_item_id,
      chapterId,
      activeSeconds: null,
    });
  }

  return {
    ok: true,
    sessionId: row.session_id,
    libraryItemId: row.library_item_id,
    resume: {
      paragraphPosition: row.resume_paragraph ?? 0,
      sentencePosition: row.resume_sentence,
      tokenPosition: row.resume_token,
    },
    furthest: {
      paragraphPosition: row.furthest_paragraph ?? 0,
      sentencePosition: row.furthest_sentence,
      tokenPosition: row.furthest_token,
    },
    readingWordCount: row.reading_word_count ?? 0,
    progressRatio: Number(row.progress_ratio ?? 0),
    completedAt: row.completed_at,
    resumed: row.resumed,
  };
}

export interface ReadingProgressResult {
  progressRatio: number;
  /** False when this exact report had already been applied. */
  applied: boolean;
  furthestWordOffset: number;
  readingWordCount: number;
  activeSeconds: number;
  wordsRead: number;
  canComplete: boolean;
}

/**
 * "I am HERE, I have confirmed reading up to THERE, and I have been reading for
 * M seconds."
 *
 * TWO ANCHORS, NOT ONE. `resume` follows the learner in both directions;
 * `furthest` is only as far as the reader has watched a place hold at the
 * reading line, so a fling to the end of the chapter moves the bookmark and
 * leaves the progress bar alone.
 *
 * NEITHER IS A PERCENTAGE. The reader reports places in the TEXT and the
 * database works out what they are worth — a client that sent a ratio would be
 * deciding its own progress, and progress is server-owned.
 *
 * Called at most once every `PROGRESS_FLUSH_MS`, once more when the learner has
 * moved `PROGRESS_FLUSH_WORDS` in either direction, and once more when the page
 * is hidden — never per scroll event. The seconds are a CLAIM: the function caps
 * what one report may add, so a slept machine or a forged request cannot buy
 * reading time.
 */
export async function reportReadingProgress(input: {
  sessionId: string;
  resume: ReadingAnchor;
  furthest: ReadingAnchor;
  activeSeconds: number;
  /**
   * The receipt. The database applies one id EXACTLY once, which is what makes
   * retrying a report safe — and therefore what lets the reader hold on to its
   * seconds through a failure instead of dropping them.
   */
  reportId: string;
  /**
   * Monotonic within one reading. A report whose seq the session has already
   * passed contributes its seconds and its furthest mark but does not move the
   * resume bookmark backwards.
   */
  reportSeq: number;
}): Promise<ActionResult<ReadingProgressResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "reportReadingProgress: no session");

  const { data, error } = await supabase.rpc("record_reading_progress", {
    p_session_id: input.sessionId,
    // Every position is clamped to what a PostgreSQL `int` can hold. A value
    // outside that range does not round-trip as a big number — it makes the
    // whole call fail with `integer out of range`, which is a silent way to
    // lose a learner's progress AND to make finishing the chapter impossible.
    p_paragraph_position: toStoredPosition(input.resume.paragraphPosition) ?? 0,
    p_sentence_position: toStoredPosition(input.resume.sentencePosition),
    p_token_position: toStoredPosition(input.resume.tokenPosition),
    p_furthest_paragraph_position:
      toStoredPosition(input.furthest.paragraphPosition) ?? 0,
    p_furthest_sentence_position: toStoredPosition(input.furthest.sentencePosition),
    p_furthest_token_position: toStoredPosition(input.furthest.tokenPosition),
    p_active_seconds: Math.max(0, Math.trunc(input.activeSeconds)),
    p_max_active_seconds: MAX_ACTIVE_SECONDS_PER_REPORT,
    p_report_id: input.reportId,
    p_report_seq: input.reportSeq,
  });
  if (error) return failFrom(error, `reportReadingProgress: ${input.sessionId}`);

  const row = data?.[0];
  if (!row) return fail("not_found", `reportReadingProgress: empty ${input.sessionId}`);

  const ratio = Number(row.progress_ratio ?? 0);
  return {
    ok: true,
    progressRatio: ratio,
    applied: row.applied ?? true,
    furthestWordOffset: row.furthest_word_offset ?? 0,
    readingWordCount: row.reading_word_count ?? 0,
    activeSeconds: row.active_seconds ?? 0,
    wordsRead: row.words_read ?? 0,
    canComplete: ratio >= CHAPTER_COMPLETION_RATIO,
  };
}


/** What the learner is shown after finishing a chapter. Real numbers, no AI. */
export interface ChapterSummary {
  alreadyCompleted: boolean;
  wordsRead: number;
  activeSeconds: number;
  lookupCount: number;
  uniqueLookupCount: number;
  savedWordCount: number;
}

/**
 * Finish a chapter.
 *
 * Deliberately an explicit action rather than a consequence of the last
 * paragraph rendering: a sticky footer or a layout shift can put the end of a
 * chapter on screen without anyone having read it. The database refuses below
 * {@link CHAPTER_COMPLETION_RATIO} regardless, so the button cannot be the whole
 * guarantee either.
 */
export async function completeChapter(
  sessionId: string,
): Promise<ActionResult<ChapterSummary>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "completeChapter: no session");

  const { data, error } = await supabase.rpc("complete_reading_chapter", {
    p_session_id: sessionId,
    p_min_ratio: CHAPTER_COMPLETION_RATIO,
  });
  if (error) return failFrom(error, `completeChapter: ${sessionId}`);

  const row = data?.[0];
  if (!row) return fail("not_found", `completeChapter: empty ${sessionId}`);

  if (!row.already_completed) {
    await recordReadingEvent(user.id, {
      event: "completed",
      readingSessionId: sessionId,
      libraryItemId: row.library_item_id,
      chapterId: row.chapter_id,
      activeSeconds: row.active_seconds ?? 0,
    });
  }

  return {
    ok: true,
    alreadyCompleted: row.already_completed,
    wordsRead: row.words_read ?? 0,
    activeSeconds: row.active_seconds ?? 0,
    lookupCount: row.lookup_count ?? 0,
    uniqueLookupCount: row.unique_lookup_count ?? 0,
    savedWordCount: row.saved_word_count ?? 0,
  };
}

/**
 * The learner stopped reading.
 *
 * Best effort by design: a sealed session is nicer than an open one, and failing
 * to seal it must never surface as an error on the way out of a page.
 */
export async function endReadingSession(input: {
  sessionId: string;
  activeSeconds: number;
}): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.rpc("end_reading_session", {
    p_session_id: input.sessionId,
    p_active_seconds: Math.max(0, Math.trunc(input.activeSeconds)),
    p_max_active_seconds: MAX_ACTIVE_SECONDS_PER_REPORT,
  });
  if (error) console.error("[fluent:reader] end_reading_session failed", error);
}

export interface LookupResult {
  alreadyRecorded: boolean;
  /** Lookups in this sitting. */
  sessionLookups: number;
  /** Distinct words looked up in this sitting. */
  sessionUniqueLookups: number;
  /** How many times this learner has ever looked this word up. */
  wordLookupTotal: number;
}

/**
 * Record that a word was looked up while reading.
 *
 * A LOOKUP IS NOT A FAILED TEST — see `readingLookupEvidence`, which is where
 * that judgement and its weight live. Here the job is only to do both halves in
 * one transaction: the reading record and the learning evidence. Splitting them
 * would let a retry write one without the other.
 *
 * The evidence is computed from the learner's CURRENT knowledge snapshot, the
 * same way a review is, so the optimistic-concurrency guard in
 * `apply_learning_evidence` still applies.
 */
export async function recordWordLookup(input: {
  interactionId: string;
  chapterId: string;
  libraryItemId: string;
  wordId: number;
  sentenceId: number | null;
  occurrenceId: number | null;
  readingSessionId: string | null;
}): Promise<ActionResult<LookupResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "recordWordLookup: no session");

  if (!input.interactionId) {
    return fail("invalid_input", "recordWordLookup: missing interaction id");
  }

  const evidence = readingLookupEvidence({
    interactionId: input.interactionId,
    wordId: input.wordId,
    libraryItemId: input.libraryItemId,
    chapterId: input.chapterId,
    sentenceId: input.sentenceId,
    occurrenceId: input.occurrenceId,
    readingSessionId: input.readingSessionId,
    occurredAt: new Date().toISOString(),
  });

  // This path already refused rather than committing an empty payload; it now
  // says so through the one helper every other commit uses.
  const prepared = await prepareEvidence(
    supabase,
    user.id,
    [evidence],
    `recordWordLookup ${input.interactionId}`,
  );
  if (!prepared.ok) return prepared;

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "recordWordLookup: service role unavailable", error);
  }

  const { data, error } = await service.rpc("apply_reading_lookup", {
    p_user_id: user.id,
    p_interaction_id: input.interactionId,
    p_chapter_id: input.chapterId,
    p_word_id: input.wordId,
    p_sentence_id: input.sentenceId,
    p_occurrence_id: input.occurrenceId,
    p_session_id: input.readingSessionId,
    p_evidence: prepared.json,
  });
  if (error) return failFrom(error, `recordWordLookup: ${input.interactionId}`);

  const row = data?.[0];
  return {
    ok: true,
    alreadyRecorded: row?.already_recorded ?? false,
    sessionLookups: row?.lookup_count ?? 0,
    sessionUniqueLookups: row?.unique_lookup_count ?? 0,
    wordLookupTotal: row?.word_lookup_total ?? 0,
  };
}

/**
 * Save a word to the review deck, keeping the sentence it was met in.
 *
 * The origin is DERIVED from the occurrence inside the database, not accepted
 * from the caller, so a card cannot claim a sentence the word never appeared in
 * — and the sentence text is copied onto the card, so deleting the book later
 * does not quietly empty it.
 */
export async function saveWordFromReader(input: {
  wordId: number;
  occurrenceId: number | null;
}): Promise<ActionResult<{ wasNew: boolean; context: string | null }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "saveWordFromReader: no session");

  const { data, error } = await supabase.rpc("save_word_from_reader", {
    p_word_id: input.wordId,
    p_occurrence_id: input.occurrenceId,
  });
  if (error) return failFrom(error, `saveWordFromReader: ${input.wordId}`);

  const row = data?.[0];
  return { ok: true, wasNew: row?.was_new ?? false, context: row?.context_de ?? null };
}


// ─────────────────────────────────────────────────────────────────────────────
// the dictionary, as of right now
// ─────────────────────────────────────────────────────────────────────────────

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

const GLOSS_COLUMNS =
  "id, lemma, display, article, word_type, translation_pl, example_de, example_pl, ipa, plural";

/**
 * "What does the dictionary say about THIS word, right now?"
 *
 * THE ONE PLACE THE READER ASKS. The gloss used to query `words` from the
 * browser: by `id` when the occurrence carried one, and otherwise by
 * `ilike("lemma", …)` — a second, much stupider matcher that could only ever find
 * a word whose headword was spelled exactly like the token on the page. *zog* is
 * not spelled *ziehen*, so for every inflected form the answer was "spoza
 * słownika" even when the entry existed.
 *
 * So resolution happens HERE, on the server, through {@link matchToken} — the
 * same function the processor and the reconciler use, over the same index, with
 * the same de-inflection rules. One algorithm, one answer, everywhere.
 *
 * WHY IT IS A SERVER ACTION and not a browser query: matching needs the whole
 * dictionary in memory. The server keeps one cached copy per instance; shipping
 * it to every reader would be absurd, and shipping a simplified matcher instead
 * is exactly the bug above.
 *
 * `wordId` is an OPTIMISATION, not the authority — when the occurrence already
 * knows its entry there is nothing to resolve. A stored id that no longer exists
 * falls through to the surface, so a deleted-and-recreated entry re-resolves
 * instead of showing nothing.
 */
export async function resolveReaderWord(input: {
  wordId: number | null;
  surface: string;
}): Promise<ActionResult<{ word: ReaderDictionaryWord | null }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "resolveReaderWord: no session");

  if (input.wordId !== null) {
    const { data, error } = await supabase
      .from("words")
      .select(GLOSS_COLUMNS)
      .eq("id", input.wordId)
      .maybeSingle();
    if (error) return failFrom(error, `resolveReaderWord: ${input.wordId}`);
    if (data) return { ok: true, word: data };
  }

  const surface = input.surface.trim();
  if (!surface) return { ok: true, word: null };

  let hit;
  try {
    const dictionary = await getDictionarySnapshot(supabase);
    hit = matchToken(surface, dictionary.index);
  } catch (cause) {
    return fail("database_error", "resolveReaderWord: dictionary", cause);
  }
  if (!hit) return { ok: true, word: null };

  const { data, error } = await supabase
    .from("words")
    .select(GLOSS_COLUMNS)
    .eq("id", hit.wordId)
    .maybeSingle();
  if (error) return failFrom(error, `resolveReaderWord: ${surface}`);

  return { ok: true, word: data ?? null };
}

/**
 * Write down what the reader already worked out: this chapter's tokens, against
 * this dictionary.
 *
 * NOT WHAT MAKES THE WORDS WORK. The page is already correct — `getReaderChapter`
 * resolved it for the render. This is about everything that reads the STORED
 * rows rather than the page: vocabulary coverage, chapter preparation, the
 * question bank. Without it the reader would say *zog = ziehen* while preparation
 * insisted the chapter contains no *ziehen*, which is the kind of disagreement
 * that makes a learner stop trusting both.
 *
 * SAFE FOR ANYONE WHO MAY READ THE CHAPTER, and that is the point of the design:
 * the caller supplies a chapter id and nothing else, and the rows written are
 * derived entirely from that chapter's own stored sentences and from `words`. A
 * learner cannot smuggle content into a book through it, cannot reach a chapter
 * RLS hides from them, and cannot delete or move anything — the pass only ever
 * adds a missing token row or fills in a null column.
 *
 * BEST EFFORT AND RESUMABLE. It is called fire-and-forget and returns a cursor;
 * an interrupted run leaves the chapter unstamped and simply happens again.
 */
export async function syncChapterDictionary(input: {
  chapterId: string;
  afterPosition?: number;
}): Promise<ActionResult<{ done: boolean; cursor: number; inserted: number; resolved: number }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "syncChapterDictionary: no session");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "syncChapterDictionary: service role", error);
  }

  const result = await reconcileChapterFully({
    // RLS IS THE AUTHORISATION: a chapter this learner may not read is not found.
    read: supabase,
    service,
    chapterId: input.chapterId,
    afterPosition: input.afterPosition,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    done: result.done,
    cursor: result.cursor,
    inserted: result.inserted,
    resolved: result.resolved,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a chapter-started / chapter-completed event.
 *
 * Best effort, and deliberately so: losing one history row is not a reason to
 * stop someone reading. Nothing downstream depends on it being present, because
 * these events feed no knowledge state — see `chapterReadingEvidence`.
 */
async function recordReadingEvent(
  userId: string,
  input: Omit<Parameters<typeof chapterReadingEvidence>[0], "occurredAt">,
): Promise<void> {
  try {
    const evidence = chapterReadingEvidence({
      ...input,
      occurredAt: new Date().toISOString(),
    });
    const fold = foldEvidence(EMPTY_SNAPSHOT, [evidence]);
    const service = createServiceRoleSupabaseClient();
    const { error } = await service.rpc("apply_reading_event", {
      p_user_id: userId,
      p_evidence: evidenceJson(fold.payload),
    });
    if (error) console.error("[fluent:reader] reading event failed", error);
  } catch (error) {
    console.error("[fluent:reader] reading event failed", error);
  }
}
