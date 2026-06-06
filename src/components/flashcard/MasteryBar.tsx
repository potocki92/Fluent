import { masteryProgress } from "@/lib/sm2";
import { cn } from "@/lib/utils";

/**
 * A thin progress bar showing how close a card is to mastery (interval ≥ 21
 * days). Shared by the flashcard and quiz sessions so the learner can see words
 * climbing toward "opanowane".
 */
export function MasteryBar({
  interval,
  className,
}: {
  interval: number;
  className?: string;
}) {
  const pct = Math.round(masteryProgress(interval) * 100);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex justify-between text-xs text-muted2">
        <span>Do opanowania</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-green/20">
        <div
          className="h-full rounded-full bg-green transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
