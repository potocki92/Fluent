import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BodyContent } from "@/components/texts/BodyContent";
import { CEFR_COLORS } from "@/lib/cefr";
import { cn } from "@/lib/utils";
import type { QuestionWithAnswer, Text } from "@/types";

/**
 * Admin-only preview: the passage as a learner sees it (no 5s read-gate) plus
 * the questions with the correct answer highlighted — for verifying the answer
 * key before publishing.
 */
export function AdminPreview({
  text,
  questions,
}: {
  text: Text;
  questions: QuestionWithAnswer[];
}) {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">
            {text.title}
          </h1>
          <Badge className={cn("border-0", CEFR_COLORS[text.cefr])}>
            {text.cefr}
          </Badge>
          <Badge
            className={cn(
              "border-0",
              text.status === "published"
                ? "bg-gold text-[#1a202c]"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {text.status === "published" ? "Opublikowany" : "Szkic"}
          </Badge>
        </div>
        <p className="text-xs text-muted2">{text.word_count ?? 0} słów</p>
      </header>

      <BodyContent body={text.body} />

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Pytania</h2>
        {questions.length === 0 ? (
          <p className="text-sm text-muted2">Brak pytań do tego tekstu.</p>
        ) : (
          <ol className="space-y-3">
            {questions.map((question, index) => (
              <li
                key={question.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <p className="font-medium text-main">
                  {index + 1}. {question.prompt}
                </p>
                <ul className="mt-2 space-y-1">
                  {question.options.map((option, idx) => {
                    const correct = idx === question.correct_idx;
                    return (
                      <li
                        key={idx}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                          correct
                            ? "bg-green-900/30 text-green-300"
                            : "text-muted2",
                        )}
                      >
                        {correct ? (
                          <Check className="size-4 shrink-0" />
                        ) : (
                          <span className="inline-block size-4 shrink-0" />
                        )}
                        <span>{option}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
