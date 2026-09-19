"use client";

import { useEffect, useRef } from "react";

import type { ReadingPositionEngine } from "@/hooks/useReadingPosition";
import {
  isBehindFurthest,
  offsetRatio,
  type ChapterWordIndex,
} from "@/lib/reading/position";

/**
 * The chapter's progress — and, only when they differ, where the learner is now.
 *
 * TWO MARKS, ONE OF WHICH IS USUALLY INVISIBLE:
 *
 *   the fill    how much of the chapter has been READ (furthest)
 *   the dot     where the learner is RIGHT NOW (current)
 *
 * Reading forward moves both, so the dot sits at the end of the fill and the bar
 * looks exactly like an ordinary progress bar — which is the point. It separates
 * only when the two facts genuinely are different:
 *
 *   0% ━━━━━●━━━━━━━━│──────── 100%
 *            ↑        ↑
 *          teraz   przeczytane do
 *
 * No permanent labels. A reader is not a telemetry panel, and a bar that
 * explains itself at all times is a bar nobody stops noticing. The words are in
 * the accessible name, where they are available on demand and silent otherwise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DOES NOT RE-RENDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Progress changes on every animation frame while the learner scrolls. This
 * subscribes to the position engine and writes the two styles directly, so a
 * whole chapter of scrolling costs zero React renders. The accessible value is
 * an attribute write for the same reason — `aria-valuenow` through state would
 * re-render the reader a hundred times a chapter to change a number nobody is
 * looking at.
 */
export function ReadingProgressBar({
  engine,
  index,
}: {
  engine: ReadingPositionEngine;
  index: ChapterWordIndex;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return engine.subscribe((state) => {
      const read = offsetRatio(index, state.furthestOffset);
      const here = offsetRatio(index, state.currentOffset);
      const apart = isBehindFurthest(state);

      if (fillRef.current) fillRef.current.style.width = `${read * 100}%`;
      if (dotRef.current) {
        dotRef.current.style.left = `${here * 100}%`;
        dotRef.current.style.opacity = apart ? "1" : "0";
      }
      if (railRef.current) {
        const percent = Math.round(read * 100);
        railRef.current.setAttribute("aria-valuenow", String(percent));
        railRef.current.setAttribute(
          "aria-valuetext",
          apart
            ? `Przeczytane do ${percent}%, teraz ${Math.round(here * 100)}%`
            : `Przeczytane ${percent}%`,
        );
      }
    });
  }, [engine, index]);

  return (
    <div
      ref={railRef}
      role="progressbar"
      aria-label="Postęp rozdziału"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      className="relative h-0.5 w-full"
      style={{ backgroundColor: "var(--reader-rule)" }}
    >
      <div
        ref={fillRef}
        className="h-full transition-[width] duration-300"
        style={{ width: "0%", backgroundColor: "var(--reader-accent)" }}
      />
      {/* The "you are here" mark. Taller than the rail so it reads as a
          position rather than as part of the fill, and centred on the point it
          means rather than starting there. */}
      <div
        ref={dotRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-200"
        style={{
          left: "0%",
          opacity: 0,
          backgroundColor: "var(--reader-accent)",
          boxShadow: "0 0 0 2px var(--reader-bg)",
        }}
      />
    </div>
  );
}

/**
 * The header's percentage.
 *
 * FURTHEST, NEVER CURRENT. "24%" while the learner is checking something they
 * read twenty minutes ago is a number that contradicts the bar right under it —
 * the header answers "how much of this chapter have I read?", which only the
 * furthest position can.
 *
 * Its own component so that the number changing does not re-render the reader.
 */
export function ReadingProgressPercent({ percent }: { percent: number }) {
  return (
    <span
      className="shrink-0 text-xs tabular-nums"
      style={{ color: "var(--reader-muted)" }}
    >
      {percent}%
    </span>
  );
}
