import Link from "next/link";
import { ArrowRight, CalendarClock, PartyPopper } from "lucide-react";

import type { TodayPlanItem } from "@/actions/today-plan";
import { PLAN_ITEM_CATEGORY_PL, renderReason } from "@/lib/learning/planner/reasons";
import { planItemHref } from "@/lib/learning/planner/routes";
import { planItemLabel } from "@/lib/learning/planner/summary";
import { PLAN_ITEM_ICONS } from "@/components/today/planIcons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * „Kontynuuj naukę" — the one thing to do next, and the button that starts it.
 *
 * THE PRIMARY ACTION OF THE WHOLE SCREEN. Today already knew which activity came
 * next (`nextPlanItem`); what it did not have was somewhere to SAY it. A bare
 * full-width button labelled "Kontynuuj naukę" with "Następne: Powtórki" under
 * it is a button, not an invitation — this card names the material, says why it
 * is being offered, and keeps one destination, which is the same href the row in
 * the plan below points at.
 *
 * THE THUMBNAIL IS NOT A COVER. Fluent has no cover art — a book is text plus
 * positions (`reader-story-engine.md`), and inventing an image would mean
 * inventing a promise. So the tile is the activity's own icon on a warm ground:
 * it gives the card its shape without claiming to be a picture of anything.
 */
export function ContinueCard({
  item,
  isComplete,
  className,
}: {
  /** The next unfinished activity, or null when the day is done or all skipped. */
  item: TodayPlanItem | null;
  /** Finished, as opposed to emptied by skipping — two different sentences. */
  isComplete: boolean;
  className?: string;
}) {
  if (!item) return <DayDone isComplete={isComplete} className={className} />;

  const Icon = PLAN_ITEM_ICONS[item.type];
  const label = planItemLabel(item);
  const reason = renderReason({ code: item.reasonCode, data: item.reasonData });

  // The kicker names the KIND of work; the line under it names the material. For
  // an activity the plan snapshotted no title for — a review queue is not "a
  // text" — those two collapse onto the same word, and „Powtórki / Powtórki" is
  // a card that says one thing twice. Then the kind is the only thing there is
  // to say, so the card says it once, as the title.
  const category = PLAN_ITEM_CATEGORY_PL[item.type] ?? "Nauka";
  const kicker = category === label ? null : category;

  return (
    <section
      className={cn("app-panel rounded-xl p-5", className)}
      aria-labelledby="continue-card-heading"
    >
      <h2 id="continue-card-heading" className="text-base font-bold">
        Kontynuuj naukę
      </h2>

      <div className="mt-4 flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gold/20 to-blue/10 text-gold sm:size-16"
        >
          <Icon className="size-6" />
        </span>

        <div className="min-w-0 flex-1">
          {kicker && (
            <p className="text-xs font-medium uppercase tracking-wide text-gold">
              {kicker}
            </p>
          )}
          <p className="truncate text-lg font-semibold" title={label}>
            {label}
          </p>
          <p className="truncate text-xs text-muted2" title={reason}>
            {reason}
          </p>
        </div>

        <Button
          asChild
          className="hidden shrink-0 rounded-full bg-gold px-5 text-dark hover:bg-gold-dark sm:inline-flex"
        >
          <Link href={planItemHref(item)}>
            Kontynuuj
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>

      {/* On a phone the button owns its own line: squeezed next to a title it
          becomes a 60px target with a truncated label. */}
      <Button
        asChild
        className="mt-4 w-full rounded-full bg-gold text-dark hover:bg-gold-dark sm:hidden"
      >
        <Link href={planItemHref(item)}>
          Kontynuuj
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}

/**
 * Nothing left to continue — and WHY there is nothing left matters.
 *
 * A finished plan and an emptied one are not the same day. `sync_daily_plan`
 * leaves an all-skipped plan `in_progress` on purpose: a day of skipping is not
 * a day of learning, and Planner V1 does not refill the slots. So the skipped
 * case says the true thing — the plan comes back tomorrow — rather than
 * congratulating anyone.
 *
 * Either way the honest card is not a disabled button: Today is a
 * recommendation, never a cage, so the two activities that never need a plan
 * stay one tap away.
 */
function DayDone({
  isComplete,
  className,
}: {
  isComplete: boolean;
  className?: string;
}) {
  return (
    <section className={cn("app-panel rounded-xl p-5", className)}>
      <h2 className="text-base font-bold">
        {isComplete ? "Na dziś to wszystko" : "Wszystkie zadania odłożone"}
      </h2>
      <div className="mt-4 flex items-center gap-4">
        <span
          aria-hidden
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-lg sm:size-16",
            isComplete ? "bg-green/10 text-green" : "bg-secondary text-muted2",
          )}
        >
          {isComplete ? (
            <PartyPopper className="size-6" />
          ) : (
            <CalendarClock className="size-6" />
          )}
        </span>
        <p className="min-w-0 flex-1 text-sm text-muted2">
          {isComplete
            ? "Plan na dziś jest zamknięty. Jeśli masz ochotę, możesz uczyć się dalej bez planu."
            : "Nowy plan przygotujemy jutro. Jeśli masz chwilę, możesz uczyć się dalej bez planu."}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="secondary" className="rounded-full">
          <Link href="/review">Dodatkowe powtórki</Link>
        </Button>
        <Button asChild size="sm" variant="secondary" className="rounded-full">
          <Link href="/library">Przeczytaj coś jeszcze</Link>
        </Button>
      </div>
    </section>
  );
}
