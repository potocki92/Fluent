import Link from "next/link";
import { PartyPopper } from "lucide-react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { ReviewModeSwitch } from "@/components/flashcard/ReviewModeSwitch";
import { DailyGoalRing } from "@/components/flashcard/DailyGoalRing";
import type { SavedWordWithWord } from "@/hooks/useSavedWords";
import {
  WORD_GOAL_KEY,
  WORD_GOAL_COLUMNS,
  toWordGoalData,
} from "@/lib/word-goal";
import type { Word } from "@/types";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Powtórki · Fluent" };

/** Dictionary columns needed to render a flashcard. */
const WORD_COLS =
  "id, display, article, word_type, translation_pl, example_de, example_pl, mnemonic";

/** How many "study ahead" / new cards to offer once due cards run out. */
const EXTRA_LIMIT = 15;

export default async function ReviewPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = new Date().toISOString();

  let dueCards: SavedWordWithWord[] = [];
  let extraCards: SavedWordWithWord[] = [];
  const queryClient = getQueryClient();

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

    extraCards = await buildExtraCards(supabase, user.id, now);

    // Prime the daily-goal ring so it renders filled on first paint instead of
    // flashing its loading skeleton while the client fetches the profile. Best
    // effort: on any failure DailyGoalRing just falls back to its client fetch
    // rather than crashing the Server Component render.
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select(WORD_GOAL_COLUMNS)
        .maybeSingle();
      queryClient.setQueryData(WORD_GOAL_KEY, toWordGoalData(profile));
    } catch {
      // ignore — client-side useWordGoal will fetch on mount
    }
  }

  // Nothing to review *and* nothing to learn ahead — the only true dead end.
  if (dueCards.length === 0 && extraCards.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Powtórki</h1>
        <Card className="items-center gap-3 bg-[#2d3748] p-5 text-center">
          <PartyPopper className="size-8 text-gold" />
          <p className="font-semibold">🎉 Wszystko powtórzone!</p>
          <p className="text-sm text-muted2">
            Zapisuj słowa w słowniku, aby pojawiły się tutaj.
          </p>
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

  // With no due cards we open straight into the "ahead" deck so the session is
  // never a dead end; the remaining extras become the "ucz się dalej" pool.
  const initialCards = dueCards.length > 0 ? dueCards : extraCards;
  const continuation = dueCards.length > 0 ? extraCards : [];

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Powtórki</h1>
        {dueCards.length === 0 && (
          <p className="text-sm text-muted2">
            Brak zaległych powtórek — uczysz się do przodu.
          </p>
        )}
        <DailyGoalRing />
        <ReviewModeSwitch cards={initialCards} extra={continuation} />
      </div>
    </HydrationBoundary>
  );
}

/**
 * Build the optional "ucz się dalej" deck: first saved words that are not yet
 * due (study ahead), then brand-new dictionary words the learner hasn't saved.
 * New words carry default SM-2 state; their first grade enrols them via
 * `updateSrs`. Returns at most {@link EXTRA_LIMIT} cards.
 */
async function buildExtraCards(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  now: string,
): Promise<SavedWordWithWord[]> {
  // 1. Study-ahead: saved, not mastered, not yet due.
  const { data: aheadData } = await supabase
    .from("saved_words")
    .select(`*, word:words(${WORD_COLS})`)
    .eq("user_id", userId)
    .eq("is_mastered", false)
    .gt("due_at", now)
    .order("due_at", { ascending: true })
    .limit(EXTRA_LIMIT);
  const ahead = ((aheadData ?? []) as unknown as SavedWordWithWord[]).filter(
    (c) => c.word != null,
  );

  const remaining = EXTRA_LIMIT - ahead.length;
  if (remaining <= 0) return ahead;

  // 2. New words: dictionary entries the learner hasn't saved yet.
  const { data: savedIds } = await supabase
    .from("saved_words")
    .select("word_id")
    .eq("user_id", userId);
  const excluded = (savedIds ?? []).map((r) => r.word_id);

  let query = supabase
    .from("words")
    .select(WORD_COLS)
    .order("cefr", { ascending: true })
    .limit(remaining);
  if (excluded.length > 0) {
    query = query.not("id", "in", `(${excluded.join(",")})`);
  }
  const { data: newWords } = await query;

  const fresh = ((newWords ?? []) as unknown as Word[]).map(
    (word): SavedWordWithWord =>
      ({
        user_id: userId,
        word_id: word.id,
        interval: 0,
        repetitions: 0,
        ease_factor: 2.5,
        due_at: now,
        is_mastered: false,
        saved_at: now,
        word,
      }) as unknown as SavedWordWithWord,
  );

  return [...ahead, ...fresh];
}
