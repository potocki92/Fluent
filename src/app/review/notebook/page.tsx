import Link from "next/link";

import { NotebookReviewSession } from "@/components/notebook/NotebookReviewSession";
import { getDueNotebookCards } from "@/lib/notebook/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Powtórki z zeszytu · Fluent" };

/**
 * `/review/notebook` — the notes the learner chose to review.
 *
 * A SEPARATE DECK, ON PURPOSE. `/review` is the dictionary deck: words, one
 * schedule each, a flip card. This is the contextual deck, and its items were
 * added one at a time by the learner rather than accumulated by saving words.
 * Mixing them would mean a session where every third card changes shape, and
 * would hide the one number a learner wants from each: how much is left.
 *
 * Both are scheduled by the same SM-2 and recorded in the same review history —
 * see `src/actions/review-notebook.ts`.
 */
export default async function NotebookReviewPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Powtórki z zeszytu</h1>
        <p className="text-sm text-muted2">Zaloguj się, aby powtarzać notatki.</p>
        <Link
          href="/auth"
          className="inline-flex h-11 items-center rounded-xl bg-gold px-4 text-sm font-semibold text-[#1a202c]"
        >
          Zaloguj się
        </Link>
      </div>
    );
  }

  const cards = await getDueNotebookCards(supabase, user.id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Powtórki z zeszytu</h1>
        <p className="text-sm text-muted2">
          Zdania i zwroty z Twoich książek — dokładnie tak, jak je zapisałeś.
        </p>
      </div>
      <NotebookReviewSession cards={cards} />
    </div>
  );
}
