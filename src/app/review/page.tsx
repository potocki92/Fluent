import Link from "next/link";
import { NotebookPen, PartyPopper } from "lucide-react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { requireAccountUser } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getQueryClient } from "@/lib/query-client";
import { ReviewModeSwitch } from "@/components/flashcard/ReviewModeSwitch";
import { ReviewHeader } from "@/components/flashcard/ReviewHeader";
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

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ words?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const user = await requireAccountUser("/review", supabase);

  const now = new Date().toISOString();

  // Today's "nowe słówka" activity passes the exact words it recommended. Serving
  // whatever the deck would otherwise have picked would mean the plan item could
  // never register as done — completion is measured against THESE word ids.
  const { words: requestedWords } = await searchParams;
  const planWordIds = parseWordIds(requestedWords);

  const queryClient = getQueryClient();

  if (planWordIds.length > 0) {
    const planned = await buildPlannedCards(supabase, user.id, planWordIds, now);
    if (planned.length > 0) {
      await primeWordGoal(supabase, queryClient);
      return (
        <HydrationBoundary state={dehydrate(queryClient)}>
          <div className="app-screen review-screen flex flex-col">
            <ReviewHeader
              title="Nowe słówka"
              note="Zestaw z Twojego dzisiejszego planu."
            />
            <ReviewModeSwitch
              className="min-h-0 flex-1"
              cards={planned}
              extra={[]}
            />
          </div>
        </HydrationBoundary>
      );
    }
  }

  const { data } = await supabase
    .from("saved_words")
    .select(`*, word:words(${WORD_COLS})`)
    .eq("user_id", user.id)
    .eq("is_mastered", false)
    .lte("due_at", now)
    .order("due_at", { ascending: true })
    .limit(20);
  // The joined `word` can come back null under RLS / data gaps — drop those so
  // ReviewSession never dereferences a missing dictionary entry.
  const dueCards = ((data ?? []) as unknown as SavedWordWithWord[]).filter(
    (c) => c.word != null,
  );

  const extraCards = await buildExtraCards(supabase, user.id, now);
  const notebookDue = await countDueNotebookCards(supabase, user.id, now);

  await primeWordGoal(supabase, queryClient);

  // Nothing to review *and* nothing to learn ahead — the only true dead end.
  if (dueCards.length === 0 && extraCards.length === 0 && notebookDue === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-[1.75rem] font-bold leading-tight">Powtórki</h1>
        <Card className="items-center gap-3 bg-card p-5 text-center">
          <PartyPopper className="size-8 text-gold" />
          <p className="font-semibold">🎉 Wszystko powtórzone!</p>
          <p className="text-sm text-muted2">
            Zapisuj słowa w słowniku albo notatki podczas czytania, aby
            pojawiły się tutaj.
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
      {/* ONE SCREEN, NOT A PAGE (§25, §39). The column is exactly as tall as the
          space between the header and the tab bar, and `ReviewModeSwitch` is the
          only child that flexes — everything above it is measured. That is what
          puts the four ratings on screen WITH the card instead of a scroll below
          it, and `min-h-0` is what lets the chain actually shrink (§40). */}
      <div className="app-screen review-screen flex flex-col">
        <ReviewHeader
          title="Powtórki"
          // One line, because the header gives it one (see `ReviewHeader`).
          // „Brak zaległych powtórek — uczysz się do przodu." was cut off mid
          // word at 393px, which reads as a bug rather than as good news.
          note={dueCards.length === 0 ? "Uczysz się do przodu" : undefined}
        />
        <ReviewModeSwitch
          className="min-h-0 flex-1"
          cards={initialCards}
          extra={continuation}
          trailing={<NotebookDeckLink count={notebookDue} />}
        />
      </div>
    </HydrationBoundary>
  );
}

/**
 * How many notebook cards are waiting.
 *
 * A COUNT, NOT A DECK. The contextual cards live on their own screen (see
 * `/review/notebook`), so this page only needs to know whether to point at it —
 * and `head: true` asks Postgres for the number without shipping a single row.
 */
async function countDueNotebookCards(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  now: string,
): Promise<number> {
  const { count } = await supabase
    .from("user_notebook_reviews")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_mastered", false)
    .lte("due_at", now);
  return count ?? 0;
}

/**
 * The way into the contextual deck — shown only when it has something in it.
 *
 * IT RIDES THE MODE SWITCH'S ROW (§10). As a card of its own it cost the review
 * screen 51px — on an iPhone with Safari's toolbars up, a third of the
 * flashcard — to say "5". Here it is a 44px target with the count on it, the
 * accessible name carries the rest, and the flashcard keeps its height.
 */
function NotebookDeckLink({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link
      href="/review/notebook"
      aria-label={`Powtórki z zeszytu: ${count}`}
      className="app-panel app-panel-link flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <NotebookPen className="size-4 text-gold" aria-hidden />
      <span className="text-xs font-semibold text-gold" aria-hidden>
        {count}
      </span>
    </Link>
  );
}

/** `?words=12,34,56` → the ids, ignoring anything malformed. */
function parseWordIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 20);
}

/**
 * Prime the daily-goal ring so the header renders filled on first paint instead
 * of flashing its loading skeleton while the client fetches the profile. Best
 * effort: on any failure `ReviewHeader` just falls back to its client fetch
 * rather than crashing the Server Component render.
 */
async function primeWordGoal(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  queryClient: ReturnType<typeof getQueryClient>,
): Promise<void> {
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

/**
 * The exact words today's plan recommended, as a deck.
 *
 * A word already in the deck keeps its real SM-2 state; one the learner has
 * never saved starts from a fresh schedule and is enrolled by its first grade,
 * exactly as the "ucz się dalej" cards always were.
 */
async function buildPlannedCards(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  wordIds: readonly number[],
  now: string,
): Promise<SavedWordWithWord[]> {
  const [{ data: words }, { data: saved }] = await Promise.all([
    supabase.from("words").select(WORD_COLS).in("id", [...wordIds]),
    supabase
      .from("saved_words")
      .select("*")
      .eq("user_id", userId)
      .in("word_id", [...wordIds]),
  ]);

  const schedules = new Map((saved ?? []).map((row) => [row.word_id, row]));

  return ((words ?? []) as unknown as Word[]).map((word) => {
    const schedule = schedules.get(word.id);
    return {
      user_id: userId,
      word_id: word.id,
      interval: schedule?.interval ?? 0,
      repetitions: schedule?.repetitions ?? 0,
      ease_factor: schedule?.ease_factor ?? 2.5,
      due_at: schedule?.due_at ?? now,
      is_mastered: schedule?.is_mastered ?? false,
      saved_at: schedule?.saved_at ?? now,
      word,
    } as unknown as SavedWordWithWord;
  });
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
