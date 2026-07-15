import Link from "next/link";
import { BarChart3, Download, Filter, ShieldCheck, UsersRound } from "lucide-react";

import type { getMemberPropertyAnalytics } from "@/lib/member-properties";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { AppLocale } from "@/lib/i18n/model";
import {
  formatOperationsAdminNumber,
  getOperationsAdminCopy,
} from "@/lib/i18n/operations-admin";

type Analytics = Awaited<ReturnType<typeof getMemberPropertyAnalytics>>;

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm";

export function MemberPropertyAnalytics({
  analytics,
  canExport,
  locale,
}: {
  analytics: Analytics;
  canExport: boolean;
  locale: AppLocale;
}) {
  const copy = getOperationsAdminCopy(locale);
  const selected = analytics.selectedField;
  const propertyValue = selected
    ? `${selected.id}:${selected.profileDefinitionId}`
    : "";
  const exportParams = new URLSearchParams({
    property: propertyValue,
    operator: analytics.query.operator,
  });
  if (analytics.query.value) exportParams.set("value", analytics.query.value);
  return (
    <section className="panel overflow-hidden" aria-labelledby="member-property-analytics-title">
      <header className="flex flex-col gap-3 border-b border-[#e5e9ec] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 id="member-property-analytics-title" className="flex items-center gap-2 text-base font-bold text-[#243444]">
            <BarChart3 className="size-4 text-[#2b9188]" />
            {copy("member.title")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#6c7882]">
            {copy("member.description")}
          </p>
        </div>
        {canExport && selected ? (
          <Link
            href={`/admin/members/properties.csv?${exportParams.toString()}`}
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Download className="size-3.5" /> {copy("member.exportCsv")}
          </Link>
        ) : null}
      </header>

      <form method="get" className="grid gap-3 border-b border-[#e8ecef] bg-[#f8fafb] p-4 sm:grid-cols-2 lg:grid-cols-[minmax(260px,1.3fr)_180px_minmax(180px,1fr)_auto] sm:p-5">
        <label className="min-w-0">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy("member.field")}</span>
          <select name="property" defaultValue={propertyValue} className={inputClass}>
            {analytics.fields.map((field) => (
              <option
                key={`${field.id}:${field.profileDefinitionId}`}
                value={`${field.id}:${field.profileDefinitionId}`}
              >
                {field.profileDefinitionName}: {field.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy("member.filter")}</span>
          <select name="operator" defaultValue={analytics.query.operator} className={inputClass}>
            <option value="is_set">{copy("member.operator.isSet")}</option>
            <option value="is_not_set">{copy("member.operator.isNotSet")}</option>
            <option value="equals">{copy("member.operator.equals")}</option>
            <option value="not_equals">{copy("member.operator.notEquals")}</option>
            <option value="contains">{copy("member.operator.contains")}</option>
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy("member.comparisonValue")}</span>
          {selected && ["select", "multiselect"].includes(selected.type) ? (
            <select name="value" defaultValue={analytics.query.value ?? ""} className={inputClass}>
              <option value="">{copy("member.select")}</option>
              {selected.options.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input name="value" defaultValue={analytics.query.value ?? ""} maxLength={500} className={inputClass} />
          )}
        </label>
        <button type="submit" className="focus-ring mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#17324d] px-4 text-sm font-semibold text-white">
          <Filter className="size-4" /> {copy("member.apply")}
        </button>
      </form>

      {!selected ? (
        <p className="p-6 text-sm text-[#71808b]">{copy("member.noFields")}</p>
      ) : (
        <>
          <div className="grid border-b border-[#e8ecef] sm:grid-cols-4 sm:divide-x sm:divide-[#e8ecef]">
            {[
              [copy("member.metric.members"), formatOperationsAdminNumber(analytics.totals.members, locale)],
              [copy("member.metric.profiles"), formatOperationsAdminNumber(analytics.totals.profiles, locale)],
              [copy("member.metric.values"), formatOperationsAdminNumber(analytics.totals.values, locale)],
              [
                copy("member.metric.matches"),
                analytics.totals.matchedMembers === null
                  ? copy("common.protected")
                  : formatOperationsAdminNumber(analytics.totals.matchedMembers, locale),
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-3 border-b border-[#edf0f2] px-5 py-4 last:border-b-0 sm:block sm:border-b-0">
                <p className="text-[10px] font-bold uppercase text-[#7a8690]">{label}</p>
                <p className="mt-1 text-xl font-bold text-[#243444]">{value}</p>
              </div>
            ))}
          </div>
          {analytics.suppressed ? (
            <div className="m-4 flex items-start gap-2 rounded-md border border-[#d6e1eb] bg-[#f2f6fa] p-3 text-xs leading-5 text-[#365f8d] sm:m-5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" /> {copy("member.suppressed")}
            </div>
          ) : null}
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)]">
            <div className="min-w-0 border-b border-[#e8ecef] p-4 lg:border-b-0 lg:border-r sm:p-5">
              <h3 className="text-sm font-bold text-[#243444]">{copy("member.distribution")}</h3>
              <div
                className="focus-ring mt-3 overflow-x-auto"
                role="region"
                aria-label={copy("member.distributionAria")}
                tabIndex={0}
              >
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead><tr className="border-b border-[#dfe5e9] text-[10px] uppercase text-[#7a8690]"><th className="py-2 pr-3">{copy("member.column.value")}</th><th className="py-2 pr-3">{copy("member.column.members")}</th><th className="py-2">{copy("member.column.profiles")}</th></tr></thead>
                  <tbody className="divide-y divide-[#edf0f2]">
                    {analytics.distribution.map((row, index) => (
                      <tr key={`${row.value}:${index}`}><td className="max-w-sm break-words py-2.5 pr-3 font-semibold text-[#354555]">{row.value}</td><td className="py-2.5 pr-3">{row.members === null ? copy("common.protected") : formatOperationsAdminNumber(row.members, locale)}</td><td className="py-2.5">{formatOperationsAdminNumber(row.profiles, locale)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="min-w-0 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#243444]"><UsersRound className="size-4 text-[#4f7cac]" /> {copy("member.matches")}</h3>
                {selected ? <Badge tone="blue">{selected.profileDefinitionName}</Badge> : null}
              </div>
              {analytics.matchedMembers.length ? (
                <div className="mt-3 max-h-72 divide-y divide-[#edf0f2] overflow-y-auto border-y border-[#edf0f2]">
                  {analytics.matchedMembers.map((member) => (
                    <Link key={member.id} href={`/admin/members/${member.id}`} className="block px-1 py-2.5 hover:bg-[#f7f9fa]">
                      <p className="text-xs font-semibold text-[#354555]">{member.firstName} {member.lastName}</p>
                      <p className="mt-0.5 truncate text-[10px] text-[#7a8690]">{member.email}</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-[#71808b]">
                  {canExport ? copy("member.noMatches") : copy("member.permissionRequired")}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
