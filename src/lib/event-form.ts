import {
  DEFAULT_EVENT_TIME_ZONE,
  eventZonedDateTimeToInstant,
  isValidEventTimeZone,
} from "@/lib/event-timezone";

export function normalizeEventDateFields(formData: FormData) {
  const rawTimeZone = formData.get("timezone");
  const timeZone =
    typeof rawTimeZone === "string" && isValidEventTimeZone(rawTimeZone)
      ? rawTimeZone
      : DEFAULT_EVENT_TIME_ZONE;
  formData.set("timezone", timeZone);
  for (const field of ["startsAt", "endsAt"] as const) {
    const value = formData.get(field);
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      continue;
    }
    const date = eventZonedDateTimeToInstant(value, timeZone);
    if (date) formData.set(field, date.toISOString());
  }
  return formData;
}
