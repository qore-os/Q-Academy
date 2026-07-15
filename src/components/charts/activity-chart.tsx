"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

export type ActivityDatum = {
  day: string;
  active: number;
};

export type ActivityChartProps = {
  data: readonly ActivityDatum[];
  variant?: "area" | "bar";
  ariaLabel: string;
  emptyLabel: string;
  seriesLabel: string;
  locale: AppLocale;
  className?: string;
};

function formatValue(value: unknown, locale: AppLocale) {
  const numericValue = Number(value ?? 0);
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

export function ActivityChart({
  data,
  variant = "area",
  ariaLabel,
  emptyLabel,
  seriesLabel,
  locale,
  className,
}: ActivityChartProps) {
  const chartData = data.map(({ day, active }) => ({
    day,
    active: Number.isFinite(active) ? Math.max(0, active) : 0,
  }));

  if (chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex h-60 min-h-60 w-full items-center justify-center sm:h-72 sm:min-h-72",
          className,
        )}
        role="status"
      >
        <p className="text-sm text-[#17324d]/60">
          {emptyLabel}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-60 min-h-60 w-full min-w-0 sm:h-72 sm:min-h-72",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <ComposedChart
          accessibilityLayer
          data={chartData}
          desc={ariaLabel}
          margin={{ top: 10, right: 8, bottom: 0, left: -12 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#17324d"
            strokeOpacity={0.1}
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            minTickGap={18}
            tick={{ fill: "#17324d", fillOpacity: 0.68, fontSize: 12 }}
            tickMargin={10}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            domain={[0, "auto"]}
            tickLine={false}
            tickFormatter={(value) => formatValue(value, locale)}
            tick={{ fill: "#17324d", fillOpacity: 0.58, fontSize: 11 }}
            tickMargin={8}
            width={42}
          />
          <Tooltip
            cursor={
              variant === "bar"
                ? { fill: "#17324d", fillOpacity: 0.05 }
                : { stroke: "#17324d", strokeOpacity: 0.18 }
            }
            formatter={(value) => [formatValue(value, locale), seriesLabel]}
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid rgba(23, 50, 77, 0.14)",
              borderRadius: 6,
              boxShadow: "0 8px 24px rgba(23, 50, 77, 0.1)",
              color: "#17324d",
              fontSize: 12,
            }}
            itemStyle={{ color: "#17324d", padding: 0 }}
            labelStyle={{ color: "#17324d", fontWeight: 600, marginBottom: 4 }}
          />

          {variant === "bar" ? (
            <Bar
              activeBar={{ fill: "#ee6c5d" }}
              dataKey="active"
              fill="#2bb7a9"
              isAnimationActive={false}
              maxBarSize={42}
              minPointSize={2}
              radius={[5, 5, 0, 0]}
            />
          ) : (
            <Area
              activeDot={{
                fill: "#ee6c5d",
                r: 5,
                stroke: "#ffffff",
                strokeWidth: 2,
              }}
              dataKey="active"
              dot={false}
              fill="#2bb7a9"
              fillOpacity={0.16}
              isAnimationActive={false}
              stroke="#2bb7a9"
              strokeWidth={3}
              type="monotone"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
