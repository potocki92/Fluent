"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus, Volume2 } from "lucide-react";

import { CEFR_COLORS } from "@/lib/cefr";
import { speakGerman } from "@/lib/speech";
import { cn } from "@/lib/utils";
import type { DictionaryListWord } from "@/lib/dictionary/contracts";
import type { WordType } from "@/types";

/** Background/text tokens for the article (rodzaj) chip. */
const ARTICLE_CHIP: Record<"der" | "die" | "das", string> = {
  der: "bg-blue-900/40 text-blue-300",
  die: "bg-pink-900/40 text-pink-300",
  das: "bg-purple-900/40 text-purple-300",
};

/** Polish labels for each grammatical word type. */
const TYPE_LABEL: Record<WordType, string> = {
  noun: "rzeczownik",
  verb: "czasownik",
  other: "inne",
};

export function WordCard({
  word,
  isSaved,
  onSave,
}: {
  word: DictionaryListWord;
  isSaved: boolean;
  onSave: () => void;
}) {
  const [bounce, setBounce] = useState(false);

  function handleSave() {
    setBounce(true);
    onSave();
  }

  return (
    <article className="flex flex-col gap-2 rounded-xl bg-[#2d3748] p-3 transition-colors hover:bg-[#374151]">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-lg px-2 py-0.5 text-sm font-semibold",
            word.article
              ? ARTICLE_CHIP[word.article]
              : "bg-[#374151] text-[#a0aec0]",
          )}
        >
          {word.article ?? TYPE_LABEL[word.word_type]}
        </span>
        {word.cefr && (
          <span
            className={cn(
              "rounded-lg px-2 py-0.5 text-xs font-semibold",
              CEFR_COLORS[word.cefr],
            )}
          >
            {word.cefr}
          </span>
        )}
      </div>

      <div>
        <h3 className="text-xl font-bold text-[#e2e8f0]">{word.display}</h3>
        <p className="text-xs uppercase tracking-wide text-[#a0aec0]">
          {TYPE_LABEL[word.word_type]}
        </p>
      </div>

      {word.translation_pl && (
        <p className="text-base text-[#e2e8f0]">{word.translation_pl}</p>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => speakGerman(word.display)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#374151] px-2.5 py-1.5 text-sm text-[#e2e8f0] transition-colors hover:bg-[#4a5568]"
        >
          <Volume2 className="size-4" />
          Wymowa
        </button>
        <motion.button
          type="button"
          onClick={handleSave}
          animate={{ scale: bounce ? 1.1 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
          onAnimationComplete={() => bounce && setBounce(false)}
          aria-pressed={isSaved}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors",
            isSaved
              ? "bg-[#d4a574] text-[#1a202c]"
              : "bg-[#374151] text-[#e2e8f0] hover:bg-[#4a5568]",
          )}
        >
          {isSaved ? (
            <>
              <Check className="size-4" />
              Zapisano
            </>
          ) : (
            <>
              <Plus className="size-4" />
              Dodaj
            </>
          )}
        </motion.button>
      </div>
    </article>
  );
}
