import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";

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
        Teksty pojawią się tutaj po przetworzeniu w panelu administratora.
      </p>
      <Link
        href="/learn"
        className="mt-4 inline-block rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-[#1a202c]"
      >
        Przejdź do tekstów
      </Link>
    </div>
  );
}
