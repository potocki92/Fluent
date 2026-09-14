import { CONCEPT_CATALOG, type ConceptCode } from "@/lib/learning/concepts";
import {
  getConceptEvidence,
  getUserWeakestConcepts,
} from "@/lib/learning/queries";
import { rankWeaknesses, WEAKNESS_SEVERITY_LABEL_PL } from "@/lib/learning/weakness";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * "Dlaczego to ćwiczę?"
 *
 * A learner told to practise Dativ deserves to see what Fluent is actually
 * looking at. What they must NOT see is the model: `score = 0.423`,
 * `confidence = 0.812` is true, useless to them, and invites an argument with a
 * number instead of an exercise. So the same state is rendered twice over —
 * counts they can verify against their own memory, and a word for how bad it is.
 *
 * This is deliberately not an analytics dashboard. It answers one question and
 * then gets out of the way.
 */
export async function WeaknessDetail({ conceptCode }: { conceptCode: ConceptCode }) {
  const definition = CONCEPT_CATALOG[conceptCode];

  const [weaknesses, evidence] = await Promise.all([
    getUserWeakestConcepts(15),
    getConceptEvidence(conceptCode),
  ]);

  const ranked = rankWeaknesses(weaknesses).find((item) => item.code === conceptCode);
  const lastFailure = ranked?.lastFailureAt ?? null;

  return (
    <Card className="gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{definition.labelPl}</p>
        {ranked && (
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              ranked.severity === "high"
                ? "bg-red/20 text-red"
                : ranked.severity === "medium"
                  ? "bg-gold/20 text-gold"
                  : "bg-secondary text-muted2",
            )}
          >
            {WEAKNESS_SEVERITY_LABEL_PL[ranked.severity]}
          </span>
        )}
      </div>

      <p className="text-sm text-muted2">{definition.descriptionPl}</p>

      {evidence.recent.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted2">
          <dt>Ostatnie odpowiedzi</dt>
          <dd className="text-right text-main">
            {evidence.correct} poprawnych · {evidence.incorrect} błędnych
          </dd>
          {lastFailure && (
            <>
              <dt>Ostatni błąd</dt>
              <dd className="text-right text-main">{relativeDay(lastFailure)}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-xs text-muted2">
          Jeszcze nie mamy wystarczająco odpowiedzi, żeby cokolwiek stwierdzić.
        </p>
      )}
    </Card>
  );
}

/** "dzisiaj" / "wczoraj" / "3 dni temu" — a date nobody has to decode. */
function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "dzisiaj";
  if (days === 1) return "wczoraj";
  if (days < 7) return `${days} dni temu`;
  if (days < 30) return `${Math.floor(days / 7)} tyg. temu`;
  return new Date(iso).toLocaleDateString("pl-PL");
}
