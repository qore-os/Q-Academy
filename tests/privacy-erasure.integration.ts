import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { db, postgresClient } from "../src/db/index";
import { mediaAssets } from "../src/db/schema";
import {
  applyMemberErasure,
  buildMemberErasureMediaPlan,
  purgeMemberErasureMedia,
} from "../src/lib/privacy/erasure-executor";
import {
  createMediaObjectKey,
  createMediaStagingObjectKey,
} from "../src/lib/media/storage-key";
import { writeDevelopmentMediaObject } from "../src/lib/media/storage";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("member erasure purges tenant media and pseudonymizes retained identity", async () => {
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const subjectUserId = randomUUID();
  const foreignUserId = randomUUID();
  const assetId = randomUUID();
  const foreignAssetId = randomUUID();
  const communityAreaId = randomUUID();
  const communitySpaceId = randomUUID();
  const communityPostId = randomUUID();
  const communityCommentId = randomUUID();
  const bytes = Buffer.from("private member avatar\n", "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const subjectReference = "a".repeat(64);
  const now = new Date();

  const storageKey = createMediaObjectKey({
    organizationId,
    assetId,
    safeFileName: "ready.txt",
  });
  const stagingStorageKey = createMediaStagingObjectKey({
    organizationId,
    assetId,
    safeFileName: "incoming.txt",
  });
  const foreignStorageKey = createMediaObjectKey({
    organizationId: foreignOrganizationId,
    assetId: foreignAssetId,
    safeFileName: "ready.txt",
  });
  const foreignStagingKey = createMediaStagingObjectKey({
    organizationId: foreignOrganizationId,
    assetId: foreignAssetId,
    safeFileName: "incoming.txt",
  });
  assert.ok(storageKey && stagingStorageKey && foreignStorageKey && foreignStagingKey);

  try {
    await sql`
      insert into organizations (id, name, slug) values
        (${organizationId}, 'Erasure tenant', ${`erasure-${organizationId.slice(0, 8)}`}),
        (${foreignOrganizationId}, 'Foreign tenant', ${`foreign-erasure-${foreignOrganizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (id, organization_id, email, password_hash, first_name, last_name, role, status) values
        (${subjectUserId}, ${organizationId}, ${`subject-${subjectUserId}@example.test`}, 'credential', 'Personal', 'Member', 'member', 'active'),
        (${foreignUserId}, ${foreignOrganizationId}, ${`foreign-${foreignUserId}@example.test`}, 'credential', 'Foreign', 'Member', 'member', 'active')
    `;
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
        content_sha256, upload_expires_at, uploaded_at, scan_completed_at
      ) values
        (${assetId}, ${organizationId}, ${subjectUserId}, ${subjectUserId}, 'avatar', 'document',
         'ready', 'filesystem', ${storageKey}, ${stagingStorageKey}, 'personal.txt', 'personal.txt',
         'text/plain', 'text/plain', ${bytes.byteLength}, ${bytes.byteLength}, ${bytes.byteLength},
         ${digest}, now() + interval '1 hour', now(), now()),
        (${foreignAssetId}, ${foreignOrganizationId}, ${foreignUserId}, ${foreignUserId}, 'avatar', 'document',
         'ready', 'filesystem', ${foreignStorageKey}, ${foreignStagingKey}, 'foreign.txt', 'foreign.txt',
         'text/plain', 'text/plain', ${bytes.byteLength}, ${bytes.byteLength}, ${bytes.byteLength},
         ${digest}, now() + interval '1 hour', now(), now())
    `;
    await writeDevelopmentMediaObject({
      identity: { organizationId, assetId, key: storageKey },
      body: (async function* () {
        yield bytes;
      })(),
      expectedSizeBytes: bytes.byteLength,
    });
    await sql`
      insert into user_sessions (organization_id, user_id, jti_hash, expires_at)
      values (${organizationId}, ${subjectUserId}, ${"b".repeat(64)}, now() + interval '1 hour')
    `;
    await sql`
      insert into activity_events (organization_id, user_id, type, entity_type, entity_id, metadata)
      values (${organizationId}, ${subjectUserId}, 'fixture', 'user', ${subjectUserId}, ${sql.json({ email: "personal@example.test" })})
    `;
    await sql`
      insert into community_areas (id, organization_id, title, slug, sort_order)
      values (${communityAreaId}, ${organizationId}, 'Erasure area', 'erasure-area', 0)
    `;
    await sql`
      insert into community_spaces (
        id, organization_id, area_id, title, slug, type, sort_order
      ) values (
        ${communitySpaceId}, ${organizationId}, ${communityAreaId},
        'Erasure discussion', 'erasure-discussion', 'discussion', 0
      )
    `;
    await sql`
      insert into posts (
        id, organization_id, space_id, author_id, title, content,
        content_format, rich_text, content_projection_version
      ) values (
        ${communityPostId}, ${organizationId}, ${communitySpaceId},
        ${subjectUserId}, 'Personal post', 'Personal rich post', 'rich_text',
        ${sql.json({
          version: 1,
          blocks: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Personal rich post" }],
            },
          ],
        })}, 1
      )
    `;
    await sql`
      insert into comments (
        id, organization_id, post_id, author_id, content, content_format,
        rich_text, content_projection_version
      ) values (
        ${communityCommentId}, ${organizationId}, ${communityPostId},
        ${subjectUserId}, 'Personal rich comment', 'rich_text',
        ${sql.json({
          version: 1,
          blocks: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Personal rich comment" }],
            },
          ],
        })}, 1
      )
    `;

    const plan = await buildMemberErasureMediaPlan({
      sql,
      organizationId,
      subjectUserId,
      snapshotAt: new Date(now.getTime() + 60_000),
    });
    assert.deepEqual(plan.purge.map(({ id }) => id), [assetId]);
    assert.equal(plan.retainShared.length, 0);
    await purgeMemberErasureMedia(plan);
    const result = await db.transaction((tx) =>
      applyMemberErasure({
        tx,
        organizationId,
        subjectUserId,
        subjectReference,
        mediaPlan: plan,
        now: new Date(),
      }),
    );
    assert.equal(result.purgedMedia, 1);
    assert.ok(result.retentionExceptions.includes("privacy_audit_chain"));

    const [subject] = await sql<Array<Record<string, unknown>>>`
      select email, password_hash, first_name, last_name, status, avatar_url
      from users where id = ${subjectUserId} and organization_id = ${organizationId}
    `;
    assert.equal(subject?.email, `erased-${subjectReference.slice(0, 24)}@privacy.invalid`);
    assert.equal(subject?.first_name, "Deleted");
    assert.equal(subject?.last_name, "Member");
    assert.equal(subject?.status, "disabled");
    assert.equal(subject?.avatar_url, null);
    assert.notEqual(subject?.password_hash, "credential");

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.organizationId, organizationId),
        ),
      );
    assert.equal(asset?.status, "deleted");
    assert.equal(asset?.storageDeletedAt instanceof Date, true);
    assert.equal(asset?.stagingDeletedAt instanceof Date, true);
    assert.equal(asset?.ownerUserId, null);
    assert.equal(asset?.quotaBytes, bytes.byteLength);

    const [sessionCount] = await sql<Array<{ count: number }>>`
      select count(*)::integer as count from user_sessions where user_id = ${subjectUserId}
    `;
    assert.equal(sessionCount?.count, 0);
    const [erasedPost] = await sql<
      Array<{
        title: string | null;
        content: string;
        contentFormat: string;
        richText: unknown;
        contentProjectionVersion: number;
      }>
    >`
      select title, content, content_format as "contentFormat",
             rich_text as "richText",
             content_projection_version as "contentProjectionVersion"
      from posts
      where id = ${communityPostId} and organization_id = ${organizationId}
    `;
    assert.deepEqual(erasedPost, {
      title: null,
      content: "[removed]",
      contentFormat: "plain_text",
      richText: null,
      contentProjectionVersion: 1,
    });
    const [erasedComment] = await sql<
      Array<{
        content: string;
        contentFormat: string;
        richText: unknown;
        contentProjectionVersion: number;
      }>
    >`
      select content, content_format as "contentFormat",
             rich_text as "richText",
             content_projection_version as "contentProjectionVersion"
      from comments
      where id = ${communityCommentId} and organization_id = ${organizationId}
    `;
    assert.deepEqual(erasedComment, {
      content: "[removed]",
      contentFormat: "plain_text",
      richText: null,
      contentProjectionVersion: 1,
    });
    const [foreignUser] = await sql<Array<{ email: string; status: string }>>`
      select email, status from users where id = ${foreignUserId}
    `;
    assert.match(foreignUser!.email, /^foreign-/);
    assert.equal(foreignUser?.status, "active");
  } finally {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
  }
});

test("member erasure rejects media from an unavailable storage driver", async () => {
  const organizationId = randomUUID();
  const subjectUserId = randomUUID();
  const assetId = randomUUID();
  const storageKey = createMediaObjectKey({
    organizationId,
    assetId,
    safeFileName: "ready.txt",
  });
  const stagingStorageKey = createMediaStagingObjectKey({
    organizationId,
    assetId,
    safeFileName: "incoming.txt",
  });

  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'Unavailable storage tenant', ${`unavailable-storage-${organizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (id, organization_id, email, password_hash, first_name, last_name, role, status)
      values (${subjectUserId}, ${organizationId}, ${`unavailable-${subjectUserId}@example.test`}, 'credential', 'Storage', 'Member', 'member', 'active')
    `;
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        declared_size_bytes, quota_bytes, upload_expires_at
      ) values (
        ${assetId}, ${organizationId}, ${subjectUserId}, ${subjectUserId},
        'avatar', 'document', 'pending', 's3', ${storageKey},
        ${stagingStorageKey}, 'pending.txt', 'pending.txt', 'text/plain',
        1, 1, now() + interval '15 minutes'
      )
    `;

    await assert.rejects(
      buildMemberErasureMediaPlan({
        sql,
        organizationId,
        subjectUserId,
        snapshotAt: new Date(Date.now() + 60_000),
      }),
      new RegExp(`Media asset ${assetId} uses an unavailable storage driver`),
    );
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
