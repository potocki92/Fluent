"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus } from "lucide-react";

import { CEFR_COLORS } from "@/lib/cefr";
import { cn } from "@/lib/utils";
import type { Word } from "@/types";

/** Learning status of a dictionary word for the current user. */
export type WordStatus = "none" | "saved" | "review" | "mastered";

/** Text colour for the grammatical article, mirroring {@link WordCard}. */
const ARTICLE_TEXT: Record<"der" | "die" | "das", string> = {
  der: "text-blue-400",
  die: "text-pink-400",
  das: "text-purple-400",
};

/** Token colour + Polish label for the status dot on the right of a row. */
const STATUS_META: Record<
  Exclude<WordStatus, "none">,
  { dot: string; label: string }
> = {
  saved: { dot: "bg-gold", label: "W nauce" },
  review: { dot: "bg-blue", label: "W powtórkach" },
  mastered: { dot: "bg-green", label: "Opanowane" },
};

/**
 * A single compact dictionary row: German word, Polish translation, CEFR badge,
 * a save toggle and a status dot. Clicking the row opens the detail sheet; the
 * save toggle and status dot are interactive on their own.
 */
export function WordRow({
  word,
  isSaved,
  status,
  onSave,
  onOpen,
}: {
  word: Word;
  isSaved: boolean;
  status: WordStatus;
  onSave: () => void;
  onOpen: () => void;
}) {
  const [bounce, setBounce] = useState(false);
  const statusMeta = status === "none" ? null : STATUS_META[status];

  function handleSave(event: React.MouseEvent) {
    event.stopPropagation();
    setBounce(true);
    onSave();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto_auto_auto] items-center gap-4 border-b border-border px-4 py-4 text-left transition-colors hover:bg-card focus-visible:bg-card focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto_auto_auto] sm:gap-3 sm:px-3 sm:py-2.5"
    >
      <span className="min-w-0 truncate text-xl font-semibold text-foreground sm:text-base">
        {word.article && (
          <span className={cn("mr-1 font-normal", ARTICLE_TEXT[word.article])}>
            {word.article}
          </span>
        )}
        {word.display}
      </span>

      <span className="min-w-0 truncate text-xl text-muted-foreground sm:text-sm">
        {word.translation_pl ?? "—"}
      </span>

      {word.cefr ? (
        <span
          className={cn(
            "rounded-md px-2 py-1 text-sm font-semibold sm:px-1.5 sm:py-0.5 sm:text-xs",
            CEFR_COLORS[word.cefr],
          )}
        >
          {word.cefr}
        </span>
      ) : (
        <span className="w-8 sm:w-6" />
      )}

      <motion.button
        type="button"
        onClick={handleSave}
        animate={{ scale: bounce ? 1.15 : 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 15 }}
        onAnimationComplete={() => bounce && setBounce(false)}
        aria-pressed={isSaved}
        aria-label={isSaved ? "Usuń z nauki" : "Dodaj do nauki"}
        className={cn(
          "flex size-11 items-center justify-center rounded-xl transition-colors sm:size-7 sm:rounded-md",
          isSaved
            ? "bg-gold text-dark"
            : "bg-secondary text-muted-foreground hover:text-foreground",
        )}
      >
        {isSaved ? (
          <Check className="size-6 sm:size-4" />
        ) : (
          <Plus className="size-6 sm:size-4" />
        )}
      </motion.button>

      <span
        className="flex size-7 items-center justify-center"
        aria-label={statusMeta?.label}
        title={statusMeta?.label}
      >
        <span
          className={cn(
            "size-3 rounded-full sm:size-2.5",
            statusMeta ? statusMeta.dot : "bg-border",
          )}
        />
      </span>
    </div>
  );
}
