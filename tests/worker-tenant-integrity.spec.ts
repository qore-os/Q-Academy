import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { testEnvironmentValue as environmentValue } from "./helpers/test-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function dispatchHeaders() {
  const secret = environmentValue("CRON_SECRET");
  return secret ? { Authorization: `Bearer ${secret}` } : undefined;
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted worker tenant-integrity flow",
  );
});

test("workers reject cross-tenant rows and fill a single-tenant webhook batch", async ({
  request,
}) => {
  test.setTimeout(60_000);
  const receivedDeliveryIds: string[] = [];
  const receiver = createServer((incoming, response) => {
    incoming.resume();
    incoming.on("end", () => {
      const deliveryId = incoming.headers["x-qa-delivery"];
      if (typeof deliveryId === "string") {
        receivedDeliveryIds.push(deliveryId);
      }
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    receiver.once("error", reject);
    receiver.listen(0, "127.0.0.1", resolve);
  });
  const address = receiver.address();
  if (!address || typeof address === "string") {
    receiver.close();
    throw new Error("The worker integrity receiver did not expose a port.");
  }

  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID();
  const foreignOrganizationId = randomUUID();
  const foreignUserId = randomUUID();
  const corruptEmailId = randomUUID();
  const corruptWebhookDeliveryId = randomUUID();
  const requestIds: string[] = [];
  let webhookId: string | null = null;
  try {
    const [target] = await sql<Array<{ organization_id: string }>>`
      select organization_id
      from api_keys
      where key_hash = ${createHash("sha256").update(demoKey).digest("hex")}
        and status = 'active'
      limit 1
    `;
    if (!target) throw new Error("The demo tenant API key was not found.");

    await sql`
      insert into organizations (id, name, slug)
      values (
        ${foreignOrganizationId}, 'Worker integrity foreign tenant',
        ${`worker-integrity-${suffix}`}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name
      ) values (
        ${foreignUserId}, ${foreignOrganizationId},
        ${`worker-${suffix}@example.test`}, 'unused', 'Foreign', 'Worker'
      )
    `;

    const created = await request.post("/api/v1/webhooks", {
      headers: { Authorization: `Bearer ${demoKey}` },
      data: {
        name: `Worker integrity ${suffix}`,
        url: `http://localhost:${address.port}/worker-integrity`,
        events: ["course.published"],
      },
    });
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string } };
    webhookId = createdBody.data.id;

    const validDeliveries = await sql<Array<{ id: string }>>`
      insert into webhook_deliveries (
        organization_id, webhook_id, event, payload, created_at, updated_at
      )
      select
        ${target.organization_id}, ${webhookId}, 'webhook.test',
        jsonb_build_object('sequence', sequence),
        timestamp with time zone '1900-01-01 00:00:00+00'
          + sequence * interval '1 second',
        timestamp with time zone '1900-01-01 00:00:00+00'
      from generate_series(1, 5) as sequence
      returning id
    `;
    await sql`
      insert into webhook_deliveries (
        id, organization_id, webhook_id, event, payload, created_at, updated_at
      ) values (
        ${corruptWebhookDeliveryId}, ${foreignOrganizationId}, ${webhookId},
        'webhook.test', ${sql.json({ crossTenant: true })},
        timestamp with time zone '1800-01-01 00:00:00+00',
        timestamp with time zone '1800-01-01 00:00:00+00'
      )
    `;
    await sql`
      insert into email_deliveries (
        id, organization_id, user_id, event, recipient_email, payload,
        created_at, updated_at
      ) values (
        ${corruptEmailId}, ${target.organization_id}, ${foreignUserId},
        'password.reset', ${`worker-${suffix}@example.test`},
        ${sql.json({
          v: 1,
          alg: "A256GCM",
          iv: "cross-tenant",
          tag: "cross-tenant",
          ciphertext: "must-not-be-decrypted",
        })},
        timestamp with time zone '1800-01-01 00:00:00+00',
        timestamp with time zone '1800-01-01 00:00:00+00'
      )
    `;

    const dispatched = await request.post(
      "/api/internal/jobs/dispatch?limit=5",
      { headers: dispatchHeaders() },
    );
    expect(dispatched.status()).toBe(200);
    await expect(dispatched.json()).resolves.toMatchObject({
      data: { webhookDeliveries: 5 },
    });
    await expect.poll(() => receivedDeliveryIds.length).toBe(5);
    expect(new Set(receivedDeliveryIds)).toEqual(
      new Set(validDeliveries.map(({ id }) => id)),
    );

    const [validState] = await sql<Array<{ delivered: number }>>`
      select count(*)::int as delivered
      from webhook_deliveries
      where id = any(${validDeliveries.map(({ id }) => id)}::uuid[])
        and status = 'delivered'
    `;
    expect(validState.delivered).toBe(5);
    const [corruptWebhook] = await sql<
      Array<{
        attempt: number;
        claimed_at: Date | null;
        status: string;
      }>
    >`
      select status::text, attempt, claimed_at
      from webhook_deliveries
      where id = ${corruptWebhookDeliveryId}
    `;
    const [corruptEmail] = await sql<
      Array<{
        attempt: number;
        claimed_at: Date | null;
        status: string;
      }>
    >`
      select status::text, attempt, claimed_at
      from email_deliveries
      where id = ${corruptEmailId}
    `;
    expect(corruptWebhook).toEqual({
      status: "pending",
      attempt: 0,
      claimed_at: null,
    });
    expect(corruptEmail).toEqual({
      status: "failed",
      attempt: 1,
      claimed_at: null,
    });
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (webhookId) await sql`delete from webhooks where id = ${webhookId}`;
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await sql.end();
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("webhook wall-clock timeout stops slow-drip responses", async ({
  request,
}) => {
  test.setTimeout(45_000);
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const receiver = createServer((incoming, response) => {
    incoming.resume();
    incoming.on("end", () => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("started");
      const interval = setInterval(() => response.write("."), 200);
      intervals.add(interval);
      response.on("close", () => {
        clearInterval(interval);
        intervals.delete(interval);
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    receiver.once("error", reject);
    receiver.listen(0, "127.0.0.1", resolve);
  });
  const address = receiver.address();
  if (!address || typeof address === "string") {
    receiver.close();
    throw new Error("The slow webhook receiver did not expose a port.");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const requestIds: string[] = [];
  let webhookId: string | null = null;
  try {
    const created = await request.post("/api/v1/webhooks", {
      headers: { Authorization: `Bearer ${demoKey}` },
      data: {
        name: `Slow webhook ${suffix}`,
        url: `http://localhost:${address.port}/slow`,
        events: ["course.published"],
      },
    });
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string } };
    webhookId = createdBody.data.id;

    const queued = await request.post(`/api/v1/webhooks/${webhookId}/test`, {
      headers: { Authorization: `Bearer ${demoKey}` },
    });
    requestIds.push(queued.headers()["x-request-id"]);
    expect(queued.status()).toBe(202);
    const queuedBody = (await queued.json()) as { data: { id: string } };
    await sql`
      update webhook_deliveries
      set created_at = timestamp with time zone '1700-01-01 00:00:00+00',
          updated_at = timestamp with time zone '1700-01-01 00:00:00+00'
      where id = ${queuedBody.data.id}
    `;

    const started = Date.now();
    const dispatched = await request.post(
      "/api/internal/jobs/dispatch?limit=1",
      { headers: dispatchHeaders() },
    );
    const durationMs = Date.now() - started;
    expect(dispatched.status()).toBe(200);
    expect(durationMs).toBeGreaterThanOrEqual(9_000);
    expect(durationMs).toBeLessThan(20_000);

    const [delivery] = await sql<
      Array<{
        attempt: number;
        claimed_at: Date | null;
        response_body: string;
        status: string;
      }>
    >`
      select status::text, attempt, claimed_at, response_body
      from webhook_deliveries
      where id = ${queuedBody.data.id}
    `;
    expect(delivery).toMatchObject({
      status: "retrying",
      attempt: 1,
      claimed_at: null,
    });
    expect(delivery.response_body).toContain("Webhook-Zeitlimit");
    const [attempt] = await sql<
      Array<{
        failure_kind: string;
        outcome: string;
        response_body_redacted: boolean;
      }>
    >`
      select outcome, failure_kind, response_body_redacted
      from webhook_delivery_attempts
      where delivery_id = ${queuedBody.data.id}
    `;
    expect(attempt).toEqual({
      outcome: "retrying",
      failure_kind: "timeout",
      response_body_redacted: true,
    });
  } finally {
    for (const interval of intervals) clearInterval(interval);
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (webhookId) await sql`delete from webhooks where id = ${webhookId}`;
    await sql.end();
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
