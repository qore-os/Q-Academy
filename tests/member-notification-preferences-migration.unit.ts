import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    "drizzle/0060_member_notification_preferences.sql",
  ),
  "utf8",
);

function position(fragment: string) {
  const index = migration.indexOf(fragment);
  assert.ok(index >= 0, `Missing migration fragment: ${fragment}`);
  return index;
}

test("0060 creates tenant-bound preferences with default-on channels", () => {
  assert.match(migration, /CREATE TYPE "public"\."notification_category"/);
  assert.match(migration, /CREATE TABLE "user_notification_preferences"/);
  assert.match(migration, /"email_enabled" boolean DEFAULT true NOT NULL/);
  assert.match(migration, /"push_enabled" boolean DEFAULT true NOT NULL/);
  assert.match(
    migration,
    /user_notification_preferences_user_tenant_fk[\s\S]*FOREIGN KEY \("user_id","organization_id"\)/,
  );
  assert.match(
    migration,
    /user_notification_preferences_configurable_category_check[\s\S]*<> 'system'/,
  );
});

test("0060 backfills delivery categories before installing classifiers", () => {
  const notificationColumn = position(
    'ALTER TABLE "notifications" ADD COLUMN "category"',
  );
  const notificationBackfill = position('UPDATE "notifications"');
  const notificationTrigger = position(
    'CREATE TRIGGER "notifications_classify_category_trigger"',
  );
  const emailBackfill = position('UPDATE "email_deliveries"');
  const emailTrigger = position(
    'CREATE TRIGGER "email_deliveries_classify_category_trigger"',
  );
  assert.ok(notificationColumn < notificationBackfill);
  assert.ok(notificationBackfill < notificationTrigger);
  assert.ok(emailBackfill < emailTrigger);
  assert.match(migration, /'password\.reset'[\s\S]*|ELSE 'system'/);
});

test("0060 constrains normalized E.164 phone storage", () => {
  assert.match(migration, /ADD COLUMN "phone" varchar\(16\)/);
  assert.match(migration, /users_phone_e164_check/);
  assert.match(migration, /\\\+\[1-9\]\[0-9\]\{6,14\}/);
});

