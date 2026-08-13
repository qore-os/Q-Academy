import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { db, postgresClient } from "@/db";
import type { CourseVersionSnapshot } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  createCourseWidget,
  deleteCourseWidget,
  updateCourseWidget,
} from "@/lib/course-widget-service";
import { courseWidgetMediaUrl } from "@/lib/course-widgets";
import { courseSnapshotWidgetsReferenceMediaAsset } from "@/lib/media/course-assets";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("v6 snapshots authorize private widget media", () => {
  const mediaAssetId = randomUUID();
  const courseId = randomUUID();
  const organizationId = randomUUID();
  const capturedAt = new Date().toISOString();
  const snapshot: CourseVersionSnapshot = {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt,
    course: {
      id: courseId,
      organizationId,
      categoryId: null,
      title: "Widget media fixture",
      slug: `widget-media-${courseId}`,
      shortDescription: "Private widget media fixture.",
      description: "Private widget media fixture.",
      coverImage: null,
      status: "published",
      difficulty: "Grundlagen",
      estimatedMinutes: 0,
      certificateEnabled: false,
      featured: false,
      visibleInCatalog: true,
      showProgressPercentage: true,
      publishedVersionId: null,
      firstPublishedAt: capturedAt,
      createdById: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    },
    learningGoals: [],
    authors: [],
    widgets: [
      {
        id: randomUUID(),
        organizationId,
        courseId,
        type: "image_link",
        sortOrder: 0,
        authorUserId: null,
        authorRole: null,
        authorDescription: null,
        title: null,
        text: null,
        linkUrl: "/academy/courses",
        imageUrl: `/api/media-assets/${mediaAssetId}/download`,
        mediaAssetId,
        altText: "Private widget image",
        createdAt: capturedAt,
        updatedAt: capturedAt,
        author: null,
      },
    ],
    modules: [],
  };
  assert.equal(
    courseSnapshotWidgetsReferenceMediaAsset(snapshot, mediaAssetId),
    true,
  );
});

async function insertReadyImage(input: {
  organizationId: string;
  uploadedById: string;
  assetId: string;
}) {
  await sql`
    insert into media_assets (
      id, organization_id, uploaded_by_id, purpose, kind, status,
      storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      detected_mime_type, declared_size_bytes, actual_size_bytes,
      quota_bytes, upload_expires_at, uploaded_at, scan_completed_at,
      content_sha256
    ) values (
      ${input.assetId}, ${input.organizationId}, ${input.uploadedById},
      'course_content', 'image', 'ready', 'filesystem',
      ${`tenants/${input.organizationId}/assets/${input.assetId}/widget.png`},
      ${`incoming/tenants/${input.organizationId}/assets/${input.assetId}/widget.png`},
      'widget.png', 'widget.png', 'image/png', 'image/png',
      128, 128, 128, now() + interval '1 hour', now(), now(),
      ${"a".repeat(64)}
    )
  `;
}

test("private course widget images are tenant-safe and immutably bound", async () => {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const courseId = randomUUID();
  const assetId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const foreignOwnerId = randomUUID();
  const foreignAssetId = randomUUID();

  try {
    await sql`
      insert into organizations (id, name, slug)
      values
        (${organizationId}, 'Widget media tenant', ${`widget-media-${organizationId.slice(0, 8)}`}),
        (${foreignOrganizationId}, 'Foreign widget media tenant', ${`foreign-widget-media-${foreignOrganizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (${ownerId}, ${organizationId}, ${`${ownerId}@example.test`}, 'hash', 'Widget', 'Owner', 'owner', 'active'),
        (${foreignOwnerId}, ${foreignOrganizationId}, ${`${foreignOwnerId}@example.test`}, 'hash', 'Foreign', 'Owner', 'owner', 'active')
    `;
    await sql`
      insert into courses (
        id, organization_id, title, slug, short_description, description,
        created_by_id
      ) values (
        ${courseId}, ${organizationId}, 'Private widget media',
        ${`private-widget-media-${courseId.slice(0, 8)}`},
        'Private image widget lifecycle.',
        'Verifies immutable course media bindings.', ${ownerId}
      )
    `;
    await insertReadyImage({ organizationId, uploadedById: ownerId, assetId });
    await insertReadyImage({
      organizationId: foreignOrganizationId,
      uploadedById: foreignOwnerId,
      assetId: foreignAssetId,
    });

    const created = await db.transaction((tx) =>
      createCourseWidget(tx, {
        organizationId,
        courseId,
        attachedById: ownerId,
        widget: {
          type: "image_link",
          mediaAssetId: assetId,
          altText: "Privates Widget-Bild",
          linkUrl: "/academy/courses",
        },
      }),
    );
    assert.equal(created.mediaAssetId, assetId);
    assert.equal(created.imageUrl, courseWidgetMediaUrl(assetId));

    const [bound] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${organizationId}
        and course_id = ${courseId}
        and media_asset_id = ${assetId}
    `;
    assert.equal(bound.count, 1);

    const updated = await db.transaction((tx) =>
      updateCourseWidget(tx, {
        organizationId,
        courseId,
        widgetId: created.id,
        attachedById: ownerId,
        widget: {
          type: "image_link",
          imageUrl: "https://images.example.test/public-widget.webp",
          altText: "Oeffentliches Widget-Bild",
          linkUrl: "/academy/courses",
        },
      }),
    );
    assert.equal(updated.mediaAssetId, null);
    assert.equal(updated.imageUrl, "https://images.example.test/public-widget.webp");

    await db.transaction((tx) =>
      deleteCourseWidget(tx, {
        organizationId,
        courseId,
        widgetId: created.id,
      }),
    );
    const [retained] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${organizationId}
        and course_id = ${courseId}
        and media_asset_id = ${assetId}
    `;
    assert.equal(retained.count, 1);

    await assert.rejects(
      db.transaction((tx) =>
        createCourseWidget(tx, {
          organizationId,
          courseId,
          attachedById: ownerId,
          widget: {
            type: "image_link",
            mediaAssetId: foreignAssetId,
            altText: "Tenantfremdes Bild",
            linkUrl: "/academy/courses",
          },
        }),
      ),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    const [afterRejected] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_widgets
      where organization_id = ${organizationId} and course_id = ${courseId}
    `;
    assert.equal(afterRejected.count, 0);
  } finally {
    await sql`delete from organizations where id in (${organizationId}, ${foreignOrganizationId})`;
  }
});
