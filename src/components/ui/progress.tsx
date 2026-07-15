import { cn } from "@/lib/utils";

export function Progress({ value, className, color = "#2bb7a9", label }: { value: number; className?: string; color?: string; label?: string }) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-xs text-[#66727f]">
          <span>{label}</span>
          <span className="font-semibold text-[#243444]">{safeValue}%</span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8ecef]" role="progressbar" aria-label={label ?? "Fortschritt"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${safeValue}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
