import { Check } from "lucide-react";

import type { TodayPlanItem } from "@/actions/today-plan";
import { PLAN_ITEM_TITLE_PL, renderMinutes } from "@/lib/learning/planner/reasons";
import { planProgress } from "@/lib/learning/planner/routes";
import { cn } from "@/lib/utils";

/** Matches the geometry of `LevelRing`, so the two rings read as one family. */
const R = 40;
const STROKE = 8;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * „Twój cel na dziś" — the plan at a glance.
 *
 * THIS IS THE PLAN, NOT A SECOND ONE. The ring counts the same completed
 * activities `planProgress` counts for the list below, and the rows are the same
 * items in the same order. Today has two altitudes on purpose: this card answers
 * "how far am I?" in one look, and the list underneath carries the controls —
 * why each task is there and the skip button. Putting the controls up here would
 * make the glance a form; leaving the glance out made a five-task plan something
 * you had to read to the end to assess.
 *
 * EVERY ROW CARRIES ITS STATE, on the right. Five identical empty circles down
 * the left edge of a half-empty card is not a summary — it is a list of things
 * that have not happened, which is the least useful reading of a plan. The right
 * column says which one is under way ("3/8"), which is finished, which was set
 * aside and, for the rest, how long it is estimated to take: the same three
 * facts the list below spends a whole card each on. It is also what makes the
 * card fill its own width between `md` and `lg`, where it is the only thing in
 * the row.
 *
 * COMPLETED ONLY, like every other progress figure in the app. A skipped task is
 * resolved — the plan can finish without it — but it is not an achievement, and
 * letting it fill the ring would make "pomiń wszystko" look like a finished day.
 */
export function DailyGoalCard({
  items,
  className,
}: {
  items: readonly TodayPlanItem[];
  className?: string;
}) {
  const { done, total, percent } = planProgress(items);
  const offset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <section
      className={cn("app-panel rounded-xl p-5", className)}
      aria-labelledby="daily-goal-heading"
    >
      <h2 id="daily-goal-heading" className="text-base font-bold">
        Twój cel na dziś
      </h2>

      <div className="mt-5 flex items-center gap-5 sm:gap-6">
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <div className="relative" style={{ width: 96, height: 96 }}>
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
              <circle
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke="var(--color-card2)"
                strokeWidth={STROKE}
              />
              {/* No animation: the card is server-rendered and the number is a
                  fact about the day, not an event worth celebrating twice. */}
              <circle
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke="var(--color-gold)"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={offset}
              />
            </svg>
            {/* Two nested boxes, not one: `items-baseline` on the full-size
                absolute box would put the flex line at the TOP of the ring, so
                the count floated above the hole instead of sitting in it. The
                outer box centres, the inner one aligns the two sizes of type. */}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex items-baseline">
                <span className="text-3xl font-bold leading-none text-main">
                  {done}
                </span>
                <span className="text-base font-medium leading-none text-muted2">
                  /{total}
                </span>
              </span>
            </span>
          </div>
          {/* An empty ring at the start of the day needs a word, or it reads as
              a component that failed to load rather than as a day not yet begun. */}
          <span className="text-[0.625rem] font-medium uppercase tracking-wide text-muted2">
            ukończone
          </span>
        </div>

        <ul className="min-w-0 flex-1 space-y-0.5">
          {items.map((item) => {
            const completed = item.status === "completed";
            const skipped = item.status === "skipped";
            const started = !completed && !skipped && item.completedCount > 0;

            return (
              <li
                key={item.id}
                className="flex min-h-8 items-center gap-3 text-sm"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    completed && "border-gold bg-gold text-dark",
                    started && "border-gold text-gold",
                    !completed && !started && "border-border/80 text-transparent",
                  )}
                >
                  {started ? (
                    <span className="size-1.5 rounded-full bg-gold" />
                  ) : (
                    <Check className="size-3" strokeWidth={3} />
                  )}
                </span>

                <span
                  className={cn(
                    "truncate",
                    completed ? "font-medium text-main" : "text-muted2",
                    skipped && "line-through opacity-60",
                  )}
                  title={PLAN_ITEM_TITLE_PL[item.type]}
                >
                  {PLAN_ITEM_TITLE_PL[item.type]}
                </span>

                <span className="ml-auto shrink-0 text-xs tabular-nums">
                  <ItemState
                    completed={completed}
                    skipped={skipped}
                    started={started}
                    item={item}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="sr-only">
        Ukończono {done} z {total} zadań dzisiejszego planu.
      </p>
    </section>
  );
}

/**
 * The right-hand column: one fact per row, in the order a learner cares about.
 *
 * A started task's progress outranks its estimate — "3/8" is what you came back
 * for — and a finished or set-aside task has no estimate worth showing at all.
 * The minutes are the PLANNER'S estimate, never a measurement, which is why they
 * go through `renderMinutes` like every other minutes figure in the app.
 */
function ItemState({
  completed,
  skipped,
  started,
  item,
}: {
  completed: boolean;
  skipped: boolean;
  started: boolean;
  item: TodayPlanItem;
}) {
  if (completed) return <span className="font-medium text-green">Gotowe</span>;
  if (skipped) return <span className="text-muted2/60">Pominięte</span>;
  if (started) {
    return (
      <span className="font-medium text-gold">
        {item.completedCount}/{item.targetCount}
      </span>
    );
  }
  return <span className="text-muted2/80">{renderMinutes(item.estimatedMinutes)}</span>;
}
