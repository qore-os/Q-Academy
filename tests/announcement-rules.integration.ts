import assert from "node:assert/strict";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  assertAnnouncementTargetRuleSetTargets,
  dismissAnnouncementForUser,
  getActiveAnnouncementsForUser,
  previewAnnouncementAudience,
  recordAnnouncementInteractions,
} from "../src/lib/announcements";
import type { AnnouncementTargetRuleSet } from "../src/lib/announcement-rules";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 4, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test(
  "announcement targeting is tenant-safe and interactions are exactly once",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const organizations = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values
        (${`Announcement rules ${suffix}`}, ${`announcement-rules-${suffix}`}),
        (${`Foreign announcement rules ${suffix}`}, ${`foreign-announcement-rules-${suffix}`})
      returning id
    `;
    const organizationId = organizations[0]!.id;
    const foreignOrganizationId = organizations[1]!.id;

    try {
      const members = await sql<Array<{ id: string; email: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${organizationId}, ${`target-${suffix}@example.test`}, 'unused', 'Target', 'Member', 'member'),
          (${organizationId}, ${`other-${suffix}@example.test`}, 'unused', 'Other', 'Member', 'member'),
          (${foreignOrganizationId}, ${`foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', 'member')
        returning id, email
      `;
      const target = members.find((member) => member.email.startsWith("target-"))!;
      const foreign = members.find((member) => member.email.startsWith("foreign-"))!;
      const groups = await sql<Array<{ id: string; organization_id: string }>>`
        insert into groups (organization_id, name)
        values
          (${organizationId}, ${`Target group ${suffix}`}),
          (${foreignOrganizationId}, ${`Foreign group ${suffix}`})
        returning id, organization_id
      `;
      const group = groups.find((entry) => entry.organization_id === organizationId)!;
      const foreignGroup = groups.find(
        (entry) => entry.organization_id === foreignOrganizationId,
      )!;
      await sql`
        insert into group_members (group_id, user_id)
        values (${group.id}, ${target.id})
      `;
      const [bundle] = await sql<Array<{ id: string }>>`
        insert into bundles (organization_id, name)
        values (${organizationId}, ${`Target bundle ${suffix}`})
        returning id
      `;
      await sql`
        insert into member_bundles (user_id, bundle_id)
        values (${target.id}, ${bundle!.id})
      `;
      const [course] = await sql<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description, status
        ) values (
          ${organizationId}, ${`Target course ${suffix}`},
          ${`target-course-${suffix}`}, 'Targeting test', 'Targeting test', 'published'
        ) returning id
      `;
      await sql`
        insert into course_access_grants (
          organization_id, user_id, course_id, source
        ) values (${organizationId}, ${target.id}, ${course!.id}, 'direct:test')
      `;
      await sql`
        insert into enrollments (user_id, course_id, status, progress)
        values (${target.id}, ${course!.id}, 'in_progress', 70)
      `;

      const targetRuleSet: AnnouncementTargetRuleSet = {
        version: 1,
        conjunction: "and",
        conditions: [
          { type: "role", role: "member" },
          { type: "group", groupId: group.id, match: "member" },
          { type: "bundle", bundleId: bundle!.id, match: "member" },
          { type: "course_access", courseId: course!.id, access: "granted" },
          {
            type: "course_progress",
            courseId: course!.id,
            comparison: "at_least",
            percent: 50,
            maxPercent: null,
          },
        ],
      };
      const preview = await previewAnnouncementAudience({
        organizationId,
        audience: "all",
        audienceId: null,
        targetRuleSet,
      });
      assert.equal(preview.count, 1);
      assert.equal(preview.sample[0]?.id, target.id);

      await assert.rejects(
        assertAnnouncementTargetRuleSetTargets(organizationId, {
          version: 1,
          conjunction: "and",
          conditions: [
            { type: "group", groupId: foreignGroup.id, match: "member" },
          ],
        }),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              "status" in error &&
              error.status === 404,
          ),
      );

      const [announcement] = await sql<Array<{ id: string }>>`
        insert into announcements (
          organization_id, title, body, audience, target_rule_set, href,
          starts_at, dismissible, active
        ) values (
          ${organizationId}, ${`Target announcement ${suffix}`}, 'Targeted body',
          'all', ${sql.json(targetRuleSet)}, '/academy/courses', now() - interval '1 minute',
          true, true
        ) returning id
      `;
      await sql`
        insert into announcements (
          organization_id, title, body, audience, target_rule_set,
          starts_at, dismissible, active
        ) values (
          ${organizationId}, ${`Invalid target announcement ${suffix}`},
          'Must fail closed', 'all',
          ${sql.json({
            version: 1,
            conjunction: "and",
            conditions: [{ type: "future_rule" }],
          })},
          now() - interval '1 minute', true, true
        )
      `;
      assert.deepEqual(
        (await getActiveAnnouncementsForUser(target.id, organizationId)).map(
          (entry) => entry.id,
        ),
        [announcement!.id],
      );
      assert.deepEqual(
        await getActiveAnnouncementsForUser(foreign.id, organizationId),
        [],
      );

      await Promise.all(
        Array.from({ length: 4 }, () =>
          recordAnnouncementInteractions({
            organizationId,
            userId: target.id,
            announcementIds: [announcement!.id],
            kind: "impression",
          }),
        ),
      );
      await Promise.all(
        Array.from({ length: 3 }, () =>
          recordAnnouncementInteractions({
            organizationId,
            userId: target.id,
            announcementIds: [announcement!.id],
            kind: "click",
          }),
        ),
      );
      await Promise.all(
        Array.from({ length: 3 }, () =>
          dismissAnnouncementForUser({
            organizationId,
            userId: target.id,
            announcementId: announcement!.id,
          }),
        ),
      );
      const interactions = await sql<
        Array<{ kind: string; count: number }>
      >`
        select kind, count(*)::integer as count
        from announcement_interactions
        where announcement_id = ${announcement!.id}
        group by kind
        order by kind
      `;
      assert.deepEqual([...interactions], [
        { kind: "click", count: 1 },
        { kind: "dismiss", count: 1 },
        { kind: "impression", count: 1 },
      ]);
      assert.equal(
        (await getActiveAnnouncementsForUser(target.id, organizationId)).length,
        0,
      );

      await assert.rejects(
        sql`
          insert into announcement_interactions (
            organization_id, announcement_id, user_id, kind
          ) values (
            ${organizationId}, ${announcement!.id}, ${foreign.id}, 'impression'
          )
        `,
        /announcement_interactions_user_tenant_fk/,
      );
    } finally {
      await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    }
  },
);
