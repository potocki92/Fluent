/**
 * The notebook's server-side read layer.
 *
 * ONE PLACE THAT KNOWS HOW A DUE CARD IS ASSEMBLED. A notebook card needs its
 * schedule, its note, the sentence the note came from, and — for a word linked
 * to the shared dictionary — that entry's general translation. Fetching those
 * per card would be four round trips times the size of the deck (§146); here it
 * is three bounded queries whatever the deck's size.
 *
 * RLS DOES THE AUTHORISATION. Everything runs on the caller's own client, so a
 * note belonging to someone else is not filtered out — it is invisible.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotebookCardSource } from "@/lib/notebook/review";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

/** One card of the notebook deck, with everything needed to show and grade it. */
export interface DueNotebookCard {
  /** Exactly one of these is set — the same discriminator the schedule uses. */
  annotationId: number | null;
  sentenceNoteId: number | null;
  kind: "word" | "phrase" | "sentence";
  /** The dictionary entry, when the annotation resolved to one. Never for a phrase. */
  wordId: number | null;
  source: NotebookCardSource;
  /** Where it came from, so the learner can go back to the book (§68). */
  itemTitle: string;
  itemSlug: string;
  chapterPosition: number;
  sentenceId: number | null;
}

/**
 * The notebook cards that are due now.
 *
 * MASTERED CARDS ARE EXCLUDED IN SQL, not filtered afterwards, so a learner with
 * a thousand retired notes still fetches a page-sized deck.
 */
export async function getDueNotebookCards(
  supabase: Client,
  userId: string,
  limit = 20,
): Promise<DueNotebookCard[]> {
  const { data: schedules, error } = await supabase
    .from("user_notebook_reviews")
    .select("annotation_id, sentence_note_id")
    .eq("user_id", userId)
    .eq("is_mastered", false)
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  if (!schedules || schedules.length === 0) return [];

  const annotationIds = schedules
    .map((row) => row.annotation_id)
    .filter((id): id is number => id !== null);
  const noteIds = schedules
    .map((row) => row.sentence_note_id)
    .filter((id): id is number => id !== null);

  // The view already carries the book and the chapter, so the deck does not
  // need a join per card to say where a note came from.
  const [annotations, notes] = await Promise.all([
    annotationIds.length > 0
      ? supabase.from("notebook_entries").select("*").in("entry_id", annotationIds).neq("entry_type", "sentence")
      : Promise.resolve({ data: [], error: null }),
    noteIds.length > 0
      ? supabase.from("notebook_entries").select("*").in("entry_id", noteIds).eq("entry_type", "sentence")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (annotations.error) throw annotations.error;
  if (notes.error) throw notes.error;

  // The SHARED dictionary's general translation, for the word-linked cards only.
  // It is the fallback gloss when the learner saved a span without writing a
  // meaning — and it stays clearly labelled as the dictionary's, never theirs.
  const wordIds = [
    ...new Set(
      (annotations.data ?? [])
        .map((row) => row.word_id)
        .filter((id): id is number => id !== null),
    ),
  ];
  const { data: words } = wordIds.length
    ? await supabase.from("words").select("id, translation_pl").in("id", wordIds)
    : { data: [] };
  const dictionary = new Map(
    (words ?? []).map((word) => [word.id, word.translation_pl]),
  );

  const byId = new Map(
    [...(annotations.data ?? []), ...(notes.data ?? [])].map((row) => [
      `${row.entry_type === "sentence" ? "note" : "annotation"}:${row.entry_id}`,
      row,
    ]),
  );

  const cards: DueNotebookCard[] = [];
  for (const schedule of schedules) {
    const key =
      schedule.annotation_id !== null
        ? `annotation:${schedule.annotation_id}`
        : `note:${schedule.sentence_note_id}`;
    const entry = byId.get(key);
    // A schedule whose note has gone (its book was deleted) is skipped rather
    // than rendered empty; the cascade will remove the row itself.
    if (!entry) continue;

    cards.push({
      annotationId: schedule.annotation_id,
      sentenceNoteId: schedule.sentence_note_id,
      kind: entry.entry_type,
      wordId: entry.entry_type === "word" ? entry.word_id : null,
      source: {
        surface: entry.surface,
        sentenceText: entry.sentence_text,
        charStart: entry.char_start,
        charEnd: entry.char_end,
        meaning: entry.entry_type === "sentence" ? null : entry.meaning,
        translation: entry.entry_type === "sentence" ? entry.meaning : null,
        dictionaryTranslation:
          entry.word_id !== null ? (dictionary.get(entry.word_id) ?? null) : null,
      },
      itemTitle: entry.item_title,
      itemSlug: entry.item_slug,
      chapterPosition: entry.chapter_position,
      sentenceId: entry.sentence_id,
    });
  }

  return cards;
}
