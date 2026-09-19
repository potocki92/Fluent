import Image from "next/image";

import { cn } from "@/lib/utils";

import fluentMark from "./fluent-mark.png";

/**
 * The Fluent symbol, and the lockup it forms with the name.
 *
 * ONE PLACE KNOWS THE ASSET. Every other brand surface asks for a size, not for
 * a path — the import lives here and nowhere else, so replacing the artwork is
 * one file. The import is static rather than a `/brand/...` string on purpose:
 * a renamed or missing file then fails the build instead of shipping a broken
 * image, and Next reads the intrinsic dimensions at compile time.
 *
 * NO LAYOUT SHIFT. The rendered box is computed from those intrinsic dimensions
 * (`markWidth`), never guessed, so the header reserves the exact space the logo
 * will occupy before it has loaded. The asset is tight-trimmed — the clear space
 * around the symbol is the lockup's `gap`, not transparent padding baked into
 * the file, which is what makes a height prop mean the height you actually see.
 *
 * THE SYMBOL IS DECORATIVE IN THE LOCKUP. It sits next to the word "Fluent", so
 * giving it alt text would have a screen reader announce the brand twice; the
 * link's accessible name comes from the visible text. {@link FluentMark} used on
 * its own takes a real `alt`.
 */

/**
 * The size steps, derived from the master lockup rather than picked by eye.
 *
 * The one proportion that matters is the symbol against the CAP HEIGHT of
 * "Fluent" — not against the font size, and not against the line box. Measured
 * off the master artwork it is 1.59, with the tag line at 0.45 of the same cap
 * and equal gaps either side of the name. Inter's cap height is 0.727em, so a
 * step's `mark` is round(1.59 × 0.727 × fontSize): 21px at text-lg, 28px at
 * text-2xl. Anything larger is what made the symbol read as an image pasted
 * next to a word instead of one mark. The gap follows the same cap: 0.37 of it,
 * equal on both sides of the name, which is why it is 5px here and 6px there
 * rather than the nearest comfortable spacing token.
 *
 * The tag line is the one place this deliberately departs from the master: at
 * 0.45 of the cap it would be an 8px word in a 56px header, so it is held at
 * half the name's font size instead — the smallest step that still reads at
 * arm's length on a phone.
 */
const LOCKUP = {
  header: {
    mark: 21,
    gap: "gap-1",
    name: "text-lg",
    tagline: "text-[0.5625rem]",
  },
  auth: {
    mark: 28,
    gap: "gap-1.5",
    name: "text-2xl",
    tagline: "text-xs",
  },
} as const;

export type LockupSize = keyof typeof LOCKUP;

/** The drawn width for a given height, from the asset itself. */
function markWidth(height: number): number {
  return Math.round((height * fluentMark.width) / fluentMark.height);
}

export function FluentMark({
  size = 28,
  alt = "",
  className,
  priority = false,
}: {
  size?: number;
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={fluentMark}
      alt={alt}
      aria-hidden={alt === "" || undefined}
      width={markWidth(size)}
      height={size}
      priority={priority}
      // Tailwind's preflight sets `img { height: auto }`, which outranks the
      // height ATTRIBUTE — without this the symbol is drawn at whatever height
      // the rounded width implies (27.3px for a requested 28) and sits a hair
      // off the text's centre line. The attributes above still carry the aspect
      // ratio, so the box is reserved before the file loads either way.
      style={{ height: `${size}px`, width: "auto" }}
      className={cn("block shrink-0 select-none", className)}
    />
  );
}

/**
 * The lockup, on one line:
 *
 *     [symbol]  Fluent  DE · PL
 *
 * `leading-none` on both words is what lets `items-center` do the right thing.
 * With normal leading each span carries half-leading above and below, and since
 * "Fluent" has no descenders its ink sits high in that box — centring the boxes
 * would then leave the symbol visibly low against the letters. Collapsed to the
 * em box, the two texts share the same cap-centre fraction, so one `items-center`
 * aligns symbol, name and tag line on the same optical line.
 */
export function FluentLogo({
  size = "header",
  className,
  priority = false,
}: {
  size?: LockupSize;
  className?: string;
  priority?: boolean;
}) {
  const step = LOCKUP[size];

  return (
    <span className={cn("flex items-center", step.gap, className)}>
      <FluentMark size={step.mark} priority={priority} />
      <span
        className={cn(
          "bg-gradient-to-r from-gold to-blue bg-clip-text font-bold leading-none tracking-tight text-transparent",
          step.name,
        )}
      >
        Fluent
      </span>
      <span
        className={cn(
          "font-medium leading-none tracking-wider text-muted2",
          step.tagline,
        )}
      >
        DE · PL
      </span>
    </span>
  );
}
