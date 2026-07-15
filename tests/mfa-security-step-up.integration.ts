import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "@/db";
import {
  MfaSecurityStepUpError,
  verifyAndConsumeMfaSecurityStepUp,
} from "@/lib/mfa/security-step-up";
import { encryptMfaSecret, hashRecoveryCode } from "@/lib/mfa/secrets";
import {
  generateRecoveryCodes,
  generateTotpSecret,
} from "@/lib/mfa/totp";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("security step-up consumes one recovery code before a sensitive mutation", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const recoveryCode = generateRecoveryCodes(1)[0];
  const now = new Date();
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'MFA step-up', ${`mfa-step-up-${organizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId}, ${`mfa-step-up-${userId}@example.test`},
        'test-password-hash', 'MFA', 'Owner', 'owner', 'active'
      )
    `;
    const secret = generateTotpSecret();
    await sql`
      insert into user_mfa_configurations (
        user_id, organization_id, status, secret_encrypted,
        recovery_code_hashes, last_totp_counter, enabled_at, created_at,
        updated_at
      ) values (
        ${userId}, ${organizationId}, 'enabled',
        ${sql.json(encryptMfaSecret(secret, organizationId, userId))},
        ${[hashRecoveryCode(recoveryCode, organizationId, userId)]},
        0, ${now}, ${now}, ${now}
      )
    `;

    await assert.rejects(
      verifyAndConsumeMfaSecurityStepUp(
        { id: userId, organizationId },
        "invalid-code",
      ),
      (error) =>
        error instanceof MfaSecurityStepUpError && error.code === "invalid",
    );

    const result = await verifyAndConsumeMfaSecurityStepUp(
      { id: userId, organizationId },
      recoveryCode,
    );
    assert.deepEqual(result, { required: true, method: "recovery" });
    const [stored] = await sql<
      Array<{ recoveryCodes: string[]; stepUps: number }>
    >`
      select recovery_code_hashes as "recoveryCodes",
        (
          select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and user_id = ${userId}
            and type = 'security.mfa.step_up'
        ) as "stepUps"
      from user_mfa_configurations
      where user_id = ${userId}
    `;
    assert.deepEqual(stored.recoveryCodes, []);
    assert.equal(stored.stepUps, 1);

    await assert.rejects(
      verifyAndConsumeMfaSecurityStepUp(
        { id: userId, organizationId },
        recoveryCode,
      ),
      (error) =>
        error instanceof MfaSecurityStepUpError && error.code === "invalid",
    );
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
