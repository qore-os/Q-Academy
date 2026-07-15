import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("OIDC PATCH idempotency stores a keyed fingerprint and replays the same request", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused API/Postgres flow");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const apiSecret = `qak_idempotency_hmac_${randomBytes(24).toString("base64url")}`;
  const idempotencyKey = `oidc-patch-hmac-${suffix}`;
  const requestBody = JSON.stringify({
    expectedVersion: 0,
    configuration: {
      displayName: `Unternehmens-Login ${suffix}`,
    },
  });
  let organizationId: string | null = null;
  let apiKeyId: string | null = null;

  try {
    const [organization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('Idempotency HMAC test', ${`idempotency-hmac-${suffix}`})
      returning id
    `;
    organizationId = organization.id;
    const [owner] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${`owner-${suffix}@example.test`}, 'unused',
        'Ida', 'Owner', 'owner', 'active'
      )
      returning id
    `;
    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${organizationId}, 'Idempotency HMAC key', ${apiSecret.slice(0, 20)},
        ${sha256(apiSecret)}, array['authentication:write'], ${owner.id}
      )
      returning id
    `;
    apiKeyId = apiKey.id;

    const headers = {
      Authorization: `Bearer ${apiSecret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    const created = await request.patch("/api/v1/organization/oidc", {
      headers,
      data: requestBody,
    });
    expect(created.status()).toBe(200);
    expect(created.headers()["idempotent-replayed"]).toBeUndefined();
    const createdText = await created.text();

    const replay = await request.patch("/api/v1/organization/oidc", {
      headers,
      data: requestBody,
    });
    expect(replay.status()).toBe(200);
    expect(replay.headers()["idempotent-replayed"]).toBe("true");
    expect(await replay.text()).toBe(createdText);

    const [stored] = await sql<
      Array<{ request_hash: string; ttl_seconds: number }>
    >`
      select
        request_hash,
        extract(epoch from (expires_at - now()))::int as ttl_seconds
      from api_idempotency_keys
      where organization_id = ${organizationId}
        and api_key_id = ${apiKeyId}
        and key = ${idempotencyKey}
    `;
    expect(stored.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.request_hash).not.toBe(sha256(requestBody));
    expect(stored.request_hash).not.toBe(sha256(`\n${requestBody}`));
    expect(stored.ttl_seconds).toBeGreaterThan(23 * 60 * 60);
    expect(stored.ttl_seconds).toBeLessThanOrEqual(24 * 60 * 60);
  } finally {
    if (organizationId) {
      await sql`delete from organizations where id = ${organizationId}`;
    }
    await sql.end();
  }
});
