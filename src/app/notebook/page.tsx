import Link from "next/link";

import { NotebookView, type NotebookBook } from "@/components/notebook/NotebookView";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata = { title: "Mój zeszyt · Fluent" };

/**
 * `/notebook` — everything the learner has written down while reading.
 *
 * WHY A ROUTE OF ITS OWN, rather than a tab inside `/review` or `/library`. The
 * notebook is not a review queue: most of what is in it was never meant to be
 * practised, and burying it under "Powtórki" would make every note look like a
 * flashcard the learner forgot to do. It is not part of the library either — the
 * library is Fluent's books, this is the learner's own writing about them.
 *
 * It stays OUT of the bottom navigation on purpose. Four destinations is the
 * right number for a phone, and the notebook is somewhere you go deliberately —
 * from the header, from a chapter's summary, or from a note you are looking for
 * — not one of the four things you do every day. Same judgement that put
 * "Słownik" in the header in Phase 3.
 *
 * The BOOK LIST is resolved here rather than in the client: it is a short,
 * cacheable query the filter needs before it can render, and doing it on the
 * server means the control is complete on first paint.
 */
export default async function NotebookPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const { book } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Mój zeszyt</h1>
        <p className="text-sm text-muted2">
          Zaloguj się, aby zobaczyć swoje notatki z książek.
        </p>
        <Link
          href="/auth"
          className="inline-flex h-11 items-center rounded-xl bg-gold px-4 text-sm font-semibold text-[#1a202c]"
        >
          Zaloguj się
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Mój zeszyt</h1>
        <p className="text-sm text-muted2">
          Twoje znaczenia, zwroty i tłumaczenia — zapisane podczas czytania.
        </p>
      </div>
      <NotebookView
        books={await notebookBooks(supabase, user.id)}
        initialBookId={book ?? null}
      />
    </div>
  );
}

/**
 * The books this learner has notes in.
 *
 * Read from the notes rather than from the library, so the filter offers the two
 * books they have annotated instead of the forty on the shelf (§51). Distinct-ing
 * in memory over a bounded column is cheaper than a `group by` through PostgREST
 * and keeps the query a plain indexed scan.
 */
async function notebookBooks(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<NotebookBook[]> {
  const [annotations, notes] = await Promise.all([
    supabase
      .from("user_text_annotations")
      .select("library_item_id")
      .eq("user_id", userId)
      .limit(2000),
    supabase
      .from("user_sentence_notes")
      .select("library_item_id")
      .eq("user_id", userId)
      .limit(2000),
  ]);

  const ids = [
    ...new Set(
      [...(annotations.data ?? []), ...(notes.data ?? [])].map(
        (row) => row.library_item_id,
      ),
    ),
  ];
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("library_items")
    .select("id, title")
    .in("id", ids)
    .order("title", { ascending: true });

  return data ?? [];
}
