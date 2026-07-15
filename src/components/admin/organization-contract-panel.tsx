import { Bot, Database, GraduationCap, UsersRound } from "lucide-react";

import type { OrganizationContractOverview } from "@/lib/organization-contracts";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

function formatBytes(value: number, locale: AppLocale) {
  const [amount, unit] = value < 1024 ** 2
    ? [value / 1024, "KB"]
    : value < 1024 ** 3
      ? [value / 1024 ** 2, "MB"]
      : [value / 1024 ** 3, "GB"];
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(amount)} ${unit}`;
}

function usageLabel(value: number, limit: number | null, locale: AppLocale, copy: ReturnType<typeof getSettingsAdminCopy>, bytes = false) {
  const current = bytes ? formatBytes(value, locale) : new Intl.NumberFormat(intlLocale(locale)).format(value);
  const maximum = limit === null
    ? copy.common.unlimited
    : bytes
      ? formatBytes(limit, locale)
      : new Intl.NumberFormat(intlLocale(locale)).format(limit);
  return copy.contract.usage(current, maximum);
}

export function OrganizationContractPanel({
  overview,
  locale,
}: {
  overview: OrganizationContractOverview;
  locale: AppLocale;
}) {
  const copy = getSettingsAdminCopy(locale);
  const { contract, usage } = overview;
  if (!contract) {
    return (
      <section className="panel p-5" id="contract">
        <h2 className="text-base font-bold text-[#243444]">{copy.contract.title}</h2>
        <p className="mt-2 text-xs text-[#66727f]">
          {copy.contract.none}
        </p>
      </section>
    );
  }

  const metrics = [
    {
      label: copy.contract.seats,
      value: usageLabel(usage.seats, contract.seatLimit, locale, copy),
      icon: UsersRound,
    },
    {
      label: copy.contract.courses,
      value: usageLabel(usage.courses, contract.courseLimit, locale, copy),
      icon: GraduationCap,
    },
    {
      label: copy.contract.storage,
      value: usageLabel(usage.storageBytes, contract.storageLimitBytes, locale, copy, true),
      icon: Database,
    },
    {
      label: copy.contract.aiCredits,
      value:
        contract.aiMonthlyCredits === null
          ? copy.common.unlimited
          : new Intl.NumberFormat(intlLocale(locale)).format(contract.aiMonthlyCredits),
      icon: Bot,
    },
  ];

  return (
    <section className="panel overflow-hidden" id="contract">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f2] px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.contract.title}</h2>
          <p className="mt-1 text-xs text-[#66727f]">{copy.contract.plan(contract.planCode)}</p>
        </div>
        <span className="rounded-md bg-[#eef6f5] px-2.5 py-1 text-xs font-semibold text-[#267267]">
          {copy.contract.statuses[contract.status as keyof typeof copy.contract.statuses] ?? contract.status}
        </span>
      </header>
      <div className="grid divide-y divide-[#edf0f2] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div className="flex min-w-0 items-center gap-3 p-4" key={metric.label}>
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-[#243444]">{metric.value}</p>
                <p className="mt-0.5 text-[10px] text-[#7a8690]">{metric.label}</p>
              </div>
            </div>
          );
        })}
      </div>
      {contract.featureEntitlements.length ? (
        <div className="flex flex-wrap gap-2 border-t border-[#edf0f2] px-5 py-4">
          {contract.featureEntitlements.map((feature) => (
            <span
              className="rounded-md border border-[#dfe4e8] bg-[#f8f9fa] px-2 py-1 text-[10px] font-semibold text-[#52606d]"
              key={feature}
            >
              {feature.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
