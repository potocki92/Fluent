import { Check } from "lucide-react";

import type { TodayPlanItem } from "@/actions/today-plan";
import { PLAN_ITEM_TITLE_PL } from "@/lib/learning/planner/reasons";
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
 * why each task is there, how long it should take, and the skip button. Putting
 * the controls up here would make the glance a form; leaving the glance out made
 * a five-task plan something you had to read to the end to assess.
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

      <div className="mt-4 flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: 84, height: 84 }}>
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
            <circle
              cx={50}
              cy={50}
              r={R}
              fill="none"
              stroke="var(--color-card2)"
              strokeWidth={STROKE}
            />
            {/* No animation here: the card is server-rendered and the number is
                a fact about the day, not an event worth celebrating twice. */}
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
          <span className="absolute inset-0 flex items-baseline justify-center">
            <span className="text-2xl font-bold text-main">{done}</span>
            <span className="text-sm font-medium text-muted2">/{total}</span>
          </span>
        </div>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {items.map((item) => {
            const completed = item.status === "completed";
            const skipped = item.status === "skipped";
            return (
              <li key={item.id} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    completed
                      ? "border-gold bg-gold text-dark"
                      : "border-border text-transparent",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span
                  className={cn(
                    "truncate",
                    completed ? "text-main" : "text-muted2",
                    skipped && "line-through opacity-60",
                  )}
                >
                  {PLAN_ITEM_TITLE_PL[item.type]}
                </span>
                {/* The count is the only number a glance needs: "3 / 8 słówek"
                    is progress, "in_progress" is a status nobody asked about. */}
                {!completed && item.completedCount > 0 && (
                  <span className="ml-auto shrink-0 text-xs font-medium text-gold">
                    {item.completedCount}/{item.targetCount}
                  </span>
                )}
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
