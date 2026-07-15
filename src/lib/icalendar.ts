export type CalendarEvent = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone?: string;
  location: string | null;
  meetingUrl: string | null;
  status?: "scheduled" | "cancelled";
  lifecycleRevision?: number;
};

export function escapeIcsText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

export function formatIcsUtc(value: Date) {
  return value
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function foldIcsLine(line: string) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let bytes = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (bytes + characterBytes > 75) {
      lines.push(current);
      current = ` ${character}`;
      bytes = 1 + characterBytes;
    } else {
      current += character;
      bytes += characterBytes;
    }
  }
  lines.push(current);
  return lines.join("\r\n");
}

function safeCalendarUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function createEventCalendar(
  event: CalendarEvent,
  calendarName: string,
  generatedAt = new Date(),
) {
  const url = safeCalendarUrl(event.meetingUrl);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Q-Academy//Event Calendar//DE",
    "CALSCALE:GREGORIAN",
    event.status === "cancelled" ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    event.timezone
      ? `X-WR-TIMEZONE:${escapeIcsText(event.timezone)}`
      : null,
    "BEGIN:VEVENT",
    `UID:${event.id}@${event.organizationId}.q-academy`,
    `SEQUENCE:${event.lifecycleRevision ?? 0}`,
    `DTSTAMP:${formatIcsUtc(generatedAt)}`,
    `DTSTART:${formatIcsUtc(event.startsAt)}`,
    `DTEND:${formatIcsUtc(event.endsAt)}`,
    event.timezone
      ? `X-Q-ACADEMY-TIMEZONE:${escapeIcsText(event.timezone)}`
      : null,
    `SUMMARY:${escapeIcsText(event.title)}`,
    event.description
      ? `DESCRIPTION:${escapeIcsText(event.description)}`
      : null,
    event.location ? `LOCATION:${escapeIcsText(event.location)}` : null,
    url ? `URL:${url}` : null,
    event.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
