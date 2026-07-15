import { execFile } from "node:child_process";
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  createEncryptionKeyring,
  decryptCompactValueWithKeyring,
  decryptPayloadWithKeyring,
  encryptPayloadWithKeyring,
  type LegacyEncryptedPayload,
} from "../src/lib/encryption-keyring";

const execFileAsync = promisify(execFile);
const adminUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

async function createIsolatedRotationDatabase(suffix: string) {
  const databaseName = `q_academy_rotation_${suffix.replaceAll("-", "").slice(0, 16)}_test`;
  if (!/^q_academy_rotation_[a-f0-9]+_test$/.test(databaseName)) {
    throw new Error("Unsafe rotation test database name.");
  }
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.unsafe(
    `create database "${databaseName}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
  );
  const sql = postgres(databaseUrl.toString(), { max: 4, prepare: false });
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await sql.end().catch(() => undefined);
    await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  };
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    const organizationId = randomUUID();
    const userId = randomUUID();
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'Rotation Base', ${`rotation-base-${suffix}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId}, ${`rotation-owner-${suffix}@example.test`},
        'not-a-login-hash', 'Rotation', 'Owner', 'owner', 'active'
      )
    `;
    return {
      databaseUrl: databaseUrl.toString(),
      dispose,
      identity: { organization_id: organizationId, user_id: userId },
      sql,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function legacyPayload(
  plaintext: string,
  associatedData: string,
  secret: string,
): LegacyEncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    iv,
  );
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function legacyCompact(plaintext: string, secret: string) {
  const payload = legacyPayload(plaintext, "", secret);
  return `v1.${payload.iv}.${payload.tag}.${payload.ciphertext}`;
}

function timestampIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

test("encryption rotation rekeys legacy rows online and is idempotent", async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "single database integration flow");
  test.setTimeout(60_000);

  const suffix = randomUUID();
  const isolatedDatabase = await createIsolatedRotationDatabase(suffix);
  const { databaseUrl, identity, sql } = isolatedDatabase;
  const emailId = randomUUID();
  const apiKeyId = randomUUID();
  const idempotencyId = randomUUID();
  const webhookId = randomUUID();
  const oidcOrganizationId = randomUUID();
  const mfaUserId = randomUUID();
  const dataLegacySecret =
    "Rotation-Legacy-Data-7QwE2rT8yU4iO9pA1sD5fG6h";
  const dataActiveSecret =
    "Rotation-Active-Data-8WqE3rT9yU5iO0pA2sD6fG7h";
  const webhookLegacySecret =
    "Rotation-Legacy-Hook-9ErT4yU0iO6pA1sD3fG7hJ8k";
  const webhookActiveSecret =
    "Rotation-Active-Hook-0RtY5uI1oP7aS2dF4gH8jK9l";
  const dataKeyId = "data-rotation-test";
  const webhookKeyId = "webhook-rotation-test";
  const emailUpdatedAt = new Date("2020-02-03T04:05:06.000Z");
  const responseText = JSON.stringify({ marker: `response-${suffix}` });
  const emailText = JSON.stringify({ link: `https://academy.test/${suffix}` });
  const webhookText = `hook-${suffix}`;
  const oidcText = `oidc-client-secret-${suffix}`;
  const mfaText = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const oidcUpdatedAt = new Date("2020-03-04T05:06:07.000Z");

  const requestIdentity = {
    organizationId: identity.organization_id,
    apiKeyId,
    key: `rotation-${suffix}`,
    method: "POST",
    path: "/api/v1/courses",
    requestHash: createHash("sha256").update(suffix).digest("hex"),
  };
  const idempotencyContext = [
    "q-academy:api-idempotency:v1",
    requestIdentity.organizationId,
    requestIdentity.apiKeyId,
    requestIdentity.key,
    requestIdentity.method,
    requestIdentity.path,
    requestIdentity.requestHash,
  ].join("\n");

  try {
    const legacyDataRing = createEncryptionKeyring({
      activeKeyId: "data-legacy-test",
      activeSecret: dataLegacySecret,
    });
    await sql.begin(async (transaction) => {
      await transaction`
        insert into organizations (id, name, slug)
        values (
          ${oidcOrganizationId}, ${`OIDC Rotation ${suffix}`},
          ${`oidc-rotation-${suffix}`}
        )
      `;
      await transaction`
        insert into oidc_configurations (
          organization_id, display_name, client_secret_encrypted,
          created_at, updated_at
        ) values (
          ${oidcOrganizationId}, 'OIDC Rotation',
          ${JSON.stringify(
            encryptPayloadWithKeyring(
              oidcText,
              `q-academy:oidc-client-secret:v1\n${oidcOrganizationId}`,
              legacyDataRing,
            ),
          )}::jsonb,
          ${oidcUpdatedAt.toISOString()}, ${oidcUpdatedAt.toISOString()}
        )
      `;
      await transaction`
        insert into users (
          id, organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${mfaUserId}, ${oidcOrganizationId},
          ${`mfa-rotation-${suffix}@example.test`}, 'not-a-login-hash',
          'MFA', 'Rotation', 'admin', 'active'
        )
      `;
      await transaction`
        insert into user_mfa_configurations (
          user_id, organization_id, status, secret_encrypted,
          recovery_code_hashes, created_at, updated_at
        ) values (
          ${mfaUserId}, ${oidcOrganizationId}, 'pending',
          ${JSON.stringify(
            encryptPayloadWithKeyring(
              mfaText,
              `mfa-totp:${oidcOrganizationId}:${mfaUserId}:v1`,
              legacyDataRing,
            ),
          )}::jsonb,
          array[]::text[], ${oidcUpdatedAt.toISOString()}, ${oidcUpdatedAt.toISOString()}
        )
      `;
      await transaction`
        insert into api_keys (
          id, organization_id, name, prefix, key_hash, scopes, status,
          created_by_id
        ) values (
          ${apiKeyId}, ${identity.organization_id}, ${`Rotation ${suffix}`},
          'qak_rotation', ${createHash("sha256").update(`key-${suffix}`).digest("hex")},
          array['courses:write']::text[], 'active', ${identity.user_id}
        )
      `;
      await transaction`
        insert into email_deliveries (
          id, organization_id, user_id, event, recipient_email, payload,
          created_at, updated_at
        ) values (
          ${emailId}, ${identity.organization_id}, ${identity.user_id},
          'rotation.test', 'rotation@example.test',
          ${JSON.stringify(legacyPayload(emailText, `email-delivery:${emailId}`, dataLegacySecret))}::jsonb,
          ${emailUpdatedAt.toISOString()}, ${emailUpdatedAt.toISOString()}
        )
      `;
      await transaction`
        insert into api_idempotency_keys (
          id, organization_id, api_key_id, key, method, path, request_hash,
          status, claim_token, response_status, response_body, expires_at
        ) values (
          ${idempotencyId}, ${identity!.organization_id}, ${apiKeyId},
          ${requestIdentity.key}, ${requestIdentity.method}, ${requestIdentity.path},
          ${requestIdentity.requestHash}, 'completed', ${randomUUID()}, 201,
          ${JSON.stringify(legacyPayload(responseText, idempotencyContext, dataLegacySecret))}::jsonb,
          now() + interval '1 day'
        )
      `;
      await transaction`
        insert into webhooks (
          id, organization_id, name, url, signing_secret_encrypted, events,
          created_by_id
        ) values (
          ${webhookId}, ${identity.organization_id}, ${`Rotation ${suffix}`},
          'https://hooks.example.test/q-academy',
          ${legacyCompact(webhookText, webhookLegacySecret)},
          array['course.published']::text[], ${identity.user_id}
        )
      `;
    });

    const cli = path.join(
      process.cwd(),
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs",
    );
    const environment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATA_ENCRYPTION_KEY_ID: dataKeyId,
      DATA_ENCRYPTION_KEY: dataActiveSecret,
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({
        "data-legacy-test": dataLegacySecret,
      }),
      WEBHOOK_ENCRYPTION_KEY_ID: webhookKeyId,
      WEBHOOK_ENCRYPTION_KEY: webhookActiveSecret,
      WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({
        "webhook-legacy-test": webhookLegacySecret,
      }),
    };
    const first = await execFileAsync(
      process.execPath,
      [cli, "scripts/rotate-encryption-keys.ts", "--execute", "--batch-size", "1"],
      { cwd: process.cwd(), env: environment, timeout: 45_000 },
    );
    const result = JSON.parse(first.stdout.trim()) as {
      rotated: Record<string, number>;
      remaining: Record<string, number>;
      verified: boolean;
    };
    expect(result).toMatchObject({
      rotated: {
        emailDeliveries: 1,
        idempotencyResponses: 1,
        oidcClientSecrets: 1,
        mfaTotpSecrets: 1,
        webhookSecrets: 1,
      },
      remaining: {
        emailDeliveries: 0,
        idempotencyResponses: 0,
        oidcClientSecrets: 0,
        mfaTotpSecrets: 0,
        webhookSecrets: 0,
      },
      verified: true,
    });
    expect(first.stdout).not.toContain(dataLegacySecret);
    expect(first.stdout).not.toContain(responseText);

    const [stored] = await sql<
      Array<{
        email_payload: unknown;
        response_body: unknown;
        signing_secret_encrypted: string;
        email_updated_at: Date | string;
      }>
    >`
      select e.payload as email_payload,
             e.updated_at as email_updated_at,
             i.response_body,
             w.signing_secret_encrypted
      from email_deliveries e
      join api_idempotency_keys i on i.id = ${idempotencyId}
      join webhooks w on w.id = ${webhookId}
      where e.id = ${emailId}
    `;
    const dataRing = createEncryptionKeyring({
      activeKeyId: dataKeyId,
      activeSecret: dataActiveSecret,
    });
    const webhookRing = createEncryptionKeyring({
      activeKeyId: webhookKeyId,
      activeSecret: webhookActiveSecret,
    });
    expect(
      decryptPayloadWithKeyring(
        stored!.email_payload,
        `email-delivery:${emailId}`,
        dataRing,
      ),
    ).toBe(emailText);
    expect(
      decryptPayloadWithKeyring(
        stored!.response_body,
        idempotencyContext,
        dataRing,
      ),
    ).toBe(responseText);
    expect(
      decryptCompactValueWithKeyring(
        stored!.signing_secret_encrypted,
        webhookRing,
      ),
    ).toBe(webhookText);
    expect(timestampIso(stored!.email_updated_at)).toBe(
      emailUpdatedAt.toISOString(),
    );
    const [storedOidc] = await sql<
      Array<{ encrypted: unknown; updatedAt: Date | string }>
    >`
      select client_secret_encrypted as encrypted,
             updated_at as "updatedAt"
      from oidc_configurations
      where organization_id = ${oidcOrganizationId}
    `;
    expect(
      decryptPayloadWithKeyring(
        storedOidc.encrypted,
        `q-academy:oidc-client-secret:v1\n${oidcOrganizationId}`,
        dataRing,
      ),
    ).toBe(oidcText);
    expect(timestampIso(storedOidc.updatedAt)).toBe(
      oidcUpdatedAt.toISOString(),
    );
    const [storedMfa] = await sql<Array<{ encrypted: unknown }>>`
      select secret_encrypted as encrypted
      from user_mfa_configurations
      where organization_id = ${oidcOrganizationId}
        and user_id = ${mfaUserId}
    `;
    expect(
      decryptPayloadWithKeyring(
        storedMfa.encrypted,
        `mfa-totp:${oidcOrganizationId}:${mfaUserId}:v1`,
        dataRing,
      ),
    ).toBe(mfaText);

    const second = await execFileAsync(
      process.execPath,
      [cli, "scripts/rotate-encryption-keys.ts", "--execute", "--batch-size", "1"],
      { cwd: process.cwd(), env: environment, timeout: 45_000 },
    );
    expect(JSON.parse(second.stdout.trim()).rotated).toEqual({
      emailDeliveries: 0,
      idempotencyResponses: 0,
      oidcClientSecrets: 0,
      mfaTotpSecrets: 0,
      webhookSecrets: 0,
    });
  } finally {
    await sql`delete from email_deliveries where id = ${emailId}`;
    await sql`delete from webhooks where id = ${webhookId}`;
    await sql`delete from api_keys where id = ${apiKeyId}`;
    await sql`delete from organizations where id = ${oidcOrganizationId}`;
    await isolatedDatabase.dispose();
  }
});
