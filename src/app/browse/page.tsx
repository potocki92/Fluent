import type { Metadata } from "next";
import { Suspense } from "react";

import { BrowseFilters } from "@/components/words/BrowseFilters";
import { WordList } from "@/components/words/WordList";

export const metadata: Metadata = {
  title: "Słownik DTZ — Fluent",
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    cefr?: string;
    type?: string;
    q?: string;
    topic?: string;
  }>;
}) {
  const { cefr, type, q, topic } = await searchParams;

  return (
    <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
      <div className="mx-auto max-w-screen-md space-y-5 px-4">
        <header>
          <h1 className="text-2xl font-bold text-foreground">
            Słownik DTZ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            2 588 słów · lista DTZ (Goethe-Institut / telc)
          </p>
        </header>

        <BrowseFilters cefr={cefr} type={type} q={q} topic={topic} />

        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">
              Ładowanie…
            </p>
          }
        >
          <WordList cefr={cefr} type={type} q={q} topic={topic} />
        </Suspense>
      </div>
    </div>
  );
}
