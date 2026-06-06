"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { useMemo } from "react";

import { useAbility } from "@/hooks/useAbility";
import { useAdaptiveTextSuggestion } from "@/hooks/useTexts";
import { useCompletedTexts } from "@/hooks/useCompletedTexts";
import { LevelSummary } from "@/components/level/LevelSummary";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Top section of the learn page: the learner's level summary alongside the
 * reading text whose difficulty best matches their current ability. The level
 * badge comes from {@link LevelSummary} — the same self-sourcing component the
 * stats page uses — so both pages stay in sync.
 */
export function LevelBanner() {
  const ability = useAbility((s) => s.ability);
  const { data: completed } = useCompletedTexts();
  const passedTextIds = useMemo(
    () =>
      new Set((completed ?? []).filter((c) => c.passed).map((c) => c.text_id)),
    [completed],
  );
  const suggestion = useAdaptiveTextSuggestion(ability, passedTextIds);

  return (
    <Card className="gap-3 bg-card p-3">
      <LevelSummary size="lg" />

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted2">
          <Sparkles className="size-3.5 text-gold" />
          Sugerowany tekst
        </p>
        {suggestion ? (
          <Link href={`/learn/${suggestion.id}`} className="group mt-1 block">
            <p className="truncate font-semibold group-hover:text-gold">
              {suggestion.title}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <Badge className="bg-gold text-primary-foreground">
                {suggestion.cefr}
              </Badge>
              <span className="flex items-center gap-1 text-sm font-medium text-gold">
                Czytaj
                <ArrowRight className="size-4" />
              </span>
            </div>
          </Link>
        ) : (
          <p className="mt-1 text-sm text-muted2">Brak dostępnych tekstów.</p>
        )}
      </div>
    </Card>
  );
}
