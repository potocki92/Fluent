"use client";

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { useParallaxMotion } from "@/hooks/useParallaxMotion";
import { cn } from "@/lib/utils";

import { HERO_LAYERS, HERO_SIZES } from "./layers";

/**
 * The parallax scene, and nothing else.
 *
 * IT OWNS THE MECHANICS, NOT THE MESSAGE (§25). What goes in front of the
 * landscape arrives as `children` and is rendered untouched — this component
 * has no idea whether it is holding a greeting, and the greeting has no idea it
 * is standing in front of a mountain. That split is also what keeps the content
 * still: `useParallaxMotion` never sets state, so `children` is reconciled once
 * and then never again, however far the cursor travels (§23).
 *
 * THE STACK IS THE ARRAY (§24). `z-index` comes from each layer's position in
 * `HERO_LAYERS` — 0, 10, 20, 30, 40 — with the readability scrim at 50 and the
 * content at 60, and the whole thing is `isolate`d so none of it can be
 * outranked by anything on the page. There are no arbitrary large numbers here
 * and nothing to keep in sync by hand.
 *
 * THE LAYERS ARE DECORATION, DOWN TO THE MARKUP. The scene is `aria-hidden`,
 * every image has an empty `alt`, none of them can be dragged, selected or
 * clicked, and the whole box is clipped — a learner using a screen reader hears
 * the greeting and nothing about a mountain range, and a learner using a mouse
 * cannot accidentally pick a picture up.
 */
export function ParallaxLandscape({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useParallaxMotion<HTMLElement>();

  return (
    // `flex items-center` rather than a full-height child, so the hero can be
    // given a MINIMUM height and still centre its content: a long display name
    // wrapping the greeting to a third line then grows the card instead of
    // being clipped by the `overflow-hidden` the layers need.
    <header ref={ref} className={cn("relative isolate flex items-center overflow-hidden", className)}>
      <div aria-hidden className="today-hero-scene">
        {HERO_LAYERS.map((layer, index) => (
          <Image
            key={layer.id}
            src={layer.src}
            alt=""
            fill
            // Above the fold on the app's home screen, and five planes of one
            // painting: a layer that arrived late would pop in over a scene
            // that is already composed, so none of them are deferred (§17).
            priority
            sizes={HERO_SIZES}
            draggable={false}
            className="today-hero-layer select-none object-cover"
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

      <span aria-hidden className="today-hero-scrim absolute inset-0 z-50" />

      <div className="relative z-[60] w-full">{children}</div>
    </header>
  );
}
