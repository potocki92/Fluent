import type { Metadata } from "next";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildDailyPlanDraft } from "@/lib/learning/planner/build";
import {
  DEFAULT_DAILY_MINUTES,
  SIGNAL_WEIGHTS,
} from "@/lib/learning/planner/constants";
import {
  learningDateFor,
  normalizeTimeZone,
} from "@/lib/learning/planner/learning-day";
import {
  PLAN_ITEM_TITLE_PL,
  renderReason,
} from "@/lib/learning/planner/reasons";
import { CONCEPTS } from "@/lib/learning/concepts";
import { getTopWeaknesses } from "@/lib/learning/queries";
import { WEAKNESS_SEVERITY_LABEL_PL } from "@/lib/learning/weakness";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Planner (debug) — Fluent" };

/**
 * A window onto the Today planner, for the signed-in admin's OWN data.
 *
 * WHY THIS EXISTS. "Why did the planner pick that?" is the question every tuning
 * session starts with, and a stored `priority_score: 0.87` cannot answer it. So
 * the signals are shown individually, next to the plan the planner would build
 * right now and the plan it actually stored today — the difference between the
 * two is exactly what the stability rule (generate once, never rebuild) is
 * doing.
 *
 * CONTENT COVERAGE is the other half. A weakness with no questions behind it
 * produces no task, silently and correctly; this page is where that silence
 * becomes visible, because it is a content problem someone can fix and the
 * ceiling on how good a plan can get.
 *
 * Not a learner-facing screen. Everything here is raw model output.
 */
export default async function AdminPlannerPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-muted2">Zaloguj się.</p>;

  const { data: profile } = await supabase
    .from("profiles")
    .select("ability, level_source, timezone, daily_learning_minutes")
    .eq("id", user.id)
    .maybeSingle();

  const now = new Date();
  const timezone = normalizeTimeZone(profile?.timezone);
  const learningDate = learningDateFor(timezone, now);

  const [draft, weaknesses, coverage, storedPlan] = await Promise.all([
    buildDailyPlanDraft(supabase, {
      userId: user.id,
      now,
      targetMinutes: profile?.daily_learning_minutes ?? DEFAULT_DAILY_MINUTES,
      ability: Number(profile?.ability ?? 1000),
      levelSource: profile?.level_source ?? "default",
    }),
    getTopWeaknesses(5, now),
    supabase.from("concept_practice_pool").select("concept_code, question_count"),
    supabase
      .from("daily_plans")
      .select("id, status, algorithm_version, evidence_level, estimated_minutes")
      .eq("user_id", user.id)
      .eq("learning_date", learningDate)
      .maybeSingle(),
  ]);

  const questionCounts = new Map(
    (coverage.data ?? []).map((row) => [row.concept_code, row.question_count]),
  );
  const uncovered = CONCEPTS.filter((concept) => !questionCounts.has(concept.code));
  const weakAndUncovered = weaknesses.filter(
    (weakness) => (questionCounts.get(weakness.code) ?? 0) === 0,
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">Planner (debug)</h1>
        <p className="text-sm text-muted2">
          Co planner wybrałby teraz dla Twojego konta — {draft.algorithmVersion}, dzień
          nauki {learningDate} ({timezone}), budżet {draft.targetMinutes} min, dowody:{" "}
          {draft.evidenceLevel}.
        </p>
        {storedPlan.data && (
          <p className="text-xs text-muted2">
            Zapisany plan na dziś: {storedPlan.data.algorithm_version} ·{" "}
            {storedPlan.data.status} · {storedPlan.data.estimated_minutes} min ·
            dowody: {storedPlan.data.evidence_level}
          </p>
        )}
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Wybrane zadania ({draft.estimatedMinutes} min)
        </h2>
        {draft.items.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted2">Brak kandydatów.</p>
          </Card>
        ) : (
          <ol className="space-y-2">
            {draft.items.map((item) => (
              <li key={`${item.type}-${item.position}`}>
                <Card className="gap-1 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {item.position}. {PLAN_ITEM_TITLE_PL[item.type]}
                    </span>
                    <span className="font-mono text-xs text-gold">
                      {item.priority.toFixed(3)}
                    </span>
                  </div>
                  <p className="text-xs text-muted2">
                    {item.type} · {item.estimatedMinutes} min · cel{" "}
                    {item.targetCount} · {renderReason(item.reason)}
                  </p>
                  <SignalTable signals={item.signals} />
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Ranking słabości
        </h2>
        {weaknesses.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted2">
              Brak — pojedyncza pomyłka nie wystarcza, żeby uznać zagadnienie za
              słabą stronę.
            </p>
          </Card>
        ) : (
          <ol className="space-y-2">
            {weaknesses.map((weakness, index) => (
              <li key={weakness.code}>
                <Card className="gap-1 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {index + 1}. {weakness.labelPl}
                    </span>
                    <span className="text-xs text-muted2">
                      {WEAKNESS_SEVERITY_LABEL_PL[weakness.severity]}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted2">
                    {weakness.code} · priority {weakness.priority.toFixed(3)} ×
                    recency {weakness.recency.toFixed(2)} = severity{" "}
                    {weakness.severityScore.toFixed(3)}
                  </p>
                  <p className="text-xs text-muted2">
                    score {weakness.score.toFixed(2)} · confidence{" "}
                    {weakness.confidence.toFixed(2)} · {weakness.failureCount} z{" "}
                    {weakness.evidenceCount} błędnych · pytań w banku:{" "}
                    {questionCounts.get(weakness.code) ?? 0}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Pokrycie treścią
        </h2>
        {weakAndUncovered.length > 0 && (
          <Card className="gap-1 border-red/50 p-4">
            <p className="text-sm font-semibold text-red">
              Słabości bez ćwiczeń ({weakAndUncovered.length})
            </p>
            <p className="text-xs text-muted2">
              Planner pomija te zagadnienia — nie ma czym ich ćwiczyć. To
              najważniejsza luka w banku pytań.
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {weakAndUncovered.map((weakness) => (
                <li key={weakness.code} className="font-mono text-muted2">
                  {weakness.code} — {weakness.labelPl}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card className="gap-1 p-4">
          <p className="text-sm font-semibold">
            Zagadnienia bez otagowanych pytań ({uncovered.length} z {CONCEPTS.length})
          </p>
          <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs sm:grid-cols-2">
            {uncovered.map((concept) => (
              <li key={concept.code} className="font-mono text-muted2">
                {concept.code}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Wagi sygnałów
        </h2>
        <Card className="p-4">
          <SignalTable signals={SIGNAL_WEIGHTS} />
        </Card>
      </section>
    </div>
  );
}

function SignalTable({ signals }: { signals: Record<string, number | undefined> }) {
  const entries = Object.entries(signals).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return null;

  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 font-mono text-xs text-muted2">
      {entries.map(([name, value]) => (
        <div key={name} className="col-span-2 flex justify-between">
          <dt>{name}</dt>
          <dd className="text-main">{(value as number).toFixed(3)}</dd>
        </div>
      ))}
    </dl>
  );
}
