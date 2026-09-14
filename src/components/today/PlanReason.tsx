import { Info } from "lucide-react";

import { renderReason, type PlanReason as Reason } from "@/lib/learning/planner/reasons";

/**
 * The one-line "dlaczego to mi pokazujesz?" under an activity.
 *
 * The reason is stored as a code plus its data and turned into Polish HERE, at
 * the last possible moment. What a learner must never see is the raw model —
 * `concept_score = 0.423`, `confidence = 0.812` — which is true, unhelpful, and
 * invites them to argue with a number instead of doing the exercise.
 */
export function PlanReason({ reason }: { reason: Reason }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted2">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{renderReason(reason)}</span>
    </p>
  );
}
