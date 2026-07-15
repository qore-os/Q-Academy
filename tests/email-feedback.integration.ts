import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import postgres from "postgres";
import { db, postgresClient } from "../src/db/index";
import {
  activeEmailSuppression,
  EmailFeedbackConflictError,
  EmailFeedbackDeliveryError,
  processMailGatewayFeedback,
  releaseEmailSuppression,
} from "../src/lib/email-feedback";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

async function schemaReady() {
  const [row] = await sql<Array<{ ready: boolean }>>`
    select to_regclass('public.email_delivery_feedback_events') is not null
       and to_regclass('public.email_suppressions') is not null as ready
  `;
  return row?.ready === true;
}

test("feedback processing is durable, idempotent, and tenant isolated", async (t) => {
  if (!(await schemaReady())) {
    t.skip("Pending email feedback schema has not been migrated yet.");
    return;
  }
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const deliveryA = randomUUID();
  const deliveryB = randomUUID();
  const eventId = `evt-${randomUUID()}`;
  const occurredAt = new Date("2026-07-13T12:00:00.000Z");
  try {
    await sql`
      insert into organizations (id, name, slug)
      values
        (${organizationA}, 'Feedback A', ${`feedback-a-${organizationA.slice(0, 8)}`}),
        (${organizationB}, 'Feedback B', ${`feedback-b-${organizationB.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (${userA}, ${organizationA}, 'a@example.test', 'unused', 'A', 'Member', 'member', 'active'),
        (${userB}, ${organizationB}, 'b@example.test', 'unused', 'B', 'Member', 'member', 'active')
    `;
    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload, status
      ) values
        (${deliveryA}, ${organizationA}, ${userA}, 'feedback.reply', 'a@example.test', ${sql.json({ test: true })}, 'delivered'),
        (${deliveryB}, ${organizationB}, ${userB}, 'feedback.reply', 'b@example.test', ${sql.json({ test: true })}, 'delivered')
    `;
    const event = {
      eventId,
      organizationId: organizationA,
      deliveryId: deliveryA,
      type: "bounce" as const,
      bounceKind: "hard" as const,
      reasonCode: "mailbox_not_found",
      occurredAt,
    };
    const first = await processMailGatewayFeedback({
      event,
      payloadHash: "a".repeat(64),
    });
    assert.equal(first.replayed, false);
    const replay = await processMailGatewayFeedback({
      event,
      payloadHash: "a".repeat(64),
    });
    assert.equal(replay.replayed, true);
    await assert.rejects(
      processMailGatewayFeedback({ event, payloadHash: "b".repeat(64) }),
      EmailFeedbackConflictError,
    );
    await assert.rejects(
      processMailGatewayFeedback({
        event: {
          ...event,
          eventId: `evt-${randomUUID()}`,
          organizationId: organizationB,
        },
        payloadHash: "c".repeat(64),
      }),
      EmailFeedbackDeliveryError,
    );
    const active = await activeEmailSuppression({
      organizationId: organizationA,
      recipientEmail: "A@EXAMPLE.TEST",
      now: occurredAt,
    });
    assert.equal(active?.reason, "hard_bounce");
    const [stored] = await sql<Array<{ events: number; suppressions: number }>>`
      select
        (select count(*)::int from email_delivery_feedback_events where organization_id = ${organizationA}) as events,
        (select count(*)::int from email_suppressions where organization_id = ${organizationA}) as suppressions
    `;
    assert.deepEqual(stored, { events: 1, suppressions: 1 });

    await assert.rejects(
      sql`
        update email_suppressions
        set source_delivery_id = ${deliveryB}
        where id = ${first.suppressionId!}
      `,
      (error: unknown) =>
        error !== null &&
        typeof error === "object" &&
        (("constraint" in error &&
          error.constraint === "email_suppressions_source_tenant_enforced") ||
          ("constraint_name" in error &&
            error.constraint_name ===
              "email_suppressions_source_tenant_enforced")),
    );
    await assert.rejects(
      sql`
        update email_suppressions
        set released_at = ${occurredAt},
            released_by_id = ${userB},
            release_reason = 'provider_error'
        where id = ${first.suppressionId!}
      `,
      (error: unknown) =>
        error !== null &&
        typeof error === "object" &&
        (("constraint" in error &&
          error.constraint === "email_suppressions_releaser_tenant_enforced") ||
          ("constraint_name" in error &&
            error.constraint_name ===
              "email_suppressions_releaser_tenant_enforced")),
    );

    await db.transaction((tx) =>
      releaseEmailSuppression(tx, {
        organizationId: organizationA,
        suppressionId: first.suppressionId!,
        actorId: userA,
        reason: "address_corrected",
        source: "admin",
      }),
    );
    assert.equal(
      await activeEmailSuppression({
        organizationId: organizationA,
        recipientEmail: "a@example.test",
        now: occurredAt,
      }),
      null,
    );
    const [audit] = await sql<Array<{ metadata: Record<string, unknown> }>>`
      select metadata from activity_events
      where organization_id = ${organizationA}
        and type = 'email.suppression.released'
      order by created_at desc limit 1
    `;
    assert.deepEqual(audit?.metadata, {
      reason: "address_corrected",
      source: "admin",
    });
  } finally {
    await sql`delete from organizations where id in (${organizationA}, ${organizationB})`;
  }
});
