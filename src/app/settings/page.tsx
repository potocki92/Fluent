"use client";

import { useAbility } from "@/hooks/useAbility";
import { useProfile } from "@/hooks/useProfile";
import { CalibrationControls } from "@/components/level/CalibrationControls";
import { LevelRing } from "@/components/level/LevelRing";
import { WordGoalControl } from "@/components/flashcard/WordGoalControl";
import { Card } from "@/components/ui/card";

export default function SettingsPage() {
  useProfile();
  const ability = useAbility((s) => s.ability);
  const answered = useAbility((s) => s.answered);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Ustawienia</h1>
        <p className="text-sm text-muted2">
          Ustal swój poziom niemieckiego — adaptacyjnym testem lub ręcznie.
        </p>
      </div>

      <Card className="flex-row items-center gap-3 bg-card p-4">
        <LevelRing size="lg" ability={ability} answered={answered} />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Twój aktualny poziom</p>
          <p className="text-xs text-muted2">
            Poziom doprecyzowuje się po każdym teście. Tutaj możesz go ustalić
            od nowa.
          </p>
        </div>
      </Card>

      <WordGoalControl />
      <CalibrationControls />
    </div>
  );
}
