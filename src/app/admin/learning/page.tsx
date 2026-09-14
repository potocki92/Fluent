import type { Metadata } from "next";

import {
  getConceptStrengths,
  getTopWeaknesses,
  getUserSkillProfile,
} from "@/lib/learning/queries";
import { VERDICT_LABEL_PL } from "@/lib/learning/knowledge-model";
import { WEAKNESS_SEVERITY_LABEL_PL } from "@/lib/learning/weakness";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Model wiedzy — Fluent",
};

/**
 * A development window onto the learning engine, for the signed-in admin's OWN
 * data — it reads the same query layer the product will eventually use, so a
 * broken pipeline is visible here instead of silently producing nothing.
 *
 * This is NOT the eventual learner-facing view. The numbers are an internal
 * heuristic estimate, not a CEFR level, and they are labelled as such. When the
 * product does surface a knowledge profile, it should be designed for learners
 * rather than grown from this page.
 */
export default async function AdminLearningPage() {
  const [profile, weaknesses, strengths] = await Promise.all([
    getUserSkillProfile(),
    getTopWeaknesses(5),
    getConceptStrengths(3),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">Model wiedzy (podgląd)</h1>
        <p className="text-sm text-muted2">
          Wewnętrzny szacunek silnika nauki dla Twojego konta. To nie jest ocena
          CEFR — poziom pokazuje pierścień na stronie statystyk.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Umiejętności
        </h2>
        <div className="space-y-2">
          {profile.map((skill) => (
            <Card key={skill.code} className="gap-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{skill.labelPl}</span>
                <span
                  className={cn(
                    "text-sm",
                    skill.verdict === "unknown" || skill.verdict === "insufficient"
                      ? "text-muted2"
                      : "text-main",
                  )}
                >
                  {VERDICT_LABEL_PL[skill.verdict]}
                </span>
              </div>
              <p className="text-xs text-muted2">
                {skill.verdict === "unknown"
                  ? skill.isAssessed
                    ? "Brak odpowiedzi — jeszcze nic nie wiemy."
                    : "Fluent nie sprawdza jeszcze tej umiejętności."
                  : `wynik ${formatScore(skill.score)} · pewność ${formatScore(
                      skill.confidence,
                    )} · ${skill.evidenceCount} odp.`}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Powtarzające się trudności
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
            {weaknesses.map((concept, index) => (
              <li key={concept.code}>
                <Card className="gap-1 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {index + 1}. {concept.labelPl}
                    </span>
                    <span className="text-xs text-muted2">
                      {WEAKNESS_SEVERITY_LABEL_PL[concept.severity]}
                    </span>
                  </div>
                  <p className="text-xs text-muted2">
                    {concept.failureCount} z {concept.evidenceCount} odpowiedzi
                    błędnych · pewność {formatScore(concept.confidence)} ·
                    aktualność {formatScore(concept.recency)}
                  </p>
                  <p className="font-mono text-xs text-muted2">{concept.code}</p>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The ranking model is not only negative: the same aggregate names what
          is working. A learner told only about their problems learns that
          opening the app feels bad. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
          Mocne strony
        </h2>
        {strengths.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-muted2">
              Jeszcze nic nie jest potwierdzone wystarczającą liczbą odpowiedzi.
            </p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {strengths.map((concept) => (
              <li key={concept.code}>
                <Card className="gap-1 p-4">
                  <span className="font-semibold">{concept.labelPl}</span>
                  <p className="text-xs text-muted2">
                    wynik {formatScore(concept.score)} · pewność{" "}
                    {formatScore(concept.confidence)} · {concept.evidenceCount} odp.
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatScore(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
