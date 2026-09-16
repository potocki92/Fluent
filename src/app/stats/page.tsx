import { Flame, MessageSquare, BookmarkCheck, CheckCircle2 } from "lucide-react";

import { WordGoalStat } from "@/components/flashcard/WordGoalStat";

import { requireAccountUser } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LevelSummary } from "@/components/level/LevelSummary";
import { CefrMilestones } from "@/components/level/CefrMilestones";
import {
  AbilityChart,
  type AbilityChartAttempt,
} from "@/components/charts/AbilityChart";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Statystyki · Fluent" };

/** How many of the learner's latest attempts the progress chart plots. */
const CHART_POINTS = 50;

export default async function StatsPage() {
  const supabase = await createServerSupabaseClient();
  // Gated centrally by the proxy; re-checked here so the queries below can be
  // written for a learner who exists rather than branching on one who might not.
  const user = await requireAccountUser("/stats", supabase);

  const profilePromise = supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // The chart plots the learner's MOST RECENT attempts. Ordering ascending and
  // then limiting took the OLDEST 50 instead, so past 50 answers the graph
  // froze on ancient history. Take the newest rows, then reverse for display so
  // the line still reads left-to-right in time order.
  const attemptsPromise = supabase
    .from("attempts")
    .select("ability_after, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHART_POINTS);

  const savedCountPromise = supabase
    .from("saved_words")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const masteredCountPromise = supabase
    .from("saved_words")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_mastered", true);

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

  const ability = Number(profile?.ability ?? 1000);
  const answered = profile?.answered ?? 0;
  const streak = profile?.streak_days ?? 0;
  const chartAttempts = ((attempts ?? []) as AbilityChartAttempt[])
    .slice()
    .reverse();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Statystyki</h1>

      {/* A) Level banner */}
      <Card className="bg-[#2d3748] p-4">
        <LevelSummary
          size="lg"
          initial={{ ability, rd: Number(profile?.rd ?? 350), answered }}
        />
      </Card>

      {/* B) Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        <WordGoalStat />
      </div>

      {/* C) Ability chart */}
      <Card className="gap-3 bg-[#2d3748] p-4">
        <h2 className="text-sm font-semibold text-muted2">Postęp umiejętności</h2>
        <AbilityChart attempts={chartAttempts} />
      </Card>

      {/* D) CEFR milestones */}
      <Card className="gap-4 bg-[#2d3748] p-4">
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
    <Card className="items-center gap-1 bg-[#2d3748] p-3 text-center">
      {icon}
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs text-muted2">{label}</span>
    </Card>
  );
}
