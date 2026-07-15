export type EventCsvAttendee = {
  firstName: string;
  lastName: string;
  email: string;
  status: "going" | "maybe" | "declined";
  respondedAt: Date;
};

export function neutralizeSpreadsheetCell(value: string) {
  return /^\s*[=+\-@]/u.test(value) || /^\s*[\t\r]/u.test(value)
    ? `'${value}`
    : value;
}

function csvCell(value: string) {
  return `"${neutralizeSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

function statusLabel(
  status: EventCsvAttendee["status"],
  locale: AppLocale,
) {
  const copy = getEventAdminCopy(locale).attendance;
  if (status === "going") return copy.going;
  if (status === "maybe") return copy.maybe;
  return copy.declined;
}

export function createEventAttendeeCsv(
  attendees: EventCsvAttendee[],
  locale: AppLocale = DEFAULT_LOCALE,
) {
  const copy = getEventAdminCopy(locale);
  const rows = [
    [...copy.csv.headers],
    ...attendees.map((attendee) => [
      attendee.firstName,
      attendee.lastName,
      attendee.email,
      statusLabel(attendee.status, locale),
      attendee.respondedAt.toISOString(),
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
import { getEventAdminCopy } from "@/lib/i18n/event-admin";
import { type AppLocale, DEFAULT_LOCALE } from "@/lib/i18n/model";
