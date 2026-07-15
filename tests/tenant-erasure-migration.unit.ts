import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../drizzle/0064_tenant_erasure_workflow.sql", import.meta.url),
  "utf8",
);
const alignmentMigration = await readFile(
  new URL("../drizzle/0065_tenant_erasure_fk_alignment.sql", import.meta.url),
  "utf8",
);

test("tenant erasure migration retains immutable receipts and authorizes exact cascades", () => {
  assert.match(migration, /CREATE TABLE "tenant_erasure_receipts"/);
  assert.match(migration, /CREATE TABLE "tenant_erasure_events"/);
  assert.match(migration, /tenant_erasure_cascade_is_authorized/);
  assert.match(
    migration,
    /current_setting\('q_academy\.tenant_erasure_receipt', true\)/,
  );
  assert.match(migration, /receipt\."status" = 'erasing'/);
  assert.match(migration, /organization\."status" <> 'offboarding'/);
  for (const triggerFunction of [
    "prevent_privacy_request_event_mutation",
    "reject_community_moderation_event_mutation",
    "prevent_ai_agent_action_event_mutation",
    "protect_ai_agent_action_request_payload",
    "reject_ai_agent_membership_provenance_removal",
    "protect_event_lifecycle_history",
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION \\"public\\"\\.\\"${triggerFunction}\\"`));
  }
  assert.match(migration, /tenant erasure receipts are immutable evidence/);
  assert.match(migration, /tenant erasure events are append-only/);
});

test("tenant erasure FK alignment makes every archived audit row cascade", () => {
  for (const constraint of [
    "activity_events_organization_id_organizations_id_fk",
    "ai_agent_action_events_organization_id_organizations_id_fk",
  ]) {
    assert.match(alignmentMigration, new RegExp(`DROP CONSTRAINT \\"${constraint}\\"`));
    assert.match(
      alignmentMigration,
      new RegExp(`ADD CONSTRAINT \\"${constraint}\\"[\\s\\S]*ON DELETE cascade`),
    );
  }
});
