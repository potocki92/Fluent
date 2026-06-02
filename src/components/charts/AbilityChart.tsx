"use client";

import { useSyncExternalStore } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** A single attempt row needed to plot ability over time. */
export interface AbilityChartAttempt {
  ability_after: number;
  created_at: string;
}

interface ChartPoint {
  index: number;
  ability: number;
  date: string;
}

/** CEFR band boundaries used for the Y-axis ticks and reference lines. */
const BAND_TICKS = [1000, 1200, 1400, 1600];
const BAND_LABELS: Record<number, string> = {
  1000: "A1",
  1200: "A2",
  1400: "B1",
  1600: "B2",
};

const dateFmt = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
});

/** Returns false on the server and during hydration, true once mounted. */
const emptySubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Ability-over-time line chart, styled fully for the dark theme. Plots the
 * learner's Elo `ability_after` for the last N attempts against the CEFR band
 * boundaries.
 */
export function AbilityChart({ attempts }: { attempts: AbilityChartAttempt[] }) {
  // Recharts' ResponsiveContainer measures the DOM, so defer rendering until
  // mounted on the client to avoid SSR hydration mismatches.
  if (!useHydrated()) {
    return <div className="h-[180px]" />;
  }

  if (attempts.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-muted2">
        Brak danych — odpowiedz na kilka pytań, aby zobaczyć postęp.
      </div>
    );
  }

  const data: ChartPoint[] = attempts.map((a, i) => ({
    index: i + 1,
    ability: Math.round(Number(a.ability_after)),
    date: dateFmt.format(new Date(a.created_at)),
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="#374151" strokeDasharray="3 3" />
        <XAxis dataKey="index" hide />
        <YAxis
          domain={[900, 1700]}
          ticks={BAND_TICKS}
          tickFormatter={(v: number) => BAND_LABELS[v] ?? ""}
          stroke="#a0aec0"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        {BAND_TICKS.map((t) => (
          <ReferenceLine key={t} y={t} stroke="#374151" strokeDasharray="3 3" />
        ))}
        <Tooltip content={<AbilityTooltip />} cursor={{ stroke: "#374151" }} />
        <Line
          type="monotone"
          dataKey="ability"
          stroke="#d4a574"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#d4a574" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Dark custom tooltip showing the Elo value and date for a point. */
function AbilityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-[#374151] bg-[#2d3748] px-3 py-2 text-xs">
      <p className="font-semibold text-gold">Elo: {point.ability}</p>
      <p className="text-muted2">{point.date}</p>
    </div>
  );
}
