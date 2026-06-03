import { abilityToCefr } from "@/lib/cefr";
import type { AbilityState } from "@/types";

export type CalibrationLevel = "green" | "a1" | "a2" | "b1" | "b2";

export const CALIBRATION_PRESETS: Record<
  CalibrationLevel,
  { ability: number; rd: number; label: string; hint: string }
> = {
  green: {
    ability: 1000,
    rd: 350,
    label: "Jestem zielony",
    hint: "start od zera",
  },
  a1: {
    ability: 1100,
    rd: 350,
    label: "Znam podstawy",
    hint: "A1",
  },
  a2: {
    ability: 1300,
    rd: 350,
    label: "Ustaw A2",
    hint: "łatwe teksty",
  },
  b1: {
    ability: 1450,
    rd: 350,
    label: "Ustaw B1",
    hint: "średnio",
  },
  b2: {
    ability: 1600,
    rd: 350,
    label: "Ustaw B2",
    hint: "trudniej",
  },
};

export const CALIBRATION_OPTIONS = Object.entries(CALIBRATION_PRESETS).map(
  ([level, preset]) => ({
    level: level as CalibrationLevel,
    label: preset.label,
    hint: preset.hint,
  }),
);

/** Build a full ability snapshot for a manually chosen calibration level. */
export function calibrationSnapshot(
  level: CalibrationLevel,
  answered: number,
): AbilityState {
  const preset = CALIBRATION_PRESETS[level];
  if (!preset) throw new Error("Nieprawidłowy poziom kalibracji.");

  return {
    ability: preset.ability,
    rd: preset.rd,
    answered,
    cefrEstimate: abilityToCefr(preset.ability),
  };
}
