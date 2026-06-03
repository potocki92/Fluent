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
  searchParams: Promise<{ cefr?: string; type?: string; q?: string }>;
}) {
  const { cefr, type, q } = await searchParams;

  return (
    <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
      <div className="mx-auto max-w-screen-md space-y-7 px-6 sm:space-y-5 sm:px-4">
        <header>
          <h1 className="text-4xl font-bold text-foreground sm:text-2xl">
            Słownik DTZ
          </h1>
          <p className="mt-1 text-xl text-muted-foreground sm:text-sm">
            2 588 słów · lista DTZ (Goethe-Institut / telc)
          </p>
        </header>

        <BrowseFilters cefr={cefr} type={type} q={q} />

        <Suspense
          fallback={
            <p className="mt-1 text-xl text-muted-foreground sm:text-sm">
              Ładowanie…
            </p>
          }
        >
          <WordList cefr={cefr} type={type} q={q} />
        </Suspense>
      </div>
    </div>
  );
}
