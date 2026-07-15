import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[11px] font-bold uppercase text-[#2b9188]">{eyebrow}</p> : null}
        <h1 className="text-[clamp(1.55rem,2.3vw,2rem)] font-bold leading-tight text-[#17212b]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#66727f]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
