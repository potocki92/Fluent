"use client";

import Link from "next/link";
import { useState } from "react";
import { BookMarked, BookOpen, CheckCircle2, Loader2, Lock } from "lucide-react";

import { MaterialCover } from "@/components/library/MaterialCover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { ShelfEntry } from "@/lib/library/queries";
import { cn } from "@/lib/utils";

const TYPE_LABEL_PL: Readonly<Record<ShelfEntry["contentType"], string>> = {
  story: "Opowiadanie",
  book: "Książka",
  article: "Artykuł",
  lesson: "Tekst",
};

/**
 * How wide the card is actually rendered: the shelf sits in a `max-w-2xl`
 * container with `md:px-6`, so 624px is its real ceiling. The artwork spans the
 * WHOLE card now — the scrim hides its right-hand half rather than cropping it —
 * so the optimizer has to be told the card's width, not the visible strip's.
 */
const COVER_SIZES = "(min-width: 768px) 624px, 100vw";

/** What the entry means, in the four words the card actually branches on. */
interface CardState {
  percent: number;
  finished: boolean;
  started: boolean;
  preparing: boolean;
  isPrivate: boolean;
}

/**
 * One item on the shelf.
 *
 * The progress bar is WORD-WEIGHTED (see `itemProgressRatio`), not
 * chapters-done-over-chapters: a book whose first chapter is 500 words and whose
 * second is 20 000 would otherwise report 50% after ten minutes, and a progress
 * number that flatters is a progress number nobody trusts twice.
 *
 * TWO CARDS, ONE COMPONENT, AND THE PICTURE DECIDES WHICH. A material with
 * artwork gets {@link CoverCard}: the image IS the card, full bleed, with the
 * text sitting on a gradient that fades it out toward the right. A material
 * without one keeps {@link PlainCard} exactly as it was — the icon, the same
 * padding, the same rhythm. That split is deliberate rather than a transitional
 * state: inventing a placeholder image, or shrinking every card to whatever the
 * least-illustrated one can manage, would make the shelf worse for the sake of
 * uniformity it does not need.
 *
 * IT IS A CLIENT COMPONENT FOR THE FALLBACK. A cover URL can outlive its object,
 * and the illustrated card reserves 42% of its width for a picture — so a dead
 * URL there is not a missing thumbnail, it is a hole where the design was. The
 * one piece of state here is "that image did not load", and it drops the row
 * back to the plain card, which needs no picture at all.
 */
export function LibraryItemCard({ entry }: { entry: ShelfEntry }) {
  const [coverFailed, setCoverFailed] = useState(false);

  const percent = Math.round(entry.progressRatio * 100);
  const finished = entry.chapterCount > 0 && entry.completedChapters >= entry.chapterCount;
  const state: CardState = {
    percent,
    finished,
    started: percent > 0 && !finished,
    // A book still being built says so with a spinner, which is the only signal
    // that anything is happening — and an import has no artwork anyway.
    preparing: entry.status === "processing",
    isPrivate: entry.rights === "private_import",
  };

  const showCover = Boolean(entry.coverUrl) && !state.preparing && !coverFailed;

  return showCover ? (
    <CoverCard entry={entry} state={state} onCoverError={() => setCoverFailed(true)} />
  ) : (
    <PlainCard entry={entry} state={state} />
  );
}

/**
 * The illustrated row: artwork edge to edge, text on the far side of a gradient.
 *
 * THE PICTURE IS NOT A COLUMN. It runs the full width and height of the card and
 * the scrim (`.cover-scrim` in `globals.css`) dissolves it into the card's own
 * colour from about a third of the way across — so there is no seam, no panel
 * and no second background, just one surface that happens to be a photograph on
 * the left. The 42% left padding on the content is what RESERVES the bright end
 * for the image; it is not a column boundary, and nothing is drawn there.
 *
 * `object-left` anchors the crop. At a phone's card ratio the image is wider
 * than it is tall after cover-scaling, so the anchor mostly decides the vertical
 * centre today — but on a wide card with a narrow image it is what keeps the
 * subject, which the admin was told to centre, from sliding out of the visible
 * third.
 */
function CoverCard({
  entry,
  state,
  onCoverError,
}: {
  entry: ShelfEntry;
  state: CardState;
  onCoverError: () => void;
}) {
  const hasStatus = state.started || state.finished;

  return (
    <Link
      href={`/library/${entry.slug}`}
      className="group relative block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-gold/50"
    >
      <MaterialCover
        coverUrl={entry.coverUrl}
        sizes={COVER_SIZES}
        className="absolute inset-0"
        // A hair of movement on hover, and none at all for anyone who has asked
        // their system for less. 1.02 is the most a picture can grow before the
        // shelf starts to feel springy.
        imageClassName="object-left motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.02]"
        fallback={null}
        onError={onCoverError}
      />
      <span aria-hidden className="cover-scrim absolute inset-0" />

      <div
        className={cn(
          // THE CONTENT SETS THE HEIGHT, as it does on the plain card: title,
          // type, bar and percent come to about 104px at `p-4`, which is what
          // keeps an illustrated row a row rather than a banner. The floor is
          // only for the case with no progress to show, where two lines of text
          // would otherwise leave the artwork almost no card to live in.
          // 40% on a phone, 42% from `sm`. The picture wants the larger share
          // and the reference design uses 42% throughout — but at 390px that
          // leaves the title 153px against the 159px Inter needs for a two-word
          // German name, so it wraps and the row grows by a line. Seven pixels
          // of picture buys the one-line title back; above `sm` there is room
          // for both.
          "relative flex min-h-[96px] flex-col gap-2 p-4 pl-[40%] sm:pl-[42%]",
          hasStatus ? "justify-between" : "justify-center",
        )}
      >
        <div className="space-y-0.5">
          <div className="flex items-start justify-between gap-2">
            {/* CLAMPED, unlike the plain card's. Reserving the bright half of
                the card for the picture leaves the title a column about 170px
                wide on a phone, and „Die Verwandlung und andere Erzählungen aus
                Prag" wraps to five lines in it — a 220px row that is no longer a
                list item. Two lines keeps the shelf's rhythm; the full title is
                one tap away and in the `title` attribute meanwhile. */}
            <h3
              title={entry.title}
              className="line-clamp-2 min-w-0 flex-1 break-words font-semibold leading-snug text-main"
            >
              {entry.title}
            </h3>
            {entry.cefr && (
              <Badge className="shrink-0 bg-gold text-[#1a202c]">{entry.cefr}</Badge>
            )}
          </div>
          <MetaLine entry={entry} state={state} onArtwork />
        </div>

        {/* The same two branches the plain card has always had, in the same
            order. `preparing` cannot reach here — a processing import has no
            artwork, so it never becomes an illustrated card. */}
        {state.started && <ProgressBlock entry={entry} state={state} onArtwork />}
        {state.finished && (
          <p className="text-xs text-green">Przeczytane w całości</p>
        )}
      </div>
    </Link>
  );
}

/** The row as it has always been: a 4:3 state icon, then the text beside it. */
function PlainCard({ entry, state }: { entry: ShelfEntry; state: CardState }) {
  return (
    <Link
      href={`/library/${entry.slug}`}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-gold/50"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[#374151] text-gold">
          {state.preparing ? (
            <Loader2 className="size-5 animate-spin" />
          ) : state.finished ? (
            <CheckCircle2 className="size-5" />
          ) : state.started ? (
            <BookMarked className="size-5" />
          ) : (
            <BookOpen className="size-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-semibold leading-snug text-main">
              {entry.title}
            </h3>
            {entry.cefr && (
              <Badge className="shrink-0 bg-gold text-[#1a202c]">{entry.cefr}</Badge>
            )}
          </div>

          <div className="mt-0.5">
            <MetaLine entry={entry} state={state} />
          </div>

          {state.preparing && (
            <p className="mt-2 text-xs text-gold">Przygotowuję rozdziały…</p>
          )}
          {!state.preparing && state.started && (
            <div className="mt-2.5">
              <ProgressBlock entry={entry} state={state} />
            </div>
          )}
          {state.finished && (
            <p className="mt-2 text-xs text-green">Przeczytane w całości</p>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * „Książka · 175 rozdziałów", and the one mark that changes who can see it.
 *
 * `onArtwork` lifts the colour, and it is a contrast requirement rather than a
 * style preference: over a blown-out cover, `--color-muted2` would need the
 * scrim at 0.95 to clear 4.5:1, which would mean covering the picture almost to
 * the text. `--color-main` clears it at 0.74, which is what the scrim actually
 * delivers where this line starts.
 */
function MetaLine({
  entry,
  state,
  onArtwork = false,
}: {
  entry: ShelfEntry;
  state: CardState;
  onArtwork?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1 truncate text-xs",
        onArtwork ? "text-main" : "text-muted2",
      )}
    >
      {/* A private import is marked, quietly. It is the one thing about a book on
          this shelf that changes who can see it. */}
      {state.isPrivate && <Lock className="size-3 shrink-0" aria-label="Prywatna" />}
      <span className="truncate">
        {[
          TYPE_LABEL_PL[entry.contentType],
          entry.author,
          entry.chapterCount > 1 ? `${entry.chapterCount} rozdziałów` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </p>
  );
}

/**
 * Where the learner got to — the same numbers, wherever the card draws them.
 *
 * Unchanged arithmetic: `percent` is rounded from `progressRatio` and the
 * chapter is `resumeChapterPosition`, exactly as before. Only the surface under
 * it is new, and `Progress` already renders a gold bar on a translucent track
 * that reads correctly against the dark end of the scrim.
 */
function ProgressBlock({
  entry,
  state,
  onArtwork = false,
}: {
  entry: ShelfEntry;
  state: CardState;
  onArtwork?: boolean;
}) {
  return (
    <div className="space-y-1">
      {/* The filled part is gold either way. The TRACK is what changes: over a
          picture, `bg-primary/20` is gold on gold and a 3% bar has nothing to
          sit in, so the unfilled part becomes the app's own dark instead. */}
      <Progress value={state.percent} className={cn(onArtwork && "bg-dark/45")} />
      <p className={cn("text-xs", onArtwork ? "text-main" : "text-muted2")}>
        {state.percent}% · rozdział {entry.resumeChapterPosition ?? 1}
      </p>
    </div>
  );
}
