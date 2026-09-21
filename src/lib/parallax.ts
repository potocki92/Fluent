/**
 * The arithmetic behind Today's parallax hero, and the only place its numbers
 * live.
 *
 * IT IS HERE RATHER THAN IN THE HOOK because this is the part that can be
 * tested. `useParallaxMotion` is listeners, a frame loop and four
 * `style.setProperty` calls — nothing in it is worth an assertion. What IS worth
 * asserting is that the pointer maps to −1…+1, that the easing converges, that
 * "settled" eventually becomes true, and that scroll progress never leaves 0…1.
 * Those four facts are what keep the effect from drifting, juddering or pinning
 * a frame loop open forever, and they are all pure functions of two numbers.
 *
 * THE TRAVEL DISTANCES ARE NOT HERE. They belong to the artwork, one per layer,
 * so they live with it in `src/components/today/hero/layers.ts`. What lives here
 * is everything that is true of the MOTION regardless of which picture is in the
 * frame.
 */

/**
 * How much of the remaining distance a frame closes.
 *
 * 0.08 at 60fps is halfway there in ~8 frames (130ms) and within a hundredth of
 * the distance — a tenth of a pixel on the nearest layer, which is nothing — in
 * about 55 (900ms). The remaining frames close a gap nobody can see, and the
 * loop parks itself as soon as they do. The layers are never pinned 1:1 to the
 * cursor on purpose (§10): a scene that tracks exactly reads as five pictures
 * glued to the mouse, and a scene that trails reads as depth.
 */
export const PARALLAX_EASING = 0.08;

/**
 * How far from its target a value may sit before the frame loop stops.
 *
 * The properties this feeds are multiplied by at most 14px, so 0.0005 is a
 * fortieth of a pixel — under the threshold at which any of this could be
 * painted differently. Stopping matters more than it sounds: an exponential
 * approach never actually arrives, so without a floor the loop would run for
 * the lifetime of the page to animate nothing.
 */
export const PARALLAX_SETTLE_EPSILON = 0.0005;

/**
 * Vertical pointer travel, as a fraction of horizontal.
 *
 * The hero is roughly five times wider than it is tall, so an unscaled vertical
 * response makes a small flick of the wrist swing the whole scene — the cursor
 * crosses the hero's height in a fifth of the distance it crosses its width.
 * Damping the axis rather than giving every layer a second travel distance
 * keeps one number per layer (§6) and keeps the two axes in proportion.
 */
export const PARALLAX_VERTICAL_DAMPING = 0.62;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Where the pointer sits along one axis of the hero, as −1 (start) … +1 (end).
 *
 * Clamped because a pointer can legitimately be reported outside the element
 * it is captured on, and an unclamped −1.4 would push a layer further than its
 * declared travel and open the edge the oversized scene box exists to prevent.
 *
 * A zero-sized box returns 0 rather than dividing by it: that is the state
 * during the first frames of a hidden or not-yet-laid-out hero, and the honest
 * answer there is "centred", not `NaN` forever.
 */
export function pointerOffset(position: number, start: number, size: number): number {
  if (size <= 0) return 0;
  return clamp(((position - start) / size - 0.5) * 2, -1, 1);
}

/** One frame of exponential approach towards `target`. */
export function approach(current: number, target: number, factor = PARALLAX_EASING): number {
  return current + (target - current) * factor;
}

/** Whether `current` is close enough to `target` to stop animating. */
export function settled(current: number, target: number): boolean {
  return Math.abs(target - current) < PARALLAX_SETTLE_EPSILON;
}

/**
 * How far the hero has scrolled up out of the viewport, as 0 (untouched) … 1
 * (entirely gone).
 *
 * `top` is the hero's distance from the top of the viewport, so it is positive
 * while the hero is still below the fold and goes negative as it leaves. That
 * makes 0 the value on a freshly loaded `/today`, which is what §30 asks for:
 * no scroll offset is baked in before the learner has scrolled anything.
 */
export function scrollProgress(top: number, height: number): number {
  if (height <= 0) return 0;
  return clamp(-top / height, 0, 1);
}
