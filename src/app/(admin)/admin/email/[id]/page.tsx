import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, Mail, UserRound } from "lucide-react";
import { z } from "zod";
import { EmailDeliveryRetry } from "@/components/admin/email-delivery-retry";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api/errors";
import { requireOrganizationAdmin } from "@/lib/auth";
import { getEmailDeliveryDetail } from "@/lib/email-center";
import type { EmailDeliveryStatus } from "@/lib/email-center-model";
import {
  getEmailDeliveryCopy,
  localizeEmailDeliveryFailure,
} from "@/lib/i18n/email-delivery";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/utils";

const statusTones: Record<
  EmailDeliveryStatus,
  "neutral" | "teal" | "coral" | "amber" | "blue"
> = {
  pending: "neutral",
  processing: "blue",
  delivered: "teal",
  failed: "coral",
  retrying: "amber",
};

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  return { title: getEmailDeliveryCopy(locale).metadataTitle };
}

export default async function EmailDeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  const copy = getEmailDeliveryCopy(locale);
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();

  let detail: Awaited<ReturnType<typeof getEmailDeliveryDetail>>;
  try {
    detail = await getEmailDeliveryDetail(actor.organizationId, id.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const failureSummary = localizeEmailDeliveryFailure(locale, detail);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.events[detail.event] ?? detail.event}
        actions={
          <Link
            href="/admin/email"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <ArrowLeft className="size-4" /> {copy.back}
          </Link>
        }
      />

      <section className="grid gap-px overflow-hidden rounded-md border border-[#e1e5e8] bg-[#e1e5e8] md:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#71808b]">{copy.fields.status}</p>
          <Badge tone={statusTones[detail.status]} className="mt-2">
            {copy.statuses[detail.status]}
          </Badge>
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#71808b]">{copy.fields.attempts}</p>
          <p className="mt-2 text-sm font-semibold tabular-nums text-[#243444]">{detail.attempt}</p>
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#71808b]">{copy.fields.created}</p>
          <p className="mt-2 text-sm font-semibold text-[#243444]">{formatDateTime(detail.createdAt, locale)}</p>
        </div>
        <div className="bg-white p-4">
          <p className="text-[10px] font-bold uppercase text-[#71808b]">{copy.fields.updated}</p>
          <p className="mt-2 text-sm font-semibold text-[#243444]">{formatDateTime(detail.updatedAt, locale)}</p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
          <header className="flex items-center gap-2 border-b border-[#e8ecef] px-4 py-3">
            <Mail className="size-4 text-[#2b9188]" />
            <h2 className="text-sm font-semibold text-[#243444]">{copy.fields.content}</h2>
          </header>
          <div className="min-h-60 p-4 sm:p-5">
            {detail.content.available ? (
              <div>
                <p className="border-b border-[#edf0f2] pb-3 text-sm font-semibold text-[#243444]">
                  {detail.content.subject}
                </p>
                <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-[#52606d]">
                  {detail.content.message}
                </p>
                {detail.content.linksRedacted ? (
                  <p className="mt-5 text-[11px] font-semibold text-[#8d6a12]">{copy.linksRedacted}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm leading-6 text-[#687582]">
                {copy.hiddenContent[detail.content.reason]}
              </p>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-md border border-[#e1e5e8] bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#243444]">
              <UserRound className="size-4 text-[#4f7cac]" /> {copy.fields.recipient}
            </h2>
            <p className="mt-3 text-sm font-semibold text-[#243444]">
              {detail.recipient.firstName} {detail.recipient.lastName}
            </p>
            <p className="mt-1 break-all text-xs text-[#66727f]">{detail.recipient.email}</p>
            <p className="mt-3 text-[11px] text-[#78848e]">
              {copy.roles[detail.recipient.role]} / {copy.recipientStatuses[detail.recipient.status]}
            </p>
          </section>

          <section className="rounded-md border border-[#e1e5e8] bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#243444]">
              <Clock3 className="size-4 text-[#8d6a12]" /> {copy.fields.gateway}
            </h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-[#71808b]">{copy.fields.httpStatus}</dt>
                <dd className="font-semibold text-[#344454]">{detail.responseStatus ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#71808b]">{copy.fields.accepted}</dt>
                <dd className="text-right font-semibold text-[#344454]">
                  {detail.deliveredAt ? formatDateTime(detail.deliveredAt, locale) : "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#71808b]">{copy.fields.nextAttempt}</dt>
                <dd className="text-right font-semibold text-[#344454]">
                  {detail.nextRetryAt ? formatDateTime(detail.nextRetryAt, locale) : "-"}
                </dd>
              </div>
            </dl>
            {failureSummary ? (
              <p className="mt-4 border-t border-[#edf0f2] pt-3 text-xs leading-5 text-[#b8493e]">
                {failureSummary}
              </p>
            ) : null}
            {detail.canRetry ? (
              <div className="mt-4 border-t border-[#edf0f2] pt-4">
                <EmailDeliveryRetry deliveryId={detail.id} locale={locale} />
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
