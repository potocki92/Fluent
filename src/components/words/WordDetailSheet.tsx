"use client";

import { Check, Plus, Volume2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { WordSuggestDialog } from "@/components/words/WordSuggestDialog";
import { CEFR_COLORS } from "@/lib/cefr";
import { topicLabel } from "@/lib/word-topics";
import { cn } from "@/lib/utils";
import type { Word, WordType } from "@/types";

/** Polish labels for each grammatical word type. */
const TYPE_LABEL: Record<WordType, string> = {
  noun: "rzeczownik",
  verb: "czasownik",
  other: "inne",
};

/** Text colour for the grammatical article, mirroring {@link WordRow}. */
const ARTICLE_TEXT: Record<"der" | "die" | "das", string> = {
  der: "text-blue-400",
  die: "text-pink-400",
  das: "text-purple-400",
};

/**
 * A bottom sheet with the full details of a dictionary word: pronunciation,
 * German example, its Polish translation, word type, article and the save
 * toggle. Rendered once by {@link WordList} for the currently selected word.
 */
export function WordDetailSheet({
  word,
  isSaved,
  onSave,
  open,
  onOpenChange,
}: {
  word: Word | null;
  isSaved: boolean;
  onSave: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  function speak() {
    if (!word || typeof window === "undefined" || !window.speechSynthesis) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(word.display);
    utterance.lang = "de-DE";
    utterance.rate = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl border-border sm:max-w-lg"
      >
        {word && (
          <>
            <SheetHeader className="pr-10">
              <div className="flex items-center gap-2">
                {word.cefr && (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-xs font-semibold",
                      CEFR_COLORS[word.cefr],
                    )}
                  >
                    {word.cefr}
                  </span>
                )}
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {TYPE_LABEL[word.word_type]}
                </span>
              </div>
              <SheetTitle className="text-xl">
                {word.article && (
                  <span
                    className={cn("mr-1.5 font-normal", ARTICLE_TEXT[word.article])}
                  >
                    {word.article}
                  </span>
                )}
                {word.display}
              </SheetTitle>
              {word.translation_pl && (
                <p className="text-base text-foreground">{word.translation_pl}</p>
              )}
              {word.ipa && (
                <p className="text-sm text-muted-foreground">[{word.ipa}]</p>
              )}
            </SheetHeader>

            <div className="space-y-4 px-4 pb-4">
              {(word.plural ||
                word.aux ||
                word.topic ||
                (word.synonyms && word.synonyms.length > 0)) && (
                <dl className="space-y-2 rounded-xl bg-card p-3 text-sm">
                  {word.plural && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Liczba mnoga:</dt>
                      <dd className="text-foreground">{word.plural}</dd>
                    </div>
                  )}
                  {word.aux && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Posiłkowy:</dt>
                      <dd className="text-foreground">{word.aux}</dd>
                    </div>
                  )}
                  {word.topic && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Temat:</dt>
                      <dd className="text-foreground">{topicLabel(word.topic)}</dd>
                    </div>
                  )}
                  {word.synonyms && word.synonyms.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-muted-foreground">Synonimy:</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {word.synonyms.map((syn) => (
                          <span
                            key={syn}
                            className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-foreground"
                          >
                            {syn}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {word.example_de && (
                <div className="rounded-xl bg-card p-3">
                  <p className="text-foreground">{word.example_de}</p>
                  {word.example_pl && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {word.example_pl}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={speak}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                >
                  <Volume2 className="size-4" />
                  Wymowa
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  aria-pressed={isSaved}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                    isSaved
                      ? "bg-gold text-dark"
                      : "bg-secondary text-foreground hover:bg-accent",
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
                      Dodaj do nauki
                    </>
                  )}
                </button>
              </div>

              <WordSuggestDialog wordId={word.id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
