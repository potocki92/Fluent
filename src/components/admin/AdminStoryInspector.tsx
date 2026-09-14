"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Flag, Loader2, RefreshCw } from "lucide-react";

import { generateChapterQuestions } from "@/actions/admin-chapter-questions";
import {
  listChapterQuestions,
  type StoryChapterSummary,
  type StoryQuestionDetail,
} from "@/actions/admin-story";
import { QUESTION_KINDS } from "@/lib/story/constants";
import { cn } from "@/lib/utils";

/**
 * The Story Inspector.
 *
 * ANSWERS ONE QUESTION PER ROW: can this chapter run a Challenge, and if not,
 * why not. Everything on screen serves that — the per-kind counts (because a
 * bank with no comprehension questions cannot satisfy the blueprint's floor),
 * the stale count (because a reprocessed chapter invalidates its own questions),
 * the reports (because only a reader catches "both of these are right"), and the
 * last job's rejections (because a bad prompt shows up as a pattern).
 *
 * NOT A CMS. There is no editor: a question an admin can retype is a question
 * that no longer matches the validation it passed. Approve, disable, regenerate
 * — three verbs, and the pipeline owns the rest.
 */
export function AdminStoryInspector({
  chapters,
}: {
  chapters: readonly StoryChapterSummary[];
}) {
  if (chapters.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted2">
        Brak przetworzonych rozdziałów. Najpierw przetwórz treść w sekcji
        Biblioteka.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {chapters.map((chapter) => (
        <ChapterCard key={chapter.chapterId} chapter={chapter} />
      ))}
    </div>
  );
}

function ChapterCard({ chapter }: { chapter: StoryChapterSummary }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [questions, setQuestions] = useState<StoryQuestionDetail[] | null>(null);

  const publishable =
    chapter.coverage.comprehension >= 2 && chapter.totalQuestions >= 4;

  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {chapter.itemTitle} · {chapter.chapterTitle ?? `Rozdział ${chapter.position}`}
          </p>
          <p className="mt-0.5 text-xs text-muted2">
            <Link
              href={`/library/${chapter.slug}/${chapter.position}`}
              className="underline-offset-2 hover:underline"
            >
              /library/{chapter.slug}/{chapter.position}
            </Link>
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await generateChapterQuestions(chapter.chapterId);
              setMessage(
                result.ok
                  ? result.refusal
                    ? `Brak generatora: ${result.refusal}`
                    : `${result.acceptedCount} przyjętych, ${result.rejectedCount} odrzuconych, ${result.duplicateCount} duplikatów`
                  : result.message,
              );
            })
          }
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:border-gold/60 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Generuj
        </button>
      </header>

      <dl className="grid grid-cols-4 gap-2 text-xs">
        {QUESTION_KINDS.map((kind) => (
          <div key={kind} className="rounded-lg bg-[#374151]/40 px-2 py-1.5">
            <dt className="text-[11px] text-muted2">{KIND_LABEL[kind]}</dt>
            <dd
              className={cn(
                "mt-0.5 font-semibold tabular-nums",
                kind === "comprehension" &&
                  chapter.coverage.comprehension < 2 &&
                  "text-red",
              )}
            >
              {chapter.coverage[kind]}
            </dd>
          </div>
        ))}
      </dl>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted2">
        <span>{chapter.totalQuestions} pytań łącznie</span>
        {chapter.needsReview > 0 && (
          <span className="text-gold">{chapter.needsReview} do przeglądu</span>
        )}
        {chapter.stale > 0 && (
          <span className="flex items-center gap-1 text-red">
            <AlertTriangle className="size-3" /> {chapter.stale} nieaktualnych
          </span>
        )}
        {chapter.disabled > 0 && <span>{chapter.disabled} wyłączonych</span>}
        {chapter.reports > 0 && (
          <span className="flex items-center gap-1 text-red">
            <Flag className="size-3" /> {chapter.reports} zgłoszeń
          </span>
        )}
        {!publishable && (
          <span className="text-red">
            Zbyt mało pytań o fabułę — wyzwanie nie zostanie zaproponowane
          </span>
        )}
      </p>

      {chapter.lastJob && (
        <p className="text-xs text-muted2">
          Ostatnie generowanie: {chapter.lastJob.status}
          {chapter.lastJob.attempts > 1 && ` · ${chapter.lastJob.attempts} prób`}
          {chapter.lastJob.provider && ` · ${chapter.lastJob.provider}`}
          {chapter.lastJob.model && `/${chapter.lastJob.model}`}
          {chapter.lastJob.candidateCount > 0 &&
            ` · ${chapter.lastJob.acceptedCount}/${chapter.lastJob.candidateCount} przyjętych`}
          {chapter.lastJob.costUsd !== null &&
            ` · $${chapter.lastJob.costUsd.toFixed(4)}`}
          {chapter.lastJob.errorCode && ` · błąd: ${chapter.lastJob.errorCode}`}
        </p>
      )}

      {message && <p className="text-xs text-gold">{message}</p>}

      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setQuestions(
              questions === null ? await listChapterQuestions(chapter.chapterId) : null,
            );
          })
        }
        className="text-xs text-muted2 underline-offset-2 transition-colors hover:text-main hover:underline"
      >
        {questions === null ? "Pokaż pytania" : "Ukryj pytania"}
      </button>

      {questions !== null && questions.length > 0 && (
        <ol className="space-y-2 border-t border-border pt-3">
          {questions.map((question) => (
            <li key={question.id} className="space-y-1 text-xs">
              <p className="font-medium">{question.prompt}</p>
              <p className="text-muted2">
                {KIND_LABEL[question.kind as keyof typeof KIND_LABEL] ?? question.kind} ·{" "}
                {question.questionType} · {question.status} · trudność{" "}
                {question.difficulty}
                {question.conceptCodes.length > 0 &&
                  ` · ${question.conceptCodes.join(", ")}`}
                {question.answerCount > 0 &&
                  question.successRate !== null &&
                  ` · ${Math.round(question.successRate * 100)}% poprawnych z ${question.answerCount}`}
                {question.reportCount > 0 && ` · ${question.reportCount} zgłoszeń`}
              </p>
              {/* SOURCE GROUNDING, shown verbatim. This is the check that
                  catches a model inventing chapter content: if the question
                  cannot be answered from these sentences, it is wrong. */}
              {question.sourceSentences.length > 0 && (
                <p className="rounded bg-[#374151]/40 px-2 py-1 italic text-muted2" lang="de">
                  {question.sourceSentences.join(" ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  comprehension: "Fabuła",
  contextual_vocabulary: "Słownictwo",
  grammar: "Gramatyka",
  transfer: "Transfer",
};
