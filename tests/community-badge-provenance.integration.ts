import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(() => sql.end());

async function badgeCommand(input: {
  token: string;
  method: "PUT" | "DELETE";
  memberId: string;
  badgeId: string;
  body?: Record<string, unknown>;
}) {
  return fetch(
    `${baseUrl}/api/v1/members/${input.memberId}/badges/${input.badgeId}`,
    {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
}

test(
  "badge API preserves automatic provenance and permits manual lifecycle",
  { timeout: 60_000 },
  async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const token = `qak_test_${randomBytes(28).toString("base64url")}`;
    let organizationId = "";
    try {
      const [organization] = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`Badge QA ${suffix}`}, ${`badge-qa-${suffix}`})
        returning id
      `;
      organizationId = organization!.id;
      const users = await sql<Array<{ id: string; role: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${organizationId}, ${`owner-${suffix}@example.test`}, 'unused', 'QA', 'Owner', 'owner'),
          (${organizationId}, ${`member-${suffix}@example.test`}, 'unused', 'QA', 'Member', 'member')
        returning id, role
      `;
      const ownerId = users.find((user) => user.role === "owner")!.id;
      const memberId = users.find((user) => user.role === "member")!.id;
      const badges = await sql<Array<{ id: string; automatic: boolean }>>`
        insert into badge_definitions (
          organization_id, name, slug, description, points_threshold
        ) values
          (${organizationId}, 'Automatic QA', ${`automatic-${suffix}`}, 'Automatic badge', 5),
          (${organizationId}, 'Manual QA', ${`manual-${suffix}`}, 'Manual badge', null)
        returning id, points_threshold is not null as automatic
      `;
      const automaticBadgeId = badges.find((badge) => badge.automatic)!.id;
      const manualBadgeId = badges.find((badge) => !badge.automatic)!.id;
      await sql`
        insert into user_badges (organization_id, user_id, badge_id, source)
        values (${organizationId}, ${memberId}, ${automaticBadgeId}, 'points:10')
      `;
      await sql`
        insert into api_keys (
          organization_id, name, prefix, key_hash, scopes, created_by_id
        ) values (
          ${organizationId}, 'Badge QA', 'qak_test',
          ${createHash("sha256").update(token).digest("hex")},
          array['community:write', 'members:write'], ${ownerId}
        )
      `;

      const overwrite = await badgeCommand({
        token,
        method: "PUT",
        memberId,
        badgeId: automaticBadgeId,
        body: { source: "manual:api" },
      });
      assert.equal(overwrite.status, 409);
      const automaticDelete = await badgeCommand({
        token,
        method: "DELETE",
        memberId,
        badgeId: automaticBadgeId,
      });
      assert.equal(automaticDelete.status, 409);
      const [automatic] = await sql<Array<{ source: string | null }>>`
        select source from user_badges
        where user_id = ${memberId} and badge_id = ${automaticBadgeId}
      `;
      assert.equal(automatic?.source, "points:10");

      const manualAward = await badgeCommand({
        token,
        method: "PUT",
        memberId,
        badgeId: manualBadgeId,
        body: { source: "manual:api" },
      });
      assert.equal(manualAward.status, 200);
      const manualDelete = await badgeCommand({
        token,
        method: "DELETE",
        memberId,
        badgeId: manualBadgeId,
      });
      assert.equal(manualDelete.status, 200);
      const [manual] = await sql<Array<{ count: number }>>`
        select count(*)::int as count from user_badges
        where user_id = ${memberId} and badge_id = ${manualBadgeId}
      `;
      assert.equal(manual?.count, 0);
    } finally {
      if (organizationId) {
        await sql`delete from organizations where id = ${organizationId}`;
      }
    }
  },
);
