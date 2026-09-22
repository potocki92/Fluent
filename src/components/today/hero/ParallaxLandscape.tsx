"use client";

import type { ReactNode } from "react";

import { useParallaxMotion } from "@/hooks/useParallaxMotion";
import { cn } from "@/lib/utils";

import { LandscapeBackdrop } from "./LandscapeBackdrop";

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
 * THE PAINTING ITSELF IS NOT HERE (§48). `LandscapeBackdrop` owns the five
 * layers, their stacking and their crop — the flashcard renders the same scene
 * without any of the machinery below. This file owns the frame: the readability
 * scrim at 50, the content at 60, and the `isolate` that keeps none of it
 * outrankable by anything else on the page.
 *
 * `priority`, because this is above the fold on the app's home screen and five
 * planes of one painting: a layer that arrived late would pop in over a scene
 * that is already composed (§17).
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
      <LandscapeBackdrop className="today-hero-scene" priority />

      <span aria-hidden className="today-hero-scrim absolute inset-0 z-50" />

      <div className="relative z-[60] w-full">{children}</div>
    </header>
  );
}
