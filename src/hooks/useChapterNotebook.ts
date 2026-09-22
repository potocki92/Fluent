"use client";

import { useQuery } from "@tanstack/react-query";

import type { NotebookEntry } from "@/hooks/useNotebook";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import { notebookKeys } from "@/lib/query-keys";

/**
 * One saved span of a sentence, in the terms the prose is marked with.
 *
 * THE KIND TRAVELS WITH THE SPAN because the two are marked differently and say
 * different things: a word you gave your own meaning to is one token with a
 * meaning of its own, a phrase is several tokens that only mean anything
 * together. Collapsing them into one mark is how a reader ends up with a page of
 * underlines nobody can tell apart (§45).
 */
export interface ChapterSpan {
  start: number;
  end: number;
  kind: "word" | "phrase";
}

/** Which sentences and which token spans of a chapter carry a note. */
export interface ChapterMarks {
  translatedSentences: ReadonlySet<number>;
  unclearSentences: ReadonlySet<number>;
  /** Saved spans, by sentence id. */
  spans: ReadonlyMap<number, ChapterSpan[]>;
  entries: NotebookEntry[];
}

const EMPTY: ChapterMarks = {
  translatedSentences: new Set(),
  unclearSentences: new Set(),
  spans: new Map(),
  entries: [],
};

export function chapterNotebookKey(chapterId: string | null) {
  return notebookKeys.chapter(chapterId);
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
      const spans = new Map<number, ChapterSpan[]>();

      for (const entry of data ?? []) {
        if (entry.sentence_id === null) continue;
        if (entry.entry_type === "sentence") {
          if (entry.has_translation) translated.add(entry.sentence_id);
          if (entry.is_unclear) unclear.add(entry.sentence_id);
          continue;
        }
        if (entry.start_position === null || entry.end_position === null) continue;
        const list = spans.get(entry.sentence_id) ?? [];
        list.push({
          start: entry.start_position,
          end: entry.end_position,
          kind: entry.entry_type === "phrase" ? "phrase" : "word",
        });
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
