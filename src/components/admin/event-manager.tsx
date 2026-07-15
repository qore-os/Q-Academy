"use client";

import {
  Ban,
  CalendarClock,
  Check,
  Clock3,
  Download,
  LoaderCircle,
  History,
  MapPin,
  Palette,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { EventCalendarThemeEditor } from "@/components/admin/event-calendar-theme-editor";
import {
  cancelEventAdminAction,
  removeEventAttendanceAdminAction,
  rescheduleEventAdminAction,
  setEventAttendanceAdminAction,
  updateEventAudienceAdminAction,
  updateEventAdminAction,
  type EventAdminActionState,
} from "@/lib/admin/event-actions";
import {
  getEventAdminCopy,
  type EventAdminCopy,
} from "@/lib/i18n/event-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { normalizeEventDateFields } from "@/lib/event-form";
import type { EventCalendarTheme } from "@/lib/event-calendar-theme";
import { getEventCalendarCopy } from "@/lib/i18n/event-calendar";
import {
  EVENT_TIME_ZONES,
  eventDateTimeLocalValue,
  eventTimeZoneDisplayName,
} from "@/lib/event-timezone";

type AttendanceStatus = "going" | "maybe" | "declined";

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
  audienceMode: "tenant" | "restricted";
  audience: {
    mode: "tenant" | "restricted";
    userIds: string[];
    groupIds: string[];
    bundleIds: string[];
  };
  eligibleMemberIds: string[];
  attendeeCount: number;
  attendees: Array<{
    eventId: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    status: AttendanceStatus;
    respondedAt: Date;
  }>;
  statusHistory: Array<{
    id: string;
    action: "created" | "rescheduled" | "cancelled";
    fromStatus: "scheduled" | "cancelled" | null;
    toStatus: "scheduled" | "cancelled";
    previousStartsAt: Date | null;
    previousEndsAt: Date | null;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    reason: string | null;
    revision: number;
    createdAt: Date;
  }>;
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

type AudienceOption = { id: string; name: string };

const initialState: EventAdminActionState = { ok: null, message: "" };
const inputClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#2b3a48]";
const labelClassName = "mb-1.5 block text-xs font-semibold text-[#52606d]";

const EVENT_COLOR_PRESETS = [
  { value: "#2bb7a9", label: "teal" },
  { value: "#4f7cac", label: "blue" },
  { value: "#ee6c5d", label: "coral" },
  { value: "#d6a536", label: "gold" },
  { value: "#7b61a8", label: "violet" },
  { value: "#3e8f5b", label: "green" },
] as const;

function typeLabel(copy: EventAdminCopy, type: EventRow["type"]) {
  return copy.types[type];
}

function actionMessage(
  state: EventAdminActionState,
  copy: EventAdminCopy,
  numberFormat: Intl.NumberFormat,
) {
  return copy.messages[state.code ?? "failed"](
    numberFormat.format(state.params?.count ?? 0),
  );
}

function EventEditForm({ event, locale, copy }: { event: EventRow; locale: AppLocale; copy: EventAdminCopy }) {
  const action = useCallback(
    (state: EventAdminActionState, formData: FormData) =>
      updateEventAdminAction(
        event.id,
        state,
        normalizeEventDateFields(formData),
      ),
    [event.id],
  );
  const [state, formAction, pending] = useActionState(action, initialState);
  const [color, setColor] = useState(event.color);
  const calendarCopy = getEventCalendarCopy(locale);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );

  useEffect(() => {
    if (state.ok === true) toast.success(actionMessage(state, copy, numberFormat));
    if (state.ok === false) toast.error(actionMessage(state, copy, numberFormat));
  }, [copy, numberFormat, state]);

  return (
    <form action={formAction} className="grid gap-4 p-4 sm:p-5">
      <label>
        <span className={labelClassName}>{copy.details.title}</span>
        <input
          name="title"
          required
          maxLength={220}
          defaultValue={event.title}
          className={inputClassName}
        />
      </label>
      <label>
        <span className={labelClassName}>{copy.details.description}</span>
        <textarea
          name="description"
          maxLength={5000}
          defaultValue={event.description ?? ""}
          className="focus-ring min-h-24 w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#2b3a48]"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelClassName}>{copy.details.type}</span>
          <select name="type" defaultValue={event.type} className={inputClassName}>
            <option value="live_call">{copy.types.live_call}</option>
            <option value="workshop">{copy.types.workshop}</option>
            <option value="webinar">{copy.types.webinar}</option>
            <option value="deadline">{copy.types.deadline}</option>
          </select>
        </label>
        <fieldset>
          <legend className={labelClassName}>{copy.details.accent}</legend>
          <div className="flex h-10 items-center gap-1 rounded-md border border-[#dce1e5] px-2">
            {EVENT_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setColor(preset.value)}
                aria-label={copy.colors[preset.label]}
                aria-pressed={color.toLowerCase() === preset.value}
                title={copy.colors[preset.label]}
                className="focus-ring grid size-7 place-items-center rounded-md"
              >
                <span
                  className={`size-4 rounded-sm ${
                    color.toLowerCase() === preset.value
                      ? "ring-2 ring-[#243444] ring-offset-2"
                      : ""
                  }`}
                  style={{ backgroundColor: preset.value }}
                />
              </button>
            ))}
            <label className="ml-auto grid size-7 cursor-pointer place-items-center rounded-md text-[#66727f]" title={copy.colors.custom}>
              <Palette className="size-4" />
              <input
                name="color"
                type="color"
                value={color}
                onChange={(input) => setColor(input.target.value)}
                className="sr-only"
                aria-label={copy.colors.customAccent}
              />
            </label>
          </div>
        </fieldset>
      </div>
      <div
        className="overflow-hidden rounded-md border border-[#dfe4e8]"
        aria-label={copy.details.preview}
      >
        <div className="flex items-center gap-3 p-3" style={{ backgroundColor: `${color}14` }}>
          <span className="grid size-9 place-items-center rounded-md bg-white" style={{ color }}>
            <CalendarClock className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-[#354555]">{event.title}</p>
            <p className="mt-0.5 text-[10px] text-[#71808b]">
              {typeLabel(copy, event.type)} · {formatDateTime(event.startsAt, locale, event.timezone)}
            </p>
          </div>
        </div>
      </div>
      <label>
        <span className={labelClassName}>{copy.details.scheduleReason}</span>
        <input
          name="scheduleReason"
          maxLength={500}
          placeholder={copy.details.scheduleReasonHint}
          className={inputClassName}
        />
      </label>
      <label>
        <span className={labelClassName}>{calendarCopy.timezone}</span>
        <select name="timezone" defaultValue={event.timezone} className={inputClassName}>
          {[event.timezone, ...EVENT_TIME_ZONES]
            .filter((timeZone, index, values) => values.indexOf(timeZone) === index)
            .map((timeZone) => (
            <option key={timeZone} value={timeZone}>
              {eventTimeZoneDisplayName(timeZone, intlLocale(locale), event.startsAt)}
            </option>
            ))}
        </select>
        <span className="mt-1 block text-[10px] text-[#7a8690]">{calendarCopy.timezoneHint}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelClassName}>{copy.details.startsAt}</span>
          <input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={eventDateTimeLocalValue(event.startsAt, event.timezone)}
            className={inputClassName}
          />
        </label>
        <label>
          <span className={labelClassName}>{copy.details.endsAt}</span>
          <input
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={eventDateTimeLocalValue(event.endsAt, event.timezone)}
            className={inputClassName}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelClassName}>{copy.details.meetingUrl}</span>
          <input
            name="meetingUrl"
            type="url"
            maxLength={2000}
            defaultValue={event.meetingUrl ?? ""}
            placeholder="https://..."
            className={inputClassName}
          />
        </label>
        <label>
          <span className={labelClassName}>{copy.details.location}</span>
          <input
            name="location"
            maxLength={200}
            defaultValue={event.location ?? ""}
            className={inputClassName}
          />
        </label>
      </div>
      <label>
        <span className={labelClassName}>{copy.details.capacity}</span>
        <input
          name="capacity"
          type="number"
          min={1}
          max={100000}
          defaultValue={event.capacity ?? ""}
          placeholder={copy.details.unlimited}
          className={inputClassName}
        />
      </label>
      <div className="flex justify-end border-t border-[#edf0f2] pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {copy.common.save}
        </Button>
      </div>
    </form>
  );
}

function AudienceChecklist({
  title,
  description,
  name,
  options,
  selectedIds,
  emptyLabel,
}: {
  title: string;
  description: string;
  name: string;
  options: AudienceOption[];
  selectedIds: string[];
  emptyLabel: string;
}) {
  const selected = new Set(selectedIds);
  return (
    <fieldset className="min-w-0 rounded-md border border-[#dfe4e8] bg-white">
      <legend className="sr-only">{title}</legend>
      <div className="border-b border-[#edf0f2] px-3 py-2.5">
        <p className="text-xs font-bold text-[#354555]">{title}</p>
        <p className="mt-0.5 text-[10px] leading-4 text-[#7a8690]">
          {description}
        </p>
      </div>
      <div className="max-h-44 overflow-y-auto p-2">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#52606d] hover:bg-[#f4f6f7]"
          >
            <input
              type="checkbox"
              name={name}
              value={option.id}
              defaultChecked={selected.has(option.id)}
              className="size-4 shrink-0 accent-[#2b9188]"
            />
            <span className="min-w-0 truncate">{option.name}</span>
          </label>
        ))}
        {!options.length ? (
          <p className="p-3 text-center text-[11px] text-[#8a949d]">
            {emptyLabel}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

function AudienceManager({
  event,
  members,
  groups,
  bundles,
  locale,
  copy,
}: {
  event: EventRow;
  members: Member[];
  groups: AudienceOption[];
  bundles: AudienceOption[];
  locale: AppLocale;
  copy: EventAdminCopy;
}) {
  const action = updateEventAudienceAdminAction.bind(null, event.id);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [mode, setMode] = useState<"tenant" | "restricted">(
    event.audience.mode,
  );
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );

  useEffect(() => {
    if (state.ok === true) toast.success(actionMessage(state, copy, numberFormat));
    if (state.ok === false) toast.error(actionMessage(state, copy, numberFormat));
  }, [copy, numberFormat, state]);

  return (
    <form action={formAction} className="space-y-4 p-4 sm:p-5">
      <fieldset>
        <legend className={labelClassName}>{copy.audience.visibility}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer gap-3 rounded-md border border-[#dfe4e8] bg-white p-3">
            <input
              type="radio"
              name="audienceMode"
              value="tenant"
              checked={mode === "tenant"}
              onChange={() => setMode("tenant")}
              className="mt-0.5 size-4 accent-[#2b9188]"
            />
            <span>
              <span className="block text-xs font-bold text-[#354555]">
                {copy.audience.tenant}
              </span>
              <span className="mt-1 block text-[10px] leading-4 text-[#7a8690]">
                {copy.audience.tenantDescription}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-3 rounded-md border border-[#dfe4e8] bg-white p-3">
            <input
              type="radio"
              name="audienceMode"
              value="restricted"
              checked={mode === "restricted"}
              onChange={() => setMode("restricted")}
              className="mt-0.5 size-4 accent-[#2b9188]"
            />
            <span>
              <span className="block text-xs font-bold text-[#354555]">
                {copy.audience.restricted}
              </span>
              <span className="mt-1 block text-[10px] leading-4 text-[#7a8690]">
                {copy.audience.restrictedDescription}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === "restricted" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <AudienceChecklist
            title={copy.audience.members}
            description={copy.audience.membersDescription}
            name="audienceUserIds"
            options={members.map((member) => ({
              id: member.id,
              name: `${member.firstName} ${member.lastName}`,
            }))}
            selectedIds={event.audience.userIds}
            emptyLabel={copy.audience.empty}
          />
          <AudienceChecklist
            title={copy.audience.groups}
            description={copy.audience.groupsDescription}
            name="audienceGroupIds"
            options={groups}
            selectedIds={event.audience.groupIds}
            emptyLabel={copy.audience.empty}
          />
          <AudienceChecklist
            title={copy.audience.bundles}
            description={copy.audience.bundlesDescription}
            name="audienceBundleIds"
            options={bundles}
            selectedIds={event.audience.bundleIds}
            emptyLabel={copy.audience.empty}
          />
        </div>
      ) : null}

      <div className="flex justify-end border-t border-[#edf0f2] pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {copy.audience.save}
        </Button>
      </div>
    </form>
  );
}

function AttendanceManager({ event, members, locale, copy }: { event: EventRow; members: Member[]; locale: AppLocale; copy: EventAdminCopy }) {
  const [pending, startTransition] = useTransition();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [status, setStatus] = useState<AttendanceStatus>("going");
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );

  function run(action: () => Promise<EventAdminActionState>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(actionMessage(result, copy, numberFormat));
      else toast.error(actionMessage(result, copy, numberFormat));
    });
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-2 rounded-md border border-[#dfe4e8] bg-[#f8f9fa] p-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end">
        <label>
          <span className={labelClassName}>{copy.attendance.member}</span>
          <select
            aria-label={copy.attendance.selectMember}
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            className={inputClassName}
          >
            {!members.length ? (
              <option value="">{copy.attendance.noEligible}</option>
            ) : null}
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.firstName} {member.lastName} - {member.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelClassName}>{copy.attendance.status}</span>
          <select
            aria-label={copy.attendance.setStatus}
            value={status}
            onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
            className={inputClassName}
          >
            <option value="going">{copy.attendance.going}</option>
            <option value="maybe">{copy.attendance.maybe}</option>
            <option value="declined">{copy.attendance.declined}</option>
          </select>
        </label>
        <Button
          disabled={pending || !memberId}
          onClick={() => run(() => setEventAttendanceAdminAction(event.id, memberId, status))}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {copy.attendance.set}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#71808b]">
          {copy.attendance.summary(
            numberFormat.format(event.attendees.length),
            numberFormat.format(event.attendeeCount),
          )}
        </p>
        <a
          href={`/admin/events/${event.id}/attendees.csv`}
          download
          aria-label={copy.attendance.exportCsv}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          <Download className="size-3.5" />
          {copy.attendance.csvLabel}
        </a>
      </div>

      <div className="overflow-hidden rounded-md border border-[#dfe4e8]">
        {event.attendees.map((attendee) => (
          <div
            key={attendee.userId}
            className="flex flex-col gap-3 border-b border-[#edf0f2] p-3 last:border-b-0 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#354555]">
                {attendee.firstName} {attendee.lastName}
              </p>
              <p className="truncate text-[11px] text-[#7a8690]">{attendee.email}</p>
            </div>
            <select
              aria-label={copy.attendance.statusFor(`${attendee.firstName} ${attendee.lastName}`)}
              value={attendee.status}
              disabled={pending}
              onChange={(changeEvent) =>
                run(() =>
                  setEventAttendanceAdminAction(
                    event.id,
                    attendee.userId,
                    changeEvent.target.value as AttendanceStatus,
                  ),
                )
              }
              className="focus-ring h-8 rounded-md border border-[#dce1e5] bg-white px-2 text-xs text-[#52606d]"
            >
              <option value="going">{copy.attendance.going}</option>
              <option value="maybe">{copy.attendance.maybe}</option>
              <option value="declined">{copy.attendance.declined}</option>
            </select>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              title={copy.attendance.remove}
              aria-label={copy.attendance.removeFor(`${attendee.firstName} ${attendee.lastName}`)}
              disabled={pending}
              onClick={() =>
                run(() => removeEventAttendanceAdminAction(event.id, attendee.userId))
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {!event.attendees.length ? (
          <p className="p-6 text-center text-xs text-[#7a8690]">
            {copy.attendance.empty}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EventLifecycleManager({ event, locale, copy }: { event: EventRow; locale: AppLocale; copy: EventAdminCopy }) {
  const rescheduleAction = useCallback(
    (state: EventAdminActionState, formData: FormData) =>
      rescheduleEventAdminAction(
        event.id,
        state,
        normalizeEventDateFields(formData),
      ),
    [event.id],
  );
  const cancelAction = cancelEventAdminAction.bind(null, event.id);
  const [rescheduleState, submitReschedule, rescheduling] = useActionState(
    rescheduleAction,
    initialState,
  );
  const [cancelState, submitCancel, cancelling] = useActionState(
    cancelAction,
    initialState,
  );
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );

  useEffect(() => {
    if (rescheduleState.ok === true) toast.success(actionMessage(rescheduleState, copy, numberFormat));
    if (rescheduleState.ok === false) toast.error(actionMessage(rescheduleState, copy, numberFormat));
  }, [copy, numberFormat, rescheduleState]);
  useEffect(() => {
    if (cancelState.ok === true) toast.success(actionMessage(cancelState, copy, numberFormat));
    if (cancelState.ok === false) toast.error(actionMessage(cancelState, copy, numberFormat));
  }, [cancelState, copy, numberFormat]);

  return (
    <div className="space-y-6 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0f2] pb-4">
        <div>
          <p className="text-xs font-bold text-[#354555]">{copy.lifecycle.currentStatus}</p>
          <p className="mt-1 text-[11px] text-[#71808b]">
            {copy.lifecycle.revision(numberFormat.format(event.lifecycleRevision))}
          </p>
        </div>
        <Badge tone={event.status === "cancelled" ? "coral" : "teal"}>
          {event.status === "cancelled" ? copy.common.cancelled : copy.common.scheduled}
        </Badge>
      </div>

      <form action={submitReschedule} className="space-y-4">
        <input type="hidden" name="timezone" value={event.timezone} />
        <div>
          <h3 className="text-sm font-bold text-[#2b3a48]">
            {event.status === "cancelled" ? copy.lifecycle.planAgain : copy.lifecycle.reschedule}
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-[#71808b]">
            {copy.lifecycle.rescheduleDescription}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelClassName}>{copy.lifecycle.newStart}</span>
            <input
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={eventDateTimeLocalValue(event.startsAt, event.timezone)}
              className={inputClassName}
            />
          </label>
          <label>
            <span className={labelClassName}>{copy.lifecycle.newEnd}</span>
            <input
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={eventDateTimeLocalValue(event.endsAt, event.timezone)}
              className={inputClassName}
            />
          </label>
        </div>
        <label>
          <span className={labelClassName}>{copy.lifecycle.reason}</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            className="focus-ring min-h-20 w-full resize-y rounded-md border border-[#dce1e5] bg-white p-3 text-sm text-[#2b3a48]"
          />
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={rescheduling || cancelling}>
            {rescheduling ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <CalendarClock className="size-4" />
            )}
            {event.status === "cancelled" ? copy.lifecycle.planAgainAction : copy.lifecycle.rescheduleAction}
          </Button>
        </div>
      </form>

      {event.status === "scheduled" ? (
        <form action={submitCancel} className="space-y-4 border-t border-[#edf0f2] pt-5">
          <div>
            <h3 className="text-sm font-bold text-[#8c3f35]">{copy.lifecycle.cancelTitle}</h3>
            <p className="mt-1 text-[11px] leading-5 text-[#71808b]">
              {copy.lifecycle.cancelDescription}
            </p>
          </div>
          <label>
            <span className={labelClassName}>{copy.lifecycle.cancelReason}</span>
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              className="focus-ring min-h-20 w-full resize-y rounded-md border border-[#e5c8c3] bg-white p-3 text-sm text-[#2b3a48]"
            />
          </label>
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="danger"
              disabled={cancelling || rescheduling}
            >
              {cancelling ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Ban className="size-4" />
              )}
              {copy.lifecycle.cancelAction}
            </Button>
          </div>
        </form>
      ) : null}

      <section className="border-t border-[#edf0f2] pt-5" aria-labelledby={`event-history-${event.id}`}>
        <h3 id={`event-history-${event.id}`} className="flex items-center gap-2 text-sm font-bold text-[#2b3a48]">
          <History className="size-4 text-[#526b83]" /> {copy.lifecycle.history}
        </h3>
        <ol className="mt-3 divide-y divide-[#edf0f2] border-y border-[#edf0f2]">
          {event.statusHistory.map((entry) => (
            <li key={entry.id} className="grid gap-1 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
              <p className="text-[10px] font-semibold text-[#71808b]">
                {copy.lifecycle.historyRevision(
                  numberFormat.format(entry.revision),
                  formatDateTime(entry.createdAt, locale),
                )}
              </p>
              <div>
                <p className="text-xs font-semibold text-[#354555]">
                  {entry.action === "cancelled"
                    ? copy.lifecycle.cancelled
                    : entry.action === "rescheduled"
                      ? copy.lifecycle.rescheduled
                      : copy.lifecycle.created}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-[#71808b]">
                  {copy.lifecycle.period(
                    formatDateTime(entry.startsAt, locale, entry.timezone),
                    formatDateTime(entry.endsAt, locale, entry.timezone),
                  )}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </p>
              </div>
            </li>
          ))}
          {!event.statusHistory.length ? (
            <li className="py-4 text-xs text-[#71808b]">
              {copy.lifecycle.empty}
            </li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}

function EventDialog({
  event,
  members,
  groups,
  bundles,
  locale,
  copy,
  onClose,
}: {
  event: EventRow;
  members: Member[];
  groups: AudienceOption[];
  bundles: AudienceOption[];
  locale: AppLocale;
  copy: EventAdminCopy;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<
    "details" | "lifecycle" | "audience" | "attendance"
  >(
    "details",
  );
  const eligibleMembers = members.filter((member) =>
    event.eligibleMemberIds.includes(member.id),
  );

  useEffect(() => {
    function handleEscape(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-3 sm:p-5">
      <button
        className="absolute inset-0 bg-[#0f263c]/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label={copy.common.closeDialog}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={copy.dialog.manage(event.title)}
        className="relative max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-[#e8ebee] bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase text-[#2b9188]">{copy.dialog.eyebrow}</p>
              <h2 className="truncate text-base font-bold text-[#243444]">{event.title}</h2>
            </div>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label={copy.common.closeDialog}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex overflow-x-auto px-4 sm:px-5" role="tablist" aria-label={copy.dialog.areas}>
            {([
              ["details", copy.dialog.details],
              ["lifecycle", copy.dialog.lifecycle],
              ["audience", copy.dialog.audience],
              ["attendance", copy.dialog.attendance(new Intl.NumberFormat(intlLocale(locale)).format(event.attendees.length))],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "focus-ring h-10 shrink-0 border-b-2 px-3 text-xs font-semibold",
                  tab === value
                    ? "border-[#2bb7a9] text-[#17324d]"
                    : "border-transparent text-[#71808b]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {tab === "details" ? <EventEditForm event={event} locale={locale} copy={copy} /> : null}
        {tab === "lifecycle" ? <EventLifecycleManager event={event} locale={locale} copy={copy} /> : null}
        {tab === "audience" ? (
          <AudienceManager
            event={event}
            members={members}
            groups={groups}
            bundles={bundles}
            locale={locale}
            copy={copy}
          />
        ) : null}
        {tab === "attendance" ? (
          event.status === "cancelled" ? (
            <div className="p-5 text-sm text-[#71808b]">
              {copy.attendance.locked}
            </div>
          ) : (
            <AttendanceManager event={event} members={eligibleMembers} locale={locale} copy={copy} />
          )
        ) : null}

      </section>
    </div>
  );
}

export function EventManager({
  events,
  members,
  groups,
  bundles,
  calendarTheme,
  locale,
}: {
  events: EventRow[];
  members: Member[];
  groups: AudienceOption[];
  bundles: AudienceOption[];
  calendarTheme: EventCalendarTheme;
  locale: AppLocale;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? null,
    [events, selectedId],
  );
  const copy = getEventAdminCopy(locale);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(intlLocale(locale)),
    [locale],
  );

  return (
    <>
      <EventCalendarThemeEditor theme={calendarTheme} locale={locale} />
      <div className="panel overflow-hidden">
        <div className="border-b border-[#e8ebee] px-5 py-4">
          <h2 className="text-base font-bold text-[#243444]">{copy.manager.title}</h2>
          <p className="mt-1 text-[11px] text-[#7a8690]">{copy.manager.count(numberFormat.format(events.length))}</p>
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {events.map((event) => (
            <article
              id={`event-${event.id}`}
              key={event.id}
              className="grid scroll-mt-24 gap-3 px-4 py-4 hover:bg-[#fafbfb] sm:px-5 md:grid-cols-[150px_minmax(0,1fr)_140px_auto] md:items-center"
            >
              <div>
                <p className="text-xs font-bold text-[#354555]">
                  {formatDate(event.startsAt, { weekday: "short", day: "2-digit", month: "short", timeZone: event.timezone }, locale)}
                </p>
                <p className="mt-1 flex items-center gap-1 text-[10px] text-[#7a8690]">
                  <Clock3 className="size-3" />
                  {formatDate(event.startsAt, { hour: "2-digit", minute: "2-digit", timeZone: event.timezone }, locale)}
                </p>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: event.color }} />
                  <h3 className="truncate text-sm font-semibold text-[#2b3a48]">{event.title}</h3>
                  <Badge tone="neutral">{typeLabel(copy, event.type)}</Badge>
                  {event.status === "cancelled" ? (
                    <Badge tone="coral">{copy.common.cancelled}</Badge>
                  ) : null}
                  <Badge tone={event.audienceMode === "tenant" ? "teal" : "blue"}>
                    {event.audienceMode === "tenant" ? copy.manager.tenant : copy.manager.audience}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-[#71808b]">{event.description}</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] text-[#8a949d]">
                  <MapPin className="size-3" />
                  {event.location ?? copy.common.online}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-[#52606d]">
                <Users className="size-4" />
                {numberFormat.format(event.attendeeCount)}{event.capacity ? ` / ${numberFormat.format(event.capacity)}` : ""}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setSelectedId(event.id)}>
                <Pencil className="size-3.5" />
                {copy.manager.manage}
              </Button>
            </article>
          ))}
          {!events.length ? (
            <div className="grid min-h-52 place-items-center p-8 text-center">
              <div>
                <CalendarClock className="mx-auto size-7 text-[#a2abb3]" />
                <p className="mt-3 text-sm font-semibold text-[#354555]">{copy.manager.empty}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {selected ? (
        <EventDialog
          key={selected.id}
          event={selected}
          members={members}
          groups={groups}
          bundles={bundles}
          locale={locale}
          copy={copy}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </>
  );
}
