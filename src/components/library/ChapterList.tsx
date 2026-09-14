import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Clock, Lock } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { ChapterWithProgress } from "@/lib/library/queries";
import { cn } from "@/lib/utils";

/**
 * Every chapter, in order, and none of them locked.
 *
 * A learner who wants to read chapter 8 first is allowed to: this is a reading
 * app, not a course with prerequisites, and gating chapters would buy nothing
 * except the certainty that someone bounces off the one they wanted. The only
 * unopenable rows are the ones that genuinely have no content yet — a chapter
 * the pipeline has not processed, which shows as such rather than as a dead
 * link.
 *
 * READING AND LEARNING ARE SHOWN SEPARATELY. A chapter can be read and not yet
 * assessed, and collapsing that into one tick would hide the only thing the row
 * still has to say. The two live side by side rather than as one percentage,
 * because a single number made of both would mean neither.
 */
export function ChapterList({
  slug,
  chapters,
  learningState,
}: {
  slug: string;
  chapters: readonly ChapterWithProgress[];
  /** chapter id → lifecycle status, for the "wyzwanie czeka" marker. */
  learningState?: ReadonlyMap<string, string>;
}) {
  if (chapters.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
        Rozdziały
      </h2>
      <ol className="space-y-2">
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <ChapterRow
              slug={slug}
              chapter={chapter}
              lifecycle={learningState?.get(chapter.id)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChapterRow({
  slug,
  chapter,
  lifecycle,
}: {
  slug: string;
  chapter: ChapterWithProgress;
  lifecycle?: string;
}) {
  const percent = Math.round(chapter.progressRatio * 100);
  const done = chapter.completedAt !== null;
  const ready = chapter.status === "ready";
  const challengeOpen =
    done && lifecycle !== undefined && lifecycle !== "completed";

  const body = (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums",
          done ? "bg-green/15 text-green" : "bg-[#374151] text-muted2",
        )}
      >
        {done ? <CheckCircle2 className="size-4" /> : chapter.position}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", !ready && "text-muted2")}>
          {chapter.title ?? `Rozdział ${chapter.position}`}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted2">
          {ready ? (
            <>
              <Clock className="size-3" />
              {chapter.estimatedMinutes} min
              {chapter.wordCount > 0 &&
                ` · ${chapter.wordCount.toLocaleString("pl-PL")} słów`}
            </>
          ) : (
            <>
              <Lock className="size-3" /> W przygotowaniu
            </>
          )}
        </p>
        {ready && !done && percent > 0 && (
          <div className="mt-1.5">
            <Progress value={percent} />
          </div>
        )}
        {challengeOpen && (
          <p className="mt-1 flex items-center gap-1 text-xs text-gold">
            <ClipboardCheck className="size-3" /> Wyzwanie czeka
          </p>
        )}
      </div>
    </div>
  );

  if (!ready) {
    return (
      <div className="rounded-xl border border-dashed border-border p-3 opacity-70">
        {body}
      </div>
    );
  }

  return (
    <Link
      // A finished chapter with an open Challenge links to the Challenge: the
      // learner has read it, and re-opening the prose is not what the row is
      // offering them.
      href={
        challengeOpen
          ? `/library/${slug}/${chapter.position}/wyzwanie`
          : `/library/${slug}/${chapter.position}`
      }
      className="block rounded-xl border border-border bg-card p-3 transition-colors hover:border-gold/50"
    >
      {body}
    </Link>
  );
}
