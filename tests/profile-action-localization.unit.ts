import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dataProfileActionMessage,
  getDataProfileActionCopy,
  type DataProfileMessageCode,
} from "../src/lib/i18n/data-profile-actions";
import {
  getAdminAnalyticsActionCopy,
  progressResetActionMessage,
  type ProgressResetMessageCode,
} from "../src/lib/i18n/admin-analytics-actions";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const dataProfileCodes: DataProfileMessageCode[] = [
  "invalidProfile",
  "invalidMember",
  "memberNotFound",
  "definitionNotFound",
  "definitionRestricted",
  "duplicateName",
  "profileCreated",
  "profileNotFound",
  "profileActivated",
  "activeProfileArchiveDenied",
  "profileArchived",
  "invalidFieldValue",
  "mediaUnavailable",
  "fieldsSaved",
  "failed",
];

const progressResetCodes: ProgressResetMessageCode[] = [
  "invalidRequest",
  "assignmentNotFound",
  "confirmationMismatch",
  "certificateRevocationRequired",
  "sharedProgressBlocked",
  "progressReset",
  "resetFailed",
];

const params = {
  name: "Profile A",
  label: "Department",
  required: true,
  certificateNumber: "CERT-1",
  courseTitle: "Course A",
  lessonStates: 3,
  quizAttempts: 2,
  submissions: 1,
  submissionsIncluded: true,
  certificateRevoked: true,
};

test("data profile action messages have complete locale and code parity", () => {
  const expectedCodes = Object.keys(getDataProfileActionCopy("de")).sort();
  assert.deepEqual(expectedCodes, [...dataProfileCodes].sort());

  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(
      Object.keys(getDataProfileActionCopy(locale)).sort(),
      expectedCodes,
    );
    for (const code of dataProfileCodes) {
      assert.ok(dataProfileActionMessage(locale, code, params).trim());
    }
  }
});

test("progress reset actions and recipient notifications have locale parity", () => {
  const expectedCodes = Object.keys(
    getAdminAnalyticsActionCopy("de").messages,
  ).sort();
  assert.deepEqual(expectedCodes, [...progressResetCodes].sort());

  for (const locale of SUPPORTED_LOCALES) {
    const copy = getAdminAnalyticsActionCopy(locale);
    assert.deepEqual(Object.keys(copy.messages).sort(), expectedCodes);
    for (const code of progressResetCodes) {
      assert.ok(progressResetActionMessage(locale, code, params).trim());
    }
    assert.ok(copy.notification.title.trim());
    assert.ok(copy.notification.revocationReason.trim());
    assert.ok(copy.notification.body("Course A", false).trim());
    assert.ok(copy.notification.body("Course A", true).trim());
  }

  assert.notEqual(
    getAdminAnalyticsActionCopy("de").notification.title,
    getAdminAnalyticsActionCopy("en").notification.title,
  );
});

test("profile and analytics clients render stable action codes", () => {
  const profileManager = readFileSync(
    "src/components/admin/member-data-profile-manager.tsx",
    "utf8",
  );
  const analytics = readFileSync(
    "src/components/admin/analytics-member-table.tsx",
    "utf8",
  );
  const profileActions = readFileSync(
    "src/lib/data-profile-actions.ts",
    "utf8",
  );
  const analyticsActions = readFileSync(
    "src/lib/admin-analytics-actions.ts",
    "utf8",
  );

  assert.match(profileManager, /dataProfileActionMessage/);
  assert.doesNotMatch(profileManager, /result\.message|state\.message/);
  assert.match(analytics, /progressResetActionMessage/);
  assert.doesNotMatch(analytics, /result\.message/);
  assert.match(profileActions, /code: "profileCreated"/);
  assert.match(profileActions, /code: "fieldsSaved"/);
  assert.match(analyticsActions, /code: "progressReset"/);
  assert.match(analyticsActions, /resolveRecipientLocale/);
});
