"use client";

import { useTexts } from "@/hooks/useTexts";
import { LevelBanner } from "@/components/level/LevelBanner";
import { TextCard } from "@/components/texts/TextCard";
import type { Text } from "@/types";

/** CEFR sections rendered, in learning order. */
const SECTIONS: Text["cefr"][] = ["A1", "A2", "B1", "B2"];

export default function LearnPage() {
  const { data: texts, isLoading, error } = useTexts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Czytaj i ucz się</h1>
        <p className="text-sm text-muted2">
          Wybierz tekst dopasowany do Twojego poziomu.
        </p>
      </div>

      <LevelBanner />

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać tekstów.</p>
      )}

      {texts && texts.length === 0 && (
        <p className="text-sm text-muted2">
          Brak tekstów. Dodaj wiersze do tabeli <code>texts</code>.
        </p>
      )}

      {SECTIONS.map((section) => {
        const inSection = texts?.filter((t) => t.cefr === section) ?? [];
        if (inSection.length === 0) return null;
        return (
          <section key={section} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
              {section}
            </h2>
            <div className="space-y-3">
              {inSection.map((text) => (
                <TextCard key={text.id} text={text} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
