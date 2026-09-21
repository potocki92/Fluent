import Link from "next/link";
import { BookMarked, BookOpen, CheckCircle2, Loader2, Lock } from "lucide-react";

import { MaterialCover } from "@/components/library/MaterialCover";
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
 *
 * THE TILE IS THE MATERIAL'S PICTURE where it has one, and the state icon where
 * it does not. Both occupy the SAME 4:3 box, so a shelf of ten items keeps one
 * rhythm instead of jumping a few pixels per row depending on which of them an
 * admin has got round to illustrating. Nothing is lost by replacing the icon:
 * „przeczytane w całości", the progress bar and „przygotowuję rozdziały…" all
 * say in words what the icon said in a glyph — except while a private import is
 * still processing, which keeps its spinner because that one IS the only signal
 * that something is happening (and an import has no cover anyway).
 */
export function LibraryItemCard({ entry }: { entry: ShelfEntry }) {
  const percent = Math.round(entry.progressRatio * 100);
  const finished = entry.chapterCount > 0 && entry.completedChapters >= entry.chapterCount;
  const started = percent > 0 && !finished;
  const preparing = entry.status === "processing";
  const isPrivate = entry.rights === "private_import";

  return (
    <Link
      href={`/library/${entry.slug}`}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-gold/50"
    >
      <div className="flex items-start gap-3">
        <MaterialCover
          coverUrl={preparing ? null : entry.coverUrl}
          sizes="64px"
          className="h-12 w-16 rounded-lg border border-border/60"
          fallback={
            <span className="flex size-full items-center justify-center bg-[#374151] text-gold">
              {preparing ? (
                <Loader2 className="size-5 animate-spin" />
              ) : finished ? (
                <CheckCircle2 className="size-5" />
              ) : started ? (
                <BookMarked className="size-5" />
              ) : (
                <BookOpen className="size-5" />
              )}
            </span>
          }
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-semibold leading-snug text-main">
              {entry.title}
            </h3>
            {entry.cefr && (
              <Badge className="shrink-0 bg-gold text-[#1a202c]">{entry.cefr}</Badge>
            )}
          </div>

          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted2">
            {/* A private import is marked, quietly. It is the one thing about a
                book on this shelf that changes who can see it. */}
            {isPrivate && <Lock className="size-3 shrink-0" aria-label="Prywatna" />}
            <span className="truncate">
              {[
                TYPE_LABEL_PL[entry.contentType],
                entry.author,
                entry.chapterCount > 1 ? `${entry.chapterCount} rozdziałów` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>

          {preparing && (
            <p className="mt-2 text-xs text-gold">Przygotowuję rozdziały…</p>
          )}

          {!preparing && started && (
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
