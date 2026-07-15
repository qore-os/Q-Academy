import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { db, postgresClient } from "@/db";
import { transferOrganizationOwnershipInTransaction } from "@/lib/organization-ownership";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("ownership transfer is tenant-bound, atomic, audited, and revokes sessions", async () => {
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const foreignAdminId = randomUUID();
  const ownerSessionId = randomUUID();
  const adminSessionId = randomUUID();
  const passwordHash = `hash-${randomUUID()}`;

  try {
    await sql`
      insert into organizations (id, name, slug) values
        (${organizationId}, 'Ownership tenant', ${`ownership-${organizationId.slice(0, 8)}`}),
        (${foreignOrganizationId}, 'Foreign ownership tenant', ${`ownership-foreign-${foreignOrganizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name, role, status
      ) values
        (${ownerId}, ${organizationId}, ${`${ownerId}@example.test`}, ${passwordHash}, 'Current', 'Owner', 'owner', 'active'),
        (${adminId}, ${organizationId}, ${`${adminId}@example.test`}, 'admin-hash', 'Next', 'Owner', 'admin', 'active'),
        (${foreignAdminId}, ${foreignOrganizationId}, ${`${foreignAdminId}@example.test`}, 'foreign-hash', 'Foreign', 'Admin', 'admin', 'active')
    `;
    await sql`
      insert into user_sessions (
        id, organization_id, user_id, jti_hash, expires_at
      ) values
        (${ownerSessionId}, ${organizationId}, ${ownerId}, ${ownerSessionId.replaceAll("-", "").repeat(2)}, now() + interval '1 day'),
        (${adminSessionId}, ${organizationId}, ${adminId}, ${adminSessionId.replaceAll("-", "").repeat(2)}, now() + interval '1 day')
    `;

    await assert.rejects(
      db.transaction((tx) =>
        transferOrganizationOwnershipInTransaction(tx, {
          actor: { id: ownerId, organizationId, passwordHash },
          targetUserId: foreignAdminId,
        }),
      ),
      /Zielkonto wurde nicht gefunden/,
    );

    const transferredAt = new Date("2026-07-13T10:00:00.000Z");
    const result = await db.transaction((tx) =>
      transferOrganizationOwnershipInTransaction(tx, {
        actor: { id: ownerId, organizationId, passwordHash },
        targetUserId: adminId,
        now: transferredAt,
      }),
    );
    assert.equal(result.previousOwnerId, ownerId);
    assert.equal(result.nextOwnerId, adminId);

    const accounts = await sql<
      Array<{ id: string; role: string; revoked_at: Date | null }>
    >`
      select account.id, account.role, session.revoked_at
      from users account
      left join user_sessions session on session.user_id = account.id
      where account.organization_id = ${organizationId}
      order by account.id
    `;
    assert.deepEqual(
      new Map(accounts.map((account) => [account.id, account.role])),
      new Map([
        [ownerId, "admin"],
        [adminId, "owner"],
      ]),
    );
    assert.equal(
      accounts.every(
        (account) => account.revoked_at?.toISOString() === transferredAt.toISOString(),
      ),
      true,
    );

    const [audit] = await sql<Array<{ metadata: Record<string, string> }>>`
      select metadata
      from activity_events
      where organization_id = ${organizationId}
        and type = 'organization.owner_transferred'
    `;
    assert.equal(audit?.metadata.previousOwnerId, ownerId);
    assert.equal(audit?.metadata.nextOwnerId, adminId);

    await assert.rejects(
      db.transaction((tx) =>
        transferOrganizationOwnershipInTransaction(tx, {
          actor: { id: ownerId, organizationId, passwordHash },
          targetUserId: adminId,
        }),
      ),
      /Owner-Berechtigung hat sich geaendert/,
    );
  } finally {
    await sql`
      delete from organizations
      where id in (${organizationId}, ${foreignOrganizationId})
    `;
  }
});
