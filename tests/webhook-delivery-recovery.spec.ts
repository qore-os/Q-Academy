import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { testEnvironmentValue as environmentValue } from "./helpers/test-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

type ReceivedRequest = {
  body: string;
  headers: IncomingHttpHeaders;
  method: string | undefined;
  url: string | undefined;
};

function isConnectionReset(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "ECONNRESET" || /\bECONNRESET\b/.test(message);
}

test("stale webhook deliveries are reclaimed and delivered once", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted webhook recovery flow",
  );

  const received: ReceivedRequest[] = [];
  const receiver = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      received.push({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: incoming.headers,
        method: incoming.method,
        url: incoming.url,
      });
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
    throw new Error("The webhook test receiver did not expose a TCP port.");
  }

  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID();
  const webhookName = `Recovery webhook ${suffix}`;
  const webhookUrl =
    `http://localhost:${address.port}/webhook-receiver?case=${suffix}`;
  const createIdempotencyKey = `recovery-webhook-create-${suffix}`;
  const requestIds: string[] = [];
  let apiKeyId: string | null = null;
  let organizationId: string | null = null;
  let webhookId: string | null = null;

  try {
    const [apiIdentity] = await sql<
      Array<{ id: string; organization_id: string }>
    >`
      select id, organization_id
      from api_keys
      where key_hash = ${createHash("sha256").update(demoKey).digest("hex")}
        and status = 'active'
      limit 1
    `;
    if (!apiIdentity) throw new Error("The demo API key was not found.");
    apiKeyId = apiIdentity.id;
    organizationId = apiIdentity.organization_id;

    const committedWebhooks = () => sql<Array<{ id: string }>>`
      select id
      from webhooks
      where organization_id = ${apiIdentity.organization_id}
        and name = ${webhookName}
        and url = ${webhookUrl}
      order by id
    `;
    const postWebhook = () => {
      const requestId = randomUUID();
      requestIds.push(requestId);
      return request.post("/api/v1/webhooks", {
        headers: {
          Authorization: `Bearer ${demoKey}`,
          "Idempotency-Key": createIdempotencyKey,
          "X-Request-Id": requestId,
        },
        data: {
          name: webhookName,
          url: webhookUrl,
          events: ["course.published"],
        },
      });
    };

    let created: Awaited<ReturnType<typeof postWebhook>>;
    let committedAfterResetId: string | null = null;
    try {
      created = await postWebhook();
    } catch (error) {
      if (!isConnectionReset(error)) throw error;

      const committedAfterReset = await committedWebhooks();
      if (committedAfterReset.length > 1) {
        throw new Error(
          `Webhook creation committed ${committedAfterReset.length} rows after ECONNRESET.`,
        );
      }
      committedAfterResetId = committedAfterReset[0]?.id ?? null;

      // This is a single, targeted replay. The stable key makes both the
      // no-commit retry and the committed response recovery non-duplicating.
      created = await postWebhook();
    }

    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as {
      data: { id: string; secret: string };
    };
    webhookId = createdBody.data.id;
    if (committedAfterResetId) {
      expect(created.headers()["idempotent-replayed"]).toBe("true");
      expect(webhookId).toBe(committedAfterResetId);
    }
    await expect(committedWebhooks()).resolves.toEqual([{ id: webhookId }]);

    const queued = await request.post(
      `/api/v1/webhooks/${webhookId}/test`,
      { headers: { Authorization: `Bearer ${demoKey}` } },
    );
    requestIds.push(queued.headers()["x-request-id"]);
    expect(queued.status()).toBe(202);
    const queuedBody = (await queued.json()) as { data: { id: string } };
    const deliveryId = queuedBody.data.id;
    const staleClaimToken = randomUUID();

    await sql`
      update webhook_deliveries
      set status = 'processing',
          claimed_at = now() - interval '10 minutes',
          claim_token = ${staleClaimToken}::uuid,
          created_at = now() - interval '50 years',
          updated_at = now() - interval '10 minutes'
      where id = ${deliveryId}
    `;

    const cronSecret = environmentValue("CRON_SECRET");
    const dispatchOptions = {
      headers: cronSecret
        ? { Authorization: `Bearer ${cronSecret}` }
        : undefined,
    };
    const dispatches = await Promise.all([
      request.post("/api/internal/jobs/dispatch?limit=1", dispatchOptions),
      request.post("/api/internal/jobs/dispatch?limit=1", dispatchOptions),
    ]);
    expect(dispatches.map((response) => response.status())).toEqual([200, 200]);

    await expect
      .poll(() => received.length, {
        message: "the reclaimed delivery should reach its receiver",
      })
      .toBe(1);
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ status: string }>>`
          select status
          from webhook_deliveries
          where id = ${deliveryId}
        `;
        return row?.status;
      })
      .toBe("delivered");

    const [persisted] = await sql<
      Array<{
        attempt: number;
        claimed_at: Date | null;
        claim_token: string | null;
        delivered_at: Date | null;
        response_body: string | null;
        response_status: number | null;
        status: string;
      }>
    >`
      select status, attempt, response_status, response_body, claimed_at, claim_token,
             delivered_at
      from webhook_deliveries
      where id = ${deliveryId}
    `;

    expect(received, persisted?.response_body ?? undefined).toHaveLength(1);
    const [deliveryRequest] = received;
    expect(deliveryRequest.method).toBe("POST");
    expect(deliveryRequest.url).toBe(
      `/webhook-receiver?case=${suffix}`,
    );
    expect(deliveryRequest.headers.host).toBe(`localhost:${address.port}`);
    expect(deliveryRequest.headers["x-qa-event"]).toBe("webhook.test");
    expect(deliveryRequest.headers["x-qa-delivery"]).toBe(deliveryId);

    const timestamp = deliveryRequest.headers["x-qa-timestamp"];
    const signature = deliveryRequest.headers["x-qa-signature"];
    expect(typeof timestamp).toBe("string");
    expect(typeof signature).toBe("string");
    const expectedSignature = createHmac("sha256", createdBody.data.secret)
      .update(`${timestamp}.${deliveryRequest.body}`)
      .digest("hex");
    expect(signature).toBe(`v1=${expectedSignature}`);
    expect(JSON.parse(deliveryRequest.body)).toMatchObject({
      type: "webhook.test",
      data: { message: "Q-Academy Webhook-Verbindungstest" },
    });

    expect(persisted).toMatchObject({
      status: "delivered",
      attempt: 1,
      response_status: 204,
      claimed_at: null,
      claim_token: null,
    });
    expect(persisted.delivered_at).toBeInstanceOf(Date);
    const attempts = await sql<
      Array<{
        attempt: number;
        failure_kind: string | null;
        outcome: string;
        replay_generation: number;
        response_body_redacted: boolean;
        response_status: number | null;
      }>
    >`
      select replay_generation, attempt, outcome, response_status,
             failure_kind, response_body_redacted
      from webhook_delivery_attempts
      where delivery_id = ${deliveryId}
      order by replay_generation, attempt
    `;
    expect(attempts).toEqual([
      {
        replay_generation: 0,
        attempt: 1,
        outcome: "delivered",
        response_status: 204,
        failure_kind: null,
        response_body_redacted: false,
      },
    ]);
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (apiKeyId && organizationId) {
      await sql`
        delete from api_idempotency_keys
        where organization_id = ${organizationId}
          and api_key_id = ${apiKeyId}
          and key = ${createIdempotencyKey}
      `;
      await sql`
        delete from webhooks
        where organization_id = ${organizationId}
          and name = ${webhookName}
          and url = ${webhookUrl}
      `;
    } else if (webhookId) {
      await sql`delete from webhooks where id = ${webhookId}`;
    }
    await sql.end();
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("webhook dispatch is concurrent and fair across tenants", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted webhook fairness flow",
  );
  test.setTimeout(60_000);

  let inFlight = 0;
  let maxInFlight = 0;
  const received: string[] = [];
  const receiver = createServer((incoming, response) => {
    incoming.resume();
    incoming.on("end", () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      received.push(incoming.url ?? "");
      setTimeout(() => {
        inFlight -= 1;
        response.statusCode = 204;
        response.end();
      }, 250);
    });
  });
  await new Promise<void>((resolve, reject) => {
    receiver.once("error", reject);
    receiver.listen(0, "127.0.0.1", resolve);
  });
  const address = receiver.address();
  if (!address || typeof address === "string") {
    receiver.close();
    throw new Error("The webhook fairness receiver did not expose a port.");
  }

  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID();
  const tenantB = randomUUID();
  const tenantC = randomUUID();
  const keyB = `qak_fair_${randomBytes(28).toString("base64url")}`;
  const keyC = `qak_fair_${randomBytes(28).toString("base64url")}`;
  const webhookIds: string[] = [];
  const deliveryIds: string[] = [];
  const requestIds: string[] = [];

  const createWebhook = async (tenant: string, apiKey: string) => {
    const response = await request.post("/api/v1/webhooks", {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        name: `Fairness ${tenant} ${suffix}`,
        url: `http://localhost:${address.port}/fairness?tenant=${tenant}`,
        events: ["course.published"],
      },
    });
    requestIds.push(response.headers()["x-request-id"]);
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    webhookIds.push(body.data.id);
    return body.data.id;
  };
  const queueDelivery = async (webhookId: string, apiKey: string) => {
    const response = await request.post(
      `/api/v1/webhooks/${webhookId}/test`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    requestIds.push(response.headers()["x-request-id"]);
    expect(response.status()).toBe(202);
    const body = (await response.json()) as { data: { id: string } };
    deliveryIds.push(body.data.id);
    return body.data.id;
  };

  try {
    await sql`
      insert into organizations (id, name, slug)
      values
        (${tenantB}, 'Fairness B', ${`fair-b-${suffix}`}),
        (${tenantC}, 'Fairness C', ${`fair-c-${suffix}`})
    `;
    await sql`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, status
      ) values
        (${tenantB}, 'Fairness B key', ${keyB.slice(0, 16)},
          ${createHash("sha256").update(keyB).digest("hex")}, array['*'], 'active'),
        (${tenantC}, 'Fairness C key', ${keyC.slice(0, 16)},
          ${createHash("sha256").update(keyC).digest("hex")}, array['*'], 'active')
    `;

    const webhookA = await createWebhook("a", demoKey);
    const webhookB = await createWebhook("b", keyB);
    const webhookC = await createWebhook("c", keyC);
    const deliveriesA = await Promise.all(
      Array.from({ length: 4 }, () => queueDelivery(webhookA, demoKey)),
    );
    const deliveriesB = await Promise.all(
      Array.from({ length: 2 }, () => queueDelivery(webhookB, keyB)),
    );
    const deliveriesC = [await queueDelivery(webhookC, keyC)];
    await sql`
      update webhook_deliveries
      set created_at = case
        when id = any(${deliveriesA}::uuid[]) then timestamp with time zone '1970-01-01 00:00:00+00'
        when id = any(${deliveriesB}::uuid[]) then timestamp with time zone '1971-01-01 00:00:00+00'
        else timestamp with time zone '1972-01-01 00:00:00+00'
      end
      where id = any(${[...deliveriesA, ...deliveriesB, ...deliveriesC]}::uuid[])
    `;

    const cronSecret = environmentValue("CRON_SECRET");
    const dispatched = await request.post(
      "/api/internal/jobs/dispatch?limit=5",
      {
        headers: cronSecret
          ? { Authorization: `Bearer ${cronSecret}` }
          : undefined,
      },
    );
    expect(dispatched.status()).toBe(200);
    await expect(dispatched.json()).resolves.toMatchObject({
      data: { webhookDeliveries: 5, cleanup: { mode: "skipped" } },
    });
    expect(maxInFlight).toBe(5);
    expect(received.filter((url) => url.includes("tenant=a"))).toHaveLength(2);
    expect(received.filter((url) => url.includes("tenant=b"))).toHaveLength(2);
    expect(received.filter((url) => url.includes("tenant=c"))).toHaveLength(1);

    const statusCounts = await sql<
      Array<{ webhook_id: string; status: string; count: number }>
    >`
      select webhook_id, status::text, count(*)::int as count
      from webhook_deliveries
      where id = any(${deliveryIds}::uuid[])
      group by webhook_id, status
      order by webhook_id, status
    `;
    const forWebhook = (webhookId: string, status: string) =>
      statusCounts.find(
        (row) => row.webhook_id === webhookId && row.status === status,
      )?.count ?? 0;
    expect(forWebhook(webhookA, "delivered")).toBe(2);
    expect(forWebhook(webhookA, "pending")).toBe(2);
    expect(forWebhook(webhookB, "delivered")).toBe(2);
    expect(forWebhook(webhookC, "delivered")).toBe(1);
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (webhookIds.length > 0) {
      await sql`delete from webhooks where id = any(${webhookIds}::uuid[])`;
    }
    await sql`delete from organizations where id in (${tenantB}, ${tenantC})`;
    await sql.end();
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
