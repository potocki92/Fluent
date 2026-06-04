"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { useAbility } from "@/hooks/useAbility";
import { useProfile } from "@/hooks/useProfile";
import { useAdaptiveTextSuggestion } from "@/hooks/useTexts";
import { LevelRing } from "@/components/level/LevelRing";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Top section of the learn page: the learner's level ring alongside the reading
 * text whose difficulty best matches their current ability.
 */
export function LevelBanner() {
  useProfile();
  const ability = useAbility((s) => s.ability);
  const answered = useAbility((s) => s.answered);
  const suggestion = useAdaptiveTextSuggestion(ability);

  return (
    <Card className="gap-3 bg-card p-3">
      <div className="flex items-center gap-3">
        <LevelRing size="lg" ability={ability} answered={answered} />

        <div className="min-w-0 flex-1">
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
      </div>
    </Card>
  );
}
