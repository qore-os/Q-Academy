import type { BrowserSessionTransferStatus } from "@/lib/media/browser-session-upload";
import { cn } from "@/lib/utils";

export function UploadTransferIndicator({
  status,
  label,
  className,
  indicatorClassName,
}: {
  status: BrowserSessionTransferStatus;
  label: string;
  className?: string;
  indicatorClassName?: string;
}) {
  const progress =
    status.kind === "determinate"
      ? Math.max(0, Math.min(100, status.progress))
      : null;

  return (
    <span
      role="progressbar"
      aria-label={label}
      {...(progress === null
        ? { "aria-valuetext": label }
        : {
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": progress,
          })}
      className={cn(
        "relative block h-1 overflow-hidden rounded bg-[#dfe7ed]",
        className,
      )}
    >
      <span
        className={cn(
          "block h-full rounded bg-[#2b9188]",
          status.kind === "indeterminate"
            ? "media-upload-indeterminate"
            : "transition-[width] duration-200 ease-out",
          indicatorClassName,
        )}
        style={progress === null ? undefined : { width: `${progress}%` }}
      />
    </span>
  );
}
