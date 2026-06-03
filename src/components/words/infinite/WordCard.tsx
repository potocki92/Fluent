import { CEFR_COLORS } from "@/lib/cefr";
import { cn } from "@/lib/utils";
import type { Word } from "@/lib/queries/words";

/** Article colour: der → blue, die → pink, das → green. */
const ARTICLE_COLOR: Record<"der" | "die" | "das", string> = {
  der: "text-blue",
  die: "text-pink-400",
  das: "text-green",
};

export function WordCard({ word }: { word: Word }) {
  return (
    <article className="flex items-center gap-3 rounded-xl bg-card p-4">
      {word.article && (
        <span
          className={cn(
            "w-8 shrink-0 text-sm font-semibold",
            ARTICLE_COLOR[word.article],
          )}
        >
          {word.article}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-foreground">
          {word.lemma}
        </p>
        {word.translation_pl && (
          <p className="truncate text-sm text-muted-foreground">
            {word.translation_pl}
          </p>
        )}
      </div>

      {word.cefr && (
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
            CEFR_COLORS[word.cefr],
          )}
        >
          {word.cefr}
        </span>
      )}
    </article>
  );
}
