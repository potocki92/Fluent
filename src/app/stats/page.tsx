import { Flame, MessageSquare, BookmarkCheck, CheckCircle2 } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { abilityToCefr } from "@/lib/cefr";
import { confidenceLevel, type ConfidenceLevel } from "@/lib/elo";
import { LevelRing } from "@/components/level/LevelRing";
import { CefrMilestones } from "@/components/level/CefrMilestones";
import {
  AbilityChart,
  type AbilityChartAttempt,
} from "@/components/charts/AbilityChart";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Statystyki · Fluent" };

/** Polish labels for the estimate-confidence levels. */
const CONFIDENCE_PL: Record<ConfidenceLevel, string> = {
  calibrating: "kalibracja",
  low: "niska",
  medium: "średnia",
  high: "wysoka",
};

export default async function StatsPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profilePromise = user
    ? supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()
    : Promise.resolve({ data: null });

  const attemptsPromise = user
    ? supabase
        .from("attempts")
        .select("ability_after, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(50)
    : Promise.resolve({ data: [] as AbilityChartAttempt[] });

  const savedCountPromise = user
    ? supabase
        .from("saved_words")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
    : Promise.resolve({ count: 0 });

  const masteredCountPromise = user
    ? supabase
        .from("saved_words")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_mastered", true)
    : Promise.resolve({ count: 0 });

  const [
    { data: profile },
    { data: attempts },
    { count: savedCount },
    { count: masteredCount },
  ] = await Promise.all([
    profilePromise,
    attemptsPromise,
    savedCountPromise,
    masteredCountPromise,
  ]);

  const ability = Number(profile?.ability ?? 1200);
  const answered = profile?.answered ?? 0;
  const streak = profile?.streak_days ?? 0;
  const cefr = abilityToCefr(ability);
  const confidence = CONFIDENCE_PL[confidenceLevel(answered)];
  const chartAttempts = (attempts ?? []) as AbilityChartAttempt[];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Statystyki</h1>

      {/* A) Level banner */}
      <Card className="flex-row items-center gap-4 bg-[#2d3748] p-6">
        <LevelRing ability={ability} answered={answered} size="lg" />
        <div className="space-y-1">
          <p className="text-lg font-bold">
            Twój poziom: <span className="text-gold">{cefr}</span>
          </p>
          <p className="text-sm text-muted2">
            Elo: {Math.round(ability)} · Pewność: {confidence}
          </p>
          <p className="text-xs text-muted2">
            Na podstawie {answered} odpowiedzi
          </p>
        </div>
      </Card>

      {/* B) Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Flame className="size-5 text-gold" />}
          value={`${streak} dni`}
          label="Passa"
        />
        <Stat
          icon={<MessageSquare className="size-5 text-blue" />}
          value={answered}
          label="Odpowiedzi"
        />
        <Stat
          icon={<BookmarkCheck className="size-5 text-gold" />}
          value={savedCount ?? 0}
          label="Słów zapisanych"
        />
        <Stat
          icon={<CheckCircle2 className="size-5 text-green" />}
          value={masteredCount ?? 0}
          label="Opanowanych"
        />
      </div>

      {/* C) Ability chart */}
      <Card className="gap-3 bg-[#2d3748] p-5">
        <h2 className="text-sm font-semibold text-muted2">Postęp umiejętności</h2>
        <AbilityChart attempts={chartAttempts} />
      </Card>

      {/* D) CEFR milestones */}
      <Card className="gap-4 bg-[#2d3748] p-5">
        <h2 className="text-sm font-semibold text-muted2">Kamienie milowe CEFR</h2>
        <CefrMilestones ability={ability} />
      </Card>
    </div>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <Card className="items-center gap-1 bg-[#2d3748] p-4 text-center">
      {icon}
      <span className="text-xl font-bold">{value}</span>
      <span className="text-xs text-muted2">{label}</span>
    </Card>
  );
}
