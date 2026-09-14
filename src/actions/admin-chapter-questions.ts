"use server";

import { requireAdmin } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { CONCEPT_CATALOG } from "@/lib/learning/concepts";
import {
  MAX_GENERATION_ATTEMPTS,
  MAX_QUESTIONS_PER_CHAPTER,
  QUESTION_GENERATOR_VERSION,
} from "@/lib/story/constants";
import {
  chapterOutline,
  chunkSentences,
} from "@/lib/story/generation/chunking";
import {
  bankCoverage,
  isBankPublishable,
  mergeCandidates,
  runPipeline,
} from "@/lib/story/generation/pipeline";
import {
  checkProvider,
  getQuestionProvider,
  type ChapterQuestionRequest,
  type GenerationSentence,
  type GenerationUsage,
  type ProviderRefusal,
} from "@/lib/story/generation/provider";
import type { QuestionCandidate, ValidatedQuestion } from "@/lib/story/questions";
import { getChapterFacts } from "@/lib/story/queries";
import { fail, failFrom, type ActionResult } from "@/lib/errors";
import type { Json } from "@/types/database";

/**
 * Generating and curating a chapter's question bank.
 *
 * THE PIPELINE, END TO END:
 *
 *     chapter content → chunks → candidates → validation → grounding → bank
 *
 * Only the third step involves a model, and everything after it exists to refuse
 * what the model got wrong. A generated question that is ambiguous or has two
 * right answers does not merely waste thirty seconds of a learner's time — it
 * writes FALSE evidence into their knowledge model, and Fluent then plans their
 * week around a weakness that never existed. So a candidate is guilty until
 * validated, every rejection keeps its reason, and nothing unvalidated is ever
 * served.
 *
 * IT RUNS WITHOUT A PROVIDER. With none configured, `generateChapterQuestions`
 * reports that plainly and an admin can still author a bank by hand through
 * `importChapterQuestions` — the validation, de-duplication and grounding checks
 * are identical either way, because they are the part that matters.
 *
 * PRIVACY. A `private_import` is somebody's own document. The provider contract
 * declares whether it can be trusted with one, the check fails CLOSED, and the
 * job row records provider, model and token usage but never a sentence of the
 * chapter — a log is a copy.
 */

export interface GenerationSummary {
  jobId: string;
  status: "ready" | "failed" | "needs_review";
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  /** Per-kind counts of what the bank now holds, for the admin panel. */
  coverage: Record<string, number>;
  /** Why nothing could be generated, when that is the answer. */
  refusal: ProviderRefusal | null;
}

/**
 * Generate (or regenerate) a chapter's question bank.
 *
 * Admin-only and idempotent: running it twice over an unchanged chapter adds
 * nothing, because `upsert_chapter_questions` keys on a content fingerprint.
 * Running it after the chapter changed marks the old bank stale first, so a
 * question written from a paragraph that has since been edited away stops being
 * served rather than quietly asking about text nobody can read.
 */
export async function generateChapterQuestions(
  chapterId: string,
): Promise<ActionResult<GenerationSummary>> {
  // `requireAdmin` throws, as the rest of the admin surface expects. Here the
  // failure has to be RETURNED, because Next redacts thrown Server Action errors
  // in production and the admin UI branches on the code.
  try {
    await requireAdmin();
  } catch {
    return fail("forbidden", "generateChapterQuestions: not an admin");
  }

  const supabase = await createServerSupabaseClient();

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "generateChapterQuestions: service role unavailable", error);
  }

  const chapter = await getChapterFacts(supabase, chapterId).catch(() => null);
  if (!chapter) return fail("not_found", `generateChapterQuestions: ${chapterId}`);
  if (chapter.status !== "ready") {
    return fail("invalid_input", `generateChapterQuestions: chapter not processed ${chapterId}`);
  }

  const { data: jobId, error: jobError } = await service.rpc(
    "start_chapter_generation_job",
    { p_chapter_id: chapterId, p_generator_version: QUESTION_GENERATOR_VERSION },
  );
  if (jobError || !jobId) {
    return failFrom(jobError, `generateChapterQuestions: job ${chapterId}`);
  }

  // Refuse to keep paying for a chapter that has failed repeatedly. Retries are
  // cheap to allow and expensive to allow forever.
  const { data: job } = await service
    .from("chapter_generation_jobs")
    .select("attempts")
    .eq("id", jobId)
    .maybeSingle();
  if ((job?.attempts ?? 1) > MAX_GENERATION_ATTEMPTS) {
    await finishJob(service, jobId, "failed", { error_code: "too_many_attempts" });
    return fail("invalid_input", `generateChapterQuestions: gave up on ${chapterId}`);
  }

  const provider = getQuestionProvider();
  const isPrivateContent = chapter.isPrivate;
  const refusal = checkProvider(provider, { isPrivateContent });

  if (refusal || !provider) {
    await finishJob(service, jobId, "failed", { error_code: refusal ?? "not_configured" });
    return {
      ok: true,
      jobId,
      status: "failed",
      candidateCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      coverage: {},
      refusal: refusal ?? "not_configured",
    };
  }

  // Anything the chapter has been rewritten past stops being served BEFORE the
  // new bank lands, so there is no window in which both are publishable.
  await service.rpc("mark_stale_chapter_questions", { p_chapter_id: chapterId });

  const [sentences, vocabulary, existing] = await Promise.all([
    loadSentences(service, chapterId),
    loadVocabulary(service, chapterId),
    loadExistingFingerprints(service, chapterId),
  ]);

  if (sentences.length === 0) {
    await finishJob(service, jobId, "failed", { error_code: "no_content" });
    return fail("not_found", `generateChapterQuestions: no sentences ${chapterId}`);
  }

  const allowedConceptCodes = Object.keys(CONCEPT_CATALOG);
  const chunks = chunkSentences(sentences);
  const batches: QuestionCandidate[][] = [];
  const usage: GenerationUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

  try {
    // LOCAL questions, one request per chunk. A chunk never contains anything
    // from another chapter, which is the spoiler boundary for free: the
    // generator for chapter 4 cannot leak chapter 5 because it has never seen it.
    for (const chunk of chunks) {
      const response = await provider.generateChapterQuestions(
        request({
          chapter,
          scope: "local",
          sentences: chunk.sentences,
          // The chapter's vocabulary, not the chunk's: a word occurring in the
          // chunk is in this list, and a generator that proposes a question
          // about one that is not in the chunk will fail grounding anyway.
          vocabulary,
          allowedConceptCodes,
          isPrivateContent,
        }),
      );
      batches.push([...response.candidates]);
      accumulate(usage, response.usage);
    }

    // CHAPTER-LEVEL questions — main idea, sequence — which no chunk can answer
    // on its own, from an evenly spread outline of the whole chapter.
    const outline = chapterOutline(sentences);
    const synthesis = await provider.generateChapterQuestions(
      request({
        chapter,
        scope: "chapter",
        sentences: outline,
        vocabulary,
        allowedConceptCodes,
        isPrivateContent,
      }),
    );
    batches.push([...synthesis.candidates]);
    accumulate(usage, synthesis.usage);
  } catch (error) {
    await finishJob(service, jobId, "failed", {
      error_code: "provider_error",
      // Bounded and never chapter text: an error message is not a place to
      // spill somebody's private book.
      error_message: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      provider: provider.capabilities.name,
      model: provider.capabilities.model,
    });
    return fail("database_error", `generateChapterQuestions: provider ${chapterId}`, error);
  }

  const candidates = mergeCandidates(batches);
  const result = runPipeline({
    candidates,
    grounding: {
      sentenceIds: new Set(sentences.map((sentence) => sentence.id)),
      wordIds: new Set(vocabulary.map((word) => word.wordId)),
    },
    existingFingerprints: existing,
    maxQuestions: MAX_QUESTIONS_PER_CHAPTER,
    existingCount: existing.size,
  });

  if (result.accepted.length > 0) {
    const { error: writeError } = await service.rpc("upsert_chapter_questions", {
      p_chapter_id: chapterId,
      p_questions: result.accepted.map(toRow) as unknown as Json,
      p_meta: {
        generation_source: "ai",
        generator_version: QUESTION_GENERATOR_VERSION,
        provider: provider.capabilities.name,
        model: provider.capabilities.model,
        // FIRST-PARTY CONTENT IS REVIEWED BEFORE IT IS PUBLISHED; a learner's own
        // import is not, because nobody but them may read it and asking them to
        // approve their own questions would be theatre. Validated questions are
        // the floor in both cases.
        status: isPrivateContent ? "published" : "needs_review",
      } as unknown as Json,
    });
    if (writeError) {
      await finishJob(service, jobId, "failed", {
        error_code: "write_failed",
        error_message: writeError.message.slice(0, 500),
      });
      return failFrom(writeError, `generateChapterQuestions: write ${chapterId}`);
    }
  }

  const coverage = bankCoverage(result.accepted);
  // A bank that could only ever produce a grammar test is not publishable: the
  // blueprint's comprehension floor would have to be broken to use it.
  const status = isBankPublishable(result.accepted) ? "ready" : "needs_review";

  await finishJob(service, jobId, status, {
    provider: provider.capabilities.name,
    model: provider.capabilities.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: usage.costUsd,
    candidate_count: candidates.length,
    accepted_count: result.accepted.length,
    rejected_count: result.rejected.length,
    rejections: result.rejected.slice(0, 50),
  });

  return {
    ok: true,
    jobId,
    status,
    candidateCount: candidates.length,
    acceptedCount: result.accepted.length,
    rejectedCount: result.rejected.length,
    duplicateCount: result.duplicates,
    coverage,
    refusal: null,
  };
}

/**
 * Import hand-authored questions through the same pipeline.
 *
 * The validation, grounding and de-duplication are identical to the generated
 * path, deliberately: a human can write an ambiguous question too, and the point
 * of the checks is the question rather than its author.
 */
export async function importChapterQuestions(input: {
  chapterId: string;
  candidates: QuestionCandidate[];
}): Promise<ActionResult<{ accepted: number; rejected: number }>> {
  try {
    await requireAdmin();
  } catch {
    return fail("forbidden", "importChapterQuestions: not an admin");
  }

  const supabase = await createServerSupabaseClient();
  const chapter = await getChapterFacts(supabase, input.chapterId).catch(() => null);
  if (!chapter) return fail("not_found", `importChapterQuestions: ${input.chapterId}`);

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch (error) {
    return fail("config_error", "importChapterQuestions: service role unavailable", error);
  }

  const [sentences, vocabulary, existing] = await Promise.all([
    loadSentences(service, input.chapterId),
    loadVocabulary(service, input.chapterId),
    loadExistingFingerprints(service, input.chapterId),
  ]);

  const result = runPipeline({
    candidates: input.candidates,
    grounding: {
      sentenceIds: new Set(sentences.map((sentence) => sentence.id)),
      wordIds: new Set(vocabulary.map((word) => word.wordId)),
    },
    existingFingerprints: existing,
    maxQuestions: MAX_QUESTIONS_PER_CHAPTER,
    existingCount: existing.size,
  });

  if (result.accepted.length > 0) {
    const { error } = await service.rpc("upsert_chapter_questions", {
      p_chapter_id: input.chapterId,
      p_questions: result.accepted.map(toRow) as unknown as Json,
      p_meta: {
        generation_source: "manual",
        generator_version: QUESTION_GENERATOR_VERSION,
        // An admin writing a question by hand has already reviewed it.
        status: "published",
      } as unknown as Json,
    });
    if (error) return failFrom(error, `importChapterQuestions: ${input.chapterId}`);
  }

  return { ok: true, accepted: result.accepted.length, rejected: result.rejected.length };
}

/** Approve, reject or disable one question of a public chapter. */
export async function setChapterQuestionStatus(input: {
  questionId: number;
  status: "published" | "needs_review" | "disabled";
}): Promise<ActionResult<{ updated: true }>> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized", "setChapterQuestionStatus: no session");

  // The admin check lives in the function too — this one only avoids a round
  // trip for the obvious case.
  const { error } = await supabase.rpc("set_chapter_question_status", {
    p_question_id: input.questionId,
    p_status: input.status,
  });
  if (error) return failFrom(error, `setChapterQuestionStatus: ${input.questionId}`);

  return { ok: true, updated: true };
}

// ─────────────────────────────────────────────────────────────────────────────

type ServiceClient = ReturnType<typeof createServiceRoleSupabaseClient>;

const SENTENCE_PAGE = 1000;

async function loadSentences(
  service: ServiceClient,
  chapterId: string,
): Promise<GenerationSentence[]> {
  const rows: GenerationSentence[] = [];

  for (let from = 0; ; from += SENTENCE_PAGE) {
    const { data, error } = await service
      .from("sentences")
      .select("id, text, paragraphs(position)")
      .eq("chapter_id", chapterId)
      .order("chapter_position", { ascending: true })
      .range(from, from + SENTENCE_PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(
      ...data.map((row) => {
        const paragraph = (Array.isArray(row.paragraphs)
          ? row.paragraphs[0]
          : row.paragraphs) as { position: number } | null | undefined;
        return {
          id: row.id,
          paragraphPosition: paragraph?.position ?? 0,
          text: row.text,
        };
      }),
    );
    if (data.length < SENTENCE_PAGE) break;
  }

  return rows;
}

async function loadVocabulary(service: ServiceClient, chapterId: string) {
  const { data } = await service
    .from("chapter_vocabulary")
    .select("word_id, occurrence_count, words(lemma, translation_pl)")
    .eq("chapter_id", chapterId)
    .order("occurrence_count", { ascending: false })
    .limit(200);

  return (data ?? []).map((row) => {
    const word = (Array.isArray(row.words) ? row.words[0] : row.words) as
      | { lemma: string; translation_pl: string | null }
      | null
      | undefined;
    return {
      wordId: row.word_id,
      lemma: word?.lemma ?? "",
      translationPl: word?.translation_pl ?? null,
      occurrenceCount: row.occurrence_count,
    };
  });
}

async function loadExistingFingerprints(
  service: ServiceClient,
  chapterId: string,
): Promise<Set<string>> {
  const { data } = await service
    .from("chapter_questions")
    .select("fingerprint")
    .eq("chapter_id", chapterId);
  return new Set((data ?? []).map((row) => row.fingerprint));
}

function request(input: {
  chapter: Awaited<ReturnType<typeof getChapterFacts>>;
  scope: "local" | "chapter";
  sentences: GenerationSentence[];
  vocabulary: { wordId: number; lemma: string; translationPl: string | null; occurrenceCount: number }[];
  allowedConceptCodes: string[];
  isPrivateContent: boolean;
}): ChapterQuestionRequest {
  return {
    chapterId: input.chapter?.id ?? "",
    language: "de",
    chapterTitle: input.chapter?.title ?? null,
    scope: input.scope,
    sentences: input.sentences,
    vocabulary: input.vocabulary,
    // Asked for more than will be kept: validation rejects some, and a bank
    // built from exactly enough candidates is a bank that is always short.
    targetCount: input.scope === "chapter" ? 4 : 6,
    allowedConceptCodes: input.allowedConceptCodes,
    isPrivateContent: input.isPrivateContent,
  };
}

function accumulate(total: GenerationUsage, usage: GenerationUsage | null): void {
  if (!usage) return;
  total.inputTokens = (total.inputTokens ?? 0) + (usage.inputTokens ?? 0);
  total.outputTokens = (total.outputTokens ?? 0) + (usage.outputTokens ?? 0);
  total.costUsd = (total.costUsd ?? 0) + (usage.costUsd ?? 0);
}

function toRow(question: ValidatedQuestion): Record<string, unknown> {
  return {
    kind: question.kind,
    question_type: question.type,
    scope: question.scope,
    prompt: question.prompt,
    options: question.options,
    correct_idx: question.correctIdx,
    accepted_answers: question.acceptedAnswers,
    sequence_items: question.sequenceItems,
    skill_code: question.skillCode,
    concept_codes: question.conceptCodes,
    word_id: question.wordId,
    difficulty: question.difficulty,
    source_sentence_ids: question.sourceSentenceIds,
    explanation_pl: question.explanationPl,
    fingerprint: question.fingerprint,
  };
}

async function finishJob(
  service: ServiceClient,
  jobId: string,
  status: "ready" | "failed" | "needs_review",
  result: Record<string, unknown>,
): Promise<void> {
  await service.rpc("finish_chapter_generation_job", {
    p_job_id: jobId,
    p_status: status,
    p_result: result as unknown as Json,
  });
}
