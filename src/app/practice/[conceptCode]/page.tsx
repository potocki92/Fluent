import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CONCEPT_CATALOG, isConceptCode } from "@/lib/learning/concepts";
import { PracticeRunner } from "@/components/practice/PracticeRunner";
import { WeaknessDetail } from "@/components/today/WeaknessDetail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conceptCode: string }>;
}): Promise<Metadata> {
  const { conceptCode } = await params;
  if (!isConceptCode(conceptCode)) return { title: "Ćwiczenie · Fluent" };
  return { title: `${CONCEPT_CATALOG[conceptCode].labelPl} · Fluent` };
}

/**
 * A weakness drill for one concept.
 *
 * Reachable from today's plan, and directly — practising something on purpose is
 * never gated on the planner having suggested it. The `item` query parameter is
 * the plan activity that opened it, so that finishing the drill moves that
 * activity; its absence just means the drill stands alone.
 *
 * Like the test screen, this page does NOT fetch the questions. Which items the
 * drill contains is decided when the session opens and snapshotted server-side,
 * so a page that pre-loaded a list would only be a second, unauthoritative copy.
 */
export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ conceptCode: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { conceptCode } = await params;
  if (!isConceptCode(conceptCode)) notFound();

  const { item } = await searchParams;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Ćwiczenie</h1>
        <p className="text-sm text-muted2">
          Kilka pytań na zagadnienie, które ostatnio sprawiało Ci kłopot.
        </p>
      </div>

      <WeaknessDetail conceptCode={conceptCode} />

      <PracticeRunner conceptCode={conceptCode} planItemId={item ?? null} />
    </div>
  );
}
