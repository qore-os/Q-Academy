import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(process.cwd(), "drizzle/0054_local_product_completion.sql"),
  "utf8",
);

function position(fragment: string) {
  const index = migration.indexOf(fragment);
  assert.notEqual(index, -1, `Missing migration fragment: ${fragment}`);
  return index;
}

test("0054 adds both new tenant-bound product evidence tables", () => {
  assert.match(migration, /CREATE TABLE "ai_external_use_acknowledgements"/);
  assert.match(migration, /ai_external_use_acknowledgements_user_tenant_fk/);
  assert.match(migration, /ai_external_use_acknowledgements_user_notice_idx/);
  assert.match(migration, /CREATE TABLE "event_lifecycle_history"/);
  assert.match(migration, /event_lifecycle_history_event_tenant_fk/);
  assert.match(migration, /event_lifecycle_history_event_revision_idx/);
});

test("0054 repairs and backfills legacy events before sealing history", () => {
  assert.ok(
    position('UPDATE "public"."events"') <
      position('ADD CONSTRAINT "events_window_check"'),
  );
  assert.ok(
    position('CREATE UNIQUE INDEX "events_id_organization_idx"') <
      position('ADD CONSTRAINT "event_lifecycle_history_event_tenant_fk"'),
  );
  assert.match(
    migration,
    /INSERT INTO "public"\."event_lifecycle_history"[\s\S]*'created'::"public"\."event_lifecycle_action"[\s\S]*ON CONFLICT \("event_id", "revision"\) DO NOTHING/,
  );
});

test("0054 makes event history append-only and permits only tenant cascade cleanup", () => {
  assert.match(migration, /protect_event_lifecycle_history/);
  assert.match(
    migration,
    /TG_OP = 'DELETE' AND NOT EXISTS[\s\S]*"public"\."organizations"/,
  );
  assert.match(migration, /event_lifecycle_history_append_only_trigger/);
  assert.match(migration, /event_lifecycle_history_reject_truncate_trigger/);
});

test("0054 enables the separately approved course access removal action", () => {
  assert.match(
    migration,
    /ALTER TYPE "public"\."ai_agent_action_type" ADD VALUE 'course_unenrollment'/,
  );
});
