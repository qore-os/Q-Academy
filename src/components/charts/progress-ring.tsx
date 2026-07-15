"use client";

import { cn } from "@/lib/utils";

export type RingTone = "navy" | "teal" | "coral";

export type ProgressRingProps = {
  value: number;
  label?: string;
  size?: number;
  strokeWidth?: number;
  tone?: RingTone;
  className?: string;
};

const TONE_COLORS: Record<RingTone, string> = {
  navy: "#17324d",
  teal: "#2bb7a9",
  coral: "#ee6c5d",
};

const VIEWBOX_SIZE = 120;
const CENTER = VIEWBOX_SIZE / 2;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function ProgressRing({
  value,
  label = "Fortschritt",
  size = 112,
  strokeWidth = 9,
  tone = "teal",
  className,
}: ProgressRingProps) {
  const normalizedValue = clamp(Number.isFinite(value) ? value : 0, 0, 100);
  const roundedValue = Math.round(normalizedValue);
  const normalizedSize = clamp(Number.isFinite(size) ? size : 112, 72, 240);
  const normalizedStroke = clamp(
    Number.isFinite(strokeWidth) ? strokeWidth : 9,
    4,
    16,
  );
  const radius = (VIEWBOX_SIZE - normalizedStroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedValue / 100);

  return (
    <div
      className={cn(
        "relative aspect-square max-w-full shrink-0 text-[#17324d]",
        className,
      )}
      style={{ width: normalizedSize }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={roundedValue}
      aria-valuetext={`${roundedValue} Prozent ${label}`}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        aria-hidden="true"
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={radius}
          stroke="#17324d"
          strokeOpacity={0.1}
          strokeWidth={normalizedStroke}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={radius}
          stroke={TONE_COLORS[tone]}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth={normalizedStroke}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      </svg>

      <span
        className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center"
        aria-hidden="true"
      >
        <span className="text-2xl font-bold leading-none tabular-nums">
          {roundedValue}%
        </span>
        <span className="mt-1 max-w-full truncate text-[11px] font-medium text-[#17324d]/60">
          {label}
        </span>
      </span>
    </div>
  );
}
