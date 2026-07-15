import assert from "node:assert/strict";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  getActiveAnnouncementsForUser,
  getAnnouncementForOrganization,
} from "../src/lib/announcements";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 3, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test(
  "announcement block documents remain tenant-isolated and learner-readable",
  { timeout: 120_000 },
  async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const organizations = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values
        (${`Content tenant ${suffix}`}, ${`content-tenant-${suffix}`}),
        (${`Content foreign ${suffix}`}, ${`content-foreign-${suffix}`})
      returning id
    `;
    const organizationId = organizations[0]!.id;
    const foreignOrganizationId = organizations[1]!.id;

    try {
      const users = await sql<Array<{ id: string; organization_id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (${organizationId}, ${`content-${suffix}@example.test`}, 'unused', 'Ada', 'Lovelace', 'member'),
          (${foreignOrganizationId}, ${`foreign-content-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', 'member')
        returning id, organization_id
      `;
      const member = users.find((entry) => entry.organization_id === organizationId)!;
      const foreign = users.find((entry) => entry.organization_id === foreignOrganizationId)!;
      const contentDocument = {
        version: 1,
        blocks: [
          {
            id: "00000000-0000-4000-8000-000000000031",
            type: "callout",
            tone: "success",
            title: "Hallo {{member.firstName}}",
            body: "Dein Kurs ist bereit.",
          },
          {
            id: "00000000-0000-4000-8000-000000000032",
            type: "cta",
            label: "Kurs fuer {{member.firstName}}",
            href: "/academy/courses",
            style: "primary",
          },
        ],
      };
      const [announcement] = await sql<Array<{ id: string }>>`
        insert into announcements (
          organization_id, title, body, content_document, href, action_label,
          audience, starts_at, active
        ) values (
          ${organizationId}, 'Tenant block content', 'Dein Kurs ist bereit.',
          ${sql.json(contentDocument)}, '/academy/courses', 'Kurs fuer {{member.firstName}}',
          'all', now() - interval '1 minute', true
        ) returning id
      `;

      await assert.rejects(
        getAnnouncementForOrganization(announcement!.id, foreignOrganizationId),
        /Ankuendigung nicht gefunden/,
      );
      assert.deepEqual(
        await getActiveAnnouncementsForUser(foreign.id, organizationId),
        [],
      );
      const visible = await getActiveAnnouncementsForUser(member.id, organizationId);
      assert.equal(visible.length, 1);
      assert.equal(visible[0]!.contentDocument.blocks[0]!.type, "callout");
      const serialized = JSON.stringify(visible[0]!.contentDocument);
      assert.match(serialized, /Hallo Ada/);
      assert.match(serialized, /Kurs fuer Ada/);
      assert.doesNotMatch(serialized, /Foreign/);
    } finally {
      await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
    }
  },
);
