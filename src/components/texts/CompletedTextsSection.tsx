import { useMemo } from "react";
import { CheckCircle2 } from "lucide-react";

import { TextCard } from "@/components/texts/TextCard";
import type { Text, TextCompletion } from "@/types";

/**
 * The "read & passed" shelf on the learn page: every text the learner finished
 * with a passing score, newest first. Passed texts are removed from the main
 * list and gathered here so finished work stays visible without cluttering the
 * "what to read next" view. Renders nothing when there is nothing passed yet.
 */
export function CompletedTextsSection({
  texts,
  completionsByTextId,
}: {
  texts: Text[];
  completionsByTextId: Map<number, TextCompletion>;
}) {
  const passed = useMemo(() => {
    return texts
      .map((text) => ({ text, completion: completionsByTextId.get(text.id) }))
      .filter(
        (
          entry,
        ): entry is { text: Text; completion: TextCompletion } =>
          entry.completion?.passed ?? false,
      )
      .sort(
        (a, b) =>
          new Date(b.completion.completed_at).getTime() -
          new Date(a.completion.completed_at).getTime(),
      );
  }, [texts, completionsByTextId]);

  if (passed.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted2">
        <CheckCircle2 className="size-3.5 text-green" />
        Przeczytane i dobrze rozwiązane
      </h2>
      <div className="space-y-3">
        {passed.map(({ text, completion }) => (
          <TextCard key={text.id} text={text} completion={completion} />
        ))}
      </div>
    </section>
  );
}
