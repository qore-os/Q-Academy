import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { db, postgresClient } from "../src/db/index";
import {
  activityEvents,
  userMfaConfigurations,
} from "../src/db/schema";
import {
  lockAndRevalidateMfaActor,
  MfaActorRevalidationError,
} from "../src/lib/mfa/management-security";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

function revalidationFailure(error: unknown) {
  return error instanceof MfaActorRevalidationError;
}

test("locked MFA actor rejects password, role, status and OIDC proof races", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const identityId = randomUUID();
  const sessionId = randomUUID();
  const now = new Date();
  const passwordHash = "password-snapshot-v1";
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'MFA revalidation', ${`mfa-revalidation-${organizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId}, ${`mfa-revalidation-${userId}@example.test`},
        ${passwordHash}, 'MFA', 'Revalidation', 'admin', 'active'
      )
    `;

    const actor = { id: userId, organizationId };
    const passwordProof = {
      method: "password" as const,
      passwordHash,
    };
    const verified = await db.transaction((tx) =>
      lockAndRevalidateMfaActor(tx, {
        actor,
        proof: passwordProof,
        requiredRole: "privileged",
        now,
      }),
    );
    assert.equal(verified.id, userId);

    await sql`update users set password_hash = 'password-snapshot-v2' where id = ${userId}`;
    await assert.rejects(
      db.transaction((tx) =>
        lockAndRevalidateMfaActor(tx, {
          actor,
          proof: passwordProof,
          requiredRole: "privileged",
          now,
        }),
      ),
      revalidationFailure,
    );

    await sql`update users set role = 'trainer' where id = ${userId}`;
    const trainerVerified = await db.transaction((tx) =>
        lockAndRevalidateMfaActor(tx, {
          actor,
          proof: { method: "password", passwordHash: "password-snapshot-v2" },
          requiredRole: "privileged",
          now,
        }),
      );
    assert.equal(trainerVerified.role, "trainer");

    await sql`update users set role = 'member' where id = ${userId}`;
    await assert.rejects(
      db.transaction((tx) =>
        lockAndRevalidateMfaActor(tx, {
          actor,
          proof: { method: "password", passwordHash: "password-snapshot-v2" },
          requiredRole: "privileged",
          now,
        }),
      ),
      revalidationFailure,
    );
    await sql`update users set role = 'admin', status = 'disabled' where id = ${userId}`;
    await assert.rejects(
      db.transaction((tx) =>
        lockAndRevalidateMfaActor(tx, {
          actor,
          proof: { method: "password", passwordHash: "password-snapshot-v2" },
          requiredRole: "privileged",
          now,
        }),
      ),
      revalidationFailure,
    );
    await sql`update users set status = 'active' where id = ${userId}`;

    await sql`
      insert into oidc_configurations (
        organization_id, enabled, issuer, client_id, client_secret_encrypted,
        password_login_enabled, version
      ) values (
        ${organizationId}, true, 'https://idp.example.test', 'mfa-client',
        ${sql.json({ v: 2, kid: "test", iv: "iv", tag: "tag", ciphertext: "ciphertext" })},
        false, 1
      )
    `;
    await sql`
      insert into oidc_identities (
        id, organization_id, user_id, issuer, subject, email_at_link,
        last_configuration_version
      ) values (
        ${identityId}, ${organizationId}, ${userId},
        'https://idp.example.test', 'mfa-subject',
        ${`mfa-revalidation-${userId}@example.test`}, 1
      )
    `;
    await sql`
      insert into user_sessions (
        id, organization_id, user_id, jti_hash, auth_method,
        oidc_identity_id, oidc_configuration_version, authenticated_at,
        oidc_auth_time, expires_at, last_seen_at
      ) values (
        ${sessionId}, ${organizationId}, ${userId},
        ${randomBytes(32).toString("hex")}, 'oidc', ${identityId}, 1,
        ${now}, ${now}, ${new Date(now.getTime() + 60 * 60_000)}, ${now}
      )
    `;
    const oidcProof = { method: "oidc" as const, sessionId };
    const oidcVerified = await db.transaction((tx) =>
      lockAndRevalidateMfaActor(tx, {
        actor,
        proof: oidcProof,
        requiredRole: "privileged",
        now,
      }),
    );
    assert.equal(oidcVerified.id, userId);

    await sql`update user_sessions set revoked_at = now() where id = ${sessionId}`;
    await assert.rejects(
      db.transaction((tx) =>
        lockAndRevalidateMfaActor(tx, {
          actor,
          proof: oidcProof,
          requiredRole: "privileged",
          now: new Date(),
        }),
      ),
      revalidationFailure,
    );
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});

test("shared per-user advisory lock serializes config and audit mutations", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const passwordHash = "serialized-password-snapshot";
  let releaseFirst!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstEntered!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    markFirstEntered = resolve;
  });
  let secondEntered = false;
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'MFA lock order', ${`mfa-lock-${organizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId}, ${`mfa-lock-${userId}@example.test`},
        ${passwordHash}, 'MFA', 'Lock', 'admin', 'active'
      )
    `;
    await sql`
      insert into user_mfa_configurations (
        user_id, organization_id, status, secret_encrypted,
        recovery_code_hashes
      ) values (
        ${userId}, ${organizationId}, 'pending',
        ${sql.json({ v: 2, kid: "test", iv: "iv", tag: "tag", ciphertext: "ciphertext" })},
        '{}'
      )
    `;

    const actor = { id: userId, organizationId };
    const proof = { method: "password" as const, passwordHash };
    const mutation = async (
      label: string,
      onLocked: () => Promise<void> | void,
    ) =>
      db.transaction(async (tx) => {
        const lockedActor = await lockAndRevalidateMfaActor(tx, {
          actor,
          proof,
          requiredRole: "privileged",
          now: new Date(),
        });
        await tx
          .select({ userId: userMfaConfigurations.userId })
          .from(userMfaConfigurations)
          .where(
            and(
              eq(userMfaConfigurations.userId, lockedActor.id),
              eq(
                userMfaConfigurations.organizationId,
                lockedActor.organizationId,
              ),
            ),
          )
          .limit(1)
          .for("update");
        await onLocked();
        await tx.insert(activityEvents).values({
          organizationId,
          userId,
          type: "security.mfa.lock_order_test",
          entityType: "user",
          entityId: userId,
          metadata: { label },
        });
      });

    const first = mutation("first", async () => {
      markFirstEntered();
      await release;
    });
    await firstEntered;
    const second = mutation("second", () => {
      secondEntered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(secondEntered, false);
    releaseFirst();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([first, second]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("MFA lock serialization timed out.")),
            5_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    assert.equal(secondEntered, true);
    const [auditCount] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from activity_events
      where organization_id = ${organizationId}
        and type = 'security.mfa.lock_order_test'
    `;
    assert.equal(auditCount?.count, 2);
  } finally {
    releaseFirst?.();
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
