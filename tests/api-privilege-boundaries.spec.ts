import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function expectForbidden(
  response: APIResponse,
  code: "forbidden" | "insufficient_scope" = "forbidden",
) {
  expect(response.status()).toBe(403);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  await expect(response.json()).resolves.toMatchObject({
    status: 403,
    title: "Forbidden",
    code,
  });
}

test("members:write cannot create, promote, demote, disable, or invite staff accounts", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API security flow");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const organizationSlug = `member-boundary-${randomUUID()}`;
  const foreignOrganizationSlug = `member-foreign-${randomUUID()}`;
  const secret = `qak_test_${randomBytes(28).toString("base64url")}`;
  let organizationId: string | null = null;
  let foreignOrganizationId: string | null = null;

  try {
    const [organization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('Member boundary test', ${organizationSlug})
      returning id
    `;
    organizationId = organization.id;
    const [foreignOrganization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('Foreign member boundary test', ${foreignOrganizationSlug})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;

    const suffix = randomUUID();
    const fixtureUsers = await client<
      Array<{
        id: string;
        email: string;
        role: "owner" | "admin" | "trainer" | "member";
        status: "active" | "invited" | "disabled";
      }>
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
        (${organization.id}, ${`owner-${suffix}@example.test`}, 'unused', 'Olivia', 'Owner', 'owner', 'active'),
        (${organization.id}, ${`admin-${suffix}@example.test`}, 'unused', 'Alex', 'Admin', 'admin', 'active'),
        (${organization.id}, ${`trainer-${suffix}@example.test`}, 'unused', 'Tina', 'Trainer', 'trainer', 'invited'),
        (${organization.id}, ${`active-${suffix}@example.test`}, 'unused', 'Mara', 'Member', 'member', 'active'),
        (${organization.id}, ${`invited-${suffix}@example.test`}, 'unused', 'Ines', 'Invite', 'member', 'invited')
      returning id, email, role, status
    `;
    const [foreignMember] = await client<Array<{ id: string }>>`
      insert into users (
        organization_id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        status
      )
      values (
        ${foreignOrganization.id},
        ${`foreign-${suffix}@example.test`},
        'unused',
        'Fiona',
        'Foreign',
        'member',
        'invited'
      )
      returning id
    `;
    await client`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes)
      values (
        ${organization.id},
        'Member boundary key',
        ${secret.slice(0, 20)},
        ${hashSecret(secret)},
        array['members:write']
      )
    `;

    const byRole = new Map(fixtureUsers.map((user) => [user.role, user]));
    const activeMember = fixtureUsers.find(
      (user) => user.role === "member" && user.status === "active",
    );
    const invitedMember = fixtureUsers.find(
      (user) => user.role === "member" && user.status === "invited",
    );
    const owner = byRole.get("owner");
    const admin = byRole.get("admin");
    const trainer = byRole.get("trainer");
    if (!owner || !admin || !trainer || !activeMember || !invitedMember) {
      throw new Error("Member boundary fixture is incomplete.");
    }
    const authorization = { Authorization: `Bearer ${secret}` };

    for (const role of ["owner", "admin", "trainer"] as const) {
      const email = `blocked-${role}-${suffix}@example.test`;
      const response = await request.post("/api/v1/members", {
        headers: authorization,
        data: {
          email,
          firstName: "Blocked",
          lastName: "Staff",
          role,
          status: "invited",
        },
      });
      await expectForbidden(response);
      const [stored] = await client<Array<{ count: number }>>`
        select count(*)::int as count
        from users
        where organization_id = ${organization.id} and email = ${email}
      `;
      expect(stored.count).toBe(0);
    }

    const activeCreateEmail = `blocked-active-${suffix}@example.test`;
    const activeCreate = await request.post("/api/v1/members", {
      headers: authorization,
      data: {
        email: activeCreateEmail,
        firstName: "Active",
        lastName: "Blocked",
        role: "member",
        status: "active",
      },
    });
    await expectForbidden(activeCreate);

    const promoted = await request.patch(
      `/api/v1/members/${invitedMember.id}`,
      {
        headers: authorization,
        data: { role: "admin" },
      },
    );
    await expectForbidden(promoted);

    const demoted = await request.patch(`/api/v1/members/${admin.id}`, {
      headers: authorization,
      data: { role: "member" },
    });
    await expectForbidden(demoted);

    const lastOwnerChange = await request.patch(
      `/api/v1/members/${owner.id}`,
      {
        headers: authorization,
        data: { role: "member", status: "disabled" },
      },
    );
    await expectForbidden(lastOwnerChange);

    const disabledTrainer = await request.delete(
      `/api/v1/members/${trainer.id}`,
      { headers: authorization },
    );
    await expectForbidden(disabledTrainer);

    const invitedActiveMember = await request.post(
      `/api/v1/members/${activeMember.id}/invite`,
      { headers: authorization },
    );
    await expectForbidden(invitedActiveMember);

    const invitedStaff = await request.post(
      `/api/v1/members/${trainer.id}/invite`,
      { headers: authorization },
    );
    await expectForbidden(invitedStaff);

    const invitedForeignMember = await request.post(
      `/api/v1/members/${foreignMember.id}/invite`,
      { headers: authorization },
    );
    expect(invitedForeignMember.status()).toBe(404);

    const legitimateUpdate = await request.patch(
      `/api/v1/members/${invitedMember.id}`,
      {
        headers: authorization,
        data: { jobTitle: "QA Specialist" },
      },
    );
    expect(legitimateUpdate.status()).toBe(200);
    await expect(legitimateUpdate.json()).resolves.toMatchObject({
      data: {
        id: invitedMember.id,
        role: "member",
        status: "invited",
        jobTitle: "QA Specialist",
      },
    });

    const legitimateInvite = await request.post(
      `/api/v1/members/${invitedMember.id}/invite`,
      { headers: authorization },
    );
    expect(legitimateInvite.status()).toBe(200);

    const legitimateCreateEmail = `legitimate-${suffix}@example.test`;
    const legitimateCreate = await request.post("/api/v1/members", {
      headers: authorization,
      data: {
        email: legitimateCreateEmail,
        firstName: "Legit",
        lastName: "Member",
      },
    });
    expect(legitimateCreate.status()).toBe(201);
    await expect(legitimateCreate.json()).resolves.toMatchObject({
      data: { role: "member", status: "invited" },
    });

    const protectedAccounts = await client<
      Array<{
        id: string;
        role: string;
        status: string;
      }>
    >`
      select id, role, status
      from users
      where id in (${owner.id}, ${admin.id}, ${trainer.id}, ${invitedMember.id})
      order by id
    `;
    const protectedById = new Map(
      protectedAccounts.map((account) => [account.id, account]),
    );
    expect(protectedById.get(owner.id)).toMatchObject({
      role: "owner",
      status: "active",
    });
    expect(protectedById.get(admin.id)).toMatchObject({
      role: "admin",
      status: "active",
    });
    expect(protectedById.get(trainer.id)).toMatchObject({
      role: "trainer",
      status: "invited",
    });
    expect(protectedById.get(invitedMember.id)).toMatchObject({
      role: "member",
      status: "invited",
    });

    const [invitationCounts] = await client<
      Array<{ active: number; staff: number; foreign: number; valid: number }>
    >`
      select
        count(*) filter (where user_id = ${activeMember.id})::int as active,
        count(*) filter (where user_id = ${trainer.id})::int as staff,
        count(*) filter (where user_id = ${foreignMember.id})::int as foreign,
        count(*) filter (where user_id = ${invitedMember.id})::int as valid
      from invitations
    `;
    expect(invitationCounts).toEqual({
      active: 0,
      staff: 0,
      foreign: 0,
      valid: 1,
    });
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end();
  }
});

test("api_keys:write can delegate only caller scopes and cannot mutate itself", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API security flow");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const organizationSlug = `key-boundary-${randomUUID()}`;
  const restrictedSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const wildcardSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const privacySecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const narrowTargetSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const broadTargetSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  let organizationId: string | null = null;

  try {
    const [organization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('API key boundary test', ${organizationSlug})
      returning id
    `;
    organizationId = organization.id;
    const keys = await client<Array<{ id: string; name: string }>>`
      insert into api_keys (
        organization_id,
        name,
        prefix,
        key_hash,
        scopes
      )
      values
        (${organization.id}, 'Restricted caller', ${restrictedSecret.slice(0, 20)}, ${hashSecret(restrictedSecret)}, array['api_keys:write']),
        (${organization.id}, 'Wildcard caller', ${wildcardSecret.slice(0, 20)}, ${hashSecret(wildcardSecret)}, array['*']),
        (${organization.id}, 'Privacy caller', ${privacySecret.slice(0, 20)}, ${hashSecret(privacySecret)}, array['api_keys:write', 'privacy:write']),
        (${organization.id}, 'Narrow target', ${narrowTargetSecret.slice(0, 20)}, ${hashSecret(narrowTargetSecret)}, array['api_keys:write']),
        (${organization.id}, 'Broad target', ${broadTargetSecret.slice(0, 20)}, ${hashSecret(broadTargetSecret)}, array['api_keys:write', 'courses:read'])
      returning id, name
    `;
    const byName = new Map(keys.map((key) => [key.name, key.id]));
    const restrictedId = byName.get("Restricted caller");
    const wildcardId = byName.get("Wildcard caller");
    const narrowTargetId = byName.get("Narrow target");
    const broadTargetId = byName.get("Broad target");
    if (!restrictedId || !wildcardId || !narrowTargetId || !broadTargetId) {
      throw new Error("API key boundary fixture is incomplete.");
    }
    const authorization = {
      Authorization: `Bearer ${restrictedSecret}`,
    };

    const selfEscalation = await request.patch(
      `/api/v1/api-keys/${restrictedId}`,
      {
        headers: authorization,
        data: { scopes: ["api_keys:write", "courses:read"] },
      },
    );
    await expectForbidden(selfEscalation);

    const selfLifetimeChange = await request.patch(
      `/api/v1/api-keys/${restrictedId}`,
      {
        headers: authorization,
        data: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      },
    );
    await expectForbidden(selfLifetimeChange);

    const selfRename = await request.patch(
      `/api/v1/api-keys/${restrictedId}`,
      {
        headers: authorization,
        data: { name: "Restricted caller renamed" },
      },
    );
    expect(selfRename.status()).toBe(200);

    const broadCreateName = `Broad child ${randomUUID()}`;
    const broadCreate = await request.post("/api/v1/api-keys", {
      headers: authorization,
      data: {
        name: broadCreateName,
        scopes: ["api_keys:write", "courses:read"],
      },
    });
    await expectForbidden(broadCreate, "insufficient_scope");

    const wildcardCreateName = `Wildcard child ${randomUUID()}`;
    const wildcardCreate = await request.post("/api/v1/api-keys", {
      headers: authorization,
      data: { name: wildcardCreateName, scopes: ["*"] },
    });
    await expectForbidden(wildcardCreate, "insufficient_scope");

    const wildcardPrivacyCreateName = `Wildcard privacy child ${randomUUID()}`;
    const wildcardPrivacyCreate = await request.post("/api/v1/api-keys", {
      headers: { Authorization: `Bearer ${wildcardSecret}` },
      data: {
        name: wildcardPrivacyCreateName,
        scopes: ["privacy:read"],
      },
    });
    await expectForbidden(wildcardPrivacyCreate, "insufficient_scope");

    const explicitPrivacyCreateName = `Explicit privacy child ${randomUUID()}`;
    const explicitPrivacyCreate = await request.post("/api/v1/api-keys", {
      headers: { Authorization: `Bearer ${privacySecret}` },
      data: {
        name: explicitPrivacyCreateName,
        scopes: ["privacy:write"],
      },
    });
    await expectForbidden(explicitPrivacyCreate, "insufficient_scope");

    const narrowCreateName = `Narrow child ${randomUUID()}`;
    const narrowCreate = await request.post("/api/v1/api-keys", {
      headers: authorization,
      data: { name: narrowCreateName, scopes: ["api_keys:write"] },
    });
    expect(narrowCreate.status()).toBe(201);
    await expect(narrowCreate.json()).resolves.toMatchObject({
      data: { name: narrowCreateName, scopes: ["api_keys:write"] },
    });

    const targetEscalation = await request.patch(
      `/api/v1/api-keys/${narrowTargetId}`,
      {
        headers: authorization,
        data: { scopes: ["api_keys:write", "courses:read"] },
      },
    );
    await expectForbidden(targetEscalation, "insufficient_scope");

    const broadLifetimeChange = await request.patch(
      `/api/v1/api-keys/${broadTargetId}`,
      {
        headers: authorization,
        data: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      },
    );
    await expectForbidden(broadLifetimeChange, "insufficient_scope");

    const [broadHashBefore] = await client<Array<{ key_hash: string }>>`
      select key_hash from api_keys where id = ${broadTargetId}
    `;
    const broadRotation = await request.post(
      `/api/v1/api-keys/${broadTargetId}/rotate`,
      { headers: authorization },
    );
    await expectForbidden(broadRotation, "insufficient_scope");

    const narrowPatch = await request.patch(
      `/api/v1/api-keys/${narrowTargetId}`,
      {
        headers: authorization,
        data: { scopes: ["api_keys:write"], name: "Narrow target patched" },
      },
    );
    expect(narrowPatch.status()).toBe(200);

    const narrowRotation = await request.post(
      `/api/v1/api-keys/${narrowTargetId}/rotate`,
      { headers: authorization },
    );
    expect(narrowRotation.status()).toBe(200);
    await expect(narrowRotation.json()).resolves.toMatchObject({
      data: { id: narrowTargetId, scopes: ["api_keys:write"] },
      meta: { secretShownOnce: true },
    });

    const selfRotation = await request.post(
      `/api/v1/api-keys/${restrictedId}/rotate`,
      { headers: authorization },
    );
    await expectForbidden(selfRotation);

    const selfRevoke = await request.delete(
      `/api/v1/api-keys/${restrictedId}`,
      { headers: authorization },
    );
    await expectForbidden(selfRevoke);

    const wildcardDelegation = await request.post("/api/v1/api-keys", {
      headers: { Authorization: `Bearer ${wildcardSecret}` },
      data: {
        name: `Wildcard delegated ${randomUUID()}`,
        scopes: ["*"],
      },
    });
    expect(wildcardDelegation.status()).toBe(201);

    const [restrictedState] = await client<
      Array<{
        name: string;
        scopes: string[];
        status: string;
        expires_at: Date | null;
      }>
    >`
      select name, scopes, status, expires_at
      from api_keys
      where id = ${restrictedId}
    `;
    expect(restrictedState).toMatchObject({
      name: "Restricted caller renamed",
      scopes: ["api_keys:write"],
      status: "active",
      expires_at: null,
    });

    const [broadState] = await client<
      Array<{ scopes: string[]; key_hash: string; expires_at: Date | null }>
    >`
      select scopes, key_hash, expires_at
      from api_keys
      where id = ${broadTargetId}
    `;
    expect(broadState).toEqual({
      scopes: ["api_keys:write", "courses:read"],
      key_hash: broadHashBefore.key_hash,
      expires_at: null,
    });

    const blockedCreateRows = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from api_keys
      where organization_id = ${organization.id}
        and name in (
          ${broadCreateName},
          ${wildcardCreateName},
          ${wildcardPrivacyCreateName},
          ${explicitPrivacyCreateName}
        )
    `;
    expect(blockedCreateRows[0]?.count).toBe(0);
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});
