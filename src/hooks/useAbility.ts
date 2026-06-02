import { create } from "zustand";

import { abilityToCefr } from "@/lib/cefr";
import type { AbilityState, TestResult } from "@/types";

interface AbilityStore extends AbilityState {
  /** Replace the whole ability snapshot (e.g. after loading the profile). */
  setAbility: (state: Partial<AbilityState>) => void;
  /** Fold a graded answer into the store. */
  applyResult: (result: TestResult) => void;
  /** Reset to the default starting values. */
  reset: () => void;
}

const DEFAULTS: AbilityState = {
  ability: 1200,
  rd: 350,
  answered: 0,
  cefrEstimate: null,
};

export const useAbility = create<AbilityStore>((set) => ({
  ...DEFAULTS,
  setAbility: (state) =>
    set((prev) => {
      const ability = state.ability ?? prev.ability;
      return {
        ...prev,
        ...state,
        cefrEstimate: state.cefrEstimate ?? abilityToCefr(ability),
      };
    }),
  applyResult: (result) =>
    set((prev) => ({
      ability: result.abilityAfter,
      answered: prev.answered + 1,
      cefrEstimate: abilityToCefr(result.abilityAfter),
    })),
  reset: () => set({ ...DEFAULTS }),
}));
