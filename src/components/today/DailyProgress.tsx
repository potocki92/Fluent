import { Progress } from "@/components/ui/progress";

/**
 * "3 z 4 ukończone" plus the bar.
 *
 * Counts COMPLETED activities only. A skipped task is resolved — the plan can
 * finish without it — but it is not an achievement, and letting it fill the bar
 * would make "pomiń wszystko" look like a finished day.
 */
export function DailyProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  const percent = Math.round((done / total) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted2">
          {done} z {total} ukończone
        </span>
        <span className="font-medium text-muted2">{percent}%</span>
      </div>
      <Progress
        value={percent}
        aria-label={`Postęp dzisiejszego planu: ${done} z ${total}`}
      />
    </div>
  );
}
