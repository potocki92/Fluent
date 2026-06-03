import Link from "next/link";
import { PartyPopper } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ReviewSession } from "@/components/flashcard/ReviewSession";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Powtórki · Fluent" };

/** Dictionary columns needed to render a flashcard. */
const WORD_COLS =
  "id, display, article, word_type, translation_pl, example_de, example_pl";

const dueFmt = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ReviewPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = new Date().toISOString();

  let dueCards: SavedWordWithWord[] = [];
  let nextDueAt: string | null = null;

  if (user) {
    const { data } = await supabase
      .from("saved_words")
      .select(`*, word:words(${WORD_COLS})`)
      .eq("user_id", user.id)
      .eq("is_mastered", false)
      .lte("due_at", now)
      .order("due_at", { ascending: true })
      .limit(20);
    // The joined `word` can come back null under RLS / data gaps — drop those
    // so ReviewSession never dereferences a missing dictionary entry.
    dueCards = ((data ?? []) as unknown as SavedWordWithWord[]).filter(
      (c) => c.word != null,
    );

    if (dueCards.length === 0) {
      const { data: next } = await supabase
        .from("saved_words")
        .select("due_at")
        .eq("user_id", user.id)
        .eq("is_mastered", false)
        .gt("due_at", now)
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      nextDueAt = next?.due_at ?? null;
    }
  }

  if (dueCards.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Powtórki</h1>
        <Card className="items-center gap-3 bg-[#2d3748] p-5 text-center">
          <PartyPopper className="size-8 text-gold" />
          <p className="font-semibold">🎉 Wszystko powtórzone!</p>
          {nextDueAt ? (
            <p className="text-sm text-muted2">
              Następna powtórka: {dueFmt.format(new Date(nextDueAt))}
            </p>
          ) : (
            <p className="text-sm text-muted2">
              Zapisuj słowa w słowniku, aby pojawiły się tutaj.
            </p>
          )}
          <Link
            href="/browse"
            className="rounded-xl bg-[#374151] px-4 py-2 text-sm font-semibold text-[#e2e8f0] transition-colors hover:bg-[#4a5568]"
          >
            Przeglądaj słownik
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Powtórki</h1>
      <ReviewSession cards={dueCards} />
    </div>
  );
}
