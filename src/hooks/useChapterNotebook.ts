"use client";

import { useQuery } from "@tanstack/react-query";

import type { NotebookEntry } from "@/hooks/useNotebook";
import { createClientSupabaseClient } from "@/lib/supabase/client";

/** Which sentences and which token spans of a chapter carry a note. */
export interface ChapterMarks {
  translatedSentences: ReadonlySet<number>;
  unclearSentences: ReadonlySet<number>;
  /** Saved spans, as `sentenceId -> [startPosition, endPosition][]`. */
  spans: ReadonlyMap<number, [number, number][]>;
  entries: NotebookEntry[];
}

const EMPTY: ChapterMarks = {
  translatedSentences: new Set(),
  unclearSentences: new Set(),
  spans: new Map(),
  entries: [],
};

export function chapterNotebookKey(chapterId: string | null) {
  return ["notebook", "chapter", chapterId ?? ""] as const;
}

/**
 * Everything this learner has written in ONE chapter.
 *
 * WHY A SEPARATE QUERY FROM {@link useSentenceNotebook}. They answer different
 * questions at different moments. This one runs once when a chapter opens and
 * exists to MARK the prose — which sentences are translated, which are flagged,
 * which words and phrases are saved — so the learner can see their own work in
 * the text. Tapping a word must never trigger it (§145): a chapter can hold
 * hundreds of notes and the gloss has to open now.
 *
 * ONE REQUEST, WITH THE JOINS ALREADY DONE. `notebook_entries` carries the book
 * and chapter, so marking a chapter is a single indexed read rather than one per
 * marked sentence (§146). The result is turned into sets and a span map here,
 * once, so the reader's marking pass is O(marks) and not O(words × marks).
 */
export function useChapterNotebook(chapterId: string | null) {
  return useQuery({
    queryKey: chapterNotebookKey(chapterId),
    enabled: chapterId !== null,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ChapterMarks> => {
      if (!chapterId) return EMPTY;
      const supabase = createClientSupabaseClient();

      const { data, error } = await supabase
        .from("notebook_entries")
        .select("*")
        .eq("chapter_id", chapterId)
        .order("sentence_position", { ascending: true });
      if (error) throw error;

      const translated = new Set<number>();
      const unclear = new Set<number>();
      const spans = new Map<number, [number, number][]>();

      for (const entry of data ?? []) {
        if (entry.sentence_id === null) continue;
        if (entry.entry_type === "sentence") {
          if (entry.has_translation) translated.add(entry.sentence_id);
          if (entry.is_unclear) unclear.add(entry.sentence_id);
          continue;
        }
        if (entry.start_position === null || entry.end_position === null) continue;
        const list = spans.get(entry.sentence_id) ?? [];
        list.push([entry.start_position, entry.end_position]);
        spans.set(entry.sentence_id, list);
      }

      return {
        translatedSentences: translated,
        unclearSentences: unclear,
        spans,
        entries: data ?? [],
      };
    },
  });
}
