import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EVENT_CALENDAR_THEME,
  eventCalendarReadableTextColor,
  eventCalendarThemeSchema,
  resolveEventCalendarTheme,
} from "../src/lib/event-calendar-theme";
import { normalizeEventDateFields } from "../src/lib/event-form";
import {
  eventDateTimeLocalValue,
  eventZonedDateTimeToInstant,
} from "../src/lib/event-timezone";

test("event wall-clock values are converted with IANA daylight-saving rules", () => {
  assert.equal(
    eventZonedDateTimeToInstant(
      "2026-07-14T10:30",
      "Europe/Berlin",
    )?.toISOString(),
    "2026-07-14T08:30:00.000Z",
  );
  assert.equal(
    eventZonedDateTimeToInstant(
      "2026-01-14T10:30",
      "Europe/Berlin",
    )?.toISOString(),
    "2026-01-14T09:30:00.000Z",
  );
  assert.equal(
    eventZonedDateTimeToInstant("2026-03-29T02:30", "Europe/Berlin"),
    null,
  );
  assert.equal(
    eventZonedDateTimeToInstant(
      "2026-10-25T02:30",
      "Europe/Berlin",
    )?.toISOString(),
    "2026-10-25T00:30:00.000Z",
  );
  assert.equal(
    eventDateTimeLocalValue(
      new Date("2026-07-14T08:30:00.000Z"),
      "Europe/Berlin",
    ),
    "2026-07-14T10:30",
  );
});

test("event form normalization never depends on the browser time zone", () => {
  const formData = new FormData();
  formData.set("timezone", "America/New_York");
  formData.set("startsAt", "2026-07-14T10:30");
  formData.set("endsAt", "2026-07-14T11:30");
  normalizeEventDateFields(formData);
  assert.equal(formData.get("startsAt"), "2026-07-14T14:30:00.000Z");
  assert.equal(formData.get("endsAt"), "2026-07-14T15:30:00.000Z");
});

test("calendar themes require bounded layout and WCAG AA colours", () => {
  assert.deepEqual(
    eventCalendarThemeSchema.parse(DEFAULT_EVENT_CALENDAR_THEME),
    DEFAULT_EVENT_CALENDAR_THEME,
  );
  assert.equal(
    eventCalendarThemeSchema.safeParse({
      ...DEFAULT_EVENT_CALENDAR_THEME,
      bodyColor: "#dddddd",
    }).success,
    false,
  );
  assert.equal(eventCalendarReadableTextColor("#ffffff"), "#000000");
  assert.equal(eventCalendarReadableTextColor("#000000"), "#ffffff");
  assert.deepEqual(resolveEventCalendarTheme({}), DEFAULT_EVENT_CALENDAR_THEME);
});
