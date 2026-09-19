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

/** The size steps the app actually uses — named, not scattered pixel literals. */
const LOCKUP = {
  header: {
    mark: 28,
    gap: "gap-2.5",
    name: "text-lg",
    tagline: "text-[0.625rem]",
  },
  auth: {
    mark: 40,
    gap: "gap-3",
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
 * Symbol, name and the DE · PL pair, stacked:
 *
 *     [symbol]  Fluent
 *               DE · PL
 *
 * Stacking is what makes this fit a 320px header. Side by side the three pieces
 * are as wide as the name plus the tag line plus two gaps; stacked, the block is
 * only as wide as the name, so the new lockup is NARROWER than the wordmark it
 * replaces was on a phone — the controls on the right keep their room.
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
      <span className="flex flex-col justify-center">
        <span
          className={cn(
            "bg-gradient-to-r from-gold to-blue bg-clip-text font-bold leading-tight tracking-tight text-transparent",
            step.name,
          )}
        >
          Fluent
        </span>
        <span
          className={cn(
            "font-medium leading-tight text-muted2",
            step.tagline,
          )}
        >
          DE · PL
        </span>
      </span>
    </span>
  );
}
