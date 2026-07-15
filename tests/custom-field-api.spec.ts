import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("custom-field REST contract persists visibility and isolates tenants", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted custom-field API flow");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().replace(/-/g, "_");
  const key = `api_visibility_${suffix}`;
  const tenantSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  let fieldId: string | null = null;
  let tenantId: string | null = null;
  const requestIds: string[] = [];
  const headers = { Authorization: `Bearer ${demoKey}` };

  try {
    const created = await request.post("/api/v1/custom-fields", {
      headers: {
        ...headers,
        "Idempotency-Key": `visibility-${randomUUID()}`,
      },
      data: {
        key,
        label: "API Sichtbarkeit",
        type: "text",
        category: "API Test",
        visibility: "trainer",
      },
    });
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    fieldId = createdBody.data.id;
    expect(createdBody.data.visibility).toBe("trainer");

    const patched = await request.patch(`/api/v1/custom-fields/${fieldId}`, {
      headers: {
        ...headers,
        "Idempotency-Key": `visibility-${randomUUID()}`,
      },
      data: { visibility: "admin" },
    });
    requestIds.push(patched.headers()["x-request-id"]);
    expect(patched.status()).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({
      data: { id: fieldId, visibility: "admin" },
    });

    const read = await request.get(`/api/v1/custom-fields/${fieldId}`, {
      headers,
    });
    requestIds.push(read.headers()["x-request-id"]);
    expect(read.status()).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      data: { id: fieldId, visibility: "admin" },
    });

    const tenantSlug = `visibility-${randomUUID()}`;
    const [tenant] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values ('Visibility isolation', ${tenantSlug})
      returning id
    `;
    tenantId = tenant.id;
    await client`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes)
      values (
        ${tenant.id},
        'Visibility isolation key',
        ${tenantSecret.slice(0, 20)},
        ${hashSecret(tenantSecret)},
        array['custom_fields:read']
      )
    `;
    const isolated = await request.get(`/api/v1/custom-fields/${fieldId}`, {
      headers: { Authorization: `Bearer ${tenantSecret}` },
    });
    requestIds.push(isolated.headers()["x-request-id"]);
    expect(isolated.status()).toBe(404);
  } finally {
    if (fieldId) {
      await client`delete from custom_field_definitions where id = ${fieldId}`;
      await client`delete from activity_events where entity_id = ${fieldId}`;
    }
    for (const requestId of requestIds.filter(Boolean)) {
      await client`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (tenantId) await client`delete from organizations where id = ${tenantId}`;
    await client.end();
  }
});
