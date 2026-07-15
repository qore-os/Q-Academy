import Link from "next/link";
import { FileText, History, ShieldBan } from "lucide-react";
import type { CoreDictionary } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

type EmailCenterCopy = CoreDictionary["experience"]["emailCenter"];

export function EmailCenterTabs({
  active,
  copy,
  suppressionLabel,
}: {
  active: "history" | "templates" | "suppressions";
  copy: EmailCenterCopy;
  suppressionLabel?: string;
}) {
  const tabs = [
    {
      id: "history",
      href: "/admin/email",
      label: copy.tabs.outbox,
      icon: History,
    },
    {
      id: "templates",
      href: "/admin/email/templates",
      label: copy.tabs.templates,
      icon: FileText,
    },
    {
      id: "suppressions",
      href: "/admin/email/suppressions",
      label: suppressionLabel ?? "Suppressions",
      icon: ShieldBan,
    },
  ] as const;
  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-[#dfe4e8]"
      aria-label={copy.title}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active === tab.id ? "page" : undefined}
            className={cn(
              "focus-ring flex h-10 shrink-0 items-center gap-2 border-b-2 px-4 text-xs font-semibold",
              active === tab.id
                ? "border-[var(--brand-accent)] text-[var(--brand-primary)]"
                : "border-transparent text-[#71808b] hover:text-[#354555]",
            )}
          >
            <Icon className="size-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
