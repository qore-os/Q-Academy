"use client";

import {
  AlertTriangle,
  Bot,
  Coins,
  LoaderCircle,
  MessageSquare,
  Save,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  AiAgentInsightsPeriod,
  AiAgentPolicyAdminView,
  AiAgentUsageInsights,
} from "@/lib/ai/agent-policy";
import {
  updateAiAgentPolicyAdminAction,
  type AiAgentPolicyActionState,
} from "@/lib/admin/ai-agent-policy-actions";
import {
  formatAiAdminDate,
  formatAiAdminDateTime,
  formatAiAdminNumber,
  getAiAdminCopy,
  localizeAiAdminMessage,
} from "@/lib/i18n/ai-admin";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

type CreditUsage = {
  creditsUsed: number;
  remaining: number;
  limit: number;
  resetAt: Date;
};

const initialState: AiAgentPolicyActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#2b3a48]";
function Metric({
  icon: Icon,
  label,
  value,
  locale,
}: {
  icon: typeof Bot;
  label: string;
  value: number;
  locale: AppLocale;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-[#edf0f2] py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:px-4 sm:last:border-r-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f4] text-[#365f68]">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase text-[#71808b]">
          {label}
        </p>
        <p className="mt-0.5 text-lg font-bold text-[#243444]">
          {formatAiAdminNumber(value, locale)}
        </p>
      </div>
    </div>
  );
}

function PolicyForm({
  locale,
  policy,
  creditUsage,
}: {
  locale: AppLocale;
  policy: AiAgentPolicyAdminView;
  creditUsage: CreditUsage;
}) {
  const copy = getAiAdminCopy(locale);
  const [state, action, pending] = useActionState(
    updateAiAgentPolicyAdminAction,
    initialState,
  );
  const [hourlyEnabled, setHourlyEnabled] = useState(
    policy.perMemberHourlyLimit !== null,
  );
  const utilization = Math.min(
    100,
    Math.round((creditUsage.creditsUsed / Math.max(1, creditUsage.limit)) * 100),
  );

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="ai-policy-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 lg:max-w-sm">
          <div className="flex items-center gap-2">
            <Coins className="size-5 text-[#2b9188]" aria-hidden="true" />
            <h2 id="ai-policy-title" className="text-base font-bold text-[#243444]">
              {copy.policy.title}
            </h2>
          </div>
          <div className="mt-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-bold text-[#243444]">
                  {formatAiAdminNumber(creditUsage.creditsUsed, locale)}
                  <span className="text-sm font-medium text-[#71808b]">
                    {" "}/ {formatAiAdminNumber(creditUsage.limit, locale)}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-[#71808b]">
                  {copy.policy.monthUsage}
                </p>
              </div>
              <p className="text-xs font-semibold text-[#52606d]">
                {utilization} %
              </p>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-[#e5eaed]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={creditUsage.limit}
              aria-valuenow={Math.min(
                creditUsage.creditsUsed,
                creditUsage.limit,
              )}
              aria-label={copy.policy.consumedCredits}
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  utilization >= 90 ? "bg-[#d36a56]" : "bg-[#2b9188]",
                )}
                style={{ width: `${utilization}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] text-[#7a8690]">
              {copy.policy.reset(
                formatAiAdminDateTime(creditUsage.resetAt, locale),
              )}
            </p>
          </div>
          {policy.configurationStatus === "invalid" ? (
            <div className="mt-4 flex gap-2 rounded-md border border-[#e3c477] bg-[#fff9e9] p-3 text-xs leading-5 text-[#755812]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
               {copy.policy.invalid}
            </div>
          ) : null}
        </div>

        <form action={action} className="grid min-w-0 flex-1 gap-4 lg:max-w-2xl">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[#e1e6e9] p-3">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={policy.enabled}
              className="focus-ring mt-0.5 size-4 accent-[#2b9188]"
            />
            <span>
              <span className="block text-sm font-semibold text-[#2b3a48]">
                 {copy.policy.enable}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-[#71808b]">
                 {copy.policy.enableHint}
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                 {copy.policy.monthlyCredits}
              </span>
              <input
                className={inputClassName}
                type="number"
                name="monthlyCreditLimit"
                min={100}
                max={1_000_000}
                step={100}
                required
                defaultValue={policy.monthlyCreditLimit}
              />
            </label>
            <div>
              <label className="flex min-h-5 cursor-pointer items-center gap-2 text-xs font-semibold text-[#52606d]">
                <input
                  type="checkbox"
                  name="hourlyEnabled"
                  checked={hourlyEnabled}
                  onChange={(event) => setHourlyEnabled(event.target.checked)}
                  className="focus-ring size-4 accent-[#2b9188]"
                />
                {copy.policy.hourlyLimit}
              </label>
              <input
                id="ai-agent-member-hourly-limit"
                className={cn(inputClassName, "mt-1.5")}
                type="number"
                name="perMemberHourlyLimit"
                aria-label={copy.policy.hourlyCredits}
                min={1}
                max={500}
                required={hourlyEnabled}
                disabled={!hourlyEnabled}
                defaultValue={policy.perMemberHourlyLimit ?? 60}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p
              className={cn(
                "min-h-5 text-xs",
                state.ok === false ? "text-[#b4493d]" : "text-[#287a71]",
              )}
              aria-live="polite"
            >
              {localizeAiAdminMessage(locale, state) ||
                (policy.updatedAt
                  ? copy.policy.changedAt(
                      formatAiAdminDateTime(policy.updatedAt, locale),
                    )
                  : copy.policy.defaultActive)}
            </p>
            <Button type="submit" disabled={pending} className="sm:self-end">
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {copy.common.save}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

function UsageInsights({
  locale,
  insights,
}: {
  locale: AppLocale;
  insights: AiAgentUsageInsights;
}) {
  const copy = getAiAdminCopy(locale);
  const periods: Array<{ value: AiAgentInsightsPeriod; label: string }> = [
    { value: "current_month", label: copy.policy.periods.currentMonth },
    { value: "7d", label: copy.policy.periods.sevenDays },
    { value: "30d", label: copy.policy.periods.thirtyDays },
    { value: "90d", label: copy.policy.periods.ninetyDays },
  ];
  return (
    <section className="panel overflow-hidden" aria-labelledby="ai-usage-title">
      <header className="flex flex-col gap-3 border-b border-[#e7ebee] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 id="ai-usage-title" className="text-base font-bold text-[#243444]">
            {copy.policy.usage}
          </h2>
          <p className="mt-1 text-[11px] text-[#71808b]">
            {copy.policy.range(
              formatAiAdminDate(insights.startsAt, locale),
              formatAiAdminDate(insights.endsAt, locale),
            )}
          </p>
        </div>
        <nav
          className="flex max-w-full overflow-x-auto"
          aria-label={copy.policy.periodAria}
        >
          {periods.map((period) => (
            <Link
              key={period.value}
              href={`/admin/ai?period=${period.value}`}
              aria-current={insights.period === period.value ? "page" : undefined}
              className={cn(
                "focus-ring shrink-0 border-b-2 px-3 py-2 text-xs font-semibold",
                insights.period === period.value
                  ? "border-[#2b9188] text-[#1e716a]"
                  : "border-transparent text-[#71808b] hover:text-[#354555]",
              )}
            >
              {period.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="grid px-4 sm:grid-cols-5 sm:px-1">
        <Metric locale={locale} icon={Bot} label={copy.policy.conversations} value={insights.totals.conversations} />
        <Metric locale={locale} icon={Users} label={copy.policy.activeUsers} value={insights.totals.activeUsers} />
        <Metric locale={locale} icon={MessageSquare} label={copy.policy.messages} value={insights.totals.messages} />
        <Metric locale={locale} icon={Coins} label={copy.policy.inputTokens} value={insights.totals.inputTokens} />
        <Metric locale={locale} icon={Coins} label={copy.policy.outputTokens} value={insights.totals.outputTokens} />
      </div>

      <div
        className="overflow-x-auto border-t border-[#e7ebee]"
        tabIndex={0}
        aria-label={copy.policy.usage}
      >
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-[#f7f9fa] text-[10px] uppercase text-[#71808b]">
            <tr>
              <th className="px-5 py-3 font-semibold">{copy.policy.agent}</th>
              <th className="px-3 py-3 text-right font-semibold">{copy.policy.chats}</th>
              <th className="px-3 py-3 text-right font-semibold">{copy.policy.users}</th>
              <th className="px-3 py-3 text-right font-semibold">{copy.policy.messages}</th>
              <th className="px-3 py-3 text-right font-semibold">{copy.policy.input}</th>
              <th className="px-5 py-3 text-right font-semibold">{copy.policy.output}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf0f2]">
            {insights.agents.map((agent, index) => (
              <tr key={`${agent.name}:${index}`} className="text-[#52606d]">
                <th className="px-5 py-3 font-semibold text-[#2b3a48]">
                  {agent.name}
                </th>
                <td className="px-3 py-3 text-right">{formatAiAdminNumber(agent.conversations, locale)}</td>
                <td className="px-3 py-3 text-right">{formatAiAdminNumber(agent.activeUsers, locale)}</td>
                <td className="px-3 py-3 text-right">{formatAiAdminNumber(agent.messages, locale)}</td>
                <td className="px-3 py-3 text-right">{formatAiAdminNumber(agent.inputTokens, locale)}</td>
                <td className="px-5 py-3 text-right">{formatAiAdminNumber(agent.outputTokens, locale)}</td>
              </tr>
            ))}
            {!insights.agents.length ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-[#71808b]">
                  {copy.policy.empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AiAgentPolicyPanel({
  locale,
  policy,
  creditUsage,
  insights,
}: {
  locale: AppLocale;
  policy: AiAgentPolicyAdminView;
  creditUsage: CreditUsage;
  insights: AiAgentUsageInsights;
}) {
  return (
    <div className="space-y-4">
      <PolicyForm locale={locale} policy={policy} creditUsage={creditUsage} />
      <UsageInsights locale={locale} insights={insights} />
    </div>
  );
}
