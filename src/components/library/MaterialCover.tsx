"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A material's picture, wherever one is shown — with the fallback built in.
 *
 * ONE COMPONENT BECAUSE THE FALLBACK IS THE HARD PART. Every surface that shows
 * artwork has to answer the same three questions the same way: what if the
 * material has no cover, what if the URL is stale, and what if the file simply
 * does not load. A card that answers them differently from the next card is how
 * a shelf ends up with one broken-image icon among nine tidy ones.
 *
 * IT IS A CLIENT COMPONENT FOR EXACTLY ONE REASON: `onError`. A cover URL can
 * outlive its object — a bucket emptied, a project restored, a hand-edited row —
 * and the server cannot know that. Without this, a dead URL renders as an empty
 * bordered box that looks like a bug; with it, the surface falls back to the same
 * icon it would show for a material that never had a picture. No data is fetched
 * here and no state is owned beyond that one flag.
 *
 * DECORATIVE BY DEFAULT. The picture repeats the title next to it, so `alt=""`
 * keeps a screen reader from announcing the same material twice.
 */
export function MaterialCover({
  coverUrl,
  sizes,
  className,
  eager = false,
  fallback,
}: {
  coverUrl: string | null;
  /** How wide the image is actually rendered, so the optimizer serves that. */
  sizes: string;
  /** The box: its size, radius and border. The image fills it, cropped centre. */
  className?: string;
  /** Above the fold — load it now rather than when it scrolls into view. */
  eager?: boolean;
  /** What this surface shows when there is no picture, or it fails to load. */
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const src = coverUrl?.trim();

  return (
    <span className={cn("relative block shrink-0 overflow-hidden", className)}>
      {src && !failed ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
