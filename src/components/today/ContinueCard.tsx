"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarClock, PartyPopper } from "lucide-react";

import type { TodayPlanItem } from "@/lib/learning/planner/contracts";
import { MaterialCover } from "@/components/library/MaterialCover";
import { planItemArtwork, type MaterialArtwork } from "@/lib/library/artwork";
import { PLAN_ITEM_CATEGORY_PL, renderReason } from "@/lib/learning/planner/reasons";
import { planItemHref } from "@/lib/learning/planner/routes";
import { planItemLabel } from "@/lib/learning/planner/summary";
import { PLAN_ITEM_ICONS } from "@/components/today/planIcons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * How wide the artwork is actually rendered, so `next/image` fetches that and
 * not a 4000 px original. The picture spans the WHOLE card — the scrim hides its
 * right-hand half rather than cropping it — so this is the card's width, not the
 * visible strip's. Today is a `max-w-5xl` dashboard whose `lg` grid gives this
 * card the `1.6fr` track: about 592 px at the widest.
 */
const ARTWORK_SIZES = "(min-width: 1024px) 592px, 100vw";

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
 * TWO CARDS, ONE COMPONENT, AND THE PICTURE DECIDES WHICH — the same split
 * `LibraryItemCard` makes on the shelf, deliberately built the same way so the
 * two surfaces stay one design. An activity whose material has artwork gets
 * {@link CoverCard}: the image IS the card, full bleed, dissolved into the
 * panel's own colour by `.cover-scrim` so there is no seam, no tile and no
 * second background. Everything else keeps {@link PlainCard} exactly as it was —
 * the activity's icon on its warm ground, the same padding, the same rhythm.
 * „Powtórki" is a deck, not a material, and a stock photograph of one would be
 * decoration pretending to be information.
 *
 * IT IS A CLIENT COMPONENT FOR THE FALLBACK, for the same reason the shelf is. A
 * cover URL can outlive its object, and the illustrated card RESERVES 40% of its
 * width for a picture — so a dead URL there is not a missing thumbnail, it is a
 * hole where the design was. The one piece of state here is "that image did not
 * load", and it drops the card back to the plain form, which needs no picture.
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
  const [coverFailed, setCoverFailed] = useState(false);

  if (!item) return <DayDone isComplete={isComplete} className={className} />;

  // The last word on whether a picture is shown, and it re-checks the activity's
  // type rather than trusting the caller — see `planItemArtwork`.
  const cover = planItemArtwork(item, artwork);

  return cover && !coverFailed ? (
    <CoverCard
      item={item}
      coverUrl={cover.url}
      onCoverError={() => setCoverFailed(true)}
      className={className}
    />
  ) : (
    <PlainCard item={item} className={className} />
  );
}

/**
 * The illustrated card: artwork edge to edge, text on the far side of a gradient.
 *
 * THE PICTURE IS NOT A COLUMN. It runs the full width and height of the card and
 * the scrim dissolves it into the panel's own colour from about a third of the
 * way across, so a learner recognises yesterday's café story before reading a
 * word and the card still belongs to the column of panels it sits in. The 40%
 * left padding RESERVES the bright end for the image; it is not a column
 * boundary, and nothing is drawn there.
 *
 * EVERY PIECE OF CONTENT SHARES THAT COLUMN, the button included. A CTA that
 * spanned the whole card would cut a gold bar across the photograph, and one
 * that floated over its bright half would be the only element on Today without a
 * readable background. Inset with the rest it is still ~216 px on a 390 px
 * phone — a comfortable target, and unmistakably the same button.
 *
 * AND IT KEEPS ITS OWN LINE AT EVERY WIDTH, unlike the plain card's. Reserving
 * 42% for the picture leaves the content about 323 px even on the widest Today
 * (`max-w-5xl`, the `1.6fr` track ≈ 591 px); an inline button takes 150 of them
 * and „Die neuen Nachbarn" needs 175, so the material's own name is the first
 * thing to be truncated. Stacked, the title gets the whole column at every
 * breakpoint and the card is one layout instead of two.
 *
 * `object-center` anchors the crop, and this is the one place it differs from
 * the shelf ON PURPOSE. A shelf row is wide and short, so its picture is scaled
 * to the width and barely trimmed sideways — `object-left` costs it nothing.
 * This card is the other shape: the strip is ~40% as wide as the card and twice
 * as tall, so a landscape cover is scaled to the HEIGHT and about half its width
 * is cut. Anchoring left would then show a cover's left edge and drop the
 * subject the admin was told to centre; centring keeps it.
 */
function CoverCard({
  item,
  coverUrl,
  onCoverError,
  className,
}: {
  item: TodayPlanItem;
  coverUrl: string;
  onCoverError: () => void;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "app-panel relative overflow-hidden rounded-xl",
        className,
      )}
      aria-labelledby="continue-card-heading"
    >
      <MaterialCover
        coverUrl={coverUrl}
        sizes={ARTWORK_SIZES}
        className="absolute inset-0"
        imageClassName="object-center"
        // Above the fold — load it now rather than when it scrolls into view.
        // Not `preload`: the LCP element on Today is the card's own text, and
        // Next 16 deprecated `priority` precisely because "important" and
        // "preload in the head" are different claims.
        eager
        // There is no icon to fall back to HERE: a failed cover re-renders the
        // whole card in its plain form, which has one.
        fallback={null}
        onError={onCoverError}
      />
      <span aria-hidden className="cover-scrim cover-scrim-panel absolute inset-0" />

      {/* 40% on a phone, 42% from `sm` — the shelf's numbers and its reasoning:
          the picture wants the larger share, but at 390px 42% leaves the title
          too little to stay on one line. The content decides the height. */}
      <div className="relative flex flex-col gap-3 p-5 pl-[40%] sm:pl-[42%]">
        <h2 id="continue-card-heading" className="text-base font-bold">
          Kontynuuj naukę
        </h2>

        <MaterialLine item={item} onArtwork />

        <ContinueButton item={item} className="w-full" />
      </div>
    </section>
  );
}

/** The card as it has always been: the activity's icon, then the text beside it. */
function PlainCard({
  item,
  className,
}: {
  item: TodayPlanItem;
  className?: string;
}) {
  const Icon = PLAN_ITEM_ICONS[item.type];

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
          className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-gold/20 to-blue/10 text-gold sm:size-16"
        >
          <Icon className="size-6" />
        </span>

        <MaterialLine item={item} />
        <ContinueButton item={item} className="hidden shrink-0 px-5 sm:inline-flex" />
      </div>

      {/* On a phone the button owns its own line: squeezed next to a title it
          becomes a 60px target with a truncated label. */}
      <ContinueButton item={item} className="mt-4 w-full sm:hidden" />
    </section>
  );
}

/**
 * What the activity is, in the three lines both cards draw.
 *
 * The kicker names the KIND of work; the line under it names the material. For
 * an activity the plan snapshotted no title for — a review queue is not "a
 * text" — those two collapse onto the same word, and „Powtórki / Powtórki" is a
 * card that says one thing twice. Then the kind is the only thing there is to
 * say, so the card says it once, as the title.
 *
 * `onArtwork` changes two things, both because the text is then living in a
 * column about 40% narrower than the card. It WRAPS instead of truncating —
 * „Die Verwandlung und andere Erzählungen aus Prag" and the reason under it both
 * lose their point at one line, and the shelf clamps its title for exactly this
 * reason — and it LIFTS the reason's colour, which is a contrast requirement
 * rather than a style preference: over a blown-out cover `--color-muted2` would
 * need the scrim at 0.85 where this text starts, which would mean covering the
 * picture almost to the type, while `--color-main` clears 4.5:1 at the 0.62 the
 * scrim actually delivers there.
 */
function MaterialLine({
  item,
  onArtwork = false,
}: {
  item: TodayPlanItem;
  onArtwork?: boolean;
}) {
  const label = planItemLabel(item);
  const reason = renderReason({ code: item.reasonCode, data: item.reasonData });
  const category = PLAN_ITEM_CATEGORY_PL[item.type] ?? "Nauka";
  const kicker = category === label ? null : category;

  return (
    <div className="min-w-0 flex-1">
      {kicker && (
        <p className="text-xs font-medium uppercase tracking-wide text-gold">
          {kicker}
        </p>
      )}
      <p
        className={cn(
          "text-lg font-semibold",
          onArtwork ? "line-clamp-2 break-words leading-snug" : "truncate",
        )}
        title={label}
      >
        {label}
      </p>
      <p
        className={cn(
          "text-xs",
          onArtwork ? "line-clamp-2 text-main" : "truncate text-muted2",
        )}
        title={reason}
      >
        {reason}
      </p>
    </div>
  );
}

/** One destination, wherever the card draws the button — `planItemHref` owns it. */
function ContinueButton({
  item,
  className,
}: {
  item: TodayPlanItem;
  className?: string;
}) {
  return (
    <Button
      asChild
      className={cn(
        "rounded-full bg-gold text-dark hover:bg-gold-dark",
        className,
      )}
    >
      <Link href={planItemHref(item)}>
        Kontynuuj
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Button>
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
