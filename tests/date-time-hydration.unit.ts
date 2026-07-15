import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatDate,
  formatDateTime,
  PLATFORM_TIME_ZONE,
} from "../src/lib/utils";

test("shared date formatting is stable by default and honors explicit time zones", () => {
  const instant = "2026-01-15T23:30:00.000Z";
  const originalTimeZone = process.env.TZ;

  try {
    process.env.TZ = "Pacific/Honolulu";
    const honoluluDate = formatDate(instant);
    const honoluluDateTime = formatDateTime(instant);

    process.env.TZ = "Asia/Tokyo";
    assert.equal(formatDate(instant), honoluluDate);
    assert.equal(formatDateTime(instant), honoluluDateTime);
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }

  assert.equal(PLATFORM_TIME_ZONE, "Europe/Berlin");
  assert.equal(
    formatDate(instant, {
      dateStyle: "full",
      timeZone: "Pacific/Honolulu",
    }),
    new Intl.DateTimeFormat("de-DE", {
      dateStyle: "full",
      timeZone: "Pacific/Honolulu",
    }).format(new Date(instant)),
  );
});

test("event status hydration starts from a serialized server reference time", () => {
  const page = readFileSync("src/app/(member)/academy/events/page.tsx", "utf8");
  const eventList = readFileSync("src/components/academy/event-list.tsx", "utf8");

  assert.match(page, /const referenceTime = new Date\(\)\.toISOString\(\)/);
  assert.match(page, /referenceTime=\{referenceTime\}/);
  assert.match(eventList, /referenceTime: string/);
  assert.match(
    eventList,
    /useState\(\(\) => new Date\(referenceTime\)\.getTime\(\)\)/,
  );
  assert.doesNotMatch(eventList, /useState\(\(\) => Date\.now\(\)\)/);
});

test("privacy request IDs use the page reference time during hydration", () => {
  const page = readFileSync("src/app/(admin)/admin/privacy/page.tsx", "utf8");
  const manager = readFileSync(
    "src/components/admin/privacy-request-manager.tsx",
    "utf8",
  );

  assert.match(page, /referenceTime=\{new Date\(\)\.toISOString\(\)\}/);
  assert.match(manager, /referenceTime=\{referenceTime\}/);
  assert.match(manager, /DSAR-\$\{referenceTime\.slice\(0, 10\)\}-/);
  assert.doesNotMatch(manager, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test("client-owned date formatters declare the platform time zone", () => {
  const formatterFiles = [
    "src/components/academy/ai-workspace.tsx",
    "src/components/academy/community-own-submissions.tsx",
    "src/components/academy/member-course-explorer.tsx",
    "src/lib/i18n/api-console.ts",
    "src/components/admin/community-moderation-queue.tsx",
    "src/components/admin/course-module-access-admin.tsx",
    "src/components/admin/custom-domain-panel.tsx",
    "src/components/admin/email-template-editor.tsx",
    "src/components/orbit/orbit-console.tsx",
  ];

  for (const file of formatterFiles) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /PLATFORM_TIME_ZONE|import\s*\{[\s\S]{0,300}\bformat(?:Date|DateTime)\b[\s\S]{0,300}\}\s*from "@\/lib\/utils"/,
      file,
    );
  }
});
