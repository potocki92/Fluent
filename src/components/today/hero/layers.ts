import type { StaticImageData } from "next/image";

import sky from "./sky.webp";
import sun from "./sun.webp";
import mountainsFar from "./mountains-far.webp";
import mountainsMid from "./mountains-mid.webp";
import forest from "./forest.webp";

/**
 * One plane of the sunrise behind Today's greeting.
 *
 * `shift` and `drift` are DISTANCES, not depth coefficients, because distance
 * is what the design is specified in and what can actually be checked: "the
 * forest may travel twelve pixels" is a sentence somebody can hold a ruler to,
 * where "the forest has depth 0.14" needs a second number before it means
 * anything.
 */
export interface HeroLayer {
  /** Stable key, and the name of the file it came from. */
  readonly id: string;
  readonly src: StaticImageData;
  /**
   * Pixels this layer travels at full pointer deflection — the cursor at one
   * edge of the hero versus the other. Vertical travel is the same distance
   * damped by `PARALLAX_VERTICAL_DAMPING`.
   */
  readonly shift: number;
  /** Pixels this layer drifts down across the hero's whole scroll-out. */
  readonly drift: number;
}

/**
 * The scene, back to front. Array order IS z-order: the renderer assigns
 * `z-index` from the index, so moving a layer in this list moves it in the
 * stack and there is no second place to keep in sync.
 *
 * THE NUMBERS ARE SMALL ON PURPOSE. Twelve pixels on the nearest plane against
 * two on the sky is enough separation to read as depth and not enough to read
 * as a screensaver. The gaps between neighbours matter more than the absolute
 * values — background barely moves, foreground moves most, and every step
 * between them is visible (§6, §34). If it ever looks too strong, take these
 * down; raising them past this is how a premium detail becomes a video game.
 *
 * `drift` runs slightly ahead of `shift` on every layer because scroll travel
 * is spent over hundreds of pixels of page rather than the width of one
 * element, so the same distance reads as a slower move.
 *
 * TOGETHER THEY ARE A BUDGET, NOT TWO INDEPENDENT NUMBERS. Pointer and scroll
 * add on the vertical axis, and the sum is what `.today-hero-scene` has to
 * overscan past the hero's edge. The worst case is the forest at the bottom of
 * its travel: 12 × `PARALLAX_VERTICAL_DAMPING` + 10 × `--drift-scale`, which is
 * 17px above `sm` against 20px of overscan and 23px on a phone against 26px.
 * Raising a `drift` past this without widening that inset is how a phone gets a
 * bright seam along the bottom of the card.
 *
 * `drift` IS THE SMALLER NUMBER HERE AND THE BIGGER ONE ON A PHONE. These are
 * the desktop values, where the scroll is a garnish on top of the pointer;
 * `--drift-scale` in `globals.css` works them harder below `sm`, because a
 * touch screen has no pointer and the scroll is the only thing moving.
 *
 * ALIGNMENT IS NOT NEGOTIABLE (§5). Every file here is the same 2172×724 frame
 * of the same painting, and the renderer gives all five the identical box,
 * `object-fit` and `object-position` — a per-layer crop is how the sun ends up
 * behind the wrong ridge at one breakpoint and nobody notices for a month.
 */
export const HERO_LAYERS: readonly HeroLayer[] = [
  { id: "sky", src: sky, shift: 2, drift: 2 },
  { id: "sun", src: sun, shift: 4, drift: 3 },
  { id: "mountains-far", src: mountainsFar, shift: 5, drift: 5 },
  { id: "mountains-mid", src: mountainsMid, shift: 8, drift: 7 },
  { id: "forest", src: forest, shift: 12, drift: 10 },
];

/**
 * How wide the hero is actually painted, so `next/image` fetches that size and
 * not a 2172px original for a 390px phone.
 *
 * Today is a dashboard route, so the column is `max-w-5xl` (1024px) and below
 * that the hero runs the full viewport width. The scene box is drawn 106% of
 * that (see `.today-hero-scene`), which is inside the rounding `next/image`
 * does to its width buckets — and it is the same string for all five layers,
 * so they always resolve to the same source width and cannot drift apart.
 */
export const HERO_SIZES = "(min-width: 1024px) 1024px, 100vw";
