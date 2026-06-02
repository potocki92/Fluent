import type { Metadata } from "next";
import { Suspense } from "react";

import { BrowseFilters } from "@/components/words/BrowseFilters";
import { WordGrid } from "@/components/words/WordGrid";

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
      <div className="mx-auto max-w-screen-xl space-y-6 px-4">
        <header>
          <h1 className="text-2xl font-bold text-[#e2e8f0]">Słownik DTZ</h1>
          <p className="text-sm text-[#a0aec0]">
            2 588 słów · lista DTZ (Goethe-Institut / telc)
          </p>
        </header>

        <BrowseFilters cefr={cefr} type={type} q={q} />

        <Suspense fallback={<p className="text-sm text-[#a0aec0]">Ładowanie…</p>}>
          <WordGrid cefr={cefr} type={type} q={q} />
        </Suspense>
      </div>
    </div>
  );
}
