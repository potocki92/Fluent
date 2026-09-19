"use client";

import { useEffect, useState } from "react";

import type { ReadingLine } from "@/hooks/useReadingLine";
import { RESUME_MARKER_MS } from "@/lib/reading/constants";
import type { ReadingAnchor } from "@/lib/reading/position";

/**
 * „Tu skończyłeś" — a thin rule across the place the learner was put back.
 *
 * WHAT IT IS NOT: a toast, a banner, a card, or anything that pushes the prose
 * down. It is an absolutely positioned overlay inside the content box, so it
 * costs the text exactly zero pixels of layout — which matters twice over here,
 * because the reader has just scrolled to a place measured in that same layout.
 * A marker that moved the text would invalidate the restore that put it there.
 *
 * `pointer-events: none` so it cannot interrupt a selection or swallow a tap on
 * the word underneath it, and `aria-hidden` because a screen reader is already
 * being told where it is by the progress bar — a second announcement in the
 * middle of the prose would be one more thing between the learner and the book.
 *
 * It leaves on its own: after {@link RESUME_MARKER_MS}, or the moment the
 * learner scrolls, because by then they have found their place and the marker is
 * answering a question nobody is asking any more.
 */
export function ResumeMarker({
  anchor,
  line,
  containerRef,
  active,
}: {
  anchor: ReadingAnchor | null;
  line: ReadingLine;
  containerRef: React.RefObject<HTMLElement | null>;
  /** Only once the restore actually landed — otherwise it marks nothing. */
  active: boolean;
}) {
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !anchor) return;

    const container = containerRef.current;
    const documentTop = line.documentTop(anchor);
    if (!container || documentTop === null) return;

    // Relative to the content box, because that is what the marker is positioned
    // inside. Measured once: the marker is gone long before anything reflows.
    const containerTop = container.getBoundingClientRect().top + window.scrollY;
    setTop(documentTop - containerTop);

    const hide = () => setTop(null);
    const timer = window.setTimeout(hide, RESUME_MARKER_MS);
    // A scroll IS the learner saying they have got their bearings.
    window.addEventListener("scroll", hide, { passive: true, once: true });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", hide);
    };
  }, [active, anchor, containerRef, line]);

  if (top === null) return null;

  return (
    <div
      aria-hidden="true"
      className="reader-resume-marker pointer-events-none absolute inset-x-0 select-none"
      style={{ top }}
    >
      <span className="reader-resume-marker-label">Tu skończyłeś</span>
    </div>
  );
}
