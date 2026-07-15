import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 1, prepare: false });

after(async () => {
  await sql.end();
});

test("event lifecycle history is immutable but permits full tenant cascade", async () => {
  const organizationId = randomUUID();
  const eventId = randomUUID();
  const receiptId = randomUUID();
  const rollback = new Error("rollback event-history integration fixture");

  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`
        insert into organizations (id, name, slug, status)
        values (
          ${organizationId}, 'Event audit',
          ${`event-audit-${organizationId.slice(0, 8)}`}, 'offboarding'
        )
      `;
      await tx`
        insert into events (
          id, organization_id, title, starts_at, ends_at, color
        ) values (
          ${eventId}, ${organizationId}, 'Immutable lifecycle',
          '2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z', '#4f7cac'
        )
      `;
      await tx`
        insert into event_lifecycle_history (
          organization_id, event_id, actor_reference, action, to_status,
          starts_at, ends_at, revision
        ) values (
          ${organizationId}, ${eventId}, ${"a".repeat(64)}, 'created',
          'scheduled', '2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z', 0
        )
      `;

      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            update event_lifecycle_history
            set actor_reference = ${"b".repeat(64)}
            where event_id = ${eventId}
          `;
        }),
        /append-only/,
      );
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            delete from event_lifecycle_history where event_id = ${eventId}
          `;
        }),
        /append-only/,
      );
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`delete from events where id = ${eventId}`;
        }),
        /append-only/,
      );
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`delete from organizations where id = ${organizationId}`;
        }),
        /append-only/,
      );

      await tx`
        insert into tenant_erasure_receipts (
          id, organization_id, organization_slug, request_reference,
          approved_by, legal_basis, status, requested_at, execute_after,
          backup_expires_at, customer_export_sha256,
          evidence_archive_sha256, evidence_manifest_sha256, archive_key_id,
          media_asset_count, storage_object_count, row_counts, policy_manifest
        ) values (
          ${receiptId}, ${organizationId},
          ${`event-audit-${organizationId.slice(0, 8)}`},
          ${`REQ-${receiptId}`}, 'privacy-owner', 'approved test policy',
          'erasing', now() - interval '31 days', now() - interval '1 day',
          now() + interval '30 days', ${"c".repeat(64)}, ${"d".repeat(64)},
          ${"e".repeat(64)}, 'test-key', 0, 0,
          ${tx.json({ event_lifecycle_history: 1 })},
          ${tx.json({ format: "integration-fixture" })}
        )
      `;
      await tx`
        select set_config(
          'q_academy.tenant_erasure_receipt', ${receiptId}, true
        )
      `;
      await tx`delete from organizations where id = ${organizationId}`;
      const [remaining] = await tx<Array<{ value: number }>>`
        select count(*)::int as value
        from event_lifecycle_history
        where organization_id = ${organizationId}
      `;
      assert.equal(remaining?.value, 0);
      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );
});
