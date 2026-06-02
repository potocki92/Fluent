"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

import { saveWord, unsaveWord } from "@/actions/save-word";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Word } from "@/types";

/** Article colour mnemonic: der → blue, die → red, das → green. */
const ARTICLE_COLOR: Record<string, string> = {
  der: "text-blue",
  die: "text-red",
  das: "text-green",
};

export function WordCard({
  word,
  saved = false,
}: {
  word: Word;
  saved?: boolean;
}) {
  const [isSaved, setIsSaved] = useState(saved);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      if (isSaved) await unsaveWord(word.id);
      else await saveWord(word.id);
      setIsSaved((s) => !s);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="gap-3 bg-[#2d3748] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">
            {word.article && (
              <span className={cn("mr-1", ARTICLE_COLOR[word.article])}>
                {word.article}
              </span>
            )}
            {word.lemma}
          </p>
          {word.translation_pl && (
            <p className="text-sm text-muted2">{word.translation_pl}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {word.cefr && (
            <Badge variant="outline" className="border-[#374151] text-muted2">
              {word.cefr}
            </Badge>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={toggle}
            disabled={pending}
            aria-label={isSaved ? "Usuń z powtórek" : "Zapisz do powtórek"}
          >
            {isSaved ? (
              <BookmarkCheck className="size-4 text-gold" />
            ) : (
              <Bookmark className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {word.example_de && (
        <div className="rounded-md bg-[#374151] p-2 text-sm">
          <p className="text-main">{word.example_de}</p>
          {word.example_pl && (
            <p className="mt-1 text-muted2">{word.example_pl}</p>
          )}
        </div>
      )}
    </Card>
  );
}
