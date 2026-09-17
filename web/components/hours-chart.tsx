"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
export default function HoursChart({
  data,
}: {
  data: { date: string; seconds: number }[];
}) {
  return (
    <div className="chart" aria-label="Daily completed hours chart">
      <ResponsiveContainer width="100%" height={230}>
        <BarChart
          data={data.map((d) => ({ date: d.date, hours: d.seconds / 3600 }))}
          margin={{ top: 10, left: -25, bottom: 0, right: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 4"
            vertical={false}
            stroke="var(--border)"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(s) =>
              new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                timeZone: "UTC",
              }).format(new Date(s))
            }
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(n) => `${n}h`}
          />
          <Tooltip
            cursor={{ fill: "var(--accent-soft)" }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
            formatter={(value) => [
              `${Number(value).toFixed(2)} hours`,
              "Worked",
            ]}
            labelFormatter={(value) => String(value)}
          />
          <Bar
            dataKey="hours"
            fill="var(--accent)"
            radius={[5, 5, 0, 0]}
            maxBarSize={42}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
