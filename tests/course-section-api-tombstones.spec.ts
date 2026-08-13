import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const replacement = "/api/v1/modules/{moduleId}/lessons";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function expectGone(response: APIResponse, instance: string) {
  expect(response.status()).toBe(410);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
  );
  await expect(response.json()).resolves.toMatchObject({
    type: "https://q-academy.local/problems/gone",
    title: "Gone",
    status: 410,
    code: "gone",
    detail: expect.stringContaining(replacement),
    instance,
    errors: { replacement },
  });
}

test("removed course-section API remains a scoped 410 tombstone", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API contract flow");

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const readSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const writeSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const readHeaders = { Authorization: `Bearer ${readSecret}` };
  const writeHeaders = { Authorization: `Bearer ${writeSecret}` };
  const requestIds: string[] = [];
  const keyIds: string[] = [];
  const moduleId = randomUUID();
  const sectionId = randomUUID();

  const readOperations = [
    `/api/v1/modules/${moduleId}/sections`,
    `/api/v1/sections/${sectionId}`,
    `/api/v1/sections/${sectionId}/lessons`,
  ];
  const writeOperations = [
    ["POST", `/api/v1/modules/${moduleId}/sections`],
    ["PATCH", `/api/v1/sections/${sectionId}`],
    ["DELETE", `/api/v1/sections/${sectionId}`],
    ["POST", `/api/v1/sections/${sectionId}/lessons`],
    ["PUT", `/api/v1/sections/${sectionId}/lesson-visibility`],
    ["PATCH", `/api/v1/sections/${sectionId}/lesson-visibility`],
  ] as const;

  try {
    const [organization] = await client<Array<{ id: string }>>`
      select id
      from organizations
      where slug = 'q-academy'
      limit 1
    `;
    if (!organization) throw new Error("Seed organization was not found.");

    const keys = await client<Array<{ id: string }>>`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes)
      values
        (
          ${organization.id},
          'Course section tombstone read key',
          ${readSecret.slice(0, 20)},
          ${hashSecret(readSecret)},
          array['modules:read']
        ),
        (
          ${organization.id},
          'Course section tombstone write key',
          ${writeSecret.slice(0, 20)},
          ${hashSecret(writeSecret)},
          array['modules:write']
        )
      returning id
    `;
    keyIds.push(...keys.map((key) => key.id));

    const unauthenticated = await request.get(`/api/v1/sections/${sectionId}`);
    expect(unauthenticated.status()).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      code: "authentication_required",
      status: 401,
    });

    for (const path of readOperations) {
      const response = await request.get(path, { headers: readHeaders });
      requestIds.push(response.headers()["x-request-id"]);
      await expectGone(response, path);
    }

    for (const [method, path] of writeOperations) {
      const response = await request.fetch(path, {
        method,
        headers: {
          ...writeHeaders,
          "content-type": "application/json",
          "idempotency-key": "removed-section-operation",
        },
        data: "{",
      });
      requestIds.push(response.headers()["x-request-id"]);
      await expectGone(response, path);
    }

    const missingWriteScope = await request.post(
      `/api/v1/modules/${moduleId}/sections`,
      { headers: readHeaders, data: {} },
    );
    expect(missingWriteScope.status()).toBe(403);
    await expect(missingWriteScope.json()).resolves.toMatchObject({
      code: "insufficient_scope",
      status: 403,
    });

    const missingReadScope = await request.get(
      `/api/v1/sections/${sectionId}`,
      { headers: writeHeaders },
    );
    expect(missingReadScope.status()).toBe(403);
    await expect(missingReadScope.json()).resolves.toMatchObject({
      code: "insufficient_scope",
      status: 403,
    });

    const invalidIdentifier = await request.get("/api/v1/sections/not-a-uuid", {
      headers: readHeaders,
    });
    requestIds.push(invalidIdentifier.headers()["x-request-id"]);
    expect(invalidIdentifier.status()).toBe(400);
    await expect(invalidIdentifier.json()).resolves.toMatchObject({
      code: "bad_request",
      status: 400,
    });

    const openApi = await request.get("/api/v1/openapi");
    expect(openApi.status()).toBe(200);
    const paths = (await openApi.json()).paths as Record<string, unknown>;
    expect(paths["/modules/{id}/sections"]).toBeUndefined();
    expect(paths["/sections/{id}"]).toBeUndefined();
    expect(paths["/sections/{id}/lessons"]).toBeUndefined();
    expect(paths["/sections/{id}/lesson-visibility"]).toBeUndefined();
  } finally {
    if (requestIds.length) {
      await client`
        delete from api_audit_logs
        where request_id = any(${requestIds})
      `;
    }
    if (keyIds.length) {
      await client`
        delete from api_keys
        where id = any(${keyIds})
      `;
    }
    await client.end();
  }
});
