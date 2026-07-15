import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function subjectReference(organizationId: string, subjectUserId: string) {
  const secret =
    process.env.PRIVACY_SUBJECT_HMAC_SECRET ??
    "q-academy-local-privacy-subject-hmac-key";
  return createHmac("sha256", secret)
    .update("q-academy:privacy-identity:v1\0")
    .update(organizationId)
    .update("\0subject\0")
    .update(subjectUserId)
    .digest("hex");
}

test("privacy API enforces scopes, tenant isolation, idempotency, and safe responses", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted privacy API flow");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const organizationIds: string[] = [];
  const readWriteSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const readOnlySecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const foreignSecret = `qak_test_${randomBytes(28).toString("base64url")}`;

  try {
    const organizations = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values
        ('Privacy API contract', ${`privacy-api-${randomUUID()}`}),
        ('Privacy API foreign', ${`privacy-api-foreign-${randomUUID()}`})
      returning id
    `;
    const [organization, foreignOrganization] = organizations;
    if (!organization || !foreignOrganization) {
      throw new Error("Privacy API organizations were not created.");
    }
    organizationIds.push(organization.id, foreignOrganization.id);

    const users = await client<
      Array<{ id: string; organization_id: string; first_name: string }>
    >`
      insert into users (
        organization_id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        status
      )
      values
        (${organization.id}, ${`owner-${randomUUID()}@example.test`}, 'unused', 'Olivia', 'Owner', 'owner', 'active'),
        (${organization.id}, ${`subject-${randomUUID()}@example.test`}, 'unused', 'Sam', 'Subject', 'member', 'active'),
        (${foreignOrganization.id}, ${`owner-${randomUUID()}@example.test`}, 'unused', 'Fiona', 'Owner', 'owner', 'active'),
        (${foreignOrganization.id}, ${`subject-${randomUUID()}@example.test`}, 'unused', 'Frank', 'Subject', 'member', 'active')
      returning id, organization_id, first_name
    `;
    const owner = users.find(
      (user) =>
        user.organization_id === organization.id && user.first_name === "Olivia",
    );
    const subject = users.find(
      (user) =>
        user.organization_id === organization.id && user.first_name === "Sam",
    );
    const foreignOwner = users.find(
      (user) =>
        user.organization_id === foreignOrganization.id &&
        user.first_name === "Fiona",
    );
    const foreignSubject = users.find(
      (user) =>
        user.organization_id === foreignOrganization.id &&
        user.first_name === "Frank",
    );
    if (!owner || !subject || !foreignOwner || !foreignSubject) {
      throw new Error("Privacy API users were not created.");
    }

    await client`
      insert into api_keys (
        organization_id,
        name,
        prefix,
        key_hash,
        scopes,
        created_by_id
      )
      values
        (${organization.id}, 'Privacy read-write', ${readWriteSecret.slice(0, 20)}, ${hashSecret(readWriteSecret)}, array['privacy:read', 'privacy:write'], ${owner.id}),
        (${organization.id}, 'Privacy read-only', ${readOnlySecret.slice(0, 20)}, ${hashSecret(readOnlySecret)}, array['privacy:read'], ${owner.id}),
        (${foreignOrganization.id}, 'Privacy foreign', ${foreignSecret.slice(0, 20)}, ${hashSecret(foreignSecret)}, array['privacy:read'], ${foreignOwner.id})
    `;

    const privacyRequestId = randomUUID();
    const clientRequestId = `customer-case-${randomUUID()}`;
    const artifactId = randomUUID();
    const policySecret = `policy-${randomUUID()}`;
    const holdReasonSecret = `hold-reason-${randomUUID()}`;
    const storageSecret = `storage-${randomUUID()}`;
    const failureDetailSecret = `failure-${randomUUID()}`;
    const reference = subjectReference(organization.id, subject.id);

    await client`
      insert into privacy_requests (
        id,
        organization_id,
        subject_user_id,
        subject_reference,
        client_request_id,
        type,
        status,
        due_at,
        policy_version,
        policy_snapshot
      )
      values (
        ${privacyRequestId},
        ${organization.id},
        ${subject.id},
        ${reference},
        ${clientRequestId},
        'access_export',
        'received',
        now() + interval '7 days',
        'privacy-v1',
        ${client.json({ internalSecret: policySecret })}
      )
    `;
    await client`
      insert into privacy_legal_holds (
        organization_id,
        request_id,
        subject_user_id,
        subject_reference,
        scope,
        reference,
        reason,
        legal_basis,
        created_by_id
      )
      values (
        ${organization.id},
        ${privacyRequestId},
        ${subject.id},
        ${reference},
        'audit',
        ${`hold-${randomUUID()}`},
        ${holdReasonSecret},
        'Article 6 legal basis secret',
        ${owner.id}
      )
    `;
    await client`
      insert into privacy_export_artifacts (
        id,
        organization_id,
        request_id,
        status,
        format,
        storage_driver,
        storage_key,
        safe_file_name,
        content_type,
        expires_at,
        failure_code,
        failure_detail
      )
      values (
        ${artifactId},
        ${organization.id},
        ${privacyRequestId},
        'failed',
        'json',
        'filesystem',
        ${`tenants/${organization.id}/privacy-exports/${privacyRequestId}/${storageSecret}.json`},
        'privacy-export.json',
        'application/json',
        now() + interval '1 day',
        'provider_error',
        ${failureDetailSecret}
      )
    `;

    const readWriteAuthorization = {
      Authorization: `Bearer ${readWriteSecret}`,
    };
    const readOnlyAuthorization = {
      Authorization: `Bearer ${readOnlySecret}`,
    };

    const list = await request.get("/api/v1/privacy-requests?limit=1", {
      headers: readWriteAuthorization,
    });
    expect(list.status()).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: [
        {
          id: privacyRequestId,
          clientRequestId,
          subject: { id: subject.id },
        },
      ],
      meta: { pagination: { returned: 1, nextCursor: null } },
    });

    const detail = await request.get(
      `/api/v1/privacy-requests/${privacyRequestId}`,
      { headers: readOnlyAuthorization },
    );
    expect(detail.status()).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.data).toMatchObject({
      id: privacyRequestId,
      subject: { id: subject.id },
      events: [],
      legalHolds: [{ scope: "audit" }],
      artifacts: [{ id: artifactId, failureCode: "provider_error" }],
    });
    expect(detailBody.data).not.toHaveProperty("subjectReference");
    expect(detailBody.data).not.toHaveProperty("policySnapshot");
    expect(detailBody.data).not.toHaveProperty("statusReason");
    expect(detailBody.data.artifacts[0]).not.toHaveProperty("storageKey");
    expect(detailBody.data.artifacts[0]).not.toHaveProperty("storageVersionId");
    expect(detailBody.data.artifacts[0]).not.toHaveProperty("failureDetail");
    expect(detailBody.data.legalHolds[0]).not.toHaveProperty("reason");
    expect(detailBody.data.legalHolds[0]).not.toHaveProperty("legalBasis");
    const serializedDetail = JSON.stringify(detailBody);
    for (const secret of [
      policySecret,
      holdReasonSecret,
      storageSecret,
      failureDetailSecret,
    ]) {
      expect(serializedDetail).not.toContain(secret);
    }

    const idempotencyKey = `privacy-${randomUUID()}`;
    const replayInput = {
      subjectUserId: subject.id,
      clientRequestId,
      type: "access_export",
    };
    const replayHeaders = {
      ...readWriteAuthorization,
      "Idempotency-Key": idempotencyKey,
    };
    const domainReplay = await request.post("/api/v1/privacy-requests", {
      headers: replayHeaders,
      data: replayInput,
    });
    expect(domainReplay.status()).toBe(200);
    await expect(domainReplay.json()).resolves.toMatchObject({
      data: { id: privacyRequestId },
      meta: { created: false },
    });
    const httpReplay = await request.post("/api/v1/privacy-requests", {
      headers: replayHeaders,
      data: replayInput,
    });
    expect(httpReplay.status()).toBe(200);
    expect(httpReplay.headers()["idempotent-replayed"]).toBe("true");

    const conflict = await request.post("/api/v1/privacy-requests", {
      headers: readWriteAuthorization,
      data: { ...replayInput, type: "erasure" },
    });
    expect(conflict.status()).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const strictValidation = await request.post("/api/v1/privacy-requests", {
      headers: readWriteAuthorization,
      data: { ...replayInput, lifecycleAction: "approve" },
    });
    expect(strictValidation.status()).toBe(422);

    const readOnlyWrite = await request.post("/api/v1/privacy-requests", {
      headers: readOnlyAuthorization,
      data: replayInput,
    });
    expect(readOnlyWrite.status()).toBe(403);

    const crossTenantCreate = await request.post("/api/v1/privacy-requests", {
      headers: readWriteAuthorization,
      data: {
        subjectUserId: foreignSubject.id,
        clientRequestId: `foreign-${randomUUID()}`,
        type: "erasure",
      },
    });
    expect(crossTenantCreate.status()).toBe(404);

    const foreignRead = await request.get(
      `/api/v1/privacy-requests/${privacyRequestId}`,
      { headers: { Authorization: `Bearer ${foreignSecret}` } },
    );
    expect(foreignRead.status()).toBe(404);

    const invalidIdentifier = await request.get(
      "/api/v1/privacy-requests/not-a-uuid",
      { headers: readOnlyAuthorization },
    );
    expect(invalidIdentifier.status()).toBe(400);

    const [eventCount] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from privacy_request_events
      where organization_id = ${organization.id}
    `;
    expect(eventCount?.count).toBe(0);
  } finally {
    if (organizationIds.length) {
      await client`
        delete from privacy_export_artifacts
        where organization_id = any(${organizationIds}::uuid[])
      `;
      await client`
        delete from privacy_legal_holds
        where organization_id = any(${organizationIds}::uuid[])
      `;
      await client`
        delete from privacy_requests
        where organization_id = any(${organizationIds}::uuid[])
      `;
      await client`
        delete from organizations
        where id = any(${organizationIds}::uuid[])
      `;
    }
    await client.end();
  }
});
