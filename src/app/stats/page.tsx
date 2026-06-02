import { Flame, Target, CheckCircle2 } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LevelRing } from "@/components/level/LevelRing";
import { AbilityChart, type AbilityPoint } from "@/components/charts/AbilityChart";
import { Card } from "@/components/ui/card";

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
        .select("ability_after, is_correct, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(50)
    : Promise.resolve({ data: [] as { ability_after: number; is_correct: boolean }[] });

  const [{ data: profile }, { data: attempts }] = await Promise.all([
    profilePromise,
    attemptsPromise,
  ]);

  const ability = Number(profile?.ability ?? 1200);
  const streak = profile?.streak_days ?? 0;
  const answered = profile?.answered ?? 0;
  const correct = (attempts ?? []).filter((a) => a.is_correct).length;
  const accuracy =
    (attempts?.length ?? 0) > 0
      ? Math.round((correct / attempts!.length) * 100)
      : 0;

  const chartData: AbilityPoint[] = (attempts ?? []).map((a, i) => ({
    label: String(i + 1),
    ability: Number(a.ability_after),
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Statystyki</h1>

      <Card className="items-center gap-3 bg-[#2d3748] p-6">
        <LevelRing ability={ability} answered={answered} size="lg" />
        <p className="text-sm text-muted2">Twój poziom umiejętności</p>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Stat icon={<Flame className="size-5 text-gold" />} value={streak} label="dni z rzędu" />
        <Stat
          icon={<CheckCircle2 className="size-5 text-green" />}
          value={`${accuracy}%`}
          label="skuteczność"
        />
        <Stat
          icon={<Target className="size-5 text-blue" />}
          value={answered}
          label="odpowiedzi"
        />
      </div>

      <Card className="gap-3 bg-[#2d3748] p-5">
        <h2 className="text-sm font-semibold text-muted2">Postęp umiejętności</h2>
        <AbilityChart data={chartData} />
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
