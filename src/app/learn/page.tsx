"use client";

import { useTexts } from "@/hooks/useTexts";
import { TextCard } from "@/components/texts/TextCard";

export default function LearnPage() {
  const { data: texts, isLoading, error } = useTexts();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Czytaj i ucz się</h1>
        <p className="text-sm text-muted2">
          Wybierz tekst dopasowany do Twojego poziomu.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać tekstów.</p>
      )}

      <div className="space-y-3">
        {texts?.map((text) => (
          <TextCard key={text.id} text={text} />
        ))}
        {texts?.length === 0 && (
          <p className="text-sm text-muted2">
            Brak tekstów. Dodaj wiersze do tabeli <code>texts</code>.
          </p>
        )}
      </div>
    </div>
  );
}
