import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatLearningTime,
} from "../src/lib/utils";

test("duration and learning-time formatting covers every supported locale", () => {
  const durations = new Set(
    SUPPORTED_LOCALES.map((locale) => formatDuration(95, locale)),
  );
  const learningTimes = new Set(
    SUPPORTED_LOCALES.map((locale) => formatLearningTime(3_725, locale)),
  );

  assert.equal(durations.size, 3);
  assert.equal(learningTimes.size, 3);
  assert.equal(formatDuration(95, "de"), "1 Std. 35 Min.");
  assert.equal(formatDuration(95, "en"), "1 hr 35 min");
  assert.equal(formatLearningTime(3_725, "es"), "1 h 2 min");
});

test("date formatting uses the effective locale without changing the platform timezone", () => {
  const date = new Date("2026-07-13T12:30:00.000Z");
  const german = formatDate(date, undefined, "de");
  const english = formatDate(date, undefined, "en");
  const italianDateTime = formatDateTime(date, "it");

  assert.notEqual(german, english);
  assert.match(german, /13/);
  assert.match(english, /13/);
  assert.match(italianDateTime, /14:30/);
});

test("localized dashboards and catalogs pass their resolved locale to formatters", () => {
  const academyDashboard = readFileSync(
    "src/app/(member)/academy/page.tsx",
    "utf8",
  );
  const adminDashboard = readFileSync(
    "src/app/(admin)/admin/page.tsx",
    "utf8",
  );
  const modulesPage = readFileSync(
    "src/app/(admin)/admin/modules/page.tsx",
    "utf8",
  );
  const certificatesPage = readFileSync(
    "src/app/(member)/academy/certificates/page.tsx",
    "utf8",
  );

  assert.match(
    academyDashboard,
    /formatDuration\(course\.estimatedMinutes, locale\)/,
  );
  assert.match(
    academyDashboard,
    /formatDateTime\(post\.createdAt, locale\)/,
  );
  assert.match(
    academyDashboard,
    /formatDateTime\(event\.startsAt, locale, event\.timezone\)/,
  );
  assert.match(
    adminDashboard,
    /formatDateTime\(submission\.submittedAt, locale\)/,
  );
  assert.match(
    modulesPage,
    /formatDuration\(module\.estimatedMinutes, locale\)/,
  );
  assert.match(
    modulesPage,
    /formatDate\(module\.updatedAt, undefined, locale\)/,
  );
  assert.match(
    certificatesPage,
    /formatDate\(certificate\.completedAt, undefined, locale\)/,
  );
});
