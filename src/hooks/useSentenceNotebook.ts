"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { NotebookEntry } from "@/hooks/useNotebook";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/**
 * Everything this learner has written about ONE sentence.
 *
 * ONE REQUEST PER TAP, NOT FIVE (§111). The word sheet needs several personal
 * facts at once — is there a meaning for THIS occurrence, is there a translation
 * of this sentence, is it flagged unclear, is any of it already in review — and
 * they are all at the same grain. Fetched separately that is four round trips
 * every time a finger lands on a word, which on a phone is the difference
 * between a sheet that opens and one that flickers. `notebook_entries` has
 * already unioned and joined them, so it is one indexed read.
 *
 * THE CACHE KEY IS THE SENTENCE, AND THAT MATTERS (§110, §138). The dictionary
 * gloss is cached by `wordId`, because a lexeme's translation is the same
 * everywhere it appears. A contextual meaning is not: *ziehen* in "Er zog sein
 * Schwert." and *ziehen* in "Sie zogen den Wagen." are different notes, and a
 * cache keyed by word would show the first one's answer under the second
 * sentence. Here the key is the sentence and the note is selected by TOKEN
 * POSITION, so that class of bug is not merely avoided — it is unrepresentable.
 *
 * NOT THE WHOLE CHAPTER (§145). Tapping a word fetches one sentence's notes; a
 * 15 000-word chapter can hold hundreds of them.
 */
export interface SentenceNotebook {
  /** The sentence note — the learner's translation and/or "nie rozumiem". */
  note: NotebookEntry | null;
  /** Word meanings and phrases anchored inside this sentence. */
  annotations: NotebookEntry[];
}

const EMPTY: SentenceNotebook = { note: null, annotations: [] };

export function sentenceNotebookKey(sentenceId: number | null) {
  return ["notebook", "sentence", sentenceId ?? 0] as const;
}

export function useSentenceNotebook(
  sentenceId: number | null,
): UseQueryResult<SentenceNotebook> {
  return useQuery({
    queryKey: sentenceNotebookKey(sentenceId),
    enabled: sentenceId !== null,
    // Personal notes change only when this learner changes them, and every
    // mutation invalidates this key explicitly. Refetching on window focus would
    // be a request per app-switch while reading on a phone.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SentenceNotebook> => {
      if (sentenceId === null) return EMPTY;
      const supabase = createClientSupabaseClient();

      const { data, error } = await supabase
        .from("notebook_entries")
        .select("*")
        .eq("sentence_id", sentenceId)
        .order("start_position", { ascending: true, nullsFirst: true });
      if (error) throw error;

      const rows = data ?? [];
      return {
        note: rows.find((row) => row.entry_type === "sentence") ?? null,
        annotations: rows.filter((row) => row.entry_type !== "sentence"),
      };
    },
  });
}

/**
 * The learner's own meaning for one token of the sentence.
 *
 * A `word` annotation covering exactly this position — never a phrase that
 * happens to contain it. "Angst machen → straszyć" is not what *Angst* means,
 * and showing it as though it were is the level-mixing this phase forbids.
 */
export function occurrenceMeaning(
  notebook: SentenceNotebook | undefined,
  tokenPosition: number | null,
): NotebookEntry | null {
  if (!notebook || tokenPosition === null) return null;
  return (
    notebook.annotations.find(
      (entry) =>
        entry.entry_type === "word" && entry.start_position === tokenPosition,
    ) ?? null
  );
}

/** Phrases whose span covers this token — shown as context, never as its gloss. */
export function phrasesCovering(
  notebook: SentenceNotebook | undefined,
  tokenPosition: number | null,
): NotebookEntry[] {
  if (!notebook || tokenPosition === null) return [];
  return notebook.annotations.filter(
    (entry) =>
      entry.entry_type === "phrase" &&
      (entry.start_position ?? -1) <= tokenPosition &&
      (entry.end_position ?? -1) >= tokenPosition,
  );
}
