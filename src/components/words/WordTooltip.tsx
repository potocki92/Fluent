"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Word } from "@/types";

/**
 * Wraps an inline German word (e.g. inside a reading passage) and reveals its
 * Polish translation + example on hover/tap.
 */
export function WordTooltip({
  word,
  children,
}: {
  word: Pick<Word, "display" | "translation_pl" | "example_de">;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <mark className="cursor-help rounded bg-gold/15 px-0.5 text-gold underline decoration-dotted underline-offset-2">
          {children}
        </mark>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-semibold">{word.display}</p>
        {word.translation_pl && (
          <p className="text-muted2">{word.translation_pl}</p>
        )}
        {word.example_de && (
          <p className="mt-1 italic text-muted2">{word.example_de}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
