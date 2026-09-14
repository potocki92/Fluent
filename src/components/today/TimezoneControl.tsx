"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Globe, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { updateLearningPreferences } from "@/actions/update-learning-preferences";
import {
  LEARNING_PREFERENCES_KEY,
  useLearningPreferences,
} from "@/hooks/useLearningPreferences";
import { DEFAULT_TIMEZONE } from "@/lib/learning/planner/learning-day";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Which day a learner is on.
 *
 * NOT A COSMETIC SETTING. `unique (user_id, learning_date)` is what makes one
 * plan per day possible at all, so the date has to be the learner's — a learner
 * in Warsaw at 23:30 UTC is already on tomorrow, and a plan keyed to the
 * server's day would hand them yesterday's.
 *
 * Rather than a thousand-entry IANA picker, the device is asked. That is
 * accurate for almost everyone, wrong only in the ways the learner can see and
 * correct, and it is offered rather than applied silently: quietly rewriting
 * someone's timezone because they opened the app on holiday would move their
 * day boundary without their knowing.
 */
/** The device's own zone — a client-only value, so the server snapshot is null. */
const NO_SUBSCRIPTION = () => () => {};

function readDeviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function TimezoneControl() {
  const queryClient = useQueryClient();
  const { data } = useLearningPreferences();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server has no device timezone, so rendering one would be a hydration
  // mismatch. `useSyncExternalStore` is the supported way to read a client-only
  // value: it yields null on the server and the real zone after hydration,
  // without a setState-in-effect cascade.
  const deviceZone = useSyncExternalStore(NO_SUBSCRIPTION, readDeviceZone, () => null);

  const current = data?.timezone ?? DEFAULT_TIMEZONE;
  const differs = deviceZone !== null && deviceZone !== current;

  async function useDeviceZone() {
    if (!deviceZone || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await updateLearningPreferences({ timezone: deviceZone });
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Strefa czasowa</p>
          <p className="text-xs text-muted2">
            Decyduje, o której zaczyna się Twój dzień nauki.
          </p>
        </div>
        {saving && <Loader2 className="size-4 animate-spin text-muted2" aria-hidden />}
        {saved && !saving && <Check className="size-4 text-green" aria-hidden />}
      </div>

      <p className="flex items-center gap-1.5 text-sm">
        <Globe className="size-4 text-muted2" aria-hidden />
        <span className="truncate">{current}</span>
      </p>

      {differs && (
        <div className="space-y-2">
          <p className="text-xs text-muted2">
            To urządzenie jest w strefie <strong>{deviceZone}</strong>.
          </p>
          <Button size="sm" variant="secondary" onClick={useDeviceZone} disabled={saving}>
            Użyj strefy z tego urządzenia
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      )}
    </Card>
  );
}
