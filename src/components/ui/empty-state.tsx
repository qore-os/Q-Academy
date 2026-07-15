import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "default",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  tone?: "default" | "inverse";
  className?: string;
}) {
  const inverse = tone === "inverse";

  return (
    <div
      className={cn(
        "flex min-h-44 flex-col items-center justify-center px-5 py-9 text-center",
        className,
      )}
      data-empty-state
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-md",
          inverse
            ? "bg-white/10 text-[#63d5ca]"
            : "bg-[#eef3f4] text-[#52697c]",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p
        className={cn(
          "mt-3 text-sm font-bold",
          inverse ? "text-white" : "text-[#2b3a48]",
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          "mt-1 max-w-md text-xs leading-5",
          inverse ? "text-white/65" : "text-[#71808b]",
        )}
      >
        {description}
      </p>
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
