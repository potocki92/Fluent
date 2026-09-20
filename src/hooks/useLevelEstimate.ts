"use client";

import { useEffect, useRef } from "react";

import { useAbility } from "@/hooks/useAbility";
import { useProfile } from "@/hooks/useProfile";
import { abilityToCefr, nextCefrLevel, progressPct } from "@/lib/cefr";
import type { CefrLevel } from "@/types";

/** A server-read snapshot of the profile's level columns. */
export interface LevelSeed {
  ability: number;
  rd: number;
  answered: number;
}

export interface LevelEstimate {
  ability: number;
  answered: number;
  /** The band the learner is in right now. */
  cefr: CefrLevel;
  /** The band above it, or null at the top of the ladder. */
  next: CefrLevel | null;
  /** Progress through the current band, 0–100. */
  percent: number;
  /** False only while the store still holds its defaults. */
  hydrated: boolean;
}

/**
 * The learner's level, from the one source of truth.
 *
 * WHY THIS IS A HOOK AND NOT THREE COPIES. The level is now shown in three
 * shapes — the chip in the header, the „Twój poziom" card on Today, the ring on
 * /stats — and every one of them needs the same four-step dance: hydrate the
 * ability store from Supabase, read it live so a finished test updates all of
 * them at once, seed it from a server snapshot where one exists, and fall back
 * to that snapshot until the store is real so the server HTML and the first
 * client paint agree. Written three times, that is three chances to reintroduce
 * the flash of "A1 / 1000" this once had.
 *
 * The arithmetic itself is not here: `abilityToCefr`, `nextCefrLevel` and
 * `progressPct` own it, in `src/lib/cefr.ts`.
 */
export function useLevelEstimate(initial?: LevelSeed): LevelEstimate {
  useProfile();
  const storeAbility = useAbility((s) => s.ability);
  const storeAnswered = useAbility((s) => s.answered);
  const cefrEstimate = useAbility((s) => s.cefrEstimate);
  const setAbility = useAbility((s) => s.setAbility);

  // Seed the store once from the server snapshot, so every consumer converges
  // immediately on a server-rendered page.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!initial || seededRef.current) return;
    setAbility(initial);
    seededRef.current = true;
  }, [initial, setAbility]);

  // `cefrEstimate` is null only at the store defaults; any hydration sets it.
  const hydrated = cefrEstimate !== null;
  const ability = hydrated ? storeAbility : initial?.ability ?? storeAbility;
  const answered = hydrated ? storeAnswered : initial?.answered ?? storeAnswered;

  return {
    ability,
    answered,
    cefr: abilityToCefr(ability),
    next: nextCefrLevel(ability),
    percent: progressPct(ability),
    hydrated,
  };
}
