import Image from "next/image";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { HERO_LAYERS, HERO_SIZES } from "./layers";

/**
 * The sunrise, painted. Five files, one stack, no opinion about motion.
 *
 * WHY IT EXISTS (§16, §48). Two screens stand in front of this landscape now —
 * Today's greeting and the review flashcard — and the thing they must never
 * disagree about is the COMPOSITION: which layers, in what order, cropped where.
 * Copying five `<Image>` elements into the second caller is how the sun ends up
 * behind the wrong ridge on one of them and nobody notices for a month. So the
 * scene is rendered here and exactly here; `ParallaxLandscape` adds the motion,
 * the flashcard adds nothing at all.
 *
 * THE STACK IS THE ARRAY (§24). `z-index` comes from each layer's position in
 * `HERO_LAYERS` — 0, 10, 20, 30, 40 — so moving a layer in that list moves it in
 * the stack and there is no second place to keep in sync. What goes IN FRONT is
 * the caller's problem: a scrim at 50, content at 60, by convention.
 *
 * IT IS DECORATION, DOWN TO THE MARKUP. The scene is `aria-hidden`, every image
 * has an empty `alt`, none of them can be dragged or selected, and the caller
 * clips the box. A learner using a screen reader hears the greeting, or the
 * German word, and nothing about a mountain range.
 *
 * `static` IS NOT A STYLE, IT IS A PROMISE. The layer transform resolves to zero
 * whenever the parallax custom properties are unset, so a still scene needs no
 * extra CSS to stand still — but it would still be paying for five promoted
 * compositor layers it can never use. The flag is what takes those back (§15).
 */
export function LandscapeBackdrop({
  className,
  sizes = HERO_SIZES,
  priority = false,
  motion = true,
}: {
  className?: string;
  /** What width the scene is actually painted at, for the image optimizer. */
  sizes?: string;
  priority?: boolean;
  /** `false` for a scene that will never move — see above. */
  motion?: boolean;
}) {
  return (
    <div
      aria-hidden
      data-static={motion ? undefined : "true"}
      className={cn("landscape-scene", className)}
    >
      {HERO_LAYERS.map((layer, index) => (
        <Image
          key={layer.id}
          src={layer.src}
          alt=""
          fill
          priority={priority}
          sizes={sizes}
          draggable={false}
          className="landscape-layer select-none object-cover"
          style={
            {
              zIndex: index * 10,
              "--layer-shift": layer.shift,
              "--layer-drift": layer.drift,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
