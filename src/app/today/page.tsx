import type { Metadata } from "next";
import Link from "next/link";

import { getOrCreateTodayPlan } from "@/actions/today-plan";
import { requireAccountUser } from "@/lib/auth/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { localHour, normalizeTimeZone } from "@/lib/learning/planner/learning-day";
import { LevelCard } from "@/components/level/LevelCard";
import { QuickActions } from "@/components/today/QuickActions";
import { TodayDashboard } from "@/components/today/TodayDashboard";
import { TodayHeader } from "@/components/today/TodayHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dzisiaj · Fluent" };

/**
 * The home screen.
 *
 * It answers one question — "co powinienem dzisiaj zrobić?" — and it answers it
 * with a plan rather than a menu. Everything that decides the answer lives in
 * `src/lib/learning/planner/`; this file fetches and renders. That split is
 * deliberate: recommendation logic inside a page component is logic nobody can
 * test and nothing else can reuse.
 */
export default async function TodayPage() {
  const supabase = await createServerSupabaseClient();
  // The proxy already turned away anyone without an account (§81). This is the
  // second lock on the same door, and it is what hands the page a `user` it does
  // not have to null-check.
  const user = await requireAccountUser("/today", supabase);

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone")
    .eq("id", user.id)
    .maybeSingle();

  const timezone = normalizeTimeZone(profile?.timezone);
  const result = await getOrCreateTodayPlan();

  // A planner failure must never take the app down with it. The learner loses
  // the recommendation, not the ability to learn — the technical detail is
  // already in the server log, where it belongs.
  if (!result.ok) return <PlanUnavailable message={result.message} />;

  const improved =
    result.items
      .filter((item) => item.type === "weakness_practice" && item.status === "completed")
      .map((item) => item.payload.conceptLabel)
      .find((label): label is string => typeof label === "string") ?? null;

  return (
    <div className="space-y-5">
      <TodayHeader
        displayName={profile?.display_name ?? null}
        hour={localHour(timezone)}
        remainingMinutes={result.remainingMinutes}
        targetMinutes={result.targetMinutes}
        streak={result.streak}
        isComplete={result.status === "completed"}
      />

      {result.items.length === 0 ? (
        <NothingToDo />
      ) : (
        <TodayDashboard plan={result} improved={improved} />
      )}
    </div>
  );
}


/**
 * The fallback when the plan could not be built.
 *
 * It offers the two things that always work regardless of the planner, because
 * "coś poszło nie tak" with no way forward is how a learner decides the app is
 * broken and stops opening it.
 */
function PlanUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Dzisiaj</h1>
      <Card className="gap-3 p-5">
        <p className="text-sm font-semibold">Nie udało się przygotować planu</p>
        <p className="text-sm text-muted2">{message}</p>
        <p className="text-sm text-muted2">
          Możesz przejść od razu do powtórek albo do czytania — nauka działa
          normalnie.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/review">Powtórki</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/learn">Czytaj</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * Genuinely nothing to recommend — no deck, no weaknesses, no unread passages.
 *
 * It keeps the level card and the quick actions rather than leaving one small
 * card alone on a dashboard-width page: an empty plan is not an empty app, and
 * the four tiles are exactly the "go and do something" this state is asking for.
 */
function NothingToDo() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <LevelCard />
        <Card className="app-panel justify-center gap-3 p-5">
          <p className="text-sm font-semibold">Na dziś nie mamy dla Ciebie zadań</p>
          <p className="text-sm text-muted2">
            Zacznij od przeczytania tekstu albo zapisz słowa ze słownika — plan na
            jutro będzie już dopasowany do Ciebie.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="rounded-full">
              <Link href="/library">Wybierz tekst</Link>
            </Button>
            <Button asChild size="sm" variant="secondary" className="rounded-full">
              <Link href="/browse">Przeglądaj słownik</Link>
            </Button>
          </div>
        </Card>
      </div>
      <QuickActions />
    </div>
  );
}
