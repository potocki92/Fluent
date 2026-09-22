import { masteryProgress } from "@/lib/sm2";
import { cn } from "@/lib/utils";

/**
 * A thin progress bar showing how close a card is to mastery (interval ≥ 21
 * days). Shared by the flashcard and quiz sessions so the learner can see words
 * climbing toward "opanowane".
 *
 * 23px, LABEL AND BAR TOGETHER (§21). On the review screen every row that is
 * not the flashcard competes with the flashcard for the same pixels, so the
 * half-leading around a 12px label is not free space — it is card height.
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
    <div className={cn("space-y-0.5", className)}>
      <div className="flex justify-between text-xs leading-tight text-muted2">
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
