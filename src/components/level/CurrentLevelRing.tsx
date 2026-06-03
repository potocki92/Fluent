"use client";

import { useAbility } from "@/hooks/useAbility";
import { useProfile } from "@/hooks/useProfile";
import { LevelRing } from "@/components/level/LevelRing";

/**
 * Small level ring fed by the live ability store. Calling {@link useProfile}
 * here hydrates the store from Supabase once, so every consumer of `useAbility`
 * (this ring included) reflects the learner's real ability.
 */
export function CurrentLevelRing() {
  useProfile();
  const ability = useAbility((s) => s.ability);
  const answered = useAbility((s) => s.answered);

  return <LevelRing size="header" ability={ability} answered={answered} />;
}
