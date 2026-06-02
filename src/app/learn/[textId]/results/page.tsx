"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { useAbility } from "@/hooks/useAbility";
import { LevelRing } from "@/components/level/LevelRing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function Results() {
  const params = useParams<{ textId: string }>();
  const search = useSearchParams();
  const correct = Number(search.get("correct") ?? 0);
  const total = Number(search.get("total") ?? 0);
  const ability = useAbility((s) => s.ability);

  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="space-y-6 text-center">
      <h1 className="text-xl font-bold">Wynik testu</h1>

      <Card className="items-center gap-4 bg-[#2d3748] p-6">
        <LevelRing ability={ability} />
        <p className="text-lg font-semibold">
          {correct} / {total} poprawnych ({pct}%)
        </p>
        <p className="text-sm text-muted2">
          Twój aktualny poziom umiejętności: {Math.round(ability)}
        </p>
      </Card>

      <div className="flex flex-col gap-2">
        <Button
          asChild
          className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          <Link href="/learn">Następny tekst</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href={`/learn/${params.textId}`}>Przeczytaj ponownie</Link>
        </Button>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted2">Ładowanie…</p>}>
      <Results />
    </Suspense>
  );
}
