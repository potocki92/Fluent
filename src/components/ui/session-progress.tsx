"use client";

import { cn } from "@/lib/utils";

/**
 * "Pytanie 3/5" and the row of dots beside it.
 *
 * Extracted because the reading test and the weakness drill had the same
 * fourteen lines twice, down to the three literal hex colours — and they had
 * already drifted: one wrapped the dots in `aria-hidden`, the other did not, so
 * a screen reader read "bullet bullet bullet bullet bullet" after the sentence
 * that already said which question it was on.
 *
 * The dots are decoration. The count above them is the accessible name, which
 * is why this owns the `aria-hidden` rather than leaving it to each caller.
 */
export function SessionProgress({
  index,
  total,
  /** True while the current question's verdict is showing — it counts as done. */
  answered = false,
  className,
}: {
  index: number;
  total: number;
  answered?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <p className="text-sm font-medium text-muted2">
        Pytanie {index + 1}/{total}
      </p>
      <div className="flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-2 rounded-full",
              i < index || (i === index && answered)
                ? "bg-gold"
                : i === index
                  ? "bg-muted-foreground"
                  : "bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}
