import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, BookUp } from "lucide-react";

import { LibraryItemCard } from "@/components/library/LibraryItemCard";
import { getLibraryShelf } from "@/lib/library/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Biblioteka — Fluent",
  description: "Czytaj po niemiecku: opowiadania, książki i teksty Fluent.",
};

/**
 * The shelf.
 *
 * Two sections, because a learner opening this page has exactly two questions:
 * "where was I?" and "what else is there?". Recommendations, genres, ratings and
 * a public marketplace are all things a library could have; none of them is a
 * question anyone has on their third chapter of one book.
 */
export default async function LibraryPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shelf = await getLibraryShelf(supabase, user?.id ?? null);
  const reading = shelf.filter(
    (entry) => entry.progressRatio > 0 && entry.completedChapters < entry.chapterCount,
  );
  const rest = shelf.filter((entry) => !reading.includes(entry));

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Biblioteka</h1>
        <p className="text-sm text-muted2">
          Czytaj prawdziwe teksty — Fluent zapamięta, gdzie skończyłeś.
        </p>
      </header>

      {/* THE OTHER DOOR INTO THE LIBRARY. Until now everything on this shelf was
          written for Fluent; a learner's own book is the other half of "what can
          I read?", so the way in sits on this page rather than in settings. */}
      <ImportEntry />

      {shelf.length === 0 ? (
        <EmptyShelf />
      ) : (
        <>
          {reading.length > 0 && (
            <Section title="Kontynuuj czytanie">
              {reading.map((entry) => (
                <LibraryItemCard key={entry.id} entry={entry} />
              ))}
            </Section>
          )}
          {rest.length > 0 && (
            <Section title={reading.length > 0 ? "Twoja biblioteka" : "Do przeczytania"}>
              {rest.map((entry) => (
                <LibraryItemCard key={entry.id} entry={entry} />
              ))}
            </Section>
          )}

          {/* `/learn` is still the graded passages and their comprehension
              tests. It is not a second library — every passage is here too —
              so it is a link rather than a tab. */}
          <Link
            href="/learn"
            className="block rounded-xl border border-dashed border-border p-3 text-center text-sm text-muted2 transition-colors hover:text-main"
          >
            Teksty z pytaniami sprawdzającymi →
          </Link>
        </>
      )}
    </div>
  );
}

function ImportEntry() {
  return (
    <Link
      href="/library/import"
      className="flex items-center gap-3 rounded-xl border border-dashed border-border p-3 transition-colors hover:border-gold/50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#374151] text-gold">
        <BookUp className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-main">
          Dodaj własną książkę
        </span>
        <span className="block text-xs text-muted2">
          PDF, EPUB lub TXT — prywatnie, tylko dla Ciebie
        </span>
      </span>
    </Link>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * An empty library is almost always an un-processed one — the passages exist,
 * their structured content has not been built yet. Saying so beats "brak
 * treści", which sends an admin looking for content they already have.
 */
function EmptyShelf() {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <BookOpen className="mx-auto mb-3 size-8 text-muted2" />
      <p className="font-medium text-main">Biblioteka jest jeszcze pusta</p>
      <p className="mt-1 text-sm text-muted2">
        Zaimportuj własną książkę albo zacznij od tekstów Fluent.
      </p>
      <Link
        href="/library/import"
        className="mt-4 inline-block rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-[#1a202c]"
      >
        Dodaj własną książkę
      </Link>
    </div>
  );
}
