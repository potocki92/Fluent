"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useState } from "react";

import type { ReadingLine } from "@/hooks/useReadingLine";
import type { ReadingPositionEngine } from "@/hooks/useReadingPosition";
import { returnTarget, type ReturnTarget } from "@/lib/reading/position";

/**
 * „Wróć…" — one small control, for the two places a learner ever wants back.
 *
 *   origin     where this sitting started. They scrolled back to check
 *              something and now want the thread again.
 *   furthest   the front of what they have read. They resumed at 31% with 42%
 *              read, and want the one action that skips the re-reading.
 *
 * `returnTarget` picks the NEARER of the two, which is always the one they
 * meant — and returns nothing at all while they are close enough to see the
 * place themselves. A control that is permanently on screen is a control nobody
 * reads, and this is a reader, not a dashboard.
 *
 * Smooth, deliberately: the learner asked for this jump, so watching it happen
 * tells them where they went. Only the restore on open is instant.
 */
export function ReturnToBookmark({
  engine,
  line,
}: {
  engine: ReadingPositionEngine;
  line: ReadingLine;
}) {
  const [target, setTarget] = useState<ReturnTarget | null>(null);

  useEffect(() => {
    return engine.subscribe((state) => {
      const next = returnTarget(state);
      // Compared by what it MEANS, not by identity: the furthest anchor is a new
      // object on most samples, and re-rendering a button for that would undo
      // the whole point of the subscription.
      setTarget((current) =>
        current?.kind === next?.kind && current?.offset === next?.offset
          ? current
          : next,
      );
    });
  }, [engine]);

  if (!target) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={() => line.scrollTo(target.anchor, "smooth")}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition-opacity hover:opacity-80"
        style={{
          borderColor: "var(--reader-rule)",
          backgroundColor: "color-mix(in srgb, var(--reader-bg) 92%, transparent)",
          color: "var(--reader-fg)",
        }}
      >
        <Bookmark className="size-3.5" style={{ color: "var(--reader-accent)" }} />
        {target.kind === "origin"
          ? "Wróć do miejsca, gdzie skończyłeś"
          : "Wróć do najdalszego miejsca"}
      </button>
    </div>
  );
}
