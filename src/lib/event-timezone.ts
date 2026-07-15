export const DEFAULT_EVENT_TIME_ZONE = "Europe/Berlin";
export const EVENT_TIME_ZONE_PATTERN =
  /^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9._+-]+)+)$/;

export const EVENT_TIME_ZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Vienna",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(timeZone, created);
  return created;
}

function partsAt(value: Date, timeZone: string): DateTimeParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function sameParts(left: DateTimeParts, right: DateTimeParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function partsUtcMillis(parts: DateTimeParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
}

export function isValidEventTimeZone(value: string) {
  if (
    !value ||
    value.length > 64 ||
    !EVENT_TIME_ZONE_PATTERN.test(value)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function eventDateTimeLocalValue(value: Date, timeZone: string) {
  const parts = partsAt(value, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function eventZonedDateTimeToInstant(
  value: string,
  timeZone: string,
) {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match || !isValidEventTimeZone(timeZone)) return null;
  const desired: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const desiredUtc = partsUtcMillis(desired);
  const normalized = new Date(desiredUtc);
  if (
    normalized.getUTCFullYear() !== desired.year ||
    normalized.getUTCMonth() + 1 !== desired.month ||
    normalized.getUTCDate() !== desired.day ||
    normalized.getUTCHours() !== desired.hour ||
    normalized.getUTCMinutes() !== desired.minute
  ) {
    return null;
  }

  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(desiredUtc + hours * 60 * 60_000);
    offsets.add(partsUtcMillis(partsAt(sample, timeZone)) - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(desiredUtc - offset))
    .filter((candidate) => sameParts(partsAt(candidate, timeZone), desired))
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0] ?? null;
}

export function eventTimeZoneDisplayName(
  timeZone: string,
  locale: string,
  at: Date,
) {
  const label = new Intl.DateTimeFormat(locale, {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return label ? `${timeZone} (${label})` : timeZone;
}
