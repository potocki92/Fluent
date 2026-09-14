import { Sparkles } from "lucide-react";

import type { CoverageEstimate } from "@/lib/reading/coverage";

/**
 * "Znasz około 89% słów w tym rozdziale."
 *
 * …and, crucially, the other case. Fluent knows something about a few dozen of a
 * learner's words; a chapter has hundreds of distinct ones. Quoting a percentage
 * across that gap produces a number that is confident and false, and a learner
 * will use it to decide whether to start a book. So when the evidence is thin
 * this says so — which is both honest and actionable, because it tells them what
 * would change it.
 */
export function CoverageNote({ coverage }: { coverage: CoverageEstimate }) {
  if (coverage.status === "insufficient_data") {
    return (
      <p className="text-center text-xs text-muted2">
        Szacowanie znajomości słownictwa pojawi się, gdy Fluent pozna więcej
        Twoich słów.
      </p>
    );
  }

  const percent = Math.round(coverage.ratio * 100);

  return (
    <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted2">
      <Sparkles className="size-3 text-gold" />
      Znasz około <span className="font-semibold text-main">{percent}%</span>{" "}
      słownictwa tego rozdziału
    </p>
  );
}
