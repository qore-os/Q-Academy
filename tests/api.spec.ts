import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function deleteAuditEntries(requestIds: Array<string | undefined>) {
  const ids = requestIds.filter((value): value is string => Boolean(value));
  if (!ids.length) return;
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    for (const requestId of ids) {
      await client`delete from api_audit_logs where request_id = ${requestId}`;
    }
  } finally {
    await client.end();
  }
}

test("API exposes consistent authentication, problem details and OpenAPI", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API contract flow");

  const unauthenticated = await request.get("/api/v1/courses");
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  await expect(unauthenticated.json()).resolves.toMatchObject({
    status: 401,
    code: "authentication_required",
    instance: "/api/v1/courses",
  });

  const invalidIdentifier = await request.get("/api/v1/courses/not-a-uuid", {
    headers: authorization,
  });
  expect(invalidIdentifier.status()).toBe(400);
  await expect(invalidIdentifier.json()).resolves.toMatchObject({
    status: 400,
    code: "bad_request",
  });

  const courses = await request.get("/api/v1/courses?limit=2", {
    headers: authorization,
  });
  expect(courses.status()).toBe(200);
  expect(courses.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
  );
  expect(Number(courses.headers()["x-ratelimit-remaining"])).toBeGreaterThan(0);
  const coursesBody = await courses.json();
  expect(coursesBody.data).toHaveLength(2);
  expect(coursesBody.meta.pagination.returned).toBe(2);

  const privateWebhook = await request.post("/api/v1/webhooks", {
    headers: authorization,
    data: {
      name: "Blocked private target",
      url: "https://[::ffff:a00:1]/hook",
      events: ["course.created"],
    },
  });
  expect(privateWebhook.status()).toBe(422);
  await expect(privateWebhook.json()).resolves.toMatchObject({
    code: "validation_error",
  });

  const nonStandardPortWebhook = await request.post("/api/v1/webhooks", {
    headers: authorization,
    data: {
      name: "Blocked non-standard port",
      url: "https://1.1.1.1:8443/hook",
      events: ["course.created"],
    },
  });
  expect(nonStandardPortWebhook.status()).toBe(422);
  await expect(nonStandardPortWebhook.json()).resolves.toMatchObject({
    code: "validation_error",
  });

  const reservedTargets = [
    "https://100.64.0.1/hook",
    "https://[2001:db8::1]/hook",
  ];
  const reservedResponses = await Promise.all(
    reservedTargets.map((url, index) =>
      request.post("/api/v1/webhooks", {
        headers: authorization,
        data: {
          name: `Blocked reserved target ${index}`,
          url,
          events: ["course.created"],
        },
      }),
    ),
  );
  expect(reservedResponses.map((response) => response.status())).toEqual([
    422, 422,
  ]);

  const openApi = await request.get("/api/v1/openapi");
  expect(openApi.status()).toBe(200);
  const openApiBody = await openApi.json();
  expect(Object.keys(openApiBody.paths)).toHaveLength(213);
  const multipartOperations = [
    {
      path: "/media-assets/{id}/multipart",
      method: "get",
      operationId: "getMediaAssetMultipartStatus",
      responseSchema: "MediaMultipartStatus",
    },
    {
      path: "/media-assets/{id}/multipart",
      method: "post",
      operationId: "recoverMediaAssetMultipartStatus",
      responseSchema: "MediaMultipartStatus",
    },
    {
      path: "/media-assets/{id}/multipart",
      method: "delete",
      operationId: "abortMediaAssetMultipartUpload",
      responseSchema: "MediaMultipartAbortResult",
    },
    {
      path: "/media-assets/{id}/multipart/parts",
      method: "post",
      operationId: "authorizeMediaAssetMultipartPart",
      responseSchema: "MediaMultipartPartAuthorization",
    },
  ] as const;
  for (const contract of multipartOperations) {
    const operation = openApiBody.paths[contract.path][contract.method];
    expect(operation).toMatchObject({
      operationId: contract.operationId,
      security: [{ BearerApiKey: [] }],
      "x-required-scopes": [],
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                properties: {
                  data: {
                    $ref: `#/components/schemas/${contract.responseSchema}`,
                  },
                },
              },
            },
          },
        },
        "503": { $ref: "#/components/responses/ServiceUnavailable" },
      },
    });
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }),
      ]),
    );
  }
  expect(
    openApiBody.paths["/media-assets/{id}/multipart/parts"].post.requestBody,
  ).toMatchObject({
    required: true,
    content: {
      "application/json": {
        schema: {
          $ref: "#/components/schemas/MediaMultipartPartAuthorizeRequest",
        },
      },
    },
  });
  expect(openApiBody.paths["/privacy-requests"].get).toMatchObject({
    operationId: "listPrivacyRequests",
    "x-required-scopes": ["privacy:read"],
  });
  expect(openApiBody.paths["/privacy-requests"].post).toMatchObject({
    operationId: "createPrivacyRequest",
    "x-required-scopes": ["privacy:write"],
  });
  expect(openApiBody.paths["/privacy-requests/{id}"].get).toMatchObject({
    operationId: "getPrivacyRequest",
    "x-required-scopes": ["privacy:read"],
  });
  expect(openApiBody.components.securitySchemes.BearerApiKey).toMatchObject({
    type: "http",
    scheme: "bearer",
  });
  await deleteAuditEntries([
    invalidIdentifier.headers()["x-request-id"],
    courses.headers()["x-request-id"],
    privateWebhook.headers()["x-request-id"],
    nonStandardPortWebhook.headers()["x-request-id"],
    ...reservedResponses.map((response) => response.headers()["x-request-id"]),
  ]);
});

test("API scopes and tenant boundaries are enforced", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API security flow");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const limitedSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const tenantSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  let limitedKeyId: string | null = null;
  let tenantOrganizationId: string | null = null;
  const requestIds: string[] = [];

  try {
    const [seed] = await client<
      Array<{ organization_id: string; course_id: string }>
    >`
      select o.id as organization_id, c.id as course_id
      from organizations o
      join courses c on c.organization_id = o.id
      where o.slug = 'q-academy'
      order by c.created_at asc
      limit 1
    `;
    if (!seed) throw new Error("Seed organization was not found.");

    const [limitedKey] = await client<Array<{ id: string }>>`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes)
      values (
        ${seed.organization_id},
        'Playwright limited scope',
        ${limitedSecret.slice(0, 20)},
        ${hashSecret(limitedSecret)},
        array['courses:read']
      )
      returning id
    `;
    limitedKeyId = limitedKey.id;

    const allowed = await request.get("/api/v1/courses?limit=1", {
      headers: { Authorization: `Bearer ${limitedSecret}` },
    });
    requestIds.push(allowed.headers()["x-request-id"]);
    expect(allowed.status()).toBe(200);
    const forbidden = await request.get("/api/v1/members?limit=1", {
      headers: { Authorization: `Bearer ${limitedSecret}` },
    });
    requestIds.push(forbidden.headers()["x-request-id"]);
    expect(forbidden.status()).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      code: "insufficient_scope",
      errors: { missing: ["members:read"] },
    });

    const tenantSlug = `api-tenant-${randomUUID()}`;
    const [tenant] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('API isolation tenant', ${tenantSlug})
      returning id
    `;
    tenantOrganizationId = tenant.id;
    await client`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes)
      values (
        ${tenant.id},
        'Playwright tenant key',
        ${tenantSecret.slice(0, 20)},
        ${hashSecret(tenantSecret)},
        array['courses:read']
      )
    `;

    const isolated = await request.get(`/api/v1/courses/${seed.course_id}`, {
      headers: { Authorization: `Bearer ${tenantSecret}` },
    });
    requestIds.push(isolated.headers()["x-request-id"]);
    expect(isolated.status()).toBe(404);
    await expect(isolated.json()).resolves.toMatchObject({ code: "not_found" });
  } finally {
    await deleteAuditEntries(requestIds);
    if (limitedKeyId) {
      await client`delete from api_keys where id = ${limitedKeyId}`;
    }
    if (tenantOrganizationId) {
      await client`delete from organizations where id = ${tenantOrganizationId}`;
    }
    await client.end();
  }
});

test("idempotent mutations replay once and reject conflicting payloads", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API mutation flow");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const idempotencyKey = `pw-${randomUUID()}`;
  const groupName = `API Test ${randomUUID()}`;
  let groupId: string | null = null;
  const requestIds: string[] = [];

  try {
    const headers = {
      ...authorization,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    const first = await request.post("/api/v1/groups", {
      headers,
      data: { name: groupName, description: "Idempotency contract test" },
    });
    expect(first.status()).toBe(201);
    requestIds.push(first.headers()["x-request-id"]);
    const firstBody = await first.json();
    groupId = firstBody.data.id;

    const replay = await request.post("/api/v1/groups", {
      headers,
      data: { name: groupName, description: "Idempotency contract test" },
    });
    expect(replay.status()).toBe(201);
    requestIds.push(replay.headers()["x-request-id"]);
    expect(replay.headers()["idempotent-replayed"]).toBe("true");
    expect((await replay.json()).data.id).toBe(groupId);

    const conflict = await request.post("/api/v1/groups", {
      headers,
      data: { name: `${groupName} changed`, description: "Different payload" },
    });
    expect(conflict.status()).toBe(409);
    requestIds.push(conflict.headers()["x-request-id"]);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const [stored] = await client<Array<{ count: number }>>`
      select count(id)::int as count from groups where name = ${groupName}
    `;
    expect(stored.count).toBe(1);
  } finally {
    await deleteAuditEntries(requestIds);
    if (groupId) await client`delete from groups where id = ${groupId}`;
    await client`
      delete from api_idempotency_keys where key = ${idempotencyKey}
    `;
    await client.end();
  }
});

test("announcement API covers scheduling, updates and member dismissals", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted announcement API flow",
  );
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const title = `API announcement ${randomUUID()}`;
  const idempotencyKeys = {
    create: `pw-${randomUUID()}`,
    update: `pw-${randomUUID()}`,
    dismiss: `pw-${randomUUID()}`,
    restore: `pw-${randomUUID()}`,
    delete: `pw-${randomUUID()}`,
  };
  const requestIds: string[] = [];
  let announcementId: string | null = null;

  try {
    const [member] = await client<Array<{ id: string }>>`
      select id from users where email = 'lea@q-academy.de' limit 1
    `;
    if (!member) throw new Error("Seed member was not found.");
    const startsAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 86_400_000).toISOString();

    const created = await request.post("/api/v1/announcements", {
      headers: {
        ...authorization,
        "Idempotency-Key": idempotencyKeys.create,
      },
      data: {
        title,
        body: "Scheduled API announcement contract test.",
        tone: "warning",
        placement: "banner",
        audience: "all",
        startsAt,
        endsAt,
      },
    });
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    announcementId = (await created.json()).data.id;

    const detail = await request.get(
      `/api/v1/announcements/${announcementId}`,
      { headers: authorization },
    );
    requestIds.push(detail.headers()["x-request-id"]);
    expect(detail.status()).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: { id: announcementId, title, active: true },
    });

    const updated = await request.patch(
      `/api/v1/announcements/${announcementId}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": idempotencyKeys.update,
        },
        data: { active: false },
      },
    );
    requestIds.push(updated.headers()["x-request-id"]);
    expect(updated.status()).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { active: false },
    });

    const dismissed = await request.put(
      `/api/v1/announcements/${announcementId}/dismissals/${member.id}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": idempotencyKeys.dismiss,
        },
      },
    );
    requestIds.push(dismissed.headers()["x-request-id"]);
    expect(dismissed.status()).toBe(200);

    const dismissals = await request.get(
      `/api/v1/announcements/${announcementId}/dismissals`,
      { headers: authorization },
    );
    requestIds.push(dismissals.headers()["x-request-id"]);
    expect(dismissals.status()).toBe(200);
    expect((await dismissals.json()).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: member.id })]),
    );

    const restored = await request.delete(
      `/api/v1/announcements/${announcementId}/dismissals/${member.id}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": idempotencyKeys.restore,
        },
      },
    );
    requestIds.push(restored.headers()["x-request-id"]);
    expect(restored.status()).toBe(200);

    const removed = await request.delete(
      `/api/v1/announcements/${announcementId}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": idempotencyKeys.delete,
        },
      },
    );
    requestIds.push(removed.headers()["x-request-id"]);
    expect(removed.status()).toBe(200);
    announcementId = null;
  } finally {
    await deleteAuditEntries(requestIds);
    if (announcementId) {
      await client`delete from announcements where id = ${announcementId}`;
    }
    for (const key of Object.values(idempotencyKeys)) {
      await client`delete from api_idempotency_keys where key = ${key}`;
    }
    await client.end();
  }
});
