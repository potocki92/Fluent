"use client";

import { useState } from "react";
import { Check, Lightbulb, Plus, Volume2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MnemonicDialog } from "@/components/words/MnemonicDialog";
import { WordSuggestDialog } from "@/components/words/WordSuggestDialog";
import { CEFR_COLORS } from "@/lib/cefr";
import type {
  DictionaryListWord,
  DictionaryWordDetail,
} from "@/lib/dictionary/contracts";
import { speakGerman } from "@/lib/speech";
import { topicLabel } from "@/lib/word-topics";
import { cn } from "@/lib/utils";
import type { WordType } from "@/types";

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
 *
 * TWO INPUTS, ON PURPOSE. `word` is the list row that was tapped, so the header
 * paints immediately; `detail` is the fuller record fetched when the sheet
 * opens, and only it carries IPA, plural, auxiliary, topic, synonyms, examples
 * and the mnemonic. Those used to be read off the list row, which never
 * selected them — so every one of the blocks below was dead code on
 * `undefined`. Splitting the two shapes is what makes that impossible to
 * reintroduce: the list row's type does not have the fields to read.
 */
export function WordDetailSheet({
  word,
  detail,
  isLoadingDetail,
  isSaved,
  onSave,
  open,
  onOpenChange,
}: {
  word: DictionaryListWord | null;
  detail: DictionaryWordDetail | null | undefined;
  isLoadingDetail: boolean;
  isSaved: boolean;
  onSave: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Reflect a freshly saved mnemonic without refetching the dictionary. Keyed by
  // word id so the override never leaks onto a different word in the reused sheet.
  const [override, setOverride] = useState<{
    id: number;
    value: string | null;
  } | null>(null);
  const mnemonic =
    override && word && override.id === word.id
      ? override.value
      : (detail?.mnemonic ?? null);

  // The detail belongs to this word only while the ids agree — the sheet is
  // reused, so a stale response for the previously tapped word must not paint
  // its plural under the new headword.
  const facts = detail && word && detail.id === word.id ? detail : null;

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
              {facts?.ipa && (
                <p className="text-sm text-muted-foreground">[{facts.ipa}]</p>
              )}
            </SheetHeader>

            <div className="space-y-4 px-4 pb-4">
              {isLoadingDetail && !facts && (
                <p className="text-sm text-muted-foreground">Ładowanie szczegółów…</p>
              )}

              {facts &&
                (facts.plural ||
                  facts.aux ||
                  facts.topic ||
                  (facts.synonyms && facts.synonyms.length > 0)) && (
                <dl className="space-y-2 rounded-xl bg-card p-3 text-sm">
                  {facts.plural && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Liczba mnoga:</dt>
                      <dd className="text-foreground">{facts.plural}</dd>
                    </div>
                  )}
                  {facts.aux && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Posiłkowy:</dt>
                      <dd className="text-foreground">{facts.aux}</dd>
                    </div>
                  )}
                  {facts.topic && (
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Temat:</dt>
                      <dd className="text-foreground">{topicLabel(facts.topic)}</dd>
                    </div>
                  )}
                  {facts.synonyms && facts.synonyms.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-muted-foreground">Synonimy:</dt>
                      <dd className="flex flex-wrap gap-1.5">
                        {facts.synonyms.map((syn) => (
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

              {facts?.example_de && (
                <div className="rounded-xl bg-card p-3">
                  <p className="text-foreground">{facts.example_de}</p>
                  {facts.example_pl && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {facts.example_pl}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => speakGerman(word.display)}
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

              <div className="space-y-2">
                {mnemonic && (
                  <div className="flex items-start gap-2 rounded-xl bg-card p-3">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-gold" />
                    <p className="text-sm text-foreground">{mnemonic}</p>
                  </div>
                )}
                {/* Gated on the detail: the dialog opens pre-filled with the
                    stored mnemonic, and offering "add one" before it has
                    arrived invites a learner to overwrite their own. */}
                {facts && (
                  <MnemonicDialog
                    wordId={word.id}
                    display={word.display}
                    mnemonic={mnemonic}
                    onSaved={(value) => setOverride({ id: word.id, value })}
                  />
                )}
              </div>

              <WordSuggestDialog wordId={word.id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
