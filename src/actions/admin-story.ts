"use server";

import { requireAdmin } from "@/lib/auth/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { QUESTION_KINDS, type QuestionKind } from "@/lib/story/constants";

/**
 * The Story Inspector's read layer.
 *
 * WHAT AN ADMIN ACTUALLY NEEDS TO KNOW about a generated bank, and nothing more:
 * does this chapter have questions, are they valid, where did each come from,
 * what did the last generation run reject and why, and has anyone reported one
 * as broken. That is a debugging surface, not a CMS — there is no editor here,
 * because a question an admin can retype is a question that stops matching the
 * validation it passed.
 *
 * PRIVATE IMPORTS ARE EXCLUDED, absolutely. An admin panel is a content tool,
 * not a reason to read somebody's personal library, and the service-role client
 * used here bypasses RLS — so the exclusion is an explicit filter rather than a
 * policy this code is relying on.
 */

export interface StoryChapterSummary {
  chapterId: string;
  itemTitle: string;
  slug: string;
  position: number;
  chapterTitle: string | null;
  status: string;
  contentHash: string | null;
  /** Per-kind counts of PUBLISHED, valid questions. */
  coverage: Record<QuestionKind, number>;
  totalQuestions: number;
  needsReview: number;
  stale: number;
  disabled: number;
  reports: number;
  lastJob: {
    status: string;
    attempts: number;
    errorCode: string | null;
    errorMessage: string | null;
    provider: string | null;
    model: string | null;
    candidateCount: number;
    acceptedCount: number;
    rejectedCount: number;
    costUsd: number | null;
    finishedAt: string | null;
  } | null;
}

export async function listStoryChapters(
  limit = 50,
): Promise<StoryChapterSummary[]> {
  await requireAdmin();

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch {
    // Without a service-role key the inspector has nothing to show; an empty
    // list is the honest rendering of that, not an error page.
    return [];
  }

  const { data: chapters } = await service
    .from("chapters")
    .select(
      "id, position, title, status, content_hash, library_items!inner(slug, title, owner_user_id)",
    )
    // PRIVATE IMPORTS ARE NOT AN ADMIN'S TO INSPECT.
    .is("library_items.owner_user_id", null)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = chapters ?? [];
  if (rows.length === 0) return [];

  const chapterIds = rows.map((row) => row.id);

  const [{ data: questions }, { data: jobs }, { data: reports }] = await Promise.all([
    service
      .from("chapter_questions")
      .select("id, chapter_id, kind, status, validation_status, source_content_hash")
      .in("chapter_id", chapterIds),
    service
      .from("chapter_generation_jobs")
      .select(
        "chapter_id, status, attempts, error_code, error_message, provider, model, candidate_count, accepted_count, rejected_count, cost_usd, finished_at, created_at",
      )
      .in("chapter_id", chapterIds)
      .order("created_at", { ascending: false }),
    service
      .from("chapter_question_reports")
      .select("question_id, chapter_questions!inner(chapter_id)")
      .in("chapter_questions.chapter_id", chapterIds),
  ]);

  const latestJob = new Map<string, NonNullable<typeof jobs>[number]>();
  for (const job of jobs ?? []) {
    if (!latestJob.has(job.chapter_id)) latestJob.set(job.chapter_id, job);
  }

  const reportsByChapter = new Map<string, number>();
  for (const report of reports ?? []) {
    const question = (Array.isArray(report.chapter_questions)
      ? report.chapter_questions[0]
      : report.chapter_questions) as { chapter_id: string } | null | undefined;
    if (!question) continue;
    reportsByChapter.set(
      question.chapter_id,
      (reportsByChapter.get(question.chapter_id) ?? 0) + 1,
    );
  }

  return rows.map((row) => {
    const item = (Array.isArray(row.library_items)
      ? row.library_items[0]
      : row.library_items) as { slug: string; title: string } | null | undefined;

    const own = (questions ?? []).filter((question) => question.chapter_id === row.id);
    const coverage = Object.fromEntries(
      QUESTION_KINDS.map((kind) => [
        kind,
        own.filter(
          (question) =>
            question.kind === kind &&
            question.status === "published" &&
            question.validation_status === "valid",
        ).length,
      ]),
    ) as Record<QuestionKind, number>;

    const job = latestJob.get(row.id);

    return {
      chapterId: row.id,
      itemTitle: item?.title ?? "",
      slug: item?.slug ?? "",
      position: row.position,
      chapterTitle: row.title,
      status: row.status,
      contentHash: row.content_hash,
      coverage,
      totalQuestions: own.length,
      needsReview: own.filter((question) => question.status === "needs_review").length,
      // A question written from content the chapter has since moved past. Kept
      // rather than deleted, and excluded from every Challenge.
      stale: own.filter(
        (question) =>
          question.status === "stale" ||
          question.source_content_hash !== row.content_hash,
      ).length,
      disabled: own.filter((question) => question.status === "disabled").length,
      reports: reportsByChapter.get(row.id) ?? 0,
      lastJob: job
        ? {
            status: job.status,
            attempts: job.attempts,
            errorCode: job.error_code,
            errorMessage: job.error_message,
            provider: job.provider,
            model: job.model,
            candidateCount: job.candidate_count,
            acceptedCount: job.accepted_count,
            rejectedCount: job.rejected_count,
            costUsd: job.cost_usd === null ? null : Number(job.cost_usd),
            finishedAt: job.finished_at,
          }
        : null,
    };
  });
}

/** One question of a public chapter, with its grounding, for review. */
export interface StoryQuestionDetail {
  id: number;
  kind: string;
  questionType: string;
  prompt: string;
  status: string;
  difficulty: number;
  generationSource: string;
  /** The sentences it was written from — the anti-hallucination check. */
  sourceSentences: string[];
  conceptCodes: string[];
  reportCount: number;
  answerCount: number;
  successRate: number | null;
}

export async function listChapterQuestions(
  chapterId: string,
): Promise<StoryQuestionDetail[]> {
  await requireAdmin();

  let service;
  try {
    service = createServiceRoleSupabaseClient();
  } catch {
    return [];
  }

  // The private-import exclusion is restated here rather than assumed from the
  // caller: this client bypasses RLS, so every query through it has to carry the
  // rule itself.
  const { data: chapter } = await service
    .from("chapters")
    .select("id, library_items!inner(owner_user_id)")
    .eq("id", chapterId)
    .is("library_items.owner_user_id", null)
    .maybeSingle();
  if (!chapter) return [];

  const { data: questions } = await service
    .from("chapter_questions")
    .select(
      "id, kind, question_type, prompt, status, difficulty, generation_source, source_sentence_ids",
    )
    .eq("chapter_id", chapterId)
    .order("kind", { ascending: true })
    .limit(100);

  const rows = questions ?? [];
  if (rows.length === 0) return [];

  const questionIds = rows.map((row) => row.id);
  const sentenceIds = [...new Set(rows.flatMap((row) => row.source_sentence_ids ?? []))];

  const [{ data: sentences }, { data: concepts }, { data: stats }, { data: reports }] =
    await Promise.all([
      sentenceIds.length > 0
        ? service.from("sentences").select("id, text").in("id", sentenceIds)
        : Promise.resolve({ data: [] as { id: number; text: string }[] }),
      service
        .from("chapter_question_concepts")
        .select("question_id, concept_code")
        .in("question_id", questionIds),
      service
        .from("chapter_question_stats")
        .select("question_id, answer_count, correct_count")
        .in("question_id", questionIds),
      service
        .from("chapter_question_reports")
        .select("question_id")
        .in("question_id", questionIds),
    ]);

  const sentenceText = new Map((sentences ?? []).map((row) => [row.id, row.text]));
  const conceptsByQuestion = new Map<number, string[]>();
  for (const row of concepts ?? []) {
    conceptsByQuestion.set(row.question_id, [
      ...(conceptsByQuestion.get(row.question_id) ?? []),
      row.concept_code,
    ]);
  }
  const statsByQuestion = new Map((stats ?? []).map((row) => [row.question_id, row]));
  const reportCounts = new Map<number, number>();
  for (const row of reports ?? []) {
    reportCounts.set(row.question_id, (reportCounts.get(row.question_id) ?? 0) + 1);
  }

  return rows.map((row) => {
    const stat = statsByQuestion.get(row.id);
    return {
      id: row.id,
      kind: row.kind,
      questionType: row.question_type,
      prompt: row.prompt,
      status: row.status,
      difficulty: row.difficulty,
      generationSource: row.generation_source,
      sourceSentences: (row.source_sentence_ids ?? [])
        .map((id) => sentenceText.get(id))
        .filter((text): text is string => Boolean(text)),
      conceptCodes: conceptsByQuestion.get(row.id) ?? [],
      reportCount: reportCounts.get(row.id) ?? 0,
      answerCount: stat?.answer_count ?? 0,
      // Shown to admins only. A learner seeing "68% get this wrong" would be
      // seeing a hint.
      successRate:
        stat && stat.answer_count > 0 ? stat.correct_count / stat.answer_count : null,
    };
  });
}
