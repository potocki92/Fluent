"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { useTexts } from "@/hooks/useTexts";
import { useCompletionsByTextId } from "@/hooks/useCompletedTexts";
import { useAbility } from "@/hooks/useAbility";
import { LevelBanner } from "@/components/level/LevelBanner";
import { TextCard } from "@/components/texts/TextCard";
import { CompletedTextsSection } from "@/components/texts/CompletedTextsSection";
import { Button } from "@/components/ui/button";
import { isTextTooHard } from "@/lib/cefr";
import type { Text } from "@/types";

/** CEFR sections rendered, in learning order. */
const SECTIONS: Text["cefr"][] = ["A1", "A2", "B1", "B2"];

export default function LearnPage() {
  const { data: texts, isLoading, error } = useTexts();
  const completionsByTextId = useCompletionsByTextId();
  const ability = useAbility((s) => s.ability);
  const [showAll, setShowAll] = useState(false);

  // Main list: drop passed texts (they live in the "read & passed" section) and,
  // unless "show all" is on, texts that are too hard for the learner's level.
  // Failed texts stay so they can be retried.
  const mainTexts = useMemo(() => {
    return (texts ?? []).filter((t) => {
      if (completionsByTextId.get(t.id)?.passed) return false;
      if (!showAll && isTextTooHard(t.difficulty, ability)) return false;
      return true;
    });
  }, [texts, completionsByTextId, ability, showAll]);

  // How many texts the level filter is currently hiding — used to offer the toggle.
  const hiddenByLevel = useMemo(() => {
    return (texts ?? []).filter(
      (t) =>
        !completionsByTextId.get(t.id)?.passed &&
        isTextTooHard(t.difficulty, ability),
    ).length;
  }, [texts, completionsByTextId, ability]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Czytaj i ucz się</h1>
        <p className="text-sm text-muted2">
          Wybierz tekst dopasowany do Twojego poziomu.
        </p>
      </div>

      <LevelBanner />

      {isLoading && <p className="text-sm text-muted2">Ładowanie…</p>}
      {error && (
        <p className="text-sm text-red">Nie udało się wczytać tekstów.</p>
      )}

      {(hiddenByLevel > 0 || showAll) && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? (
            <>
              <EyeOff className="size-4" />
              Pokaż tylko dopasowane do poziomu
            </>
          ) : (
            <>
              <Eye className="size-4" />
              Pokaż wszystkie teksty ({hiddenByLevel} trudniejszych)
            </>
          )}
        </Button>
      )}

      {texts && texts.length === 0 && (
        <p className="text-sm text-muted2">
          Brak tekstów. Dodaj wiersze do tabeli <code>texts</code>.
        </p>
      )}

      {texts && texts.length > 0 && mainTexts.length === 0 && (
        <p className="text-sm text-muted2">
          Wszystko na Twoim poziomie zrobione! Włącz „Pokaż wszystkie teksty”,
          aby zobaczyć trudniejsze.
        </p>
      )}

      {SECTIONS.map((section) => {
        const inSection = mainTexts.filter((t) => t.cefr === section);
        if (inSection.length === 0) return null;
        return (
          <section key={section} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
              {section}
            </h2>
            <div className="space-y-3">
              {inSection.map((text) => (
                <TextCard
                  key={text.id}
                  text={text}
                  completion={completionsByTextId.get(text.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {texts && (
        <CompletedTextsSection
          texts={texts}
          completionsByTextId={completionsByTextId}
        />
      )}
    </div>
  );
}
