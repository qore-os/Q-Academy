import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../drizzle/0066_webhook_delivery_attempt_history.sql", import.meta.url),
  "utf8",
);
const worker = await readFile(
  new URL("../src/lib/api/webhook-delivery.ts", import.meta.url),
  "utf8",
);
const operations = await readFile(
  new URL("../src/lib/api/webhook-delivery-operations.ts", import.meta.url),
  "utf8",
);

test("webhook attempt migration is tenant-bound, sanitized and append-only", () => {
  assert.match(migration, /CREATE TABLE "webhook_delivery_attempts"/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf('CREATE TABLE "webhook_delivery_attempts"'),
      migration.indexOf(");\n--> statement-breakpoint"),
    ),
    /response_body"/,
  );
  assert.match(migration, /"response_body_redacted" boolean/);
  assert.match(migration, /webhook_delivery_attempts_delivery_tenant_fk/);
  assert.match(migration, /webhook_delivery_attempts_webhook_tenant_fk/);
  assert.ok(
    migration.indexOf('CREATE UNIQUE INDEX "webhook_deliveries_id_organization_idx"') <
      migration.indexOf('ADD CONSTRAINT "webhook_delivery_attempts_delivery_tenant_fk"'),
    "The referenced tenant key must exist before the composite foreign key.",
  );
  assert.match(migration, /webhook delivery attempts are append-only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "public"\."webhook_delivery_attempts"/);
  assert.match(migration, /BEFORE TRUNCATE ON "public"\."webhook_delivery_attempts"/);
  assert.match(migration, /tenant_erasure_cascade_is_authorized/);
});

test("webhook worker commits a claim-guarded attempt with its parent transition", () => {
  assert.match(worker, /claimToken = randomUUID\(\)/);
  assert.match(worker, /eq\(webhookDeliveries\.claimToken, claimToken\)/);
  assert.match(worker, /return db\.transaction\(async \(tx\) =>/);
  assert.match(worker, /tx\.insert\(webhookDeliveryAttempts\)/);
  assert.match(worker, /responseBodyRedacted: responseBody\.length > 0/);
  assert.match(worker, /if \(!updated\) return null/);
});

test("replay advances the generation while preserving immutable attempts", () => {
  assert.match(
    operations,
    /replayGeneration: sql`\$\{webhookDeliveries\.replayGeneration\} \+ 1`/,
  );
  assert.match(operations, /claimToken: null/);
  assert.match(operations, /\.from\(webhookDeliveryAttempts\)/);
  assert.match(operations, /\.limit\(50\)/);
});
