"use client";

import { QuestionForm } from "@/components/admin/QuestionForm";
import { QuestionList } from "@/components/admin/QuestionList";
import { useAdminQuestions } from "@/hooks/useAdminQuestions";

export function QuestionManager({ textId }: { textId: number }) {
  const { data: questions, isLoading, error } = useAdminQuestions(textId);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold">Pytania</h2>

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać pytań.</p>
      )}

      {questions && <QuestionList textId={textId} questions={questions} />}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-main">Nowe pytanie</h3>
        <QuestionForm textId={textId} mode="create" />
      </div>
    </section>
  );
}
