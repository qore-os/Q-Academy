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

test("tenant cascade requires an offboarding receipt and retains its evidence", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const requestId = randomUUID();
  const receiptId = randomUUID();
  const webhookId = randomUUID();
  const webhookDeliveryId = randomUUID();
  const rollback = new Error("rollback tenant-erasure integration fixture");

  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`
        insert into organizations (id, name, slug, status)
        values (${organizationId}, 'Erasure integration', ${`erase-${organizationId.slice(0, 8)}`}, 'offboarding')
      `;
      await tx`
        insert into users (
          id, organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${userId}, ${organizationId}, ${`owner-${userId}@example.test`},
          'invalid', 'Erasure', 'Owner', 'owner', 'disabled'
        )
      `;
      await tx`
        insert into privacy_requests (
          id, organization_id, subject_user_id, subject_reference,
          requested_by_id, client_request_id, type, status, due_at
        ) values (
          ${requestId}, ${organizationId}, ${userId}, ${"a".repeat(64)},
          ${userId}, ${`ERASURE-${requestId}`}, 'erasure', 'received',
          now() + interval '30 days'
        )
      `;
      await tx`
        insert into privacy_request_events (
          organization_id, request_id, actor_reference, event, to_status
        ) values (
          ${organizationId}, ${requestId}, ${"b".repeat(64)},
          'privacy_request.created', 'received'
        )
      `;
      await tx`
        insert into activity_events (
          organization_id, user_id, type, entity_type, entity_id, metadata
        ) values (
          ${organizationId}, ${userId}, 'tenant.fixture', 'organization',
          ${organizationId}, ${tx.json({ fixture: true })}
        )
      `;
      await tx`
        insert into webhooks (
          id, organization_id, name, url, signing_secret_encrypted, events
        ) values (
          ${webhookId}, ${organizationId}, 'Erasure webhook',
          'https://example.test/erasure', 'unused-test-secret',
          array['member.updated']
        )
      `;
      await tx`
        insert into webhook_deliveries (
          id, organization_id, webhook_id, event, status, attempt,
          response_status, duration_ms
        ) values (
          ${webhookDeliveryId}, ${organizationId}, ${webhookId},
          'member.updated', 'delivered', 1, 204, 10
        )
      `;
      await tx`
        insert into webhook_delivery_attempts (
          organization_id, delivery_id, webhook_id, replay_generation,
          attempt, outcome, response_status, response_body_redacted,
          duration_ms, started_at, completed_at
        ) values (
          ${organizationId}, ${webhookDeliveryId}, ${webhookId}, 0,
          1, 'delivered', 204, false, 10,
          now() - interval '10 milliseconds', now()
        )
      `;

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
          ${receiptId}, ${organizationId}, ${`erase-${organizationId.slice(0, 8)}`},
          ${`REQ-${requestId}`}, 'privacy-owner', 'approved test policy',
          'erasing', now() - interval '31 days', now() - interval '1 day',
          now() + interval '30 days', ${"c".repeat(64)}, ${"d".repeat(64)},
          ${"e".repeat(64)}, 'test-key', 0, 0,
          ${tx.json({ privacy_request_events: 1 })},
          ${tx.json({ format: "integration-fixture" })}
        )
      `;
      await tx`select set_config('q_academy.tenant_erasure_receipt', ${receiptId}, true)`;
      const deleted = await tx<Array<{ id: string }>>`
        delete from organizations where id = ${organizationId} returning id
      `;
      assert.deepEqual(deleted.map(({ id }) => id), [organizationId]);
      await tx`
        update tenant_erasure_receipts
        set status = 'backup_retention_pending', primary_erased_at = now(),
            updated_at = now()
        where id = ${receiptId}
      `;
      const [receipt] = await tx<
        Array<{ organizationId: string; status: string }>
      >`
        select organization_id as "organizationId", status
        from tenant_erasure_receipts where id = ${receiptId}
      `;
      assert.deepEqual(receipt, {
        organizationId,
        status: "backup_retention_pending",
      });
      const [eventCount] = await tx<Array<{ count: number }>>`
        select count(*)::integer as count
        from privacy_request_events where organization_id = ${organizationId}
      `;
      assert.equal(eventCount?.count, 0);
      const [activityCount] = await tx<Array<{ count: number }>>`
        select count(*)::integer as count
        from activity_events where organization_id = ${organizationId}
      `;
      assert.equal(activityCount?.count, 0);
      const [attemptCount] = await tx<Array<{ count: number }>>`
        select count(*)::integer as count
        from webhook_delivery_attempts where organization_id = ${organizationId}
      `;
      assert.equal(attemptCount?.count, 0);
      const cascadeConstraints = await tx<
        Array<{ name: string; deleteAction: string }>
      >`
        select conname as name, confdeltype::text as "deleteAction"
        from pg_constraint
        where conname in (
          'activity_events_organization_id_organizations_id_fk',
          'ai_agent_action_events_organization_id_organizations_id_fk'
        )
        order by conname
      `;
      assert.deepEqual(cascadeConstraints.map((constraint) => ({ ...constraint })), [
        {
          name: "activity_events_organization_id_organizations_id_fk",
          deleteAction: "c",
        },
        {
          name: "ai_agent_action_events_organization_id_organizations_id_fk",
          deleteAction: "c",
        },
      ]);
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`delete from tenant_erasure_receipts where id = ${receiptId}`;
        }),
        /immutable evidence/,
      );
      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );
});
