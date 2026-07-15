import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { db, postgresClient } from "@/db";
import {
  assertOrganizationCourseCapacity,
  assertOrganizationFeatureAvailable,
  assertOrganizationSeatCapacity,
  assertOrganizationStorageCapacity,
  getOrganizationContractOverview,
} from "@/lib/organization-contracts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

function constraint(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("constraint" in error) return String(error.constraint);
  if ("constraint_name" in error) return String(error.constraint_name);
  return undefined;
}

test("contract limits and entitlements are tenant-bound and database enforced", async () => {
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'Contract tenant', ${`contract-${organizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${ownerId}, ${organizationId}, ${`${ownerId}@example.test`}, 'hash',
        'Contract', 'Owner', 'owner', 'active'
      )
    `;
    await sql`
      insert into organization_contracts (
        organization_id, plan_code, status, seat_limit, course_limit,
        storage_limit_bytes, ai_monthly_credits, feature_entitlements
      ) values (
        ${organizationId}, 'integration_2026', 'active', 1, 1,
        1048576, 10, array['ai']::text[]
      )
    `;

    await assertOrganizationFeatureAvailable(db, organizationId, "ai");
    await assert.rejects(
      assertOrganizationFeatureAvailable(db, organizationId, "commerce"),
      /nicht freigeschaltet/,
    );
    await assert.rejects(
      db.transaction((tx) =>
        assertOrganizationSeatCapacity(tx, { organizationId }),
      ),
      /Seat-Limit/,
    );
    await assert.rejects(
      db.transaction((tx) =>
        assertOrganizationStorageCapacity(tx, {
          organizationId,
          requestedBytes: 1_048_577,
        }),
      ),
      /Speicherlimit/,
    );

    await assert.rejects(
      sql`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${organizationId}, ${`blocked-${ownerId}@example.test`}, 'hash',
          'Blocked', 'Member', 'member', 'invited'
        )
      `,
      (error: unknown) => constraint(error) === "organization_seat_limit_enforced",
    );

    await db.transaction((tx) =>
      assertOrganizationCourseCapacity(tx, organizationId),
    );
    await sql`
      insert into courses (
        organization_id, title, slug, short_description, description, created_by_id
      ) values (
        ${organizationId}, 'First course', 'first-course', 'First', 'First', ${ownerId}
      )
    `;
    await assert.rejects(
      db.transaction((tx) =>
        assertOrganizationCourseCapacity(tx, organizationId),
      ),
      /Kurslimit/,
    );
    await assert.rejects(
      sql`
        insert into courses (
          organization_id, title, slug, short_description, description, created_by_id
        ) values (
          ${organizationId}, 'Blocked course', 'blocked-course', 'Blocked', 'Blocked', ${ownerId}
        )
      `,
      (error: unknown) => constraint(error) === "organization_course_limit_enforced",
    );

    const overview = await getOrganizationContractOverview(organizationId);
    assert.equal(overview.contract?.planCode, "integration_2026");
    assert.deepEqual(overview.usage, {
      seats: 1,
      courses: 1,
      storageBytes: 0,
    });

    const assetId = randomUUID();
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, storage_driver,
        storage_key, staging_storage_key, original_file_name, safe_file_name,
        declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at
      ) values (
        ${assetId}, ${organizationId}, ${ownerId}, 'course_content', 'image',
        'filesystem',
        ${`tenants/${organizationId}/assets/${assetId}/image.png`},
        ${`incoming/tenants/${organizationId}/assets/${assetId}/image.png`},
        'image.png', 'image.png', 'image/png', 800000, 800000,
        now() + interval '1 hour'
      )
    `;
    const blockedAssetId = randomUUID();
    await assert.rejects(
      sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, purpose, kind, storage_driver,
          storage_key, staging_storage_key, original_file_name, safe_file_name,
          declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at
        ) values (
          ${blockedAssetId}, ${organizationId}, ${ownerId}, 'course_content',
          'image', 'filesystem',
          ${`tenants/${organizationId}/assets/${blockedAssetId}/image.png`},
          ${`incoming/tenants/${organizationId}/assets/${blockedAssetId}/image.png`},
          'image.png', 'image.png', 'image/png', 300000, 300000,
          now() + interval '1 hour'
        )
      `,
      (error: unknown) =>
        constraint(error) === "organization_storage_limit_enforced",
    );

    const processingJobId = randomUUID();
    await sql`
      insert into media_processing_jobs (
        id, organization_id, source_asset_id, requested_by_id, type,
        request_key, source_content_sha256, provider
      ) values (
        ${processingJobId}, ${organizationId}, ${assetId}, ${ownerId},
        'thumbnail', ${randomUUID()}, ${"a".repeat(64)}, 'integration-test'
      )
    `;
    await assert.rejects(
      sql`
        insert into media_asset_derivatives (
          organization_id, source_asset_id, processing_job_id, kind,
          storage_driver, storage_key, mime_type, size_bytes, content_sha256,
          width, height
        ) values (
          ${organizationId}, ${assetId}, ${processingJobId}, 'thumbnail',
          'filesystem', ${`derivatives/${randomUUID()}.webp`}, 'image/webp',
          300000, ${"b".repeat(64)}, 320, 180
        )
      `,
      (error: unknown) =>
        constraint(error) === "organization_storage_limit_enforced",
    );
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
