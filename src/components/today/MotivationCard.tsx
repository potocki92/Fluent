import { Quote } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The quiet card.
 *
 * It holds one sentence and no action, which is the whole of its job: a dashboard
 * where every surface demands something is exhausting to open every morning, and
 * the grid needs somewhere for the eye to rest before the day's tasks.
 *
 * THE SENTENCE IS FIXED, AND HONEST. It is a statement about how learning works,
 * not a compliment about the learner — Fluent does not have the evidence to pay
 * a personalised compliment, and a rotating quote generator would be a feature
 * with its own content problem. One true line, always the same, costs nothing
 * and never says something the data contradicts.
 */
export function MotivationCard({ className }: { className?: string }) {
  return (
    <section
      className={cn(
        "app-panel relative flex min-h-[11rem] flex-col justify-center overflow-hidden rounded-xl p-6",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-16 size-64 rounded-full bg-blue/5 blur-2xl"
      />
      <Quote className="relative size-6 text-gold/70" aria-hidden />
      <p className="relative mt-4 max-w-[22rem] text-pretty text-xl font-semibold leading-snug text-main sm:text-2xl">
        Systematyczność zawsze wygrywa.
      </p>
    </section>
  );
}
