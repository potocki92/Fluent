"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { NOTEBOOK_PAGE_SIZE } from "@/lib/notebook/constants";
import { notebookKeys } from "@/lib/query-keys";
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

/** Kept as a named export for the call sites; the key itself is in one place. */
export function notebookKey(query: NotebookQuery) {
  return notebookKeys.entries(query);
}

/**
 * Where the last page stopped — all three parts, or none.
 *
 * `created_at` alone is NOT a cursor here. It defaults to `now()`, which in
 * PostgreSQL is transaction start time, so every note written by one save
 * shares it exactly; and `notebook_entries` unions two tables, whose id
 * sequences are independent. A single-column cursor with a strict `<` therefore
 * SKIPPED every row sharing the boundary timestamp — silently, with no gap and
 * no error, just notes the learner could not reach.
 *
 * `(created_at, entry_type, entry_id)` is unique across the whole view, which
 * makes both the ordering and the cursor total.
 */
export interface NotebookCursor {
  createdAt: string;
  entryType: NotebookEntry["entry_type"];
  entryId: number;
}

/** The last row of a page, as the cursor for the next one. */
function cursorFrom(page: readonly NotebookEntry[]): NotebookCursor | undefined {
  const last = page.at(-1);
  if (!last) return undefined;
  return {
    createdAt: last.created_at,
    entryType: last.entry_type,
    entryId: last.entry_id,
  };
}

/**
 * The notebook, a page at a time.
 *
 * PAGINATED FROM THE FIRST COMMIT (§113). A learner who reads three novels has
 * tens of thousands of notes; "we will add paging when it gets slow" means
 * adding it after the screen has already stopped working for the people who use
 * it most.
 *
 * THE KEYSET LIVES IN SQL. `list_notebook_entries` compares
 * `(created_at, entry_type, entry_id) < (…)` as a ROW — one expression that is
 * right by construction. Expressed through PostgREST the same predicate becomes
 * a nested `or=(…,and(…),and(…))` string with hand-quoted timestamps: three
 * clauses that must agree, in a string no compiler checks. The function is
 * `security invoker`, so the view's RLS still scopes every row to its owner.
 *
 * NO N+1 (§146). `notebook_entries` has already joined the book and the
 * chapter, so a page is one request and fifty titles, not fifty-one requests.
 */
export function useNotebook(query: NotebookQuery) {
  return useInfiniteQuery({
    queryKey: notebookKey(query),
    initialPageParam: null as NotebookCursor | null,
    queryFn: async ({ pageParam }): Promise<NotebookEntry[]> => {
      const supabase = createClientSupabaseClient();
      const { data, error } = await supabase.rpc("list_notebook_entries", {
        p_filter: query.filter,
        p_library_item_id: query.libraryItemId ?? null,
        p_chapter_id: query.chapterId ?? null,
        // The learner's text goes through as text: the function escapes the
        // LIKE metacharacters, so searching for "100%" finds "100%".
        p_search: query.search?.trim() || null,
        p_cursor_created_at: pageParam?.createdAt ?? null,
        p_cursor_entry_type: pageParam?.entryType ?? null,
        p_cursor_entry_id: pageParam?.entryId ?? null,
        p_limit: NOTEBOOK_PAGE_SIZE,
      });
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < NOTEBOOK_PAGE_SIZE ? undefined : cursorFrom(lastPage),
  });
}

/** The books a learner has notes in, for the "filtruj po książce" control. */
export function notebookBooksKey() {
  return notebookKeys.books();
}
