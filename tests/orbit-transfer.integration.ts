import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, eq } from "drizzle-orm";
import postgres from "postgres";

import { db, postgresClient } from "../src/db/index";
import {
  courses,
  mediaAssets,
  users,
  type User,
} from "../src/db/schema";
import { publishCourseVersion } from "../src/lib/api/course-versioning";
import {
  deleteStoredMediaObject,
  inspectStoredMediaObject,
  writeDevelopmentMediaObject,
} from "../src/lib/media/storage";
import { processMediaMaintenanceQueues } from "../src/lib/media/scan-worker";
import {
  createMediaObjectKey,
  createMediaStagingObjectKey,
  type MediaObjectIdentity,
} from "../src/lib/media/storage-key";
import {
  createOrbitTransfer,
  preflightOrbitTransfer,
} from "../src/lib/orbit/transfer";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 4, prepare: false });

type Fixture = {
  sourceOrganizationId: string;
  targetOrganizationId: string;
  sourceUserId: string;
  targetUserId: string;
  workspaceId: string;
  accountId: string;
  courseId: string;
  sourceVideoId: string;
  sourceMedia: Array<{
    id: string;
    identity: MediaObjectIdentity;
  }>;
};

async function writeObject(identity: MediaObjectIdentity, bytes: Buffer) {
  async function* body() {
    yield bytes;
  }
  await writeDevelopmentMediaObject({
    identity,
    body: body(),
    expectedSizeBytes: bytes.byteLength,
  });
}

async function createFixture(): Promise<Fixture> {
  const sourceOrganizationId = randomUUID();
  const targetOrganizationId = randomUUID();
  const sourceUserId = randomUUID();
  const targetUserId = randomUUID();
  const workspaceId = randomUUID();
  const accountId = randomUUID();
  const courseId = randomUUID();
  const moduleId = randomUUID();
  const lessonId = randomUUID();
  const videoId = randomUUID();
  const imageId = randomUUID();
  const videoBytes = Buffer.from("orbit video fixture\n", "utf8");
  const imageBytes = Buffer.from("orbit image fixture\n", "utf8");
  const sourceMedia = [
    {
      id: videoId,
      kind: "video",
      mimeType: "video/mp4",
      safeFileName: "orbit-video.mp4",
      bytes: videoBytes,
      durationMilliseconds: 12_000,
    },
    {
      id: imageId,
      kind: "image",
      mimeType: "image/webp",
      safeFileName: "orbit-image.webp",
      bytes: imageBytes,
      durationMilliseconds: null,
    },
  ] as const;

  await sql`
    insert into organizations (id, name, slug) values
      (
        ${sourceOrganizationId}, 'Orbit integration source',
        ${`orbit-integration-source-${sourceOrganizationId.slice(0, 8)}`}
      ),
      (
        ${targetOrganizationId}, 'Orbit integration target',
        ${`orbit-integration-target-${targetOrganizationId.slice(0, 8)}`}
      )
  `;
  await sql`
    insert into users (
      id, organization_id, email, password_hash, first_name, last_name,
      role, status
    ) values
      (
        ${sourceUserId}, ${sourceOrganizationId},
        ${`orbit-source-${sourceUserId}@example.test`}, 'credential',
        'Orbit', 'Source', 'owner', 'active'
      ),
      (
        ${targetUserId}, ${targetOrganizationId},
        ${`orbit-target-${targetUserId}@example.test`}, 'credential',
        'Orbit', 'Target', 'owner', 'active'
      )
  `;
  await sql`
    insert into orbit_accounts (id, email, display_name, status)
    values (
      ${accountId}, ${`orbit-${accountId}@example.test`},
      'Orbit integration operator', 'active'
    )
  `;
  await sql`
    insert into orbit_account_identities (
      account_id, organization_id, user_id
    ) values (${accountId}, ${sourceOrganizationId}, ${sourceUserId})
  `;
  await sql`
    insert into orbit_workspaces (id, name, slug, instance_slot_limit)
    values (
      ${workspaceId}, 'Orbit integration',
      ${`orbit-integration-${workspaceId.slice(0, 8)}`}, 2
    )
  `;
  await sql`
    insert into orbit_instances (
      workspace_id, organization_id, status, seat_limit, course_limit,
      entitlements
    ) values
      (
        ${workspaceId}, ${sourceOrganizationId}, 'active', 100, 100,
        array['content_transfer']::text[]
      ),
      (
        ${workspaceId}, ${targetOrganizationId}, 'active', 100, 100,
        array['content_transfer']::text[]
      )
  `;
  await sql`
    insert into orbit_workspace_memberships (
      workspace_id, account_id, role
    ) values (${workspaceId}, ${accountId}, 'owner')
  `;
  await sql`
    insert into courses (
      id, organization_id, title, slug, short_description, description,
      created_by_id
    ) values (
      ${courseId}, ${sourceOrganizationId}, 'Orbit media course',
      ${`orbit-media-${courseId.slice(0, 8)}`}, 'Short', 'Description',
      ${sourceUserId}
    )
  `;
  await sql`
    insert into modules (id, organization_id, title, is_reusable)
    values (${moduleId}, ${sourceOrganizationId}, 'Orbit media', false)
  `;
  await sql`
    insert into course_modules (
      organization_id, course_id, module_id, sort_order
    ) values (${sourceOrganizationId}, ${courseId}, ${moduleId}, 0)
  `;
  await sql`
    insert into lessons (
      id, organization_id, module_id, title, slug, sort_order, status
    ) values (
      ${lessonId}, ${sourceOrganizationId}, ${moduleId}, 'Media lesson',
      'media-lesson', 0, 'published'
    )
  `;

  const storedSourceMedia: Fixture["sourceMedia"] = [];
  for (const media of sourceMedia) {
    const storageKey = createMediaObjectKey({
      organizationId: sourceOrganizationId,
      assetId: media.id,
      safeFileName: media.safeFileName,
    })!;
    const stagingStorageKey = createMediaStagingObjectKey({
      organizationId: sourceOrganizationId,
      assetId: media.id,
      safeFileName: `${media.kind}.upload`,
    })!;
    const identity = {
      organizationId: sourceOrganizationId,
      assetId: media.id,
      key: storageKey,
    };
    await writeObject(identity, media.bytes);
    storedSourceMedia.push({ id: media.id, identity });
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, detected_mime_type,
        declared_size_bytes, actual_size_bytes, duration_milliseconds,
        quota_bytes, content_sha256, upload_expires_at, uploaded_at,
        scan_completed_at
      ) values (
        ${media.id}, ${sourceOrganizationId}, ${sourceUserId},
        'course_content', ${media.kind}, 'ready', 'filesystem', ${storageKey},
        ${stagingStorageKey}, ${media.safeFileName}, ${media.safeFileName},
        ${media.mimeType}, ${media.mimeType}, ${media.bytes.byteLength},
        ${media.bytes.byteLength}, ${media.durationMilliseconds},
        ${media.bytes.byteLength},
        ${createHash("sha256").update(media.bytes).digest("hex")},
        ${new Date(Date.now() + 24 * 60 * 60_000)}, now(), now()
      )
    `;
    await sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values (
        ${sourceOrganizationId}, ${courseId}, ${media.id}, ${sourceUserId}
      )
    `;
  }
  await sql`
    insert into content_blocks (
      lesson_id, type, title, sort_order, data
    ) values
      (
        ${lessonId}, 'video', 'Orbit video', 0,
        ${JSON.stringify({
          mediaAssetId: videoId,
          mediaAssetName: "orbit-video.mp4",
          caption: "",
          transcriptLanguage: "en",
          videoDescriptionIntent: "automatic",
        })}::jsonb
      ),
      (
        ${lessonId}, 'image', 'Orbit image', 1,
        ${JSON.stringify({
          mediaAssetId: imageId,
          mediaAssetName: "orbit-image.webp",
          imageUrl: `/api/media-assets/${imageId}/download`,
          caption: "Orbit image",
        })}::jsonb
      )
  `;

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  await db.transaction(async (transaction) => {
    await publishCourseVersion(transaction, {
      organizationId: sourceOrganizationId,
      course,
      changelog: "Orbit integration publication",
      publishedAt: new Date(),
      createdById: sourceUserId,
    });
  });

  return {
    sourceOrganizationId,
    targetOrganizationId,
    sourceUserId,
    targetUserId,
    workspaceId,
    accountId,
    courseId,
    sourceVideoId: videoId,
    sourceMedia: storedSourceMedia,
  };
}

async function removeFixture(fixture: Fixture) {
  const targetRows = await db
    .select({
      id: mediaAssets.id,
      organizationId: mediaAssets.organizationId,
      storageKey: mediaAssets.storageKey,
      stagingStorageKey: mediaAssets.stagingStorageKey,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.organizationId, fixture.targetOrganizationId));
  for (const source of fixture.sourceMedia) {
    await deleteStoredMediaObject(source.identity).catch(() => undefined);
  }
  for (const target of targetRows) {
    await Promise.all([
      deleteStoredMediaObject({
        organizationId: target.organizationId,
        assetId: target.id,
        key: target.storageKey,
      }).catch(() => undefined),
      deleteStoredMediaObject({
        organizationId: target.organizationId,
        assetId: target.id,
        key: target.stagingStorageKey,
      }).catch(() => undefined),
    ]);
  }
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set local session_replication_role = replica");
    await transaction`
      delete from orbit_audit_events where workspace_id = ${fixture.workspaceId}
    `;
    await transaction.unsafe("set local session_replication_role = origin");
    await transaction`
      delete from orbit_transfer_jobs where workspace_id = ${fixture.workspaceId}
    `;
    await transaction`
      delete from courses
      where organization_id in (
        ${fixture.sourceOrganizationId}, ${fixture.targetOrganizationId}
      )
    `;
    await transaction`
      delete from media_assets
      where organization_id in (
        ${fixture.sourceOrganizationId}, ${fixture.targetOrganizationId}
      )
    `;
    await transaction`
      delete from orbit_workspaces where id = ${fixture.workspaceId}
    `;
    await transaction`
      delete from orbit_accounts where id = ${fixture.accountId}
    `;
    await transaction`
      delete from organizations
      where id in (
        ${fixture.sourceOrganizationId}, ${fixture.targetOrganizationId}
      )
    `;
  });
}

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("createOrbitTransfer commits media, graph, one automatic thumbnail, and no phantom description job", async () => {
  const fixture = await createFixture();
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, fixture.sourceUserId),
          eq(users.organizationId, fixture.sourceOrganizationId),
        ),
      )
      .limit(1);
    const request = {
      sourceOrganizationId: fixture.sourceOrganizationId,
      targetOrganizationId: fixture.targetOrganizationId,
      sourceCourseIds: [fixture.courseId],
      authorMappings: [],
    };
    const preflight = await preflightOrbitTransfer(
      user as User,
      fixture.workspaceId,
      request,
    );
    assert.ok(preflight.confirmationToken);
    assert.equal(preflight.mediaAssetCount, 2);
    let result: Awaited<ReturnType<typeof createOrbitTransfer>>;
    try {
      result = await createOrbitTransfer({
        user: user as User,
        workspaceId: fixture.workspaceId,
        idempotencyKey: `orbit-integration-${randomUUID()}`,
        request: {
          ...request,
          confirmationToken: preflight.confirmationToken!,
          acceptedWarnings: preflight.warnings,
        },
      });
    } catch (error) {
      const cause = error instanceof Error ? error.cause : null;
      throw new Error(
        `Orbit transfer failed: ${cause instanceof Error ? `${cause.message} (${"code" in cause ? String(cause.code) : "unknown"})` : String(cause)}`,
        { cause: error },
      );
    }
    assert.equal(result.created, true);
    assert.equal(result.job.status, "completed");
    assert.equal(result.job.targetCourseIds.length, 1);

    const targetAssets = await sql<
      Array<{
        id: string;
        kind: string;
        status: string;
        storageKey: string;
      }>
    >`
      select id, kind, status, storage_key as "storageKey"
      from media_assets
      where organization_id = ${fixture.targetOrganizationId}
      order by kind, id
    `;
    assert.equal(targetAssets.length, 2);
    assert.deepEqual(
      targetAssets.map((asset) => [asset.kind, asset.status]),
      [
        ["image", "ready"],
        ["video", "ready"],
      ],
    );
    for (const asset of targetAssets) {
      const inspected = await inspectStoredMediaObject({
        organizationId: fixture.targetOrganizationId,
        assetId: asset.id,
        key: asset.storageKey,
      });
      assert.ok(inspected.sizeBytes > 0);
    }
    const [bindingCount] = await sql<[{ count: number }]>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.targetOrganizationId}
        and course_id = ${result.job.targetCourseIds[0]}
    `;
    assert.equal(bindingCount.count, 2);
    const targetVideo = targetAssets.find((asset) => asset.kind === "video");
    assert.ok(targetVideo);
    assert.notEqual(targetVideo.id, fixture.sourceVideoId);
    const thumbnailJobs = await sql<
      Array<{ sourceAssetId: string; atMilliseconds: number; status: string }>
    >`
      select job.source_asset_id as "sourceAssetId",
             (job.options ->> 'atMilliseconds')::int as "atMilliseconds",
             job.status
      from media_processing_jobs job
      join media_assets asset on asset.id = job.source_asset_id
      where job.organization_id = ${fixture.targetOrganizationId}
        and job.type = 'thumbnail'
        and asset.kind = 'video'
      order by (job.options ->> 'atMilliseconds')::int
    `;
    assert.deepEqual(
      [...thumbnailJobs],
      [0].map((atMilliseconds) => ({
        sourceAssetId: targetVideo.id,
        atMilliseconds,
        status: "queued",
      })),
    );
    const targetVideoBlocks = await sql<
      Array<{
        id: string;
        title: string;
        revision: number;
        data: {
          mediaAssetId?: string;
          caption?: string;
          transcriptLanguage?: string;
          videoDescriptionIntent?: string;
        };
      }>
    >`
      select block.id, block.title, block.revision, block.data
      from content_blocks block
      join lessons lesson on lesson.id = block.lesson_id
      join modules module on module.id = lesson.module_id
      where module.organization_id = ${fixture.targetOrganizationId}
        and block.type = 'video'
      order by block.sort_order
    `;
    assert.equal(targetVideoBlocks.length, 1);
    assert.equal(targetVideoBlocks[0]?.data.mediaAssetId, targetVideo.id);
    assert.equal(targetVideoBlocks[0]?.data.caption, "");
    assert.equal(targetVideoBlocks[0]?.data.videoDescriptionIntent, "touched");
    const [descriptionState] = await sql<
      [{ descriptions: number; transcripts: number }]
    >`
      select
        (select count(*)::int from video_description_jobs
         where organization_id = ${fixture.targetOrganizationId}) as descriptions,
        (select count(*)::int from media_processing_jobs
         where organization_id = ${fixture.targetOrganizationId}
           and type = 'transcript') as transcripts
    `;
    assert.deepEqual(descriptionState, { descriptions: 0, transcripts: 0 });
    const [nonVideoThumbnailCount] = await sql<[{ count: number }]>`
      select count(*)::int as count
      from media_processing_jobs job
      join media_assets asset on asset.id = job.source_asset_id
      where job.organization_id = ${fixture.targetOrganizationId}
        and job.type = 'thumbnail'
        and asset.kind <> 'video'
    `;
    assert.equal(nonVideoThumbnailCount.count, 0);
  } finally {
    await removeFixture(fixture);
  }
});

test("a final Orbit thumbnail failure leaves durable reservations that maintenance proves deleted", async () => {
  const fixture = await createFixture();
  const idempotencyKey = `orbit-failure-${randomUUID()}`;
  let triggerInstalled = false;
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, fixture.sourceUserId),
          eq(users.organizationId, fixture.sourceOrganizationId),
        ),
      )
      .limit(1);
    const request = {
      sourceOrganizationId: fixture.sourceOrganizationId,
      targetOrganizationId: fixture.targetOrganizationId,
      sourceCourseIds: [fixture.courseId],
      authorMappings: [],
    };
    const preflight = await preflightOrbitTransfer(
      user as User,
      fixture.workspaceId,
      request,
    );
    await sql.unsafe(`
      create or replace function q_test_fail_orbit_thumbnail()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.organization_id = '${fixture.targetOrganizationId}'::uuid
           and new.type = 'thumbnail' then
          raise exception 'injected Orbit thumbnail failure';
        end if;
        return new;
      end;
      $$
    `);
    await sql.unsafe(`
      create trigger q_test_fail_orbit_thumbnail
      before insert on media_processing_jobs
      for each row execute function q_test_fail_orbit_thumbnail()
    `);
    triggerInstalled = true;

    await assert.rejects(
      createOrbitTransfer({
        user: user as User,
        workspaceId: fixture.workspaceId,
        idempotencyKey,
        request: {
          ...request,
          confirmationToken: preflight.confirmationToken!,
          acceptedWarnings: preflight.warnings,
        },
      }),
      (error: unknown) => {
        let current = error;
        while (current instanceof Error) {
          if (current.message.includes("injected Orbit thumbnail failure")) {
            return true;
          }
          current = current.cause;
        }
        return false;
      },
    );
    await sql.unsafe(
      "drop trigger q_test_fail_orbit_thumbnail on media_processing_jobs",
    );
    await sql.unsafe("drop function q_test_fail_orbit_thumbnail() ");
    triggerInstalled = false;

    const [failed] = await sql<
      Array<{
        id: string;
        status: string;
        claimToken: string | null;
        leaseExpiresAt: Date | null;
        failureCode: string | null;
      }>
    >`
      select id, status, claim_token as "claimToken",
             lease_expires_at as "leaseExpiresAt",
             failure_code as "failureCode"
      from orbit_transfer_jobs
      where workspace_id = ${fixture.workspaceId}
        and idempotency_key = ${idempotencyKey}
    `;
    assert.equal(failed.status, "failed");
    assert.equal(failed.claimToken, null);
    assert.equal(failed.leaseExpiresAt, null);
    assert.equal(failed.failureCode, "transfer_execution_failed");
    const [graphState] = await sql<
      [{ courses: number; readyAssets: number; bindings: number; thumbnails: number }]
    >`
      select
        (select count(*)::int from courses
         where organization_id = ${fixture.targetOrganizationId}) as courses,
        (select count(*)::int from media_assets
         where organization_id = ${fixture.targetOrganizationId}
           and status = 'ready') as "readyAssets",
        (select count(*)::int from course_media_assets
         where organization_id = ${fixture.targetOrganizationId}) as bindings,
        (select count(*)::int from media_processing_jobs
         where organization_id = ${fixture.targetOrganizationId}
           and type = 'thumbnail') as thumbnails
    `;
    assert.deepEqual(graphState, {
      courses: 0,
      readyAssets: 0,
      bindings: 0,
      thumbnails: 0,
    });
    const reservations = await sql<
      Array<{
        id: string;
        storageKey: string;
        stagingStorageKey: string;
        status: string;
        quotaBytes: number;
      }>
    >`
      select id, storage_key as "storageKey",
             staging_storage_key as "stagingStorageKey", status,
             quota_bytes as "quotaBytes"
      from media_assets
      where organization_id = ${fixture.targetOrganizationId}
      order by id
    `;
    assert.equal(reservations.length, 2);
    assert.ok(reservations.every((reservation) => reservation.status === "pending"));
    assert.ok(reservations.every((reservation) => Number(reservation.quotaBytes) > 0));
    for (const reservation of reservations) {
      const stored = await inspectStoredMediaObject({
        organizationId: fixture.targetOrganizationId,
        assetId: reservation.id,
        key: reservation.storageKey,
      });
      assert.ok(stored.sizeBytes > 0);
    }

    await sql`
      update media_assets
      set upload_expires_at = now() - interval '2 hours',
          updated_at = now() - interval '2 hours'
      where organization_id = ${fixture.targetOrganizationId}
    `;
    await processMediaMaintenanceQueues(5);
    await sql`
      update media_assets
      set deleted_at = now() - interval '2 hours',
          updated_at = now() - interval '2 hours'
      where organization_id = ${fixture.targetOrganizationId}
        and status = 'deleted'
    `;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await processMediaMaintenanceQueues(5);
    }
    const cleaned = await sql<
      Array<{
        id: string;
        status: string;
        quotaBytes: number;
        storageDeletedAt: Date | null;
        stagingDeletedAt: Date | null;
      }>
    >`
      select id, status, quota_bytes as "quotaBytes",
             storage_deleted_at as "storageDeletedAt",
             staging_deleted_at as "stagingDeletedAt"
      from media_assets
      where organization_id = ${fixture.targetOrganizationId}
    `;
    assert.equal(cleaned.length, 2);
    assert.ok(
      cleaned.every(
        (asset) =>
          asset.status === "deleted" &&
          Number(asset.quotaBytes) === 0 &&
          asset.storageDeletedAt &&
          asset.stagingDeletedAt,
      ),
    );
    for (const reservation of reservations) {
      await assert.rejects(
        inspectStoredMediaObject({
          organizationId: fixture.targetOrganizationId,
          assetId: reservation.id,
          key: reservation.storageKey,
        }),
        /missing/i,
      );
    }
  } finally {
    if (triggerInstalled) {
      await sql
        .unsafe("drop trigger if exists q_test_fail_orbit_thumbnail on media_processing_jobs")
        .catch(() => undefined);
      await sql
        .unsafe("drop function if exists q_test_fail_orbit_thumbnail()")
        .catch(() => undefined);
    }
    await removeFixture(fixture);
  }
});
