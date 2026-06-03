"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";

import { abilityToCefr } from "@/lib/cefr";
import { LevelRing } from "@/components/level/LevelRing";
import { Confetti } from "@/components/level/Confetti";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function emojiFor(pct: number): string {
  if (pct >= 100) return "🎉";
  if (pct >= 60) return "👍";
  return "💪";
}

function Results() {
  const search = useSearchParams();
  const correct = Number(search.get("correct") ?? 0);
  const total = Number(search.get("total") ?? 0);
  const abilityBefore = Number(search.get("abilityBefore") ?? 0);
  const abilityAfter = Number(search.get("abilityAfter") ?? abilityBefore);

  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const delta = Math.round(abilityAfter - abilityBefore);
  const cefrBefore = abilityToCefr(abilityBefore);
  const cefrAfter = abilityToCefr(abilityAfter);
  const cefrChanged = cefrBefore !== cefrAfter;
  const nextLevel = abilityToCefr(abilityAfter);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      {cefrChanged && <Confetti />}

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className="w-full"
      >
        <Card className="items-center gap-4 bg-[#2d3748] p-5 text-center">
          <span className="text-4xl">{emojiFor(pct)}</span>
          <p className="text-xl font-bold">
            {correct} / {total} poprawnych
          </p>

          <LevelRing size="sm" ability={abilityAfter} answered={total} />

          <div className="space-y-1">
            <p className="text-base font-semibold">
              {cefrBefore}
              <span className="mx-1.5 text-muted2">→</span>
              <span className={cefrChanged ? "text-gold" : undefined}>
                {cefrAfter}
              </span>
            </p>
            <p className="text-sm text-muted2">
              Elo: {Math.round(abilityBefore)} → {Math.round(abilityAfter)}{" "}
              <span className={delta >= 0 ? "text-green" : "text-red"}>
                ({delta > 0 ? "+" : ""}
                {delta})
              </span>
            </p>
          </div>
        </Card>
      </motion.div>

      <div className="mt-5 flex w-full flex-col gap-2">
        <Button
          asChild
          className="w-full bg-gold text-[#1a202c] hover:bg-gold-dark"
        >
          <Link href="/learn">Następny tekst (poziom {nextLevel})</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/stats">Moje statystyki</Link>
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
