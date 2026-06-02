"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface AbilityPoint {
  /** Short label for the x-axis (e.g. attempt number or date). */
  label: string;
  ability: number;
}

/** Line chart of the learner's Elo ability over time. */
export function AbilityChart({ data }: { data: AbilityPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted2">
        Brak danych — odpowiedz na kilka pytań, aby zobaczyć postęp.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={224}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <XAxis
          dataKey="label"
          stroke="#a0aec0"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#a0aec0"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          domain={["dataMin - 50", "dataMax + 50"]}
        />
        <Tooltip
          contentStyle={{
            background: "#2d3748",
            border: "1px solid #374151",
            borderRadius: 8,
            color: "#e2e8f0",
          }}
          labelStyle={{ color: "#a0aec0" }}
        />
        <Line
          type="monotone"
          dataKey="ability"
          stroke="#d4a574"
          strokeWidth={2}
          dot={{ r: 3, fill: "#d4a574" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
