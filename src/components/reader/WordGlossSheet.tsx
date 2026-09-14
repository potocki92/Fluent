"use client";

import { useQuery } from "@tanstack/react-query";
import { BookmarkCheck, BookmarkPlus, Volume2 } from "lucide-react";
import { useState } from "react";

import { saveWordFromReader } from "@/actions/reading";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { speakGerman } from "@/lib/speech";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** What the reader knows about the word that was tapped. */
export interface GlossTarget {
  occurrenceId: number;
  wordId: number | null;
  sentenceId: number | null;
  lemma: string;
  surface: string;
  /** The sentence the word appeared in — the thing that makes it mean something. */
  sentence: string;
}

interface GlossWord {
  id: number;
  display: string;
  article: string | null;
  word_type: string;
  translation_pl: string | null;
  example_de: string | null;
  example_pl: string | null;
  ipa: string | null;
  plural: string | null;
}

/**
 * The gloss — Word Tooltip 2.0.
 *
 * WHY A SHEET AND NOT A POPOVER. The old `WordTooltip` was a Radix tooltip,
 * which is a desktop hover affordance wearing a tap handler: on a phone it
 * opened wherever the word happened to be, clipped against the screen edge,
 * covered the sentence being read, and had nowhere to put more than three lines.
 * A bottom sheet is anchored, never clipped, big enough for the sentence, and it
 * is the interaction every reading app on a phone already uses. It is used at
 * every width — a drawer on a laptop is unremarkable, whereas two divergent
 * implementations of the same panel is a permanent maintenance tax.
 *
 * CONTEXT IS PASSED EVEN THOUGH IT IS NOT USED YET. The sheet receives
 * `sentenceId` and `occurrenceId` alongside the word. Today the translation
 * shown is the dictionary's general one; the whole point of `word_occurrences`
 * is that "*ziehen* here means *wyciągnąć*" can arrive later without changing a
 * single call site. Showing the sentence now is also simply better: a learner
 * reading "Er zog sein Schwert." and seeing *ciągnąć* is better served by seeing
 * the sentence next to it than by a lone headword.
 */
export function WordGlossSheet({
  target,
  onClose,
}: {
  target: GlossTarget | null;
  onClose: () => void;
}) {
  // Which occurrence was saved, rather than a boolean reset by an effect: the
  // "W powtórkach" state belongs to ONE word, and deriving it means opening the
  // next word cannot briefly show the previous word's confirmation.
  const [savedOccurrence, setSavedOccurrence] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = target !== null && savedOccurrence === target.occurrenceId;

  const { data, isLoading } = useQuery({
    queryKey: ["reader-gloss", target?.wordId ?? target?.lemma ?? ""],
    enabled: target !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GlossWord | null> => {
      if (!target) return null;
      const supabase = createClientSupabaseClient();
      const query = supabase
        .from("words")
        .select(
          "id, display, article, word_type, translation_pl, example_de, example_pl, ipa, plural",
        )
        .limit(1);

      const { data, error } = target.wordId
        ? await query.eq("id", target.wordId).maybeSingle()
        : await query.ilike("lemma", target.lemma).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function onSave() {
    if (!target?.wordId || saving) return;
    setSaving(true);
    const result = await saveWordFromReader({
      wordId: target.wordId,
      occurrenceId: target.occurrenceId,
    });
    setSaving(false);
    if (result.ok) setSavedOccurrence(target.occurrenceId);
  }

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        // No close button: the built-in one sits top-right, exactly where the
        // pronunciation control belongs. A bottom sheet is dismissed by tapping
        // outside it or pressing Escape, and the handle below says so.
        showCloseButton={false}
        className="max-h-[80svh] gap-0 overflow-y-auto rounded-t-2xl border-t border-[#374151] bg-[#2d3748] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-main"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-[#4b5563]"
        />
        <SheetTitle className="sr-only">
          {target ? `Słowo: ${target.surface}` : "Słowo"}
        </SheetTitle>

        {isLoading || !data ? (
          <GlossSkeleton surface={target?.surface ?? ""} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xl font-semibold break-words">{data.display}</p>
                <p className="mt-0.5 text-sm text-muted2">
                  {[data.ipa, data.plural ? `l.mn. ${data.plural}` : null]
                    .filter(Boolean)
                    .join(" · ") || wordTypeLabel(data.word_type)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => speakGerman(data.display)}
                aria-label="Odsłuchaj wymowę"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#374151] text-muted2 transition-colors hover:text-main"
              >
                <Volume2 className="size-5" />
              </button>
            </div>

            {data.translation_pl && (
              <p className="text-lg text-gold">{data.translation_pl}</p>
            )}

            {/* The sentence the word was met in. This is the reason the reader
                records occurrences at all, and it is useful before any
                contextual translation exists. */}
            {target?.sentence && (
              <blockquote className="rounded-lg border-l-2 border-gold/50 bg-[#374151]/60 px-3 py-2 text-sm italic leading-relaxed text-main">
                {target.sentence}
              </blockquote>
            )}

            {data.example_de && (
              <div className="space-y-0.5 text-sm">
                <p className="italic text-muted2">{data.example_de}</p>
                {data.example_pl && <p className="text-muted2">{data.example_pl}</p>}
              </div>
            )}

            <Button
              type="button"
              onClick={onSave}
              disabled={saved || saving || !target?.wordId}
              className={cn(
                "w-full",
                saved
                  ? "bg-[#374151] text-muted2"
                  : "bg-gold text-[#1a202c] hover:bg-gold-dark",
              )}
            >
              {saved ? (
                <>
                  <BookmarkCheck className="size-4" /> W powtórkach
                </>
              ) : (
                <>
                  <BookmarkPlus className="size-4" /> Dodaj do powtórek
                </>
              )}
            </Button>
            {saved && (
              <p className="text-center text-xs text-muted2">
                Zdanie z książki zostało zapisane razem ze słowem.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function GlossSkeleton({ surface }: { surface: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xl font-semibold">{surface}</p>
      <div className="h-4 w-32 animate-pulse rounded bg-[#374151]" />
      <div className="h-4 w-48 animate-pulse rounded bg-[#374151]" />
      <div className="h-10 w-full animate-pulse rounded bg-[#374151]" />
    </div>
  );
}

function wordTypeLabel(type: string): string {
  if (type === "noun") return "rzeczownik";
  if (type === "verb") return "czasownik";
  return "";
}
