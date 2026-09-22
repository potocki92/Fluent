"use client";

import { useAbility } from "@/hooks/useAbility";
import { useProfile } from "@/hooks/useProfile";
import { CalibrationControls } from "@/components/level/CalibrationControls";
import { ConfidenceBadge, LevelRing } from "@/components/level/LevelRing";
import { WordGoalControl } from "@/components/flashcard/WordGoalControl";
import { LearningTimeControl } from "@/components/today/LearningTimeControl";
import { TimezoneControl } from "@/components/today/TimezoneControl";
import { Card } from "@/components/ui/card";

export default function SettingsPage() {
  useProfile();
  const ability = useAbility((s) => s.ability);
  const answered = useAbility((s) => s.answered);

  return (
    <div className="space-y-3">
      <header className="space-y-0.5">
        <h1 className="text-[1.75rem] font-bold leading-tight">Ustawienia</h1>
        <p className="text-sm text-muted2">
          Ustal swój poziom niemieckiego — adaptacyjnym testem lub ręcznie.
        </p>
      </header>

      {/* A ROW, NOT A PORTRAIT TILE (§34). The ring used to carry „Elo" and the
          confidence badge stacked under it, which made this card 170px tall and
          left the sentence beside it wrapping in a 150px gutter. The same three
          facts as a ring plus two chips are 135px, and „Dzienny czas nauki" is
          then on screen with them. */}
      <Card className="flex-row items-center gap-4 bg-card p-4">
        <LevelRing size="lg" meta={false} ability={ability} answered={answered} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold">Twój aktualny poziom</p>
          <p className="text-xs text-muted2">
            Poziom doprecyzowuje się po każdym teście. Tutaj możesz go ustalić
            od nowa.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted2">
              Elo: {Math.round(ability)}
            </span>
            <ConfidenceBadge answered={answered} />
          </div>
        </div>
      </Card>

      <LearningTimeControl />
      <TimezoneControl />
      <WordGoalControl />
      <CalibrationControls />
    </div>
  );
}
