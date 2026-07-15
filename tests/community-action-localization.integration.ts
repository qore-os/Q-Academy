import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import postgres from "postgres";

import { db, postgresClient } from "../src/db/index";
import { notifications } from "../src/db/schema";
import { resolveCommunityRecipientLocales } from "../src/lib/community-notification-locales";
import { syncCommunityMentions } from "../src/lib/community-mentions";
import { getCommunityNotificationCopy } from "../src/lib/i18n/community-actions";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("community moderation notifications persist in the recipient locale", async () => {
  const organizationId = randomUUID();
  const italianMemberId = randomUUID();
  const inheritedMemberId = randomUUID();
  try {
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId},
        'Community notification locale tenant',
        ${`community-locale-${organizationId.slice(0, 8)}`},
        'fr'
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
        (
          ${italianMemberId}, ${organizationId},
          ${`${italianMemberId}@example.test`}, 'unused', 'Italian', 'Member',
          'member', 'active', 'it'
        ),
        (
          ${inheritedMemberId}, ${organizationId},
          ${`${inheritedMemberId}@example.test`}, 'unused', 'French', 'Member',
          'member', 'active', null
        )
    `;

    const notificationIds = await db.transaction(async (tx) => {
      const recipients = [italianMemberId, inheritedMemberId];
      const locales = await resolveCommunityRecipientLocales(tx, {
        organizationId,
        userIds: recipients,
      });
      assert.equal(locales.get(italianMemberId), "it");
      assert.equal(locales.get(inheritedMemberId), "fr");
      const ids: string[] = [];
      for (const userId of recipients) {
        const locale = locales.get(userId);
        assert.ok(locale);
        const copy = getCommunityNotificationCopy(locale);
        const [stored] = await tx
          .insert(notifications)
          .values({
            userId,
            title: copy.reportHeldTitle,
            body: copy.reportHeldBody,
            type: "community",
            category: "community",
            href: "/academy/community",
          })
          .returning({ id: notifications.id });
        assert.ok(stored);
        ids.push(stored.id);
      }
      return ids;
    });

    const stored = await sql<Array<{ user_id: string; title: string }>>`
      select user_id, title
      from notifications
      where id = any(${notificationIds}::uuid[])
      order by user_id
    `;
    const byUser = new Map(stored.map((row) => [row.user_id, row.title]));
    assert.equal(
      byUser.get(italianMemberId),
      getCommunityNotificationCopy("it").reportHeldTitle,
    );
    assert.equal(
      byUser.get(inheritedMemberId),
      getCommunityNotificationCopy("fr").reportHeldTitle,
    );
    assert.notEqual(byUser.get(italianMemberId), byUser.get(inheritedMemberId));
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});

test("community mention notifications use the recipient locale and stay idempotent", async () => {
  const organizationId = randomUUID();
  const areaId = randomUUID();
  const spaceId = randomUUID();
  const postId = randomUUID();
  const authorId = randomUUID();
  const mentionedMemberId = randomUUID();
  const suffix = organizationId.slice(0, 8);
  const mentionHandle = `mentioned${suffix}`;
  const authorName = "Authored Name Sentinel";
  const content = `Welcome @${mentionHandle}`;
  try {
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId},
        'Community mention locale tenant',
        ${`community-mention-${suffix}`},
        'en'
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
        (
          ${authorId}, ${organizationId},
          ${`author${suffix}@example.test`}, 'unused', 'Author', 'Member',
          'member', 'active', 'en'
        ),
        (
          ${mentionedMemberId}, ${organizationId},
          ${`${mentionHandle}@example.test`}, 'unused', 'Mentioned', 'Member',
          'member', 'active', 'it'
        )
    `;
    await sql`
      insert into community_areas (id, organization_id, title, slug, sort_order)
      values (${areaId}, ${organizationId}, 'General', 'general', 0)
    `;
    await sql`
      insert into community_spaces (
        id, organization_id, area_id, title, slug, access_mode, sort_order
      ) values (
        ${spaceId}, ${organizationId}, ${areaId}, 'Open space', 'open-space',
        'open', 0
      )
    `;
    await sql`
      insert into posts (
        id, organization_id, space_id, author_id, title, content,
        moderation_state, published_at
      ) values (
        ${postId}, ${organizationId}, ${spaceId}, ${authorId}, 'Mention test',
        ${content}, 'published', now()
      )
    `;

    const firstResult = await db.transaction((tx) =>
      syncCommunityMentions(tx, {
        organizationId,
        postId,
        mentionedById: authorId,
        mentionedByName: authorName,
        content,
      }),
    );
    const secondResult = await db.transaction((tx) =>
      syncCommunityMentions(tx, {
        organizationId,
        postId,
        mentionedById: authorId,
        mentionedByName: authorName,
        content,
      }),
    );

    assert.deepEqual(
      firstResult.map((candidate) => candidate.id),
      [mentionedMemberId],
    );
    assert.deepEqual(
      secondResult.map((candidate) => candidate.id),
      [mentionedMemberId],
    );
    const stored = await sql<Array<{ title: string; body: string }>>`
      select title, body
      from notifications
      where user_id = ${mentionedMemberId}
        and category = 'community'
        and href = ${`/academy/community?post=${postId}#post-${postId}`}
      order by created_at
    `;
    const copy = getCommunityNotificationCopy("it");
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.title, copy.mentionTitle);
    assert.equal(stored[0]?.body, copy.mentionBody(authorName));
    assert.match(stored[0]?.body ?? "", new RegExp(authorName));
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
