"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { updateLearningPreferences } from "@/actions/update-learning-preferences";
import {
  DAILY_MINUTE_PRESETS,
  DEFAULT_DAILY_MINUTES,
} from "@/lib/learning/planner/constants";
import {
  LEARNING_PREFERENCES_KEY,
  useLearningPreferences,
} from "@/hooks/useLearningPreferences";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * How long the learner wants to study each day.
 *
 * This sits alongside the daily word goal rather than replacing it. They answer
 * different questions — "how many cards?" versus "how long?" — and only the
 * second one can size a plan that mixes reviews, drills and reading, because
 * time is the only unit those three share.
 */
export function LearningTimeControl() {
  const queryClient = useQueryClient();
  const { data } = useLearningPreferences();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = data?.dailyLearningMinutes ?? DEFAULT_DAILY_MINUTES;

  async function choose(minutes: number) {
    if (saving || minutes === current) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await updateLearningPreferences({
        dailyLearningMinutes: minutes,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: LEARNING_PREFERENCES_KEY });
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
          <p className="text-sm font-semibold">Dzienny czas nauki</p>
          <p className="text-xs text-muted2">
            Tyle czasu Fluent zaplanuje Ci na każdy dzień.
          </p>
        </div>
        {saving && <Loader2 className="size-4 animate-spin text-muted2" aria-hidden />}
        {saved && !saving && <Check className="size-4 text-green" aria-hidden />}
      </div>

      <div
        role="radiogroup"
        aria-label="Dzienny czas nauki"
        className="flex flex-wrap gap-2"
      >
        {DAILY_MINUTE_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            role="radio"
            aria-checked={minutes === current}
            disabled={saving}
            onClick={() => choose(minutes)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition-colors",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
              minutes === current
                ? "bg-gold font-semibold text-dark"
                : "bg-secondary text-main hover:bg-accent",
            )}
          >
            {minutes} min
          </button>
        ))}
      </div>

      <p className="text-xs text-muted2">
        Zmiana zacznie obowiązywać od jutrzejszego planu — dzisiejszy zostaje taki,
        jaki jest.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      )}
    </Card>
  );
}
