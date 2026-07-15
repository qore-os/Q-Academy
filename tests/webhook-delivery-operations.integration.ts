import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, eq } from "drizzle-orm";
import {
  organizations,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhooks,
} from "../src/db/schema";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

const { db, postgresClient } = await import("../src/db/index");
const {
  getWebhookDelivery,
  listWebhookDeliveries,
  replayFailedWebhookDelivery,
} = await import("../src/lib/api/webhook-delivery-operations");
const { deliverWebhook } = await import("../src/lib/api/webhook-delivery");

after(async () => {
  await postgresClient.end();
});

test("dead-letter operations are tenant-bound, sanitized and failed-only", async () => {
  const suffix = randomUUID();
  const [organization, foreignOrganization] = await db
    .insert(organizations)
    .values([
      { name: `Delivery operations ${suffix}`, slug: `delivery-ops-${suffix}` },
      { name: `Foreign delivery ${suffix}`, slug: `foreign-delivery-${suffix}` },
    ])
    .returning({ id: organizations.id });

  try {
    const [webhook, foreignWebhook] = await db
      .insert(webhooks)
      .values([
        {
          organizationId: organization.id,
          name: "Operations webhook",
          url: "https://example.test/webhooks",
          signingSecretEncrypted: "not-used-by-this-test",
          events: ["course.published"],
        },
        {
          organizationId: foreignOrganization.id,
          name: "Foreign webhook",
          url: "https://foreign.example.test/webhooks",
          signingSecretEncrypted: "not-used-by-this-test",
          events: ["course.published"],
        },
      ])
      .returning({ id: webhooks.id, organizationId: webhooks.organizationId });
    const [failed, delivered, foreignFailed] = await db
      .insert(webhookDeliveries)
      .values([
        {
          organizationId: organization.id,
          webhookId: webhook.id,
          event: "course.published",
          payload: {
            id: "evt_operations",
            type: "course.published",
            data: { apiToken: "payload-secret", courseId: "course-private" },
          },
          status: "failed",
          attempt: 6,
          responseStatus: 503,
          responseBody: "downstream-secret-body",
          durationMs: 950,
        },
        {
          organizationId: organization.id,
          webhookId: webhook.id,
          event: "course.published",
          status: "delivered",
          attempt: 1,
          responseStatus: 204,
          deliveredAt: new Date(),
        },
        {
          organizationId: foreignOrganization.id,
          webhookId: foreignWebhook.id,
          event: "course.published",
          status: "failed",
          attempt: 6,
          responseStatus: 500,
          responseBody: "foreign-secret-body",
        },
      ])
      .returning({ id: webhookDeliveries.id });
    const completedAt = new Date();
    const startedAt = new Date(completedAt.getTime() - 950);
    const [failedAttempt] = await db
      .insert(webhookDeliveryAttempts)
      .values({
        organizationId: organization.id,
        deliveryId: failed.id,
        webhookId: webhook.id,
        replayGeneration: 0,
        attempt: 6,
        outcome: "failed",
        responseStatus: 503,
        failureKind: "http",
        responseBodyRedacted: true,
        durationMs: 950,
        startedAt,
        completedAt,
      })
      .returning({ id: webhookDeliveryAttempts.id });
    const activeClaimToken = randomUUID();
    const [claimed] = await db
      .insert(webhookDeliveries)
      .values({
        organizationId: organization.id,
        webhookId: webhook.id,
        event: "course.published",
        status: "processing",
        claimedAt: new Date(),
        claimToken: activeClaimToken,
      })
      .returning({ id: webhookDeliveries.id });

    assert.equal(await deliverWebhook(claimed.id, randomUUID()), null);
    const [claimAfterStaleWorker] = await db
      .select({
        status: webhookDeliveries.status,
        claimToken: webhookDeliveries.claimToken,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, claimed.id));
    assert.deepEqual(claimAfterStaleWorker, {
      status: "processing",
      claimToken: activeClaimToken,
    });

    const list = await listWebhookDeliveries({
      organizationId: organization.id,
      status: "failed",
      limit: 50,
    });
    assert.deepEqual(list.map((item) => item.id), [failed.id]);
    assert.equal(list[0]?.replayable, true);
    assert.equal("payload" in list[0]!, false);
    assert.equal("responseBody" in list[0]!, false);
    assert.doesNotMatch(
      JSON.stringify(list),
      /payload-secret|course-private|downstream-secret-body|foreign-secret-body/,
    );

    const detail = await getWebhookDelivery({
      organizationId: organization.id,
      webhookId: webhook.id,
      deliveryId: failed.id,
    });
    assert.deepEqual(detail?.payload.dataKeys, ["apiToken", "courseId"]);
    assert.deepEqual(detail?.attempts, [
      {
        id: failedAttempt.id,
        replayGeneration: 0,
        attempt: 6,
        outcome: "failed",
        responseStatus: 503,
        responseBodyRedacted: true,
        failureKind: "http",
        durationMs: 950,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      },
    ]);
    assert.doesNotMatch(JSON.stringify(detail), /payload-secret|course-private/);
    assert.doesNotMatch(JSON.stringify(detail), /downstream-secret-body/);

    await assert.rejects(
      db
        .update(webhookDeliveryAttempts)
        .set({ durationMs: 951 })
        .where(eq(webhookDeliveryAttempts.id, failedAttempt.id)),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "cause" in error &&
        String(error.cause).includes("append-only"),
    );
    await assert.rejects(
      db
        .delete(webhookDeliveryAttempts)
        .where(eq(webhookDeliveryAttempts.id, failedAttempt.id)),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "cause" in error &&
        String(error.cause).includes("append-only"),
    );

    assert.equal(
      await getWebhookDelivery({
        organizationId: organization.id,
        deliveryId: foreignFailed.id,
      }),
      null,
    );
    assert.deepEqual(
      await replayFailedWebhookDelivery({
        organizationId: organization.id,
        deliveryId: foreignFailed.id,
      }),
      { kind: "not_found" },
    );

    const deliveredReplay = await replayFailedWebhookDelivery({
      organizationId: organization.id,
      deliveryId: delivered.id,
    });
    assert.deepEqual(deliveredReplay, {
      kind: "not_replayable",
      status: "delivered",
    });

    const replay = await replayFailedWebhookDelivery({
      organizationId: organization.id,
      deliveryId: failed.id,
    });
    assert.equal(replay.kind, "requeued");
    if (replay.kind === "requeued") {
      assert.equal(replay.delivery.status, "pending");
      assert.equal(replay.delivery.attempt, 0);
      assert.equal(replay.delivery.responseStatus, null);
      assert.equal(replay.delivery.replayable, false);
      assert.equal(replay.delivery.attempts.length, 1);
      assert.equal(replay.delivery.attempts[0]?.replayGeneration, 0);
    }
    const [persisted] = await db
      .select({
        status: webhookDeliveries.status,
        attempt: webhookDeliveries.attempt,
        responseStatus: webhookDeliveries.responseStatus,
        responseBody: webhookDeliveries.responseBody,
        durationMs: webhookDeliveries.durationMs,
        claimToken: webhookDeliveries.claimToken,
        replayGeneration: webhookDeliveries.replayGeneration,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, failed.id),
          eq(webhookDeliveries.organizationId, organization.id),
        ),
      )
      .limit(1);
    assert.deepEqual(persisted, {
      status: "pending",
      attempt: 0,
      responseStatus: null,
      responseBody: null,
      durationMs: null,
      claimToken: null,
      replayGeneration: 1,
    });
    assert.deepEqual(
      await replayFailedWebhookDelivery({
        organizationId: organization.id,
        deliveryId: failed.id,
      }),
      { kind: "not_replayable", status: "pending" },
    );
  } finally {
    await db
      .delete(webhooks)
      .where(eq(webhooks.organizationId, organization.id));
    await db
      .delete(webhooks)
      .where(eq(webhooks.organizationId, foreignOrganization.id));
    await db
      .delete(organizations)
      .where(eq(organizations.id, organization.id));
    await db
      .delete(organizations)
      .where(eq(organizations.id, foreignOrganization.id));
  }
});
