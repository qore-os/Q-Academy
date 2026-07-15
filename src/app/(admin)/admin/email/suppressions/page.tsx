import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EmailCenterTabs } from "@/components/admin/email-center-tabs";
import { EmailSuppressionRelease } from "@/components/admin/email-suppression-release";
import { PageHeader } from "@/components/ui/page-header";
import { requireTeamPermission } from "@/lib/auth";
import { listEmailSuppressions } from "@/lib/email-feedback";
import { emailSuppressionListQuerySchema } from "@/lib/email-feedback-model";
import { getEmailSuppressionCopy } from "@/lib/email-suppression-copy";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { intlLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireTeamPermission("settings.manage");
  const locale = await resolveUserLocale(actor);
  return { title: getEmailSuppressionCopy(locale).title };
}

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function EmailSuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireTeamPermission("settings.manage");
  const [params, locale] = await Promise.all([
    searchParams,
    resolveUserLocale(actor),
  ]);
  const copy = getEmailSuppressionCopy(locale);
  const emailCopy = getCoreDictionary(locale).experience.emailCenter;
  const parsed = emailSuppressionListQuerySchema.safeParse({
    status: one(params.status),
    reason: one(params.reason),
    search: one(params.search),
  });
  const filters = parsed.success ? parsed.data : {};
  const page = Math.max(1, Math.min(10_000, Number(one(params.page)) || 1));
  const pageSize = 25;
  const result = await listEmailSuppressions(actor.organizationId, {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const dateTime = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PLATFORM_TIME_ZONE,
  });
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));
  const reasonLabels = {
    hard_bounce: copy.hardBounce,
    soft_bounce: copy.softBounce,
    complaint: copy.complaint,
  } as const;
  const statusLabels = {
    active: copy.active,
    released: copy.released,
    expired: copy.expired,
  } as const;
  const queryForPage = (target: number) => {
    const query = new URLSearchParams();
    if (filters.search) query.set("search", filters.search);
    if (filters.status) query.set("status", filters.status);
    if (filters.reason) query.set("reason", filters.reason);
    query.set("page", String(target));
    return `/admin/email/suppressions?${query.toString()}`;
  };
  const hasNext = result.offset + result.data.length < result.total;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <EmailCenterTabs
        active="suppressions"
        copy={emailCopy}
        suppressionLabel={copy.tab}
      />
      <form className="grid gap-3 border-b border-[#dfe4e8] pb-5 md:grid-cols-[minmax(16rem,1fr)_12rem_16rem_auto]">
        <label className="relative">
          <span className="sr-only">{copy.search}</span>
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#71808b]" />
          <input
            name="search"
            defaultValue={filters.search}
            placeholder={copy.search}
            maxLength={160}
            className="focus-ring h-10 w-full rounded border border-[#dfe4e8] bg-white pl-9 pr-3 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">{copy.status}</span>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="focus-ring h-10 w-full rounded border border-[#dfe4e8] bg-white px-3 text-sm"
          >
            <option value="">{copy.all}</option>
            <option value="active">{copy.active}</option>
            <option value="released">{copy.released}</option>
            <option value="expired">{copy.expired}</option>
          </select>
        </label>
        <label>
          <span className="sr-only">{copy.reason}</span>
          <select
            name="reason"
            defaultValue={filters.reason ?? ""}
            className="focus-ring h-10 w-full rounded border border-[#dfe4e8] bg-white px-3 text-sm"
          >
            <option value="">{copy.all}</option>
            <option value="hard_bounce">{copy.hardBounce}</option>
            <option value="soft_bounce">{copy.softBounce}</option>
            <option value="complaint">{copy.complaint}</option>
          </select>
        </label>
        <button className="focus-ring h-10 rounded bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white">
          {copy.filter}
        </button>
      </form>
      <div className="overflow-x-auto border-y border-[#dfe4e8]">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="bg-[#f7f9fa] text-xs font-semibold text-[#566674]">
            <tr>
              <th className="px-4 py-3">{copy.recipient}</th>
              <th className="px-4 py-3">{copy.reason}</th>
              <th className="px-4 py-3">{copy.occurrences}</th>
              <th className="px-4 py-3">{copy.lastEvent}</th>
              <th className="px-4 py-3">{copy.lifecycle}</th>
              <th className="px-4 py-3">{copy.action}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7ebee]">
            {result.data.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="px-4 py-4">
                  <p className="font-semibold text-[#253341]">
                    {row.recipient.name}
                  </p>
                  <p className="mt-1 text-xs text-[#71808b]">
                    {row.recipient.email}
                  </p>
                </td>
                <td className="px-4 py-4 text-[#354555]">
                  {reasonLabels[row.reason]}
                </td>
                <td className="px-4 py-4 tabular-nums text-[#354555]">
                  {row.occurrenceCount}
                </td>
                <td className="px-4 py-4 text-[#354555]">
                  {dateTime.format(row.lastOccurredAt)}
                </td>
                <td className="px-4 py-4">
                  <span className="inline-flex rounded border border-[#dfe4e8] px-2 py-1 text-xs font-semibold text-[#566674]">
                    {statusLabels[row.status]}
                  </span>
                  {row.expiresAt && row.status === "active" ? (
                    <p className="mt-2 text-xs text-[#71808b]">
                      {dateTime.format(row.expiresAt)}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  {row.status === "active" ? (
                    <EmailSuppressionRelease id={row.id} copy={copy} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.data.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[#71808b]">
            {copy.empty}
          </p>
        ) : null}
      </div>
      <nav
        className="flex items-center justify-between text-sm"
        aria-label={copy.pagination}
      >
        <p className="text-[#71808b]">
          {numberFormat.format(result.total)} {copy.results}
        </p>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              className="focus-ring rounded border border-[#dfe4e8] px-3 py-2"
              href={queryForPage(page - 1)}
              aria-label={copy.previousPage}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          {hasNext ? (
            <Link
              className="focus-ring rounded border border-[#dfe4e8] px-3 py-2"
              href={queryForPage(page + 1)}
              aria-label={copy.nextPage}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
