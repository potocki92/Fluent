"use client";

import { useEffect, useRef, useState } from "react";

import { PARAGRAPH_VISIBLE_RATIO } from "@/lib/reading/constants";

/**
 * Which paragraph the learner has actually reached.
 *
 * WHY NOT SCROLL PERCENT. Scroll position is a fact about a viewport, not about
 * a reader: it is wrong the moment an image loads, a font swaps, the window is
 * resized, or the chapter ends with a short paragraph. More importantly it
 * cannot distinguish "scrolled past" from "read", and it makes the last
 * paragraph reachable by flinging the scrollbar.
 *
 * So progress is the furthest paragraph that was genuinely ON SCREEN — at least
 * {@link PARAGRAPH_VISIBLE_RATIO} of it — which is also what makes the
 * completion rule defensible: a final paragraph that renders one pixel into the
 * viewport because of a sticky footer never counts.
 *
 * This is not anti-cheat. Someone determined to scroll to the end can. It is
 * about the progress bar being *meaningful* for the reader who is not trying to
 * game it.
 */
export function useVisibleParagraph(
  containerRef: React.RefObject<HTMLElement | null>,
  paragraphCount: number,
) {
  const [visible, setVisible] = useState(0);
  const furthestRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || paragraphCount === 0) return;

    const nodes = container.querySelectorAll<HTMLElement>(
      "[data-paragraph-position]",
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let highest = furthestRef.current;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!isReached(entry)) continue;
          const position = Number(
            (entry.target as HTMLElement).dataset.paragraphPosition,
          );
          if (Number.isFinite(position) && position > highest) highest = position;
        }
        if (highest !== furthestRef.current) {
          furthestRef.current = highest;
          setVisible(highest);
        }
      },
      // Several thresholds rather than one, because "reached" is two rules —
      // see `isReached`.
      { threshold: [0, 0.25, PARAGRAPH_VISIBLE_RATIO, 0.75, 1] },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef, paragraphCount]);

  return visible;
}

/**
 * Has this paragraph been reached?
 *
 * Two rules, because one is not enough. Half of a short paragraph on screen is
 * clearly "reached"; a paragraph TALLER than the viewport can never be half
 * visible at all, and demanding it would stall progress forever on a phone — so
 * a paragraph that fills most of the screen counts too.
 */
function isReached(entry: IntersectionObserverEntry): boolean {
  if (entry.intersectionRatio >= PARAGRAPH_VISIBLE_RATIO) return true;
  const viewport = entry.rootBounds?.height ?? 0;
  return viewport > 0 && entry.intersectionRect.height >= viewport * 0.6;
}
