"use client";

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { calibrateLevel } from "@/actions/calibrate-level";
import { CALIBRATION_OPTIONS, type CalibrationLevel } from "@/lib/calibration";
import { useAbility } from "@/hooks/useAbility";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OPTIONS = CALIBRATION_OPTIONS;

/**
 * Manual calibration for the initial Elo estimate. The estimate still keeps
 * calibrating through test answers afterwards, but this lets learners start
 * from a realistic baseline instead of being stuck on the generic default.
 */
export function CalibrationControls({ className }: { className?: string }) {
  const setAbility = useAbility((s) => s.setAbility);
  const [selected, setSelected] = useState<CalibrationLevel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCalibration(level: CalibrationLevel) {
    setSelected(level);
    setMessage(null);
    startTransition(async () => {
      try {
        const next = await calibrateLevel(level);
        setAbility(next);
        setMessage(
          "Poziom startowy zaktualizowany. Kolejne testy doprecyzują wynik.",
        );
      } catch {
        setMessage(
          "Nie udało się zapisać kalibracji. Zaloguj się i spróbuj ponownie.",
        );
      }
    });
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-border bg-card2 p-3",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <RotateCcw className="mt-0.5 size-4 shrink-0 text-gold" />
        <div>
          <p className="text-sm font-semibold">Szybka kalibracja poziomu</p>
          <p className="text-xs text-muted2">
            Jeśli start jest za wysoki, ustaw punkt wyjścia ręcznie. Nie blokuje to
            dalszej automatycznej kalibracji po odpowiedziach.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {OPTIONS.map((option) => (
          <Button
            key={option.level}
            type="button"
            variant={option.level === "green" ? "default" : "secondary"}
            size="sm"
            disabled={isPending}
            onClick={() => handleCalibration(option.level)}
            className="h-auto flex-col items-start gap-0 py-2 text-left"
          >
            <span>
              {isPending && selected === option.level
                ? "Zapisywanie…"
                : option.label}
            </span>
            <span className="text-[11px] font-normal opacity-80">
              {option.hint}
            </span>
          </Button>
        ))}
      </div>

      {message && <p className="text-xs text-muted2">{message}</p>}
    </div>
  );
}
