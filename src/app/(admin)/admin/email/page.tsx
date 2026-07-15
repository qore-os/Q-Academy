import type { Metadata } from "next";
import { EmailDeliveryHistory } from "@/components/admin/email-delivery-history";
import { EmailCenterTabs } from "@/components/admin/email-center-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrganizationAdmin } from "@/lib/auth";
import {
  listEmailDeliveries,
  validEmailCenterEvent,
  validEmailDeliveryStatus,
} from "@/lib/email-center";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getEmailSuppressionCopy } from "@/lib/email-suppression-copy";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  return { title: getCoreDictionary(locale).experience.emailCenter.title };
}

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function dateBoundary(value: string | undefined, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function EmailCenterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireOrganizationAdmin();
  const [query, locale] = await Promise.all([
    searchParams,
    resolveUserLocale(actor),
  ]);
  const copy = getCoreDictionary(locale).experience.emailCenter;
  const search = one(query.search)?.trim().slice(0, 200);
  const rawEvent = one(query.event);
  const rawStatus = one(query.status);
  const event = validEmailCenterEvent(rawEvent) ? rawEvent : undefined;
  const status = validEmailDeliveryStatus(rawStatus) ? rawStatus : undefined;
  const fromInput = one(query.from);
  const toInput = one(query.to);
  const page = Math.max(1, Math.min(10_000, Number(one(query.page)) || 1));
  const pageSize = 25;
  const result = await listEmailDeliveries(actor.organizationId, {
    search,
    event,
    status,
    from: dateBoundary(fromInput, false),
    to: dateBoundary(toInput, true),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <EmailCenterTabs
        active="history"
        copy={copy}
        suppressionLabel={getEmailSuppressionCopy(locale).tab}
      />
      <EmailDeliveryHistory
        copy={copy}
        locale={locale}
        rows={result.data}
        total={result.total}
        page={page}
        pageSize={pageSize}
        filters={{
          search,
          event,
          status,
          from: fromInput,
          to: toInput,
        }}
      />
    </div>
  );
}
