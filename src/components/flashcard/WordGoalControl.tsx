"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { updateWordGoal } from "@/actions/update-word-goal";
import { useWordGoal } from "@/hooks/useWordGoal";
import { Card } from "@/components/ui/card";

const PRESETS = [5, 10, 15, 20, 30, 50] as const;

export function WordGoalControl() {
  const queryClient = useQueryClient();
  const { data } = useWordGoal();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentGoal = data?.goal ?? 20;

  async function choose(goal: number) {
    if (saving || goal === currentGoal) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateWordGoal(goal);
      await queryClient.invalidateQueries({ queryKey: ["word-goal"] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-3 bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Dzienny cel powtórek</p>
          <p className="text-xs text-muted2">
            Liczba słówek do powtórzenia każdego dnia.
          </p>
        </div>
        {saving && <Loader2 className="size-4 animate-spin text-muted2" />}
        {saved && !saving && <Check className="size-4 text-green" />}
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={saving}
            onClick={() => choose(n)}
            className={
              n === currentGoal
                ? "rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-[#1a202c] transition-colors"
                : "rounded-lg bg-[#374151] px-3 py-1.5 text-sm font-medium text-[#e2e8f0] transition-colors hover:bg-[#4a5568] disabled:opacity-50"
            }
          >
            {n}
          </button>
        ))}
      </div>
    </Card>
  );
}
