import assert from "node:assert/strict";
import test from "node:test";

import {
  categoryForEmailEvent,
  categoryForNotificationType,
  CONFIGURABLE_NOTIFICATION_CATEGORIES,
} from "@/lib/notification-preference-model";
import {
  normalizeOptionalPhone,
  optionalPhoneSchema,
} from "@/lib/phone-number";

test("phone input normalizes bounded international numbers", () => {
  assert.equal(normalizeOptionalPhone(" +49 (170) 123-45.67 "), "+491701234567");
  assert.equal(normalizeOptionalPhone("0044 20 7946 0958"), "+442079460958");
  assert.equal(normalizeOptionalPhone("  "), null);
  assert.equal(optionalPhoneSchema.parse("+1 202 555 0184"), "+12025550184");
  assert.equal(optionalPhoneSchema.parse(""), null);
});

test("phone input rejects local, overlong, and impossible international values", () => {
  for (const value of ["0170 1234567", "+01234567", "+49abc123", `+49${"1".repeat(20)}`]) {
    assert.equal(optionalPhoneSchema.safeParse(value).success, false, value);
  }
});

test("notification categories classify delivery events without making system mail optional", () => {
  assert.deepEqual(CONFIGURABLE_NOTIFICATION_CATEGORIES, [
    "learning",
    "community",
    "events",
    "feedback",
    "announcements",
  ]);
  assert.equal(categoryForEmailEvent("lesson.available"), "learning");
  assert.equal(categoryForEmailEvent("feedback.reply"), "feedback");
  assert.equal(categoryForEmailEvent("event.cancelled"), "events");
  assert.equal(categoryForEmailEvent("password.reset"), "system");
  assert.equal(categoryForNotificationType("community"), "community");
  assert.equal(categoryForNotificationType("submission"), "feedback");
  assert.equal(categoryForNotificationType("unknown"), "system");
});

