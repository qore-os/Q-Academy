import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function startDiscoveryProvider() {
  let issuer = "";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", issuer || "http://127.0.0.1");
    if (
      request.method === "GET" &&
      url.pathname === "/oidc/.well-known/openid-configuration"
    ) {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          scopes_supported: ["openid", "email"],
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oidc`;
  return {
    issuer,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function commandHeaders(secret: string, idempotencyKey: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Idempotency-Key": idempotencyKey,
  };
}

const lostSecretEnvelope = {
  v: 2,
  alg: "A256GCM",
  kid: "lost-key",
  iv: "AAAAAAAAAAAAAAAA",
  tag: "AAAAAAAAAAAAAAAAAAAAAA",
  ciphertext: "AA",
};

test("OIDC configuration recovers lost secret envelopes without weakening lockout safety", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API-only integration flow");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const provider = await startDiscoveryProvider();
  const suffix = randomUUID();
  const apiSecret = `qak_oidc_recovery_${randomBytes(24).toString("base64url")}`;
  const legacySecret = `qak_oidc_legacy_${randomBytes(24).toString("base64url")}`;
  let organizationId: string | null = null;

  try {
    const [organization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values ('OIDC recovery test', ${`oidc-recovery-${suffix}`})
      returning id
    `;
    organizationId = organization.id;
    const [owner] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${`owner-${suffix}@example.test`}, 'unused',
        'Olivia', 'Owner', 'owner', 'active'
      )
      returning id
    `;
    await sql`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${organizationId}, 'OIDC recovery key', ${apiSecret.slice(0, 20)},
        ${hashSecret(apiSecret)}, array['authentication:read', 'authentication:write'],
        ${owner.id}
      )
    `;
    await sql`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${organizationId}, 'Legacy wildcard key', ${legacySecret.slice(0, 20)},
        ${hashSecret(legacySecret)}, array['*', 'organization:write'],
        ${owner.id}
      )
    `;
    await sql`
      insert into oidc_configurations (
        organization_id, enabled, display_name, issuer, client_id,
        client_secret_encrypted, allowed_email_domains,
        password_login_enabled, version
      ) values (
        ${organizationId}, true, 'Company SSO', ${provider.issuer},
        'recovery-client', ${sql.json(lostSecretEnvelope)},
        ${sql.json(["example.test"])}, true, 4
      )
    `;

    const rejectedLegacyKey = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(legacySecret, randomUUID()),
        data: {
          expectedVersion: 4,
          configuration: { displayName: "Must not be authorized" },
        },
      },
    );
    expect(rejectedLegacyKey.status()).toBe(403);
    await expect(rejectedLegacyKey.json()).resolves.toMatchObject({
      code: "insufficient_scope",
    });

    const preserveLostSecret = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 4,
          configuration: { displayName: "Preserve must fail" },
        },
      },
    );
    expect(preserveLostSecret.status()).toBe(409);
    await expect(preserveLostSecret.json()).resolves.toMatchObject({
      code: "conflict",
      detail: expect.stringContaining("muss ersetzt werden"),
    });

    const replaceLostSecret = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 4,
          configuration: { clientSecret: "replacement-secret-value" },
        },
      },
    );
    expect(replaceLostSecret.status()).toBe(200);
    await expect(replaceLostSecret.json()).resolves.toMatchObject({
      data: {
        enabled: true,
        clientSecretConfigured: true,
        passwordLoginEnabled: true,
        version: 5,
      },
    });
    const [replacementState] = await sql<
      Array<{
        client_secret_encrypted: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }>
    >`
      select c.client_secret_encrypted, e.metadata
      from oidc_configurations c
      join lateral (
        select metadata
        from activity_events
        where organization_id = c.organization_id
          and type = 'auth.oidc.configuration.updated'
        order by created_at desc, id desc
        limit 1
      ) e on true
      where c.organization_id = ${organizationId}
    `;
    expect(replacementState.client_secret_encrypted.kid).not.toBe("lost-key");
    expect(replacementState.metadata).toMatchObject({
      changedFields: [],
      clientSecretReplaced: true,
      clientSecretCleared: false,
      version: 5,
    });

    await sql`
      update oidc_configurations
      set client_secret_encrypted = ${sql.json(lostSecretEnvelope)},
          password_login_enabled = false,
          updated_at = now()
      where organization_id = ${organizationId}
    `;
    const clearAndRestorePassword = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 5,
          configuration: {
            enabled: false,
            clientSecret: null,
            passwordLoginEnabled: true,
          },
        },
      },
    );
    expect(clearAndRestorePassword.status()).toBe(200);
    await expect(clearAndRestorePassword.json()).resolves.toMatchObject({
      data: {
        enabled: false,
        clientSecretConfigured: false,
        passwordLoginEnabled: true,
        version: 6,
      },
    });
    const [clearAudit] = await sql<Array<{ metadata: Record<string, unknown> }>>`
      select metadata
      from activity_events
      where organization_id = ${organizationId}
        and type = 'auth.oidc.configuration.updated'
      order by created_at desc, id desc
      limit 1
    `;
    expect(clearAudit.metadata).toMatchObject({
      changedFields: ["enabled", "passwordLoginEnabled"],
      clientSecretReplaced: false,
      clientSecretCleared: true,
      enabled: false,
      passwordLoginEnabled: true,
      version: 6,
    });

    const enableProvider = await request.patch("/api/v1/organization/oidc", {
      headers: commandHeaders(apiSecret, randomUUID()),
      data: {
        expectedVersion: 6,
        configuration: {
          enabled: true,
          issuer: provider.issuer,
          clientId: "recovery-client",
          clientSecret: "second-replacement-secret",
          allowedEmailDomains: ["example.test"],
        },
      },
    });
    expect(enableProvider.status()).toBe(200);
    await expect(enableProvider.json()).resolves.toMatchObject({
      data: { enabled: true, passwordLoginEnabled: true, version: 7 },
    });

    const combinedLockout = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 7,
          configuration: {
            allowedEmailDomains: ["changed.example.test"],
            passwordLoginEnabled: false,
          },
        },
      },
    );
    expect(combinedLockout.status()).toBe(409);
    await expect(combinedLockout.json()).resolves.toMatchObject({
      code: "conflict",
      detail: expect.stringContaining("Provider-Aenderungen"),
    });

    const combinedSecretReplacement = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 7,
          configuration: {
            clientSecret: "third-replacement-secret",
            passwordLoginEnabled: false,
          },
        },
      },
    );
    expect(combinedSecretReplacement.status()).toBe(409);
    await expect(combinedSecretReplacement.json()).resolves.toMatchObject({
      code: "conflict",
      detail: expect.stringContaining("Provider-Aenderungen"),
    });

    const withoutOwnerLogin = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 7,
          configuration: { passwordLoginEnabled: false },
        },
      },
    );
    expect(withoutOwnerLogin.status()).toBe(409);
    await expect(withoutOwnerLogin.json()).resolves.toMatchObject({
      code: "conflict",
      detail: expect.stringContaining("aktuelle SSO-Konfiguration"),
    });

    await sql`
      insert into oidc_identities (
        organization_id, user_id, issuer, subject, email_at_link,
        last_configuration_version
      ) values (
        ${organizationId}, ${owner.id}, ${provider.issuer}, ${`owner-${suffix}`},
        ${`owner-${suffix}@example.test`}, 6
      )
    `;
    const staleOwnerLogin = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 7,
          configuration: { passwordLoginEnabled: false },
        },
      },
    );
    expect(staleOwnerLogin.status()).toBe(409);

    await sql`
      update oidc_identities
      set last_configuration_version = 7, last_login_at = now()
      where organization_id = ${organizationId} and user_id = ${owner.id}
    `;
    const verifiedOwnerLogin = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 7,
          configuration: { passwordLoginEnabled: false },
        },
      },
    );
    expect(verifiedOwnerLogin.status()).toBe(200);
    await expect(verifiedOwnerLogin.json()).resolves.toMatchObject({
      data: { enabled: true, passwordLoginEnabled: false, version: 8 },
    });
    const restorePassword = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 8,
          configuration: { passwordLoginEnabled: true },
        },
      },
    );
    expect(restorePassword.status()).toBe(200);
    await sql`
      update oidc_identities
      set last_configuration_version = 9, last_login_at = now()
      where organization_id = ${organizationId} and user_id = ${owner.id}
    `;
    const [sessionFixture] = await sql<
      Array<{ oidcSessionId: string; passwordSessionId: string }>
    >`
      with identity as (
        select id
        from oidc_identities
        where organization_id = ${organizationId} and user_id = ${owner.id}
      ), oidc_session as (
        insert into user_sessions (
          organization_id, user_id, jti_hash, auth_method,
          oidc_identity_id, oidc_configuration_version,
          authenticated_at, oidc_auth_time, expires_at
        )
        select ${organizationId}, ${owner.id}, ${randomBytes(32).toString("hex")},
               'oidc', identity.id, 9, now(), now(), now() + interval '12 hours'
        from identity
        returning id
      ), password_session as (
        insert into user_sessions (
          organization_id, user_id, jti_hash, auth_method, expires_at
        ) values (
          ${organizationId}, ${owner.id}, ${randomBytes(32).toString("hex")},
          'password', now() + interval '1 day'
        )
        returning id
      )
      select oidc_session.id as "oidcSessionId",
             password_session.id as "passwordSessionId"
      from oidc_session cross join password_session
    `;
    const changeAuthenticationBoundary = await request.patch(
      "/api/v1/organization/oidc",
      {
        headers: commandHeaders(apiSecret, randomUUID()),
        data: {
          expectedVersion: 9,
          configuration: {
            allowedEmailDomains: ["example.test", "second.example.test"],
          },
        },
      },
    );
    expect(changeAuthenticationBoundary.status()).toBe(200);
    const [sessionRevocation] = await sql<
      Array<{ oidcRevoked: boolean; passwordRevoked: boolean }>
    >`
      select
        (select revoked_at is not null from user_sessions
         where id = ${sessionFixture.oidcSessionId}) as "oidcRevoked",
        (select revoked_at is not null from user_sessions
         where id = ${sessionFixture.passwordSessionId}) as "passwordRevoked"
    `;
    expect(sessionRevocation).toEqual({
      oidcRevoked: true,
      passwordRevoked: false,
    });
    const [auditCount] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from activity_events
      where organization_id = ${organizationId}
        and type = 'auth.oidc.configuration.updated'
    `;
    expect(auditCount.count).toBe(6);
  } finally {
    if (organizationId) {
      await sql`delete from organizations where id = ${organizationId}`;
    }
    await sql.end();
    await provider.close();
  }
});
