import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import postgres from "postgres";
import { postgresClient } from "@/db";
import {
  assignTeamRole,
  createTeamRole,
  getTeamAccessForUser,
  updateTeamRole,
} from "@/lib/team-permissions";
import { ApiError } from "@/lib/api/errors";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("custom-role mutations stay tenant isolated and owners stay immutable", async (t) => {
  const [readiness] = await sql<{ exists: boolean }[]>`
    select to_regclass('public.team_roles') is not null
      and to_regclass('public.team_role_assignments') is not null as exists
  `;
  if (!readiness?.exists) {
    t.skip("Consolidated team-role migration has not been applied yet.");
    return;
  }

  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const ownerAId = randomUUID();
  const ownerBId = randomUUID();
  const adminAId = randomUUID();
  const adminBId = randomUUID();
  const ownerA = {
    id: ownerAId,
    organizationId: organizationA,
    role: "owner" as const,
    status: "active" as const,
  };
  const ownerB = {
    id: ownerBId,
    organizationId: organizationB,
    role: "owner" as const,
    status: "active" as const,
  };
  try {
    await sql`
      insert into organizations (id, name, slug) values
        (${organizationA}, 'Role tenant A', ${`role-a-${organizationA.slice(0, 8)}`}),
        (${organizationB}, 'Role tenant B', ${`role-b-${organizationB.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name, role, status
      ) values
        (${ownerAId}, ${organizationA}, ${`${ownerAId}@example.test`}, 'hash', 'Owner', 'A', 'owner', 'active'),
        (${adminAId}, ${organizationA}, ${`${adminAId}@example.test`}, 'hash', 'Admin', 'A', 'admin', 'active'),
        (${ownerBId}, ${organizationB}, ${`${ownerBId}@example.test`}, 'hash', 'Owner', 'B', 'owner', 'active'),
        (${adminBId}, ${organizationB}, ${`${adminBId}@example.test`}, 'hash', 'Admin', 'B', 'admin', 'active')
    `;
    const role = await createTeamRole(ownerA, {
      name: "Integration Team",
      description: null,
      color: "#2b9188",
      permissions: ["integrations.manage"],
    });

    await assert.rejects(
      assignTeamRole(ownerA, role.id, adminBId),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    await assert.rejects(
      assignTeamRole(ownerA, role.id, ownerAId),
      (error: unknown) => error instanceof ApiError && error.status === 403,
    );
    await assert.rejects(
      updateTeamRole(ownerB, role.id, {
        revision: role.revision,
        name: "Cross tenant overwrite",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );

    await assignTeamRole(ownerA, role.id, adminAId);
    const access = await getTeamAccessForUser({
      id: adminAId,
      organizationId: organizationA,
      role: "admin",
    });
    assert.deepEqual(access.permissions, ["integrations.manage"]);
    assert.equal(access.customRole?.id, role.id);

    await assert.rejects(
      sql`
        insert into team_role_assignments (
          organization_id, user_id, role_id, assigned_by_id
        ) values (${organizationB}, ${adminBId}, ${role.id}, ${ownerBId})
      `,
    );
  } finally {
    await sql`delete from organizations where id in (${organizationA}, ${organizationB})`;
  }
});

