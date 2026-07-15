import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(process.cwd(), "drizzle/0055_product_completion_wave.sql"),
  "utf8",
);

test("0055 adds locale preferences and constrained active learning time", () => {
  assert.match(migration, /ADD COLUMN "default_locale" varchar\(5\) DEFAULT 'de' NOT NULL/);
  assert.match(migration, /ADD COLUMN "preferred_locale" varchar\(5\)/);
  assert.match(migration, /organizations_default_locale_check/);
  assert.match(migration, /users_preferred_locale_check/);
  assert.match(migration, /CREATE TABLE "lesson_learning_time_sessions"/);
  assert.match(migration, /lesson_learning_time_sessions_sequence_check/);
  assert.match(migration, /lesson_learning_time_sessions_timestamps_check/);
  assert.match(migration, /lesson_learning_time_sessions_user_tenant_fk/);
});

test("0055 stores push credentials encrypted and binds every delivery to its tenant", () => {
  assert.match(migration, /CREATE TABLE "web_push_subscriptions"/);
  assert.match(migration, /web_push_subscriptions_encrypted_check/);
  assert.match(migration, /CREATE TABLE "push_notification_deliveries"/);
  assert.match(migration, /push_notification_deliveries_state_check/);
  assert.match(migration, /push_notification_deliveries_notification_user_fk/);
  assert.match(migration, /push_notification_deliveries_subscription_tenant_fk/);
  assert.doesNotMatch(migration, /\bendpoint\b varchar|\bp256dh\b|\bauth_secret\b/);
});

test("0055 creates the composite subscription key before the delivery foreign key", () => {
  const uniqueIndex = migration.indexOf(
    'CREATE UNIQUE INDEX "web_push_subscriptions_id_user_org_idx"',
  );
  const foreignKey = migration.indexOf(
    'ADD CONSTRAINT "push_notification_deliveries_subscription_tenant_fk"',
  );
  assert.ok(uniqueIndex >= 0, "Missing composite subscription unique index.");
  assert.ok(foreignKey > uniqueIndex, "The subscription key must exist before its FK.");
});
