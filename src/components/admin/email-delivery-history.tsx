import Link from "next/link";
import { ArrowRight, MailSearch, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  EMAIL_CENTER_EVENTS,
  EMAIL_DELIVERY_STATUSES,
  type EmailDeliveryStatus,
} from "@/lib/email-center-model";
import type { CoreDictionary } from "@/lib/i18n/dictionaries";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

type DeliveryRow = {
  id: string;
  event: string;
  status: EmailDeliveryStatus;
  attempt: number;
  responseStatus: number | null;
  nextRetryAt: Date | string | null;
  deliveredAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  recipient: { name: string; email: string };
};

type EmailCenterCopy = CoreDictionary["experience"]["emailCenter"];

const eventCopyKeys = {
  "feedback.reply": "feedbackReply",
  "lesson.available": "lessonAvailable",
  "invitation.created": "invitationCreated",
  "password.reset": "passwordReset",
  "event.rescheduled": "eventRescheduled",
  "event.cancelled": "eventCancelled",
  "email.template.test": "templateTest",
} as const;

function eventLabel(copy: EmailCenterCopy, event: string) {
  const key = eventCopyKeys[event as keyof typeof eventCopyKeys];
  return key ? copy.eventLabels[key] : event;
}

function localizedDateTime(value: Date | string, locale: AppLocale) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

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

function filterHref(
  filters: Record<string, string | undefined>,
  page: number,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/email?${query}` : "/admin/email";
}

function DeliveryStatus({
  status,
  copy,
}: {
  status: EmailDeliveryStatus;
  copy: EmailCenterCopy;
}) {
  return <Badge tone={statusTones[status]}>{copy.statusLabels[status]}</Badge>;
}

export function EmailDeliveryHistory({
  rows,
  total,
  page,
  pageSize,
  filters,
  copy,
  locale,
}: {
  rows: DeliveryRow[];
  total: number;
  page: number;
  pageSize: number;
  copy: EmailCenterCopy;
  locale: AppLocale;
  filters: {
    search?: string;
    event?: string;
    status?: string;
    from?: string;
    to?: string;
  };
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="overflow-hidden rounded-md border border-[#e1e5e8] bg-white">
      <form
        method="get"
        className="grid gap-3 border-b border-[#e8ecef] p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(145px,auto))_auto]"
      >
        <label className="relative block min-w-0">
          <span className="sr-only">{copy.searchPlaceholder}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a949d]" />
          <input
            type="search"
            name="search"
            defaultValue={filters.search}
            maxLength={200}
            placeholder={copy.searchPlaceholder}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] pl-9 pr-3 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">{copy.event}</span>
          <select
            name="event"
            defaultValue={filters.event ?? ""}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
          >
            <option value="">{copy.allEvents}</option>
            {EMAIL_CENTER_EVENTS.map((event) => (
              <option key={event} value={event}>
                {eventLabel(copy, event)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{copy.status}</span>
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
          >
            <option value="">{copy.allStatuses}</option>
            {EMAIL_DELIVERY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {copy.statusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{copy.created}</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">{copy.updated}</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] px-3 text-sm"
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit">
            <Search className="size-4" /> {copy.filter}
          </Button>
          <Link
            href="/admin/email"
            className={buttonClassName({ variant: "secondary", size: "icon" })}
            aria-label={copy.resetFilters}
            title={copy.resetFilters}
          >
            <X className="size-4" />
          </Link>
        </div>
      </form>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#687582]">
            <tr>
              <th className="px-4 py-3">{copy.recipient}</th>
              <th className="px-4 py-3">{copy.event}</th>
              <th className="px-4 py-3">{copy.status}</th>
              <th className="px-4 py-3">{copy.attempts}</th>
              <th className="px-4 py-3">{copy.created}</th>
              <th className="px-4 py-3">{copy.updated}</th>
              <th className="w-14 px-4 py-3">
                <span className="sr-only">{copy.open}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf0f2]">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-[#fafbfb]">
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold text-[#243444]">
                    {row.recipient.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[#66727f]">
                    {row.recipient.email}
                  </p>
                </td>
                <td className="px-4 py-3 text-sm text-[#52606d]">
                  {eventLabel(copy, row.event)}
                </td>
                <td className="px-4 py-3">
                  <DeliveryStatus status={row.status} copy={copy} />
                </td>
                <td className="px-4 py-3 text-sm tabular-nums text-[#52606d]">
                  {row.attempt}
                </td>
                <td className="px-4 py-3 text-xs text-[#687582]">
                  {localizedDateTime(row.createdAt, locale)}
                </td>
                <td className="px-4 py-3 text-xs text-[#687582]">
                  {localizedDateTime(row.updatedAt, locale)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/email/${row.id}`}
                    aria-label={copy.open}
                    className={buttonClassName({
                      variant: "ghost",
                      size: "icon",
                      className: "size-8",
                    })}
                  >
                    <ArrowRight className="size-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-[#edf0f2] md:hidden">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/admin/email/${row.id}`}
            className="focus-ring block p-4 hover:bg-[#fafbfb]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#243444]">
                  {row.recipient.name}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#66727f]">
                  {row.recipient.email}
                </p>
              </div>
              <DeliveryStatus status={row.status} copy={copy} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#687582]">
              <span>{eventLabel(copy, row.event)}</span>
              <span>{localizedDateTime(row.createdAt, locale)}</span>
            </div>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="grid min-h-52 place-items-center px-4 py-10 text-center">
          <div>
            <MailSearch className="mx-auto size-7 text-[#8ba6a3]" />
            <p className="mt-3 text-sm font-semibold text-[#344454]">
              {copy.empty}
            </p>
          </div>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] px-4 py-3">
        <p className="text-xs text-[#66727f]">
          {copy.entries(total, page, totalPages)}
        </p>
        <div className="flex gap-2">
          <Link
            href={filterHref(filters, Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={cn(
              buttonClassName({ variant: "secondary", size: "sm" }),
              page <= 1 && "pointer-events-none opacity-45",
            )}
          >
            {copy.previous}
          </Link>
          <Link
            href={filterHref(filters, Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={cn(
              buttonClassName({ variant: "secondary", size: "sm" }),
              page >= totalPages && "pointer-events-none opacity-45",
            )}
          >
            {copy.next}
          </Link>
        </div>
      </footer>
    </section>
  );
}
