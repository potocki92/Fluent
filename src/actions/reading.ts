"use server";

import {
  EMPTY_SNAPSHOT,
  evidenceJson,
  foldEvidence,
  type KnowledgeSnapshot,
} from "@/lib/learning/aggregate";
import {
  chapterReadingEvidence,
  readingLookupEvidence,
} from "@/lib/learning/evidence";
import { loadKnowledgeSnapshot } from "@/lib/learning/snapshot";
import {
  CHAPTER_COMPLETION_RATIO,
  MAX_ACTIVE_SECONDS_PER_REPORT,
} from "@/lib/reading/constants";
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

/** Where to put the learner when a chapter opens. */
export interface ReadingSessionStart {
  sessionId: string;
  libraryItemId: string;
  resumeParagraph: number;
  resumeSentence: number | null;
  furthestParagraph: number;
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
    resumeParagraph: row.resume_paragraph ?? 0,
    resumeSentence: row.resume_sentence,
    furthestParagraph: row.furthest_paragraph ?? 0,
    progressRatio: Number(row.progress_ratio ?? 0),
    completedAt: row.completed_at,
    resumed: row.resumed,
  };
}

export interface ReadingProgressResult {
  progressRatio: number;
  furthestParagraph: number;
  activeSeconds: number;
  wordsRead: number;
  canComplete: boolean;
}

/**
 * "I can see paragraph N, and I have been reading for M seconds."
 *
 * Called at most once every `PROGRESS_FLUSH_MS` and once more when the page is
 * hidden — never per scroll event. The seconds are a CLAIM: the function caps
 * what one report may add, so a slept machine or a forged request cannot buy
 * reading time.
 */
export async function reportReadingProgress(input: {
  sessionId: string;
  paragraphPosition: number;
  sentencePosition?: number | null;
  activeSeconds: number;
}): Promise<ActionResult<ReadingProgressResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "reportReadingProgress: no session");

  const { data, error } = await supabase.rpc("record_reading_progress", {
    p_session_id: input.sessionId,
    p_paragraph_position: Math.max(0, Math.trunc(input.paragraphPosition)),
    p_sentence_position: input.sentencePosition ?? null,
    p_active_seconds: Math.max(0, Math.trunc(input.activeSeconds)),
    p_max_active_seconds: MAX_ACTIVE_SECONDS_PER_REPORT,
  });
  if (error) return failFrom(error, `reportReadingProgress: ${input.sessionId}`);

  const row = data?.[0];
  if (!row) return fail("not_found", `reportReadingProgress: empty ${input.sessionId}`);

  const ratio = Number(row.progress_ratio ?? 0);
  return {
    ok: true,
    progressRatio: ratio,
    furthestParagraph: row.furthest_paragraph ?? 0,
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

  let snapshot: KnowledgeSnapshot = EMPTY_SNAPSHOT;
  try {
    snapshot = await loadKnowledgeSnapshot(supabase, user.id, [evidence]);
  } catch (error) {
    return fail("database_error", "recordWordLookup: snapshot", error);
  }

  const fold = foldEvidence(snapshot, [evidence]);

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
    p_evidence: evidenceJson(fold.payload),
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
