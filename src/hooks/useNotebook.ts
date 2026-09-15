"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { NOTEBOOK_PAGE_SIZE } from "@/lib/notebook/constants";
import { createClientSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

/** One row of the notebook, book and chapter already joined on. */
export type NotebookEntry =
  Database["public"]["Views"]["notebook_entries"]["Row"];

/**
 * What the notebook is showing.
 *
 * FOUR FILTERS, NOT A QUERY BUILDER. "Everything / words / phrases / sentences /
 * to explain" is the question a learner has, plus "…in this book" and "…in this
 * chapter". Anything beyond that is a search feature, and a notebook that needs
 * a search feature before it has fifty entries has failed at being a notebook.
 */
export type NotebookFilter =
  | "all"
  | "words"
  | "phrases"
  | "sentences"
  | "unclear";

export interface NotebookQuery {
  filter: NotebookFilter;
  libraryItemId?: string | null;
  chapterId?: string | null;
  /** Matches the German surface, the personal lemma, or the learner's Polish. */
  search?: string | null;
}

export function notebookKey(query: NotebookQuery) {
  return [
    "notebook",
    "entries",
    query.filter,
    query.libraryItemId ?? null,
    query.chapterId ?? null,
    query.search?.trim() || null,
  ] as const;
}

/**
 * The notebook, a page at a time.
 *
 * PAGINATED FROM THE FIRST COMMIT (§113). A learner who reads three novels has
 * tens of thousands of notes; "we will add paging when it gets slow" means
 * adding it after the screen has already stopped working for the people who use
 * it most. Keyset on `created_at`, which every listing index is ordered by, so
 * page 40 costs what page 1 costs — unlike an offset, which re-scans everything
 * before it.
 *
 * NO N+1 (§146). `notebook_entries` has already joined the book and the chapter,
 * so fifty entries are one request and fifty titles, not fifty-one requests.
 */
export function useNotebook(query: NotebookQuery) {
  return useInfiniteQuery({
    queryKey: notebookKey(query),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<NotebookEntry[]> => {
      const supabase = createClientSupabaseClient();
      let request = supabase
        .from("notebook_entries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(NOTEBOOK_PAGE_SIZE);

      if (pageParam) request = request.lt("created_at", pageParam);
      if (query.libraryItemId) {
        request = request.eq("library_item_id", query.libraryItemId);
      }
      if (query.chapterId) request = request.eq("chapter_id", query.chapterId);

      if (query.filter === "words") request = request.eq("entry_type", "word");
      if (query.filter === "phrases") request = request.eq("entry_type", "phrase");
      if (query.filter === "sentences") request = request.eq("has_translation", true);
      if (query.filter === "unclear") request = request.eq("is_unclear", true);

      const search = query.search?.trim();
      if (search) {
        // German as written, the learner's own headword, or their Polish — the
        // three things they would actually remember about a note.
        const escaped = search.replace(/[%,()]/g, " ");
        request = request.or(
          `surface.ilike.%${escaped}%,lemma.ilike.%${escaped}%,meaning.ilike.%${escaped}%`,
        );
      }

      const { data, error } = await request;
      if (error) throw error;
      return data ?? [];
    },
    // The cursor is the last row's timestamp. Two notes written in the same
    // microsecond would tie; at human pace, across two tables, that does not
    // happen, and the alternative (a composite cursor through PostgREST) buys
    // nothing for it.
    getNextPageParam: (lastPage) =>
      lastPage.length < NOTEBOOK_PAGE_SIZE
        ? undefined
        : (lastPage.at(-1)?.created_at ?? undefined),
  });
}

/** The books a learner has notes in, for the "filtruj po książce" control. */
export function notebookBooksKey() {
  return ["notebook", "books"] as const;
}
