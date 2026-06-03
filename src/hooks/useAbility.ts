import { create } from "zustand";

import { abilityToCefr } from "@/lib/cefr";
import type { AbilityState } from "@/types";

interface AbilityStore extends AbilityState {
  /** Replace the whole ability snapshot (e.g. after loading the profile or
   * finishing a test). */
  setAbility: (state: Partial<AbilityState>) => void;
  /** Reset to the default starting values. */
  reset: () => void;
}

const DEFAULTS: AbilityState = {
  ability: 1000,
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
  reset: () => set({ ...DEFAULTS }),
}));
