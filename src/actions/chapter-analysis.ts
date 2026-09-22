"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { DEFAULT_DAILY_MINUTES } from "@/lib/learning/planner/constants";
import {
  CONFIDENCE_LABEL_PL,
  DIFFICULTY_LABEL_PL,
  type DifficultyLabel,
  type EstimateConfidence,
} from "@/lib/story/analysis";
import { STORY_ENGINE_VERSION } from "@/lib/story/constants";
import {
  computeChapterAnalysis,
  getBookReadingHistory,
  getCachedAnalysis,
  getChapterConceptPressure,
  getChapterFacts,
  getChapterQuestionCandidates,
  getChapterVocabulary,
  getPreteachCandidates,
  getWeakConceptSeverity,
  getWordKnowledge,
  type ChapterFacts,
  type ChapterVocabularyEntry,
} from "@/lib/story/queries";
import {
  preparationMinutes,
  preteachTargetCount,
  rankPreteachWords,
  selectPreteachWords,
  type RankedPreteachWord,
} from "@/lib/story/preparation";
import type { WordEvidence } from "@/lib/story/knowledge";
import type {
  ChapterStoryState,
  PreparationOffer,
  PreparationWord,
} from "@/lib/story/contracts";
import { fail, failFrom, settleRead, type ActionResult } from "@/lib/errors";

/**
 * "What is this chapter, for me?" — the BEFORE half of the story lifecycle.
 *
 * One action answers everything the chapter card needs: how much of the
 * vocabulary the learner probably knows and how far that figure can be trusted,
 * how demanding the chapter is FOR THEM as opposed to what band it is, how long
 * it should take, whether a short preparation is worth offering, and whether a
 * Challenge exists on the other side.
 *
 * IT IS CACHED, AND THE CACHE IS HONEST. Recomputing on every render would mean
 * a join across `chapter_vocabulary`, `user_word_knowledge` and the concept state
 * for each of forty chapters on a book page. Recomputing on every learning event
 * would mean constantly recomputing to produce the same number — one flashcard
 * cannot meaningfully move a 400-word coverage estimate. So the analysis is
 * stored per (learner, chapter) and invalidated on the two things that genuinely
 * change it: the chapter's content, and the engine version.
 *
 * NOTHING HERE CLAIMS MORE THAN IT KNOWS. Below the evidence floor there is no
 * percentage at all, and the difficulty verdict carries the confidence of the
 * coverage behind it.
 */

/**
 * The SHAPES live in `@/lib/story/contracts` — a module with no `"use server"`
 * on it — so a chapter card can describe a chapter without pulling a Server
 * Action into its graph. Re-exported for callers that want both.
 */
export type {
  ChapterStoryState,
  PreparationOffer,
  PreparationWord,
} from "@/lib/story/contracts";
import { toJson } from "@/lib/json";

export async function getChapterStoryState(
  chapterId: string,
): Promise<ActionResult<{ state: ChapterStoryState }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let chapter: ChapterFacts | null;
  try {
    chapter = await getChapterFacts(supabase, chapterId);
  } catch (error) {
    return fail("database_error", `getChapterStoryState: ${chapterId}`, error);
  }
  // RLS makes an unreadable chapter indistinguishable from a missing one, which
  // is exactly right: a private import must not be detectable by its absence.
  if (!chapter) return fail("not_found", `getChapterStoryState: ${chapterId}`);

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("ability, level_source, daily_learning_minutes")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  // An unplaced learner has no ability, and an ability of 1000 they never earned
  // is worse than none: it would put a CEFR gap into the difficulty score on the
  // strength of a default.
  const ability =
    profile && profile.level_source !== "default" ? Number(profile.ability) : null;
  const dailyMinutes = profile?.daily_learning_minutes ?? DEFAULT_DAILY_MINUTES;

  try {
    const cached = user
      ? await getCachedAnalysis(supabase, user.id, chapterId, chapter.contentHash)
      : null;

    // ONE read of the chapter's vocabulary and this learner's knowledge of it,
    // shared by the analysis and the preparation shortlist. Both need exactly
    // the same rows, and reading them twice would double the cost of every
    // chapter card on a book page.
    const vocabulary = await getChapterVocabulary(supabase, chapter.id);
    const knowledgeRows = user
      ? await getWordKnowledge(
          supabase,
          user.id,
          vocabulary.map((entry) => entry.wordId),
        )
      : [];
    const knowledge = new Map(knowledgeRows.map((row) => [row.wordId, row]));

    const computed = cached
      ? null
      : computeChapterAnalysis({
          chapter,
          ability,
          vocabulary,
          knowledge: knowledgeRows,
          history: user
            ? await getBookReadingHistory(
                supabase,
                user.id,
                chapter.libraryItemId,
                chapter.id,
              )
            : { chaptersCompleted: 0, lookupRate: null },
          weaknessPressure: user
            ? await getChapterConceptPressure(supabase, user.id, chapter.id)
            : null,
        });

    const coveragePercent = cached
      ? cached.coverageStatus === "estimated" && cached.coverageRatio !== null
        ? Math.round(cached.coverageRatio * 100)
        : null
      : (computed?.coveragePercent ?? null);

    const coverageConfidence = (cached?.coverageConfidence ??
      computed?.coverageConfidence ??
      "none") as EstimateConfidence;

    const difficultyLabel = (cached?.difficultyLabel ??
      computed?.difficulty.label ??
      "just_right") as DifficultyLabel;

    const difficultyConfidence = (cached?.difficultyConfidence ??
      computed?.difficulty.confidence ??
      "none") as EstimateConfidence;

    const targetCount = cached
      ? cached.preteachTargetCount
      : preteachTargetCount({
          chapterWordCount: chapter.wordCount,
          difficulty: difficultyLabel,
          dailyMinutes,
        });

    // The preparation shortlist is built fresh even from a cached analysis: the
    // COUNT is cached because it is part of the analysis, the words are not,
    // because a card the learner has since learned should not still be offered.
    const preparation = user
      ? await buildPreparationOffer(
          supabase,
          user.id,
          chapter,
          targetCount,
          vocabulary,
          knowledge,
        )
      : null;

    // `hasChallenge` is a CLAIM ABOUT THE CHAPTER, not about this request:
    // `.catch(() => [])` turned an unreachable database into "this chapter has
    // no Challenge", which the card then stated as fact and the learner had no
    // way to question. A failed read is a failed read.
    const candidateRead = user
      ? await settleRead(
          () => getChapterQuestionCandidates(supabase, chapterId),
          `getChapterStoryState: question bank ${chapterId}`,
        )
      : ({ ok: true, value: [] } as const);
    if (!candidateRead.ok) return candidateRead;
    const candidates = candidateRead.value;

    const lifecycle = user
      ? ((
          await supabase
            .from("user_chapter_learning_state")
            .select("status")
            .eq("user_id", user.id)
            .eq("chapter_id", chapterId)
            .maybeSingle()
        ).data?.status ?? "not_started")
      : "not_started";

    // Persist a freshly computed analysis. Best-effort: a cache that failed to
    // write is a slower page, never a wrong one.
    if (user && computed) {
      await persistAnalysis(user.id, chapter, {
        coverage_status: computed.coverage.status,
        coverage_ratio:
          computed.coverage.status === "estimated" ? computed.coverage.ratio : null,
        coverage_confidence: computed.coverageConfidence,
        observed_words: computed.coverage.observedWords,
        known_words:
          computed.coverage.status === "estimated" ? computed.coverage.knownWords : 0,
        total_words: computed.coverage.totalWords,
        difficulty_score: computed.difficulty.score,
        difficulty_label: computed.difficulty.label,
        difficulty_confidence: computed.difficulty.confidence,
        signals: computed.difficulty.signals,
        estimated_minutes: chapter.estimatedMinutes,
        preteach_target_count: targetCount,
        story_engine_version: STORY_ENGINE_VERSION,
      });
    }

    return {
      ok: true,
      state: {
        chapterId: chapter.id,
        libraryItemId: chapter.libraryItemId,
        slug: chapter.slug,
        position: chapter.position,
        title: chapter.title,
        itemTitle: chapter.itemTitle,
        wordCount: chapter.wordCount,
        estimatedMinutes: chapter.estimatedMinutes,
        coveragePercent,
        coverageConfidence,
        coverageConfidenceLabel: CONFIDENCE_LABEL_PL[coverageConfidence],
        difficultyLabel,
        difficultyLabelPl: DIFFICULTY_LABEL_PL[difficultyLabel],
        difficultyConfidence,
        preparation,
        hasChallenge: candidates.length > 0,
        lifecycle: lifecycle as ChapterStoryState["lifecycle"],
      },
    };
  } catch (error) {
    return fail("database_error", `getChapterStoryState: compute ${chapterId}`, error);
  }
}

/**
 * The words worth clearing before this chapter — or nothing at all.
 *
 * Returns null rather than an empty offer when the ranking finds nothing worth
 * pre-teaching, because "Przygotuj się · 0 słów" is a button that should not
 * exist. A learner who already knows the chapter's vocabulary should simply be
 * shown "Zacznij czytać".
 */
async function buildPreparationOffer(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  chapter: ChapterFacts,
  targetCount: number,
  vocabulary: readonly ChapterVocabularyEntry[],
  knowledge: ReadonlyMap<number, WordEvidence>,
): Promise<PreparationOffer | null> {
  if (targetCount <= 0 || vocabulary.length === 0) return null;

  const [candidates, weakConcepts] = await Promise.all([
    getPreteachCandidates(supabase, chapter.id, vocabulary),
    getWeakConceptSeverity(supabase, userId),
  ]);

  const ranked = rankPreteachWords({
    candidates,
    knowledge,
    chapterParagraphCount: chapter.paragraphCount,
    weakConcepts: new Set(weakConcepts.keys()),
  });

  const chosen = selectPreteachWords(ranked, targetCount);
  if (chosen.length === 0) return null;

  return {
    wordCount: chosen.length,
    estimatedMinutes: preparationMinutes(chosen.length),
    words: chosen.map(toPreparationWord),
  };
}

function toPreparationWord(word: RankedPreteachWord): PreparationWord {
  return {
    wordId: word.wordId,
    lemma: word.lemma,
    display: word.display,
    translation: word.translationPl ?? "",
    contextSentence: word.context.sentence,
    contextSource: word.context.source,
    firstSentencePosition: word.firstSentencePosition,
  };
}

/**
 * Write the analysis cache.
 *
 * Through the service role, because `chapter_user_analysis` has no learner write
 * path: a coverage figure a learner could author is a coverage figure that means
 * nothing. The user id was established from the cookie-bound client above before
 * this is ever reached.
 */
async function persistAnalysis(
  userId: string,
  chapter: ChapterFacts,
  analysis: Record<string, unknown>,
): Promise<void> {
  try {
    const service = createServiceRoleSupabaseClient();
    await service.rpc("upsert_chapter_analysis", {
      p_user_id: userId,
      p_chapter_id: chapter.id,
      p_analysis: toJson(analysis),
    });
  } catch (error) {
    // A cache that did not write is a slower page, not a wrong one — and in a
    // deployment with no service-role key it is simply how this feature runs.
    console.error("[fluent:story] analysis cache write failed", error);
  }
}

/** Advance the learning lifecycle when a chapter is opened or finished. */
export async function markChapterReading(
  chapterId: string,
  event: "started" | "completed",
): Promise<ActionResult<{ status: string }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "markChapterReading: no session");

  const { data, error } = await supabase.rpc(
    event === "started"
      ? "mark_chapter_reading_started"
      : "mark_chapter_reading_completed",
    { p_chapter_id: chapterId },
  );
  if (error) return failFrom(error, `markChapterReading: ${event} ${chapterId}`);

  return { ok: true, status: data ?? "not_started" };
}
