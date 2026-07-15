import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("idempotency claims isolate credentials, encrypt secrets and serialize parallel mutations", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API security flow");

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const createKey = `secret-cache-${suffix}`;
  const deliveryKey = `parallel-delivery-${suffix}`;
  const webhookName = `Idempotency webhook ${suffix}`;
  const webhookInput = {
    name: webhookName,
    url: "https://example.com/q-academy-idempotency-test",
    events: ["course.published"],
  };
  const secondarySecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const webhookIds: string[] = [];
  const requestIds: string[] = [];
  let secondaryKeyId: string | null = null;

  try {
    const [demoKey] = await client<
      Array<{ id: string; organization_id: string }>
    >`
      select id, organization_id
      from api_keys
      where key_hash = ${hashSecret(demoSecret)}
        and status = 'active'
      limit 1
    `;
    if (!demoKey) throw new Error("Demo API key was not found.");

    const [secondaryKey] = await client<Array<{ id: string }>>`
      insert into api_keys (
        organization_id,
        name,
        prefix,
        key_hash,
        scopes
      ) values (
        ${demoKey.organization_id},
        ${`Idempotency isolation ${suffix}`},
        ${secondarySecret.slice(0, 20)},
        ${hashSecret(secondarySecret)},
        array['webhooks:write']
      )
      returning id
    `;
    secondaryKeyId = secondaryKey.id;

    const headers = {
      Authorization: `Bearer ${demoSecret}`,
      "Idempotency-Key": createKey,
    };
    const created = await request.post("/api/v1/webhooks", {
      headers,
      data: webhookInput,
    });
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    expect(created.headers()["idempotent-replayed"]).toBeUndefined();
    const createdText = await created.text();
    const createdBody = JSON.parse(createdText) as {
      data: { id: string; secret: string };
    };
    webhookIds.push(createdBody.data.id);

    const replay = await request.post("/api/v1/webhooks", {
      headers,
      data: webhookInput,
    });
    requestIds.push(replay.headers()["x-request-id"]);
    expect(replay.status()).toBe(201);
    expect(replay.headers()["idempotent-replayed"]).toBe("true");
    expect(await replay.text()).toBe(createdText);

    const conflictResponse = await request.post("/api/v1/webhooks", {
      headers,
      data: { ...webhookInput, name: `${webhookName} conflict` },
    });
    requestIds.push(conflictResponse.headers()["x-request-id"]);
    expect(conflictResponse.status()).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const [stored] = await client<
      Array<{
        id: string;
        status: string;
        response_status: number;
        response_body: string;
      }>
    >`
      select id, status, response_status, response_body::text as response_body
      from api_idempotency_keys
      where organization_id = ${demoKey.organization_id}
        and api_key_id = ${demoKey.id}
        and key = ${createKey}
    `;
    expect(stored.status).toBe("completed");
    expect(stored.response_status).toBe(201);
    expect(stored.response_body).not.toContain(createdBody.data.secret);
    expect(stored.response_body).not.toContain('"secret"');
    expect(stored.response_body).toContain('"alg": "A256GCM"');

    const isolated = await request.post("/api/v1/webhooks", {
      headers: {
        Authorization: `Bearer ${secondarySecret}`,
        "Idempotency-Key": createKey,
      },
      data: webhookInput,
    });
    requestIds.push(isolated.headers()["x-request-id"]);
    expect(isolated.status()).toBe(201);
    expect(isolated.headers()["idempotent-replayed"]).toBeUndefined();
    const isolatedBody = (await isolated.json()) as {
      data: { id: string; secret: string };
    };
    webhookIds.push(isolatedBody.data.id);
    expect(isolatedBody.data.id).not.toBe(createdBody.data.id);
    expect(isolatedBody.data.secret).not.toBe(createdBody.data.secret);

    await client`
      update api_idempotency_keys
      set response_body = jsonb_set(
        response_body,
        '{ciphertext}',
        to_jsonb('tampered'::text)
      )
      where id = ${stored.id}
    `;
    const tamperedReplay = await request.post("/api/v1/webhooks", {
      headers,
      data: webhookInput,
    });
    requestIds.push(tamperedReplay.headers()["x-request-id"]);
    expect(tamperedReplay.status()).toBe(500);
    await expect(tamperedReplay.json()).resolves.toMatchObject({
      code: "internal_error",
    });
    const [afterTamper] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from webhooks
      where name = ${webhookName}
    `;
    expect(afterTamper.count).toBe(2);

    await client`
      update api_idempotency_keys
      set expires_at = now() - interval '1 second'
      where id = ${stored.id}
    `;
    const reclaimed = await request.post("/api/v1/webhooks", {
      headers,
      data: webhookInput,
    });
    requestIds.push(reclaimed.headers()["x-request-id"]);
    expect(reclaimed.status()).toBe(201);
    expect(reclaimed.headers()["idempotent-replayed"]).toBeUndefined();
    const reclaimedBody = (await reclaimed.json()) as {
      data: { id: string; secret: string };
    };
    webhookIds.push(reclaimedBody.data.id);
    expect(reclaimedBody.data.id).not.toBe(createdBody.data.id);
    expect(reclaimedBody.data.secret).not.toBe(createdBody.data.secret);
    const [replacement] = await client<Array<{ id: string }>>`
      select id
      from api_idempotency_keys
      where organization_id = ${demoKey.organization_id}
        and api_key_id = ${demoKey.id}
        and key = ${createKey}
    `;
    expect(replacement.id).not.toBe(stored.id);

    const testUrl = `/api/v1/webhooks/${reclaimedBody.data.id}/test`;
    const concurrentHeaders = {
      Authorization: `Bearer ${demoSecret}`,
      "Idempotency-Key": deliveryKey,
    };
    const [parallelA, parallelB] = await Promise.all([
      request.post(testUrl, { headers: concurrentHeaders }),
      request.post(testUrl, { headers: concurrentHeaders }),
    ]);
    requestIds.push(
      parallelA.headers()["x-request-id"],
      parallelB.headers()["x-request-id"],
    );
    expect(parallelA.status()).toBe(202);
    expect(parallelB.status()).toBe(202);
    const parallelTexts = await Promise.all([
      parallelA.text(),
      parallelB.text(),
    ]);
    expect(parallelTexts[1]).toBe(parallelTexts[0]);
    expect(
      [parallelA, parallelB].filter(
        (response) =>
          response.headers()["idempotent-replayed"] === "true",
      ),
    ).toHaveLength(1);

    const deliveryBody = JSON.parse(parallelTexts[0]) as {
      data: { id: string };
    };
    const [deliveryCount] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from webhook_deliveries
      where webhook_id = ${reclaimedBody.data.id}
        and event = 'webhook.test'
    `;
    expect(deliveryCount.count).toBe(1);
    expect(deliveryBody.data.id).toBeTruthy();
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await client`delete from api_audit_logs where request_id = ${requestId}`;
    }
    await client`
      delete from api_idempotency_keys
      where key = any(${[createKey, deliveryKey]})
    `;
    if (webhookIds.length) {
      await client`
        delete from webhooks
        where id = any(${webhookIds})
      `;
    }
    if (secondaryKeyId) {
      await client`delete from api_keys where id = ${secondaryKeyId}`;
    }
    await client.end();
  }
});
