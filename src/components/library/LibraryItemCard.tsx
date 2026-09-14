import Link from "next/link";
import { BookMarked, BookOpen, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { ShelfEntry } from "@/lib/library/queries";

const TYPE_LABEL_PL: Readonly<Record<ShelfEntry["contentType"], string>> = {
  story: "Opowiadanie",
  book: "Książka",
  article: "Artykuł",
  lesson: "Tekst",
};

/**
 * One item on the shelf.
 *
 * The progress bar is WORD-WEIGHTED (see `itemProgressRatio`), not
 * chapters-done-over-chapters: a book whose first chapter is 500 words and whose
 * second is 20 000 would otherwise report 50% after ten minutes, and a progress
 * number that flatters is a progress number nobody trusts twice.
 */
export function LibraryItemCard({ entry }: { entry: ShelfEntry }) {
  const percent = Math.round(entry.progressRatio * 100);
  const finished = entry.chapterCount > 0 && entry.completedChapters >= entry.chapterCount;
  const started = percent > 0 && !finished;

  return (
    <Link
      href={`/library/${entry.slug}`}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-gold/50"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#374151] text-gold">
          {finished ? (
            <CheckCircle2 className="size-5" />
          ) : started ? (
            <BookMarked className="size-5" />
          ) : (
            <BookOpen className="size-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-semibold leading-snug text-main">
              {entry.title}
            </h3>
            {entry.cefr && (
              <Badge className="shrink-0 bg-gold text-[#1a202c]">{entry.cefr}</Badge>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-muted2">
            {[
              TYPE_LABEL_PL[entry.contentType],
              entry.author,
              entry.chapterCount > 1 ? `${entry.chapterCount} rozdziałów` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {started && (
            <div className="mt-2.5 space-y-1">
              <Progress value={percent} />
              <p className="text-xs text-muted2">
                {percent}% · rozdział {entry.resumeChapterPosition ?? 1}
              </p>
            </div>
          )}
          {finished && (
            <p className="mt-2 text-xs text-green">Przeczytane w całości</p>
          )}
        </div>
      </div>
    </Link>
  );
}
