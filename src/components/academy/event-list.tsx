"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  Check,
  Clock3,
  HelpCircle,
  History,
  LoaderCircle,
  MapPin,
  Users,
  Video,
  X,
} from "lucide-react";
import { rsvpEventAction } from "@/lib/actions";
import {
  getEventAdminCopy,
  type EventAdminCopy,
} from "@/lib/i18n/event-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  eventCalendarReadableTextColor,
  type EventCalendarTheme,
} from "@/lib/event-calendar-theme";

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  type: "live_call" | "workshop" | "deadline" | "webinar";
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  meetingUrl: string | null;
  location: string | null;
  color: string;
  capacity: number | null;
  status: "scheduled" | "cancelled";
  lifecycleRevision: number;
  attendeeCount: number;
  myStatus: "going" | "maybe" | "declined" | null;
  statusHistory: Array<{
    id: string;
    action: "created" | "rescheduled" | "cancelled";
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    reason: string | null;
    revision: number;
    createdAt: Date;
  }>;
};

type EventListCopy = {
  filterLabel: string;
  upcoming: string;
  mine: string;
  past: string;
  going: string;
  maybe: string;
  decline: string;
  cancelled: string;
  expired: string;
  live: string;
  planned: string;
  joinOnline: string;
  calendar: string;
  empty: string;
};

function EventActions({ event, copy, systemCopy, theme }: { event: EventRow; copy: EventListCopy; systemCopy: EventAdminCopy; theme: EventCalendarTheme }) {
  const [pending, startTransition] = useTransition();
  const options = [
    { value: "going" as const, label: copy.going, icon: Check },
    { value: "maybe" as const, label: copy.maybe, icon: HelpCircle },
    { value: "declined" as const, label: copy.decline, icon: X },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const Icon = option.icon;
        const active = event.myStatus === option.value;
        return (
          <button
            key={option.value}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await rsvpEventAction(event.id, option.value);
                const message = systemCopy.member[result.rsvpMessageCode ?? "rsvpInvalid"];
                if (result.error) toast.error(message);
                if (result.success) toast.success(message);
              })
            }
            className="focus-ring flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold"
            style={{
              borderColor: active ? theme.accentColor : theme.borderColor,
              backgroundColor: active ? theme.accentColor : theme.surfaceColor,
              color: active
                ? eventCalendarReadableTextColor(theme.accentColor)
                : theme.bodyColor,
            }}
          >
            {pending && active ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Icon className="size-3" />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function EventList({
  events,
  copy,
  referenceTime,
  calendarTheme,
  locale,
}: {
  events: EventRow[];
  copy: EventListCopy;
  referenceTime: string;
  calendarTheme: EventCalendarTheme;
  locale: AppLocale;
}) {
  const [filter, setFilter] = useState<"upcoming" | "mine" | "past">(
    "upcoming",
  );
  const [now, setNow] = useState(() => new Date(referenceTime).getTime());
  const systemCopy = getEventAdminCopy(locale);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = useMemo(
    () =>
      events.filter((event) => {
        const past = new Date(event.endsAt).getTime() < now;
        if (filter === "past") return past;
        if (filter === "mine")
          return (
            !past &&
            event.status === "scheduled" &&
            (event.myStatus === "going" || event.myStatus === "maybe")
          );
        return !past;
      }),
    [events, filter, now],
  );
  const options = [
    { value: "upcoming" as const, label: copy.upcoming },
    { value: "mine" as const, label: copy.mine },
    { value: "past" as const, label: copy.past },
  ];

  return (
    <div
      className="p-3 sm:p-4"
      style={{
        backgroundColor: calendarTheme.backgroundColor,
        borderRadius: calendarTheme.cardRadius,
      }}
    >
      <div
        className="mb-4 flex gap-1 overflow-x-auto border-b"
        style={{ borderColor: calendarTheme.borderColor }}
        role="group"
        aria-label={copy.filterLabel}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            className="focus-ring h-10 shrink-0 border-b-2 px-4 text-xs font-semibold"
            style={{
              borderBottomColor:
                filter === option.value
                  ? calendarTheme.accentColor
                  : "transparent",
              color:
                filter === option.value
                  ? calendarTheme.headingColor
                  : calendarTheme.bodyColor,
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {filtered.map((event) => {
          const startsAt = new Date(event.startsAt).getTime();
          const endsAt = new Date(event.endsAt).getTime();
          const past = endsAt <= now;
          const live = startsAt <= now && now < endsAt;
          const cancelled = event.status === "cancelled";
          const latestChange = event.statusHistory[0];
          return (
            <article
              id={`event-${event.id}`}
              key={event.id}
              className="scroll-mt-24 overflow-hidden border"
              style={{
                backgroundColor: calendarTheme.surfaceColor,
                borderColor: calendarTheme.borderColor,
                borderRadius: calendarTheme.cardRadius,
              }}
            >
              <div className="grid md:grid-cols-[120px_minmax(0,1fr)]">
                <div
                  className="flex items-center gap-3 border-b border-[#e8ebee] p-4 md:block md:border-b-0 md:border-r md:text-center"
                  style={{ backgroundColor: `${event.color}12` }}
                >
                  <CalendarCheck
                    className="size-5 md:mx-auto"
                    style={{ color: event.color }}
                  />
                  <div>
                    <p className="mt-0 text-xl font-bold md:mt-2" style={{ color: calendarTheme.headingColor }}>
                      {formatDate(event.startsAt, { day: "2-digit", timeZone: event.timezone }, locale)}
                    </p>
                    <p className="text-[10px] font-bold uppercase" style={{ color: calendarTheme.bodyColor }}>
                      {formatDate(event.startsAt, { month: "short", timeZone: event.timezone }, locale)}
                    </p>
                  </div>
                </div>
                <div className={calendarTheme.density === "compact" ? "p-3 md:p-4" : "p-4 md:p-5"}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            event.type === "workshop"
                              ? "blue"
                              : event.type === "deadline"
                                ? "coral"
                                : "teal"
                          }
                        >
                          {systemCopy.types[event.type]}
                        </Badge>
                        <span
                          className="inline-flex min-h-5 items-center rounded px-2 py-0.5 text-[9px] font-bold uppercase text-white"
                          style={{
                            backgroundColor: cancelled
                              ? calendarTheme.cancelledColor
                              : live
                                ? calendarTheme.liveColor
                                : past
                                ? calendarTheme.bodyColor
                                  : calendarTheme.accentColor,
                            color:
                              cancelled || live
                                ? "#ffffff"
                                : eventCalendarReadableTextColor(
                                    past
                                      ? calendarTheme.bodyColor
                                      : calendarTheme.accentColor,
                                  ),
                          }}
                        >
                          {cancelled ? copy.cancelled : past ? copy.expired : live ? copy.live : copy.planned}
                        </span>
                        <span className="flex items-center gap-1 text-[10px]" style={{ color: calendarTheme.bodyColor }}>
                          <Clock3 className="size-3" />
                          {formatDate(event.startsAt, { hour: "2-digit", minute: "2-digit", timeZone: event.timezone, timeZoneName: "short" }, locale)}
                        </span>
                      </div>
                      <h2 className="mt-2 text-base font-bold" style={{ color: calendarTheme.headingColor }}>
                        {event.title}
                      </h2>
                      <p className="mt-1 max-w-2xl text-xs leading-5" style={{ color: calendarTheme.bodyColor }}>
                        {event.description}
                      </p>
                      {cancelled && latestChange?.reason ? (
                        <p className="mt-3 rounded-md border border-[#efc9c3] bg-[#fff6f4] px-3 py-2 text-xs leading-5 text-[#8c3f35]">
                          <strong>{systemCopy.member.cancellationReason}</strong> {latestChange.reason}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-[#7a8690]">
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3.5" />
                          {event.location ?? systemCopy.member.online}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="size-3.5" />
                          {systemCopy.member.attendance(
                            numberFormat.format(event.attendeeCount),
                            event.capacity ? numberFormat.format(event.capacity) : null,
                          )}
                        </span>
                        {event.meetingUrl && !past && !cancelled ? (
                          <a
                            href={event.meetingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="focus-ring flex items-center gap-1 font-semibold"
                            style={{ color: calendarTheme.accentColor }}
                          >
                            <Video className="size-3.5" />
                            {copy.joinOnline}
                          </a>
                        ) : null}
                        {!past ? (
                          <a
                            href={`/academy/events/${event.id}/calendar`}
                            download
                            className="focus-ring flex items-center gap-1 font-semibold text-[#365f8d] hover:text-[#17324d]"
                          >
                            <CalendarPlus className="size-3.5" />
                            {copy.calendar}
                          </a>
                        ) : null}
                      </div>
                      {event.statusHistory.length ? (
                        <details className="mt-3 border-t border-[#edf0f2] pt-3">
                          <summary className="focus-ring inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#526b83]">
                            <History className="size-3.5" />
                            {systemCopy.member.history(numberFormat.format(event.statusHistory.length))}
                          </summary>
                          <ol className="mt-2 space-y-2">
                            {event.statusHistory.map((entry) => (
                              <li key={entry.id} className="text-[11px] leading-5 text-[#66727f]">
                                <span className="font-semibold text-[#354555]">
                                  {entry.action === "cancelled"
                                    ? systemCopy.member.cancelled
                                    : entry.action === "rescheduled"
                                      ? systemCopy.member.rescheduled
                                      : systemCopy.member.created}
                                </span>{" "}
                                {systemCopy.member.changedAt(formatDateTime(entry.createdAt, locale, entry.timezone))}
                                {entry.action === "rescheduled"
                                  ? ` ${systemCopy.member.forDate(formatDateTime(entry.startsAt, locale, entry.timezone))}`
                                  : ""}
                                {entry.reason ? ` - ${entry.reason}` : ""}
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : null}
                    </div>
                    {!past && !cancelled ? <EventActions event={event} copy={copy} systemCopy={systemCopy} theme={calendarTheme} /> : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {!filtered.length ? (
          <div
            className="grid min-h-48 place-items-center border p-8 text-center"
            style={{
              backgroundColor: calendarTheme.surfaceColor,
              borderColor: calendarTheme.borderColor,
              borderRadius: calendarTheme.cardRadius,
            }}
          >
            <div>
              <CalendarCheck className="mx-auto size-7 text-[#a2abb3]" />
              <p className="mt-3 text-sm font-semibold text-[#354555]">
                {copy.empty}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
