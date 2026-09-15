"use client";

import { Loader2, NotebookPen, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { NotebookEntryCard } from "@/components/notebook/NotebookEntryCard";
import { useIntersection } from "@/hooks/useIntersection";
import { useNotebook, type NotebookFilter } from "@/hooks/useNotebook";
import { cn } from "@/lib/utils";

/** The books a learner can narrow the notebook down to. */
export interface NotebookBook {
  id: string;
  title: string;
}

const FILTERS: { id: NotebookFilter; label: string }[] = [
  { id: "all", label: "Wszystko" },
  { id: "words", label: "Słowa" },
  { id: "phrases", label: "Zwroty" },
  { id: "sentences", label: "Zdania" },
  { id: "unclear", label: "Do wyjaśnienia" },
];

/**
 * The personal notebook.
 *
 * WHAT THIS IS NOT. It is not a second place to read, not a document editor, and
 * not a place where notes are created — everything here was written inside a
 * book, next to the sentence it is about, which is the whole premise of the
 * phase. This screen exists for the one question a reader's own notes raise
 * later: "what have I actually worked out, and where was it?".
 *
 * FIVE FILTERS AS A ROW, NOT AS TABS (§50). Five Radix tabs at phone width
 * either truncate their Polish labels or wrap into two rows that look like a
 * mistake. A horizontally scrollable chip row holds all five, keeps the active
 * one legible, and is the control the rest of Fluent already uses for this shape
 * of choice.
 *
 * THE BOOK FILTER IS A SELECT, and it is populated from the entries themselves
 * rather than from the library: a learner with notes in two books should not
 * scroll past forty they have never annotated (§51).
 */
export function NotebookView({
  books,
  initialBookId = null,
}: {
  books: readonly NotebookBook[];
  /** Pre-selected book, e.g. when arriving from a chapter's "Twoja nauka". */
  initialBookId?: string | null;
}) {
  const [filter, setFilter] = useState<NotebookFilter>("all");
  const [libraryItemId, setLibraryItemId] = useState<string | null>(initialBookId);
  const [search, setSearch] = useState("");
  // Committed on submit rather than per keystroke: a request per letter over a
  // trigram-less `ilike` is the kind of thing that only hurts once the notebook
  // is big, which is exactly when it matters.
  const [committedSearch, setCommittedSearch] = useState("");

  const query = useMemo(
    () => ({ filter, libraryItemId, search: committedSearch }),
    [filter, libraryItemId, committedSearch],
  );

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotebook(query);

  const entries = data?.pages.flat() ?? [];
  const sentinel = useIntersection(
    () => void fetchNextPage(),
    Boolean(hasNextPage) && !isFetchingNextPage,
  );

  return (
    <div className="space-y-4">
      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <div role="tablist" aria-label="Rodzaj notatek" className="flex w-max gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={cn(
                "h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50",
                filter === option.id
                  ? "bg-gold text-[#1a202c]"
                  : "bg-[#2d3748] text-muted2 hover:text-main",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {books.length > 1 && (
          <select
            value={libraryItemId ?? ""}
            onChange={(event) => setLibraryItemId(event.target.value || null)}
            aria-label="Filtruj po książce"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[#374151] bg-[#2d3748] px-3 text-sm text-main outline-none focus-visible:border-gold"
          >
            <option value="">Wszystkie książki</option>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setCommittedSearch(search);
          }}
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#374151] bg-[#2d3748] px-3 focus-within:border-gold"
        >
          <Search className="size-4 shrink-0 text-muted2" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => setCommittedSearch(search)}
            placeholder="Szukaj w notatkach"
            aria-label="Szukaj w notatkach"
            className="min-w-0 flex-1 bg-transparent text-sm text-main outline-none placeholder:text-muted2"
          />
        </form>
      </div>

      {isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : isLoading ? (
        <p className="py-10 text-center text-sm text-muted2">Wczytujemy zeszyt…</p>
      ) : entries.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <>
          <ul className="space-y-2">
            {entries.map((entry) => (
              <NotebookEntryCard
                key={`${entry.entry_type}-${entry.entry_id}`}
                entry={entry}
              />
            ))}
          </ul>
          <div ref={sentinel} aria-hidden className="h-px" />
          {isFetchingNextPage && (
            <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted2">
              <Loader2 className="size-4 animate-spin" /> Wczytujemy…
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ filter }: { filter: NotebookFilter }) {
  const copy: Record<NotebookFilter, string> = {
    all: "Czytając książkę, zapisuj znaczenia słów, zwroty i własne tłumaczenia — wszystko wyląduje tutaj.",
    words: "Stuknij słowo w czytniku i dodaj własne znaczenie w tym miejscu.",
    phrases: "Zaznacz kilka słów w jednym zdaniu i zapisz je jako zwrot.",
    sentences: "Stuknij zdanie w czytniku i zapisz własne tłumaczenie.",
    unclear: "Nic tu nie czeka na wyjaśnienie. Oznacz zdanie jako „Nie rozumiem”, gdy utkniesz.",
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-[#374151] bg-[#2d3748] px-6 py-10 text-center">
      <NotebookPen className="size-8 text-gold" />
      <p className="text-sm text-muted2">{copy[filter]}</p>
    </div>
  );
}

/** §101: a failure the learner can act on, never a Postgres code. */
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red/40 bg-red/10 px-6 py-8 text-center">
      <p className="text-sm text-main">Nie udało się wczytać zeszytu.</p>
      <button
        type="button"
        onClick={onRetry}
        className="h-10 rounded-xl bg-[#374151] px-4 text-sm font-semibold text-main transition-colors hover:bg-[#4a5568]"
      >
        Spróbuj ponownie
      </button>
    </div>
  );
}
