"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  loadTagsForEvidence,
  prepareEvidence,
} from "@/lib/learning/commit-evidence";
import {
  assessmentRetrieval,
  chapterAssessmentEvidence,
  type LearningEvidence,
} from "@/lib/learning/evidence";
import {
  CONCEPT_CATALOG,
  isConceptCode,
  type ConceptCode,
} from "@/lib/learning/concepts";
import { isSkillCode, type SkillCode } from "@/lib/learning/skills";
import type { ChallengeResult } from "@/lib/story/contracts";
import {
  buildBlueprint,
  fitBlueprint,
  isChallengeViable,
  type BlueprintPressure,
} from "@/lib/story/blueprint";
import {
  CHALLENGE_SECONDS_PER_QUESTION,
  STORY_ENGINE_VERSION,
  type QuestionKind,
} from "@/lib/story/constants";
import { buildFollowUp, challengeFeedback } from "@/lib/story/follow-up";
import {
  getChapterFacts,
  getChapterQuestionCandidates,
  getWeakConceptSeverity,
} from "@/lib/story/queries";
import {
  availableByKind,
  selectChallengeQuestions,
} from "@/lib/story/selection";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { Json } from "@/types/database";

/**
 * The Chapter Challenge — the AFTER half of the story lifecycle.
 *
 * WHAT MAKES IT PERSONAL IS SELECTION, NOT GENERATION. The bank belongs to the
 * chapter and is shared by everyone who reads it; what differs per learner is
 * which six of the forty they get, and in what mix. That is the only version of
 * personalisation that can also be reviewed, validated once, and improved for
 * everybody at the same time.
 *
 * WHAT MAY NEVER BE PERSONALISED AWAY is comprehension. A learner with failing
 * grammar still gets story questions, because a Challenge that stopped asking
 * "did you follow what happened?" would lose the only measurement it exists to
 * make — and would be a grammar worksheet that happens to appear after a novel.
 *
 * THE TRUST MODEL IS A TEST'S, unchanged since Phase 1: the server picks the
 * items and snapshots them, each answer is written exactly once, the key is
 * revealed only after the answer is committed, and finalize is atomic and
 * idempotent. What the Challenge deliberately does NOT do is move Elo, CEFR,
 * `attempts` or `text_completions` — its questions were chosen partly because
 * the learner struggled, and scoring a displayed level from that biased sample
 * would punish someone for reading a hard chapter.
 */

/** One Challenge question as the client sees it — never an answer key. */
export interface ChallengeQuestion {
  questionId: number;
  kind: QuestionKind;
  type: "multiple_choice" | "true_false" | "cloze" | "sequence";
  prompt: string;
  /** For multiple choice and true/false. */
  options: string[] | null;
  /** For a sequence question, SHUFFLED — the stored order is the answer. */
  sequenceItems: string[] | null;
  answered: boolean;
}

export interface StartedChallenge {
  sessionId: string;
  chapterId: string;
  slug: string;
  chapterPosition: number;
  itemTitle: string;
  questions: ChallengeQuestion[];
  estimatedMinutes: number;
  resumeAt: number;
  /** True when the bank could not fill the requested mix — a shorter Challenge. */
  shortened: boolean;
}

/**
 * Open (or resume) a Chapter Challenge.
 *
 * Three steps, all server-side: read the candidate pool (metadata only), build a
 * blueprint from the learner's weaknesses and what they actually did while
 * reading, then select against it. The client receives prompts and nothing else.
 */
export async function startChapterChallenge(input: {
  chapterId: string;
  planItemId?: string | null;
}): Promise<ActionResult<StartedChallenge>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "startChapterChallenge: no session");

  const chapter = await getChapterFacts(supabase, input.chapterId).catch(() => null);
  if (!chapter) return fail("not_found", `startChapterChallenge: ${input.chapterId}`);

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "startChapterChallenge: service role unavailable", error);
  }

  let candidates;
  try {
    candidates = await getChapterQuestionCandidates(supabase, input.chapterId);
  } catch (error) {
    return fail("database_error", `startChapterChallenge: pool ${input.chapterId}`, error);
  }

  // NO BANK IS NOT AN ERROR IN THE READER — the chapter is still readable and
  // still completable. It only means there is no Challenge to offer, which the
  // UI says plainly rather than showing a broken button.
  if (candidates.length === 0) {
    return fail("not_found", `startChapterChallenge: empty bank ${input.chapterId}`);
  }

  const [weakConcepts, interactions, ability] = await Promise.all([
    getWeakConceptSeverity(supabase, user.id).catch(() => new Map<string, number>()),
    getChapterInteractions(supabase, user.id, input.chapterId),
    getAbility(supabase, user.id),
  ]);

  const blueprint = buildBlueprint({
    pressure: pressureFrom(weakConcepts),
    chapterInteractionCount: interactions.size,
  });

  const { fitted, total } = fitBlueprint(blueprint, availableByKind(candidates));

  // A SHORT CHALLENGE BEATS A BAD ONE. If the bank cannot fill three questions,
  // nothing is offered at all rather than a two-question "assessment" whose
  // result would be noise fed straight into the knowledge model.
  if (!isChallengeViable(total)) {
    return fail("not_found", `startChapterChallenge: thin bank ${input.chapterId}`);
  }

  const selection = selectChallengeQuestions({
    questions: candidates,
    blueprint: fitted,
    ability,
    weakConcepts,
    interactedWordIds: interactions,
  });

  const { data: sessionId, error: startError } = await service.rpc(
    "start_chapter_assessment",
    {
      p_user_id: user.id,
      p_chapter_id: input.chapterId,
      p_question_ids: selection.questions.map((question) => question.id),
      p_blueprint: {
        requested: blueprint,
        fitted,
        story_engine_version: STORY_ENGINE_VERSION,
      } as unknown as Json,
      p_signals: {
        // WHY THESE QUESTIONS. Developer-facing and never shown to a learner,
        // but an admin asking "why did they get exactly these six?" six months
        // from now needs the answer to still exist.
        questions: selection.questions.map((question) => ({
          id: question.id,
          score: question.score,
          signals: question.signals,
        })),
        reused_recent: selection.reusedRecent,
      } as unknown as Json,
      p_plan_item_id: input.planItemId ?? null,
    },
  );
  if (startError || !sessionId) {
    return failFrom(startError, `startChapterChallenge: ${input.chapterId}`);
  }

  const loaded = await loadChallenge(supabase, sessionId);
  if (!loaded.ok) return loaded;

  return {
    ok: true,
    sessionId,
    chapterId: chapter.id,
    slug: chapter.slug,
    chapterPosition: chapter.position,
    itemTitle: chapter.itemTitle,
    questions: loaded.questions,
    estimatedMinutes: Math.max(
      1,
      Math.round((loaded.questions.length * CHALLENGE_SECONDS_PER_QUESTION) / 60),
    ),
    resumeAt: loaded.resumeAt,
    shortened: total < blueprint.comprehension + blueprint.contextual_vocabulary +
      blueprint.grammar + blueprint.transfer,
  };
}

export interface ChallengeAnswerResult {
  isCorrect: boolean;
  /** For multiple choice and true/false. */
  correctIdx: number | null;
  /** For cloze — one accepted spelling, so the learner sees what was wanted. */
  correctText: string | null;
  /** For sequence — the right order in PRESENTED positions. */
  correctOrder: number[] | null;
  explanationPl: string | null;
  alreadyAnswered: boolean;
}

/**
 * Answer one Challenge question.
 *
 * All grading happens in the database, for all four answerable types, because
 * the answer key must not leave it before the learner's answer is committed.
 * A client that could see the key before answering is a client that can score
 * itself.
 */
export async function answerChallengeQuestion(input: {
  sessionId: string;
  questionId: number;
  selectedIdx?: number | null;
  typedAnswer?: string | null;
  sequenceAnswer?: number[] | null;
  responseMs: number | null;
}): Promise<ActionResult<ChallengeAnswerResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "answerChallengeQuestion: no session");

  const { data, error } = await supabase.rpc("answer_chapter_assessment_question", {
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_selected_idx: input.selectedIdx ?? null,
    p_typed_answer: input.typedAnswer ?? null,
    p_sequence_answer: input.sequenceAnswer ?? null,
    p_response_ms: input.responseMs,
  });
  if (error) return failFrom(error, `answerChallengeQuestion: ${input.sessionId}`);

  const row = data?.[0];
  if (!row) return fail("not_found", `answerChallengeQuestion: empty ${input.sessionId}`);

  return {
    ok: true,
    isCorrect: row.is_answer_correct,
    correctIdx: row.answer_key_idx,
    correctText: row.answer_key_text,
    correctOrder: row.answer_key_order,
    explanationPl: row.explanation_pl,
    alreadyAnswered: row.already_answered,
  };
}

/** What the learner is shown after the Challenge. Real numbers only. */
/**
 * The SHAPE lives in `@/lib/story/contracts`, so the result card can describe a
 * Challenge result without importing a Server Action module.
 */
export type { ChallengeResult } from "@/lib/story/contracts";

/** A stale knowledge read is recomputed rather than forced through. */
const MAX_ATTEMPTS = 3;

/**
 * Seal a Challenge, record what it proved, and work out what to revisit.
 *
 * THE EVIDENCE GOES WHERE ALL EVIDENCE GOES. Every answer becomes a
 * `learning_event` through `apply_learning_evidence`, attributed to the
 * question's OWN skill and concepts and to no others — a wrong answer about the
 * plot never lands in the grammar state, and a comprehension question about a
 * paragraph that happens to contain *Schwert* proves nothing about *Schwert*.
 * There is no separate story-mastery score, because a second knowledge model is
 * a second set of numbers that will disagree with the first.
 */
export async function finalizeChapterChallenge(
  sessionId: string,
): Promise<ActionResult<ChallengeResult>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "finalizeChapterChallenge: no session");

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail(
      "config_error",
      "finalizeChapterChallenge: service role unavailable",
      error,
    );
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { data: session, error: sessionError } = await supabase
      .from("chapter_assessment_sessions")
      .select("id, chapter_id, library_item_id, status, correct, total")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) {
      return failFrom(sessionError, `finalizeChapterChallenge: load ${sessionId}`);
    }
    if (!session) {
      return fail("not_found", `finalizeChapterChallenge: no session ${sessionId}`);
    }

    const { data: items, error: itemsError } = await supabase
      .from("chapter_assessment_items")
      .select("question_id, kind, question_type, is_correct, answered_at, response_ms")
      .eq("session_id", sessionId);
    if (itemsError) {
      return failFrom(itemsError, `finalizeChapterChallenge: items ${sessionId}`);
    }

    const answered = (items ?? []).filter(
      (row) => row.answered_at !== null && row.is_correct !== null,
    );
    if (answered.length === 0) {
      return fail("session_incomplete", `finalizeChapterChallenge: empty ${sessionId}`);
    }

    const loadedTags = await loadTagsForEvidence(
      () =>
        loadQuestionTags(
          service,
          answered.map((row) => row.question_id),
        ),
      `finalizeChapterChallenge ${sessionId}`,
    );
    if (!loadedTags.ok) return loadedTags;
    const tags = loadedTags.tags;

    const evidence: LearningEvidence[] = answered.map((row) => {
      const tag = tags.get(row.question_id);
      const retrieval = assessmentRetrieval(row.question_type);
      return chapterAssessmentEvidence({
        sessionId,
        questionId: row.question_id,
        libraryItemId: session.library_item_id,
        chapterId: session.chapter_id,
        skillCode: tag?.skillCode ?? null,
        conceptCodes: tag?.conceptCodes ?? [],
        testedWordId: tag?.wordId ?? null,
        retrievalType: retrieval.retrievalType,
        responseMode: retrieval.responseMode,
        sourceSentenceId: tag?.sourceSentenceId ?? null,
        isCorrect: row.is_correct === true,
        responseMs: row.response_ms,
        occurredAt: row.answered_at as string,
      });
    });

    const prepared = await prepareEvidence(
      supabase,
      user.id,
      evidence,
      `finalizeChapterChallenge ${sessionId}`,
    );
    if (!prepared.ok) return prepared;

    const scores = scoreByKind(answered);

    const { data, error } = await service.rpc("finalize_chapter_assessment", {
      p_session_id: sessionId,
      p_user_id: user.id,
      p_evidence: prepared.json,
      p_scores: scores as unknown as Json,
    });

    const result = data?.[0];
    if (!error && result) {
      const followUp = await buildChapterFollowUp(
        supabase,
        user.id,
        session.chapter_id,
        answered,
        tags,
      );

      const feedback = challengeFeedback({
        comprehensionCorrect: scores.comprehension_correct,
        comprehensionTotal: scores.comprehension_total,
        vocabularyCorrect: scores.vocabulary_correct,
        vocabularyTotal: scores.vocabulary_total,
        followUp,
      });

      return {
        ok: true,
        correct: result.correct_count,
        total: result.total_count,
        comprehension: {
          correct: scores.comprehension_correct,
          total: scores.comprehension_total,
        },
        vocabulary: {
          correct: scores.vocabulary_correct,
          total: scores.vocabulary_total,
        },
        grammar: { correct: scores.grammar_correct, total: scores.grammar_total },
        headlinePl: feedback.headlinePl,
        detailPl: feedback.detailPl,
        reviewTargets: [
          ...followUp.words.map((word) => ({
            label: word.lemma,
            kind: "word" as const,
          })),
          ...followUp.concepts.map((concept) => ({
            label: conceptLabel(concept.conceptCode),
            kind: "concept" as const,
          })),
        ],
        alreadyFinalized: result.already_finalized,
      };
    }

    if (error?.code === "FL423" && attempt < MAX_ATTEMPTS) continue;

    return failFrom(error, `finalizeChapterChallenge: commit ${sessionId}`);
  }

  return fail("stale_state", `finalizeChapterChallenge: gave up on ${sessionId}`);
}

/**
 * "Później."
 *
 * The Challenge stays available from the library, and Today may bring it back
 * for a few days. Nothing is blocked: a learner who wants to keep reading keeps
 * reading, which is the behaviour the engine exists to encourage.
 */
export async function deferChapterChallenge(
  chapterId: string,
): Promise<ActionResult<{ status: string }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "deferChapterChallenge: no session");

  const { data, error } = await supabase.rpc("defer_chapter_assessment", {
    p_chapter_id: chapterId,
  });
  if (error) return failFrom(error, `deferChapterChallenge: ${chapterId}`);

  return { ok: true, status: data ?? "assessment_pending" };
}

/** "To pytanie jest nie tak." The human check on generated content. */
export async function reportChallengeQuestion(input: {
  questionId: number;
  reason: "ambiguous" | "wrong_answer" | "not_in_chapter" | "unclear" | "other";
  note?: string | null;
}): Promise<ActionResult<{ reported: true }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "reportChallengeQuestion: no session");

  const { error } = await supabase.rpc("report_chapter_question", {
    p_question_id: input.questionId,
    p_reason: input.reason,
    p_note: input.note ?? null,
  });
  if (error) return failFrom(error, `reportChallengeQuestion: ${input.questionId}`);

  return { ok: true, reported: true };
}

/** Reload a Challenge in progress — used on resume and after a refresh. */
export async function loadChapterChallenge(
  sessionId: string,
): Promise<ActionResult<{ questions: ChallengeQuestion[]; resumeAt: number }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "loadChapterChallenge: no session");

  return loadChallenge(supabase, sessionId);
}

// ─────────────────────────────────────────────────────────────────────────────

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function loadChallenge(
  supabase: ServerClient,
  sessionId: string,
): Promise<ActionResult<{ questions: ChallengeQuestion[]; resumeAt: number }>> {
  const { data, error } = await supabase.rpc("get_chapter_assessment", {
    p_session_id: sessionId,
  });
  if (error || !data) return failFrom(error, `loadChallenge: ${sessionId}`);

  return {
    ok: true,
    questions: data.map((row) => ({
      questionId: row.question_id,
      kind: row.kind as QuestionKind,
      type: row.question_type as ChallengeQuestion["type"],
      prompt: row.prompt,
      options: row.options,
      sequenceItems: row.sequence_items,
      answered: row.answered_at !== null,
    })),
    resumeAt: Math.max(
      0,
      data.findIndex((row) => row.answered_at === null),
    ),
  };
}

interface QuestionTag {
  skillCode: SkillCode | null;
  conceptCodes: ConceptCode[];
  wordId: number | null;
  sourceSentenceId: number | null;
}

/**
 * What each answered question exercises.
 *
 * Read with the SERVICE ROLE, because `chapter_questions` is deliberately
 * unreadable from a learner's client — the row carries the answer key. Only the
 * tags are taken off it, and only for questions in a session that has already
 * been established as the caller's own.
 */
async function loadQuestionTags(
  service: ReturnType<typeof createServiceRoleSupabaseClient>,
  questionIds: readonly number[],
): Promise<Map<number, QuestionTag>> {
  if (questionIds.length === 0) return new Map();

  const [questionRows, conceptRows] = await Promise.all([
    service
      .from("chapter_questions")
      .select("id, skill_code, word_id, source_sentence_ids")
      .in("id", [...questionIds]),
    service
      .from("chapter_question_concepts")
      .select("question_id, concept_code")
      .in("question_id", [...questionIds]),
  ]);

  // A failed read here is not "this item is untagged" — untagged evidence moves
  // no state, so swallowing it would seal the challenge and record nothing.
  if (questionRows.error) throw questionRows.error;
  if (conceptRows.error) throw conceptRows.error;
  const questions = questionRows.data;
  const concepts = conceptRows.data;

  const byQuestion = new Map<number, ConceptCode[]>();
  for (const row of concepts ?? []) {
    if (!isConceptCode(row.concept_code)) continue;
    byQuestion.set(row.question_id, [
      ...(byQuestion.get(row.question_id) ?? []),
      row.concept_code,
    ]);
  }

  return new Map(
    (questions ?? []).map((question) => [
      question.id,
      {
        // An untagged item is attributed to NO skill rather than to a guessed
        // one — the same rule `item-tags.ts` holds for the passage bank.
        skillCode: isSkillCode(question.skill_code) ? question.skill_code : null,
        conceptCodes: byQuestion.get(question.id) ?? [],
        wordId: question.word_id,
        sourceSentenceId: question.source_sentence_ids?.[0] ?? null,
      },
    ]),
  );
}

interface AnsweredItem {
  question_id: number;
  kind: string;
  question_type: string;
  is_correct: boolean | null;
  answered_at: string | null;
  response_ms: number | null;
}

function scoreByKind(answered: readonly AnsweredItem[]) {
  const tally = (kinds: readonly string[]) => {
    const rows = answered.filter((row) => kinds.includes(row.kind));
    return {
      correct: rows.filter((row) => row.is_correct).length,
      total: rows.length,
    };
  };

  const comprehension = tally(["comprehension"]);
  const vocabulary = tally(["contextual_vocabulary"]);
  // A transfer question is scored with the dimension it transfers, which for the
  // question types Phase 5 generates is grammar.
  const grammar = tally(["grammar", "transfer"]);

  return {
    comprehension_correct: comprehension.correct,
    comprehension_total: comprehension.total,
    vocabulary_correct: vocabulary.correct,
    vocabulary_total: vocabulary.total,
    grammar_correct: grammar.correct,
    grammar_total: grammar.total,
  };
}

/**
 * The words this learner actually met in this chapter.
 *
 * Looked up while reading, or saved from it. A question about one of those is a
 * question about their reading; a question about a word they sailed past is a
 * question about the chapter.
 */
async function getChapterInteractions(
  supabase: ServerClient,
  userId: string,
  chapterId: string,
): Promise<Set<number>> {
  const [{ data: lookups }, { data: prepared }] = await Promise.all([
    supabase
      .from("reading_lookups")
      .select("word_id")
      .eq("user_id", userId)
      .eq("chapter_id", chapterId)
      .limit(200),
    supabase
      .from("chapter_preparation_items")
      .select("word_id, chapter_preparation_sessions!inner(user_id, chapter_id)")
      .eq("chapter_preparation_sessions.user_id", userId)
      .eq("chapter_preparation_sessions.chapter_id", chapterId)
      .limit(50),
  ]);

  return new Set([
    ...(lookups ?? []).map((row) => row.word_id),
    ...(prepared ?? []).map((row) => row.word_id),
  ]);
}

/** What the chapter leaves behind for the days after it. */
async function buildChapterFollowUp(
  supabase: ServerClient,
  userId: string,
  chapterId: string,
  answered: readonly AnsweredItem[],
  tags: ReadonlyMap<number, QuestionTag>,
) {
  const [{ data: lookups }, { data: prepared }, { data: saved }] = await Promise.all([
    supabase
      .from("reading_lookups")
      .select("word_id")
      .eq("user_id", userId)
      .eq("chapter_id", chapterId)
      .limit(300),
    supabase
      .from("chapter_preparation_items")
      .select("word_id, lemma, chapter_preparation_sessions!inner(user_id, chapter_id)")
      .eq("chapter_preparation_sessions.user_id", userId)
      .eq("chapter_preparation_sessions.chapter_id", chapterId)
      .limit(50),
    supabase.from("saved_words").select("word_id").eq("user_id", userId).limit(500),
  ]);

  const lookupCounts = new Map<number, number>();
  for (const row of lookups ?? []) {
    lookupCounts.set(row.word_id, (lookupCounts.get(row.word_id) ?? 0) + 1);
  }

  const preTaught = new Map(
    (prepared ?? []).map((row) => [row.word_id, row.lemma as string]),
  );
  const savedIds = new Set((saved ?? []).map((row) => row.word_id));

  const assessmentByWord = new Map<number, boolean>();
  for (const row of answered) {
    const wordId = tags.get(row.question_id)?.wordId;
    if (wordId === null || wordId === undefined) continue;
    // A word missed anywhere in the Challenge counts as missed.
    assessmentByWord.set(
      wordId,
      (assessmentByWord.get(wordId) ?? true) && row.is_correct === true,
    );
  }

  const wordIds = new Set([
    ...lookupCounts.keys(),
    ...preTaught.keys(),
    ...assessmentByWord.keys(),
  ]);

  const lemmas = await lemmaLookup(supabase, [...wordIds]);

  const conceptTally = new Map<string, { failureCount: number; askedCount: number }>();
  for (const row of answered) {
    for (const code of tags.get(row.question_id)?.conceptCodes ?? []) {
      const entry = conceptTally.get(code) ?? { failureCount: 0, askedCount: 0 };
      entry.askedCount += 1;
      if (row.is_correct !== true) entry.failureCount += 1;
      conceptTally.set(code, entry);
    }
  }

  return buildFollowUp({
    outcomes: [...wordIds].map((wordId) => ({
      wordId,
      lemma: preTaught.get(wordId) ?? lemmas.get(wordId) ?? String(wordId),
      lookupCount: lookupCounts.get(wordId) ?? 0,
      wasPreTaught: preTaught.has(wordId),
      assessmentCorrect: assessmentByWord.get(wordId) ?? null,
      alreadySaved: savedIds.has(wordId),
    })),
    conceptOutcomes: [...conceptTally.entries()].map(([conceptCode, entry]) => ({
      conceptCode,
      ...entry,
    })),
  });
}

async function lemmaLookup(
  supabase: ServerClient,
  wordIds: readonly number[],
): Promise<Map<number, string>> {
  if (wordIds.length === 0) return new Map();
  const { data } = await supabase
    .from("words")
    .select("id, display")
    .in("id", [...wordIds]);
  return new Map((data ?? []).map((row) => [row.id, row.display]));
}

/** Weakness severity, collapsed to the three dimensions the blueprint tilts. */
function pressureFrom(weakConcepts: ReadonlyMap<string, number>): BlueprintPressure {
  const worstOf = (predicate: (code: string) => boolean) => {
    let worst = 0;
    for (const [code, severity] of weakConcepts) {
      if (predicate(code)) worst = Math.max(worst, severity);
    }
    return worst;
  };

  const READING_CONCEPTS = new Set([
    "main_idea",
    "detail",
    "inference",
    "sequence",
    "reference_resolution",
  ]);
  const VOCABULARY_CONCEPTS = new Set([
    "lexical_recognition",
    "lexical_recall",
    "false_friend",
    "collocation",
    "word_gender",
    "compound_word",
  ]);

  return {
    reading: worstOf((code) => READING_CONCEPTS.has(code)),
    vocabulary: worstOf((code) => VOCABULARY_CONCEPTS.has(code)),
    grammar: worstOf(
      (code) => !READING_CONCEPTS.has(code) && !VOCABULARY_CONCEPTS.has(code),
    ),
  };
}

async function getAbility(
  supabase: ServerClient,
  userId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("profiles")
    .select("ability, level_source")
    .eq("id", userId)
    .maybeSingle();
  // An unplaced learner has no ability, and a default they never earned is worse
  // than none: it would put a difficulty comparison into the ranking on the
  // strength of a number Fluent invented.
  if (!data || data.level_source === "default") return null;
  return Number(data.ability);
}

/**
 * The Polish name of a concept, snapshotted into the result rather than looked
 * up by the UI later — so a catalog rename cannot rewrite a result the learner
 * has already seen.
 */
function conceptLabel(code: string): string {
  return isConceptCode(code) ? CONCEPT_CATALOG[code].labelPl : code;
}
