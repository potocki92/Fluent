import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarClock, PartyPopper } from "lucide-react";

import type { TodayPlanItem } from "@/actions/today-plan";
import { planItemArtwork, type MaterialArtwork } from "@/lib/library/artwork";
import { PLAN_ITEM_CATEGORY_PL, renderReason } from "@/lib/learning/planner/reasons";
import { planItemHref } from "@/lib/learning/planner/routes";
import { planItemLabel } from "@/lib/learning/planner/summary";
import { PLAN_ITEM_ICONS } from "@/components/today/planIcons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * How wide the thumbnail is rendered, so `next/image` fetches that and not a
 * 4000 px original. Both layers below declare the SAME `sizes` deliberately —
 * see {@link CardArtwork}.
 */
const ARTWORK_SIZES = "(min-width: 640px) 104px, 76px";

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
 * THE THUMBNAIL IS THE MATERIAL, WHEN THERE IS ONE. Material artwork now exists
 * — an admin attaches it to a text and it is stored once, on the library item
 * (`src/lib/library/artwork.ts`) — so a reading task shows the picture of what
 * you are about to read, and a learner recognises yesterday's café story without
 * reading a word. Everything else keeps the icon it always had: „Powtórki" is a
 * deck, not a material, and a stock photograph of one would be decoration
 * pretending to be information. A material with no artwork, a URL that no longer
 * resolves, or a non-reading activity all land on the same fallback —
 * `PLAN_ITEM_ICONS` on its warm ground.
 *
 * IT HOLDS NO AUTHORITY AND FETCHES NOTHING. The artwork arrives as a prop,
 * resolved on the server next to the plan; a Supabase query between two pieces
 * of JSX would make this card impossible to render anywhere else.
 */
export function ContinueCard({
  item,
  isComplete,
  artwork,
  className,
}: {
  /** The next unfinished activity, or null when the day is done or all skipped. */
  item: TodayPlanItem | null;
  /** Finished, as opposed to emptied by skipping — two different sentences. */
  isComplete: boolean;
  /** The material's picture, where the activity has a material and it has one. */
  artwork?: MaterialArtwork | null;
  className?: string;
}) {
  if (!item) return <DayDone isComplete={isComplete} className={className} />;

  const Icon = PLAN_ITEM_ICONS[item.type];
  const label = planItemLabel(item);
  const reason = renderReason({ code: item.reasonCode, data: item.reasonData });
  // The last word on whether a picture is shown, and it re-checks the activity's
  // type rather than trusting the caller — see `planItemArtwork`.
  const cover = planItemArtwork(item, artwork);

  // The kicker names the KIND of work; the line under it names the material. For
  // an activity the plan snapshotted no title for — a review queue is not "a
  // text" — those two collapse onto the same word, and „Powtórki / Powtórki" is
  // a card that says one thing twice. Then the kind is the only thing there is
  // to say, so the card says it once, as the title.
  const category = PLAN_ITEM_CATEGORY_PL[item.type] ?? "Nauka";
  const kicker = category === label ? null : category;

  return (
    <section
      className={cn("app-panel relative overflow-hidden rounded-xl p-5", className)}
      aria-labelledby="continue-card-heading"
    >
      {cover && <CardAmbience url={cover.url} />}

      <h2
        id="continue-card-heading"
        className="relative z-10 text-base font-bold"
      >
        Kontynuuj naukę
      </h2>

      <div className="relative z-10 mt-4 flex items-center gap-4">
        {cover ? (
          <CardArtwork url={cover.url} />
        ) : (
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gold/20 to-blue/10 text-gold sm:size-16"
          >
            <Icon className="size-6" />
          </span>
        )}

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
        className="relative z-10 mt-4 w-full rounded-full bg-gold text-dark hover:bg-gold-dark sm:hidden"
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
 * The material's picture, at the size it is actually rendered.
 *
 * 4:3 ON A DESKTOP, SQUARE ON A PHONE, and neither may push the card wider than
 * the screen: `shrink-0` fixes the tile, the text next to it owns `min-w-0`, and
 * the truncation stays where it already was. A 104 px tile and a 96-character
 * German title on a 375 px screen is the case this layout is measured against.
 *
 * DECORATIVE, so `alt=""`. The picture repeats what the title beside it already
 * says; describing it again would make a screen reader announce the same
 * material twice, and there is no information in it a learner could otherwise
 * miss.
 *
 * ABOVE THE FOLD, so it loads eagerly rather than waiting to be scrolled into
 * view — but not `preload`: the LCP element on Today is the card's own text, and
 * Next 16 deprecated `priority` precisely because "important" and "preload in
 * the head" are different claims.
 */
function CardArtwork({ url }: { url: string }) {
  return (
    <span className="relative block size-[76px] shrink-0 overflow-hidden rounded-xl border border-border/80 sm:h-[78px] sm:w-[104px]">
      <Image
        src={url}
        alt=""
        fill
        sizes={ARTWORK_SIZES}
        loading="eager"
        fetchPriority="high"
        className="object-cover"
      />
    </span>
  );
}

/**
 * The same picture again, as atmosphere.
 *
 * WHY IT IS BARELY THERE. The card's job is to be read and tapped; the artwork's
 * job is to make it recognisable. So the image sits on the right at a tenth of
 * its opacity under a gradient that is fully the panel colour on the left, and
 * the text above it never loses contrast. On a phone it is fainter still and
 * narrower — a small screen is mostly text, and there is no room to spend on
 * atmosphere at the cost of legibility.
 *
 * IT COSTS NO EXTRA REQUEST. It declares the same `sizes` as the thumbnail, so
 * `next/image` resolves both to the same optimized URL and the browser fetches
 * it once. The blur is what makes a 104 px source look deliberate rather than
 * low-resolution when it is stretched across a third of the card.
 */
function CardAmbience({ url }: { url: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 select-none">
      <span className="absolute inset-y-0 right-0 block w-3/5 opacity-[0.07] blur-[2px] sm:w-2/5 sm:opacity-[0.12]">
        <Image
          src={url}
          alt=""
          fill
          sizes={ARTWORK_SIZES}
          loading="eager"
          className="object-cover"
        />
      </span>
      {/* The mask, in the panel's OWN colour (`--panel-bg`, declared by
          `.app-panel`) rather than `card` or `dark`: either of those is a
          different grey from the one this card is actually painted in, and
          laying it over the left half would make the card sit visibly lower than
          the one beside it. */}
      <span className="absolute inset-0 block bg-gradient-to-r from-[var(--panel-bg)] from-40% via-[var(--panel-bg)]/80 to-transparent" />
    </span>
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
