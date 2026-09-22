"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reconcileChapterFully } from "@/lib/content/reconciler";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { prepareEvidence } from "@/lib/learning/commit-evidence";
import {
  chapterPreparationEvidence,
  type LearningEvidence,
} from "@/lib/learning/evidence";
import { shuffleWithOrder } from "@/lib/shuffle";
import { PRETEACH_DISTRACTORS, STORY_ENGINE_VERSION } from "@/lib/story/constants";
import { getChapterFacts, getSentenceIdsByPosition } from "@/lib/story/queries";
import { getChapterStoryState, type PreparationWord } from "@/actions/chapter-analysis";
import { fail, failFrom, settleRead, type ActionResult } from "@/lib/errors";
import type { Json } from "@/types/database";
import { toJson } from "@/lib/json";

/**
 * Chapter preparation — the BEFORE step, and the one most at risk of ruining the
 * thing it exists to serve.
 *
 * The temptation is to teach the chapter's vocabulary. A chapter with 142 words
 * the learner does not know would then open with 142 cards, and Fluent would
 * have turned a book into homework before the first sentence. What this does
 * instead is clear between three and eight obstacles and get out of the way.
 *
 * THREE PROPERTIES MATTER MORE THAN THE SELECTION.
 *
 *  1. THE SNAPSHOT IS STABLE. Once started, the list does not change — not for a
 *     knowledge update, not for a re-entry from another tab. A task that rewrites
 *     itself halfway through is not a task.
 *  2. SKIPPING IS ALWAYS AVAILABLE. A learner who wants to read right now is
 *     doing the thing the whole product exists for. The skip is recorded because
 *     adoption is worth measuring, not because it is a failure.
 *  3. IT PROVES ALMOST NOTHING. Recognising a word seconds after being shown its
 *     translation is the easiest retrieval Fluent can construct, and the evidence
 *     weight says so. What makes preparation valuable to the model is the
 *     retention check days later.
 */

/** One preparation card as the client sees it — never `correct_idx`. */
export interface PreparationCard {
  wordId: number;
  lemma: string;
  display: string;
  options: string[];
  contextSentence: string | null;
  contextSource: "chapter_opening" | "dictionary" | "none";
  answered: boolean;
}

export interface StartedPreparation {
  sessionId: string;
  chapterId: string;
  slug: string;
  chapterPosition: number;
  cards: PreparationCard[];
  /** Where to resume; non-zero when an unfinished preparation is reopened. */
  resumeAt: number;
}

/**
 * Open (or resume) a chapter preparation.
 *
 * The selection is computed here, by the ranking in `src/lib/story/preparation.ts`,
 * and handed to a service-role function that snapshots it. The client never
 * chooses the words — the same trust boundary a test has, for the same reason:
 * a learner who picked their own preparation would be picking the words they
 * already know.
 */
export async function startChapterPreparation(input: {
  chapterId: string;
  planItemId?: string | null;
}): Promise<ActionResult<StartedPreparation>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startChapterPreparation: no session");

  // PREPARATION READS THE STORED AGGREGATE, so the aggregate has to be current
  // before it is read. `chapter_vocabulary` is derived from the occurrences'
  // `word_id`s, and a chapter imported before a word existed carries none for it
  // — which would have preparation insist a chapter contains no *ziehen* while
  // the reader glosses *zog* as exactly that. Reconciling first is cheap (a
  // chapter already stamped with the current dictionary revision returns
  // immediately) and it is the same idempotent pass the reader triggers.
  //
  // Best effort: a chapter that cannot be reconciled is still worth preparing
  // from what is stored.
  try {
    const service = createServiceRoleSupabaseClient();
    const reconciled = await reconcileChapterFully({
      read: supabase,
      service,
      chapterId: input.chapterId,
    });
    if (!reconciled.ok) {
      console.error("[fluent:story] preparation reconcile failed", reconciled.message);
    }
  } catch (error) {
    console.error("[fluent:story] preparation reconcile unavailable", error);
  }

  const state = await getChapterStoryState(input.chapterId);
  if (!state.ok) return state;
  if (!state.state.preparation || state.state.preparation.words.length === 0) {
    // Nothing worth pre-teaching is a real outcome, not an error: the learner
    // already knows this chapter's vocabulary and should simply go and read.
    return fail("not_found", `startChapterPreparation: nothing to teach ${input.chapterId}`);
  }

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "startChapterPreparation: service role unavailable", error);
  }

  // `getChapterFacts` returns null for "no such chapter" and THROWS when the
  // read fails. Collapsing the two with `.catch(() => null)` told a learner
  // whose connection blinked that the chapter did not exist — and offered them
  // no retry, because the app had decided it was gone.
  const read = await settleRead(
    () => getChapterFacts(supabase, input.chapterId),
    `startChapterPreparation: chapter ${input.chapterId}`,
  );
  if (!read.ok) return read;
  const chapter = read.value;
  if (!chapter) return fail("not_found", `startChapterPreparation: ${input.chapterId}`);

  let items: Json;
  try {
    items = toJson(
      await buildPreparationItems(
        supabase,
        input.chapterId,
        state.state.preparation.words,
      ),
    );
  } catch (error) {
    return fail("database_error", "startChapterPreparation: build items", error);
  }

  const { data: sessionId, error: startError } = await service.rpc(
    "start_chapter_preparation",
    {
      p_user_id: user.id,
      p_chapter_id: input.chapterId,
      p_items: items,
      p_plan_item_id: input.planItemId ?? null,
      p_signals: toJson({ story_engine_version: STORY_ENGINE_VERSION }),
    },
  );
  if (startError || !sessionId) {
    return failFrom(startError, `startChapterPreparation: ${input.chapterId}`);
  }

  const { data: cards, error: loadError } = await supabase.rpc("get_chapter_preparation", {
    p_session_id: sessionId,
  });
  if (loadError || !cards) {
    return failFrom(loadError, `startChapterPreparation: load ${sessionId}`);
  }

  return {
    ok: true,
    sessionId,
    chapterId: input.chapterId,
    slug: chapter.slug,
    chapterPosition: chapter.position,
    cards: cards.map((card) => ({
      wordId: card.word_id,
      lemma: card.lemma,
      display: card.display,
      options: card.options,
      contextSentence: card.context_sentence,
      contextSource: card.context_source as PreparationCard["contextSource"],
      answered: card.answered_at !== null,
    })),
    resumeAt: Math.max(
      0,
      cards.findIndex((card) => card.answered_at === null),
    ),
  };
}

export interface PreparationAnswerResult {
  isCorrect: boolean;
  correctIdx: number;
  alreadyAnswered: boolean;
}

/**
 * Answer one preparation card.
 *
 * Graded server-side, and the key comes back only after the answer is committed.
 * Preparation is a warm-up rather than an assessment, but the boundary is the
 * same one everywhere else in Fluent — there is no reason to build a second,
 * weaker one for a screen that happens to be friendlier.
 */
export async function answerPreparationItem(input: {
  sessionId: string;
  wordId: number;
  selectedIdx: number;
  responseMs: number | null;
}): Promise<ActionResult<PreparationAnswerResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "answerPreparationItem: no session");

  const { data, error } = await supabase.rpc("answer_preparation_item", {
    p_session_id: input.sessionId,
    p_word_id: input.wordId,
    p_selected_idx: input.selectedIdx,
    p_response_ms: input.responseMs,
  });
  if (error) return failFrom(error, `answerPreparationItem: ${input.sessionId}`);

  const row = data?.[0];
  if (!row) return fail("not_found", `answerPreparationItem: empty ${input.sessionId}`);

  return {
    ok: true,
    isCorrect: row.is_answer_correct,
    correctIdx: row.answer_key_idx,
    alreadyAnswered: row.already_answered,
  };
}

export interface FinalizedPreparation {
  correct: number;
  total: number;
  alreadyFinalized: boolean;
}

/** A stale knowledge read is recomputed rather than forced through. */
const MAX_ATTEMPTS = 3;

/**
 * Seal a preparation and record what it proved.
 *
 * WHICH IS DELIBERATELY LITTLE. `chapterPreparationEvidence` discounts the
 * multiple-choice weight to 0.24, because the learner recognised a Polish
 * translation they were shown seconds earlier. Recording it at full weight would
 * let someone "learn" forty words a week by clicking through warm-ups, and the
 * knowledge model — which cannot see how easy the retrieval was — would believe
 * every one of them.
 *
 * Receptive only. A recognition exercise never feeds active vocabulary; that is
 * the learning engine's rule and preparation does not get an exception.
 */
export async function finalizeChapterPreparation(
  sessionId: string,
): Promise<ActionResult<FinalizedPreparation>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "finalizeChapterPreparation: no session");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail(
      "config_error",
      "finalizeChapterPreparation: service role unavailable",
      error,
    );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // RLS scopes this to the caller, so someone else's session resolves to
    // nothing rather than to a permission error.
    const { data: session, error: sessionError } = await supabase
      .from("chapter_preparation_sessions")
      .select("id, chapter_id, library_item_id, status, correct, total")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      return failFrom(sessionError, `finalizeChapterPreparation: load ${sessionId}`);
    }
    if (!session) {
      return fail("not_found", `finalizeChapterPreparation: no session ${sessionId}`);
    }

    const { data: rows, error: itemsError } = await supabase
      .from("chapter_preparation_items")
      .select("word_id, is_correct, answered_at, response_ms, sentence_id")
      .eq("session_id", sessionId);
    if (itemsError) {
      return failFrom(itemsError, `finalizeChapterPreparation: items ${sessionId}`);
    }

    const answered = (rows ?? []).filter(
      (row) => row.answered_at !== null && row.is_correct !== null,
    );

    const evidence: LearningEvidence[] = answered.map((row) =>
      chapterPreparationEvidence({
        sessionId,
        wordId: row.word_id,
        libraryItemId: session.library_item_id,
        chapterId: session.chapter_id,
        sentenceId: row.sentence_id,
        isCorrect: row.is_correct === true,
        responseMs: row.response_ms,
        occurredAt: row.answered_at as string,
      }),
    );

    // A preparation with nothing to pre-teach legitimately carries no evidence
    // and still seals; a preparation whose knowledge state cannot be READ does
    // not seal at all, so the same finalization can be retried in full.
    const prepared = await prepareEvidence(
      supabase,
      user.id,
      evidence,
      `finalizeChapterPreparation ${sessionId}`,
    );
    if (!prepared.ok) return prepared;

    const { data, error } = await service.rpc("finalize_chapter_preparation", {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_evidence: prepared.json,
    });

    const result = data?.[0];
    if (!error && result) {
      return {
        ok: true,
        correct: result.correct_count,
        total: result.total_count,
        alreadyFinalized: result.already_finalized,
      };
    }

    // The knowledge state moved between the read and the commit (another tab, a
    // queued review). Recompute from fresh data rather than overwriting it.
    if (error?.code === "FL423" && attempt < MAX_ATTEMPTS) continue;

    return failFrom(error, `finalizeChapterPreparation: commit ${sessionId}`);
  }

  return fail("stale_state", `finalizeChapterPreparation: gave up on ${sessionId}`);
}

/**
 * "Pomiń i czytaj."
 *
 * The Story Engine may not imprison the reader. This closes any open preparation
 * and records the skip, and then the learner goes and reads — which is the point.
 */
export async function skipChapterPreparation(
  chapterId: string,
): Promise<ActionResult<{ status: string }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "skipChapterPreparation: no session");

  const { data, error } = await supabase.rpc("skip_chapter_preparation", {
    p_chapter_id: chapterId,
  });
  if (error) return failFrom(error, `skipChapterPreparation: ${chapterId}`);

  return { ok: true, status: data ?? "prepared" };
}

/**
 * Turn the ranked shortlist into snapshot rows, with distractors.
 *
 * Distractors are drawn from the OTHER words on the shortlist first, then from
 * the dictionary at the same CEFR band — so the four options are plausible
 * rather than a real translation next to three obvious absurdities, which would
 * make the card test nothing at all.
 */
async function buildPreparationItems(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  chapterId: string,
  words: readonly PreparationWord[],
): Promise<Record<string, unknown>[]> {
  const sentenceIds = await getSentenceIdsByPosition(
    supabase,
    chapterId,
    words
      .filter((word) => word.contextSource === "chapter_opening")
      .map((word) => word.firstSentencePosition),
    // DELIBERATE FALLBACK. Without the sentence ids a pre-teach card loses its
    // example sentence and still teaches the word — degraded, never wrong.
    // Refusing here would withhold the preparation to avoid a plainer card.
  ).catch(() => new Map<number, number>());

  const { data: pool } = await supabase
    .from("words")
    .select("id, translation_pl")
    .not("translation_pl", "is", null)
    .neq("translation_pl", "")
    .limit(400);

  const fallback = (pool ?? [])
    .map((row) => row.translation_pl)
    .filter((value): value is string => Boolean(value));

  return words.map((word) => {
    const others = words
      .filter((other) => other.wordId !== word.wordId && other.translation !== word.translation)
      .map((other) => other.translation);

    const distractors: string[] = [];
    const seen = new Set([word.translation]);

    for (const candidate of [
      ...shuffleWithOrder(others).items,
      ...shuffleWithOrder(fallback).items,
    ]) {
      if (distractors.length >= PRETEACH_DISTRACTORS) break;
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      distractors.push(candidate);
    }

    const options = shuffleWithOrder([word.translation, ...distractors]).items;

    return {
      word_id: word.wordId,
      lemma: word.lemma,
      display: word.display,
      translation: word.translation,
      options,
      correct_idx: options.indexOf(word.translation),
      context_sentence: word.contextSentence,
      context_source: word.contextSource,
      sentence_id:
        word.contextSource === "chapter_opening"
          ? (sentenceIds.get(word.firstSentencePosition) ?? null)
          : null,
    };
  });
}
