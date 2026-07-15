import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OperationalCleanupConfigurationError,
  resolveOperationalCleanupPolicy,
} from "../src/lib/operational-cleanup-policy";

test("operational cleanup applies conservative delivery retention defaults", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const policy = resolveOperationalCleanupPolicy({}, now);

  assert.equal(policy.emailDeliveryRetentionDays, 90);
  assert.equal(policy.webhookDeliveryRetentionDays, 90);
  assert.equal(policy.pushDeliveryRetentionDays, 90);
  assert.equal(policy.communityAuthorBoostRetentionDays, 90);
  assert.equal(
    policy.emailDeliveryCutoff.toISOString(),
    "2026-04-11T12:00:00.000Z",
  );
  assert.equal(
    policy.webhookDeliveryCutoff.toISOString(),
    "2026-04-11T12:00:00.000Z",
  );
  assert.equal(
    policy.pushDeliveryCutoff.toISOString(),
    "2026-04-11T12:00:00.000Z",
  );
  assert.equal(
    policy.communityAuthorBoostCutoff.toISOString(),
    "2026-04-11T12:00:00.000Z",
  );
});

test("operational cleanup supports independent bounded delivery policies", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const policy = resolveOperationalCleanupPolicy(
    {
      EMAIL_DELIVERY_RETENTION_DAYS: "30",
      WEBHOOK_DELIVERY_RETENTION_DAYS: "365",
      PUSH_DELIVERY_RETENTION_DAYS: "7",
      COMMUNITY_AUTHOR_BOOST_RETENTION_DAYS: "180",
    },
    now,
  );

  assert.equal(policy.emailDeliveryRetentionDays, 30);
  assert.equal(policy.webhookDeliveryRetentionDays, 365);
  assert.equal(policy.pushDeliveryRetentionDays, 7);
  assert.equal(policy.communityAuthorBoostRetentionDays, 180);
  assert.equal(
    policy.emailDeliveryCutoff.toISOString(),
    "2026-06-10T12:00:00.000Z",
  );
  assert.equal(
    policy.webhookDeliveryCutoff.toISOString(),
    "2025-07-10T12:00:00.000Z",
  );
  assert.equal(
    policy.pushDeliveryCutoff.toISOString(),
    "2026-07-03T12:00:00.000Z",
  );
  assert.equal(
    policy.communityAuthorBoostCutoff.toISOString(),
    "2026-01-11T12:00:00.000Z",
  );
});

test("operational cleanup rejects invalid retention instead of guessing", () => {
  for (const value of ["0", "1.5", "-1", "3651", "forever"]) {
    assert.throws(
      () =>
        resolveOperationalCleanupPolicy({
          EMAIL_DELIVERY_RETENTION_DAYS: value,
        }),
      OperationalCleanupConfigurationError,
    );
  }
  assert.throws(
    () =>
      resolveOperationalCleanupPolicy({
        COMMUNITY_AUTHOR_BOOST_RETENTION_DAYS: "3651",
      }),
    OperationalCleanupConfigurationError,
  );
  assert.throws(
    () =>
      resolveOperationalCleanupPolicy({
        PUSH_DELIVERY_RETENTION_DAYS: "0",
      }),
    OperationalCleanupConfigurationError,
  );
});

test("generic retention never owns moderation case history", () => {
  const sources = [
    readFileSync(
      new URL("../src/lib/operational-cleanup.ts", import.meta.url),
      "utf8",
    ),
    readFileSync(
      new URL("../src/lib/privacy/retention.ts", import.meta.url),
      "utf8",
    ),
  ].join("\n");

  for (const protectedName of [
    "communityModerationCases",
    "communityModerationEvents",
    "communityModerationAssessments",
    "communityModerationAppeals",
    "community_moderation_cases",
    "community_moderation_events",
    "community_moderation_assessments",
    "community_moderation_appeals",
  ]) {
    assert.equal(
      sources.includes(protectedName),
      false,
      `${protectedName} must stay outside generic cleanup ownership.`,
    );
  }
});
