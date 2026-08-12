import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };

async function runBehaviorChild(input: {
  operation: "complete" | "privacy";
  organizationId: string;
  userId: string;
  assetId: string;
  sizeBytes: number;
  mimeType: string;
}) {
  const register = path.resolve("tests/register-server-only.cjs");
  const loader = path.resolve(
    "tests/helpers/media-storage-inspect-loader.mjs",
  );
  const script = path.resolve(
    "tests/helpers/direct-upload-claim-behavior-child.ts",
  );
  await execFileAsync(
    process.execPath,
    [
      "--require",
      register,
      "--import",
      "tsx",
      "--loader",
      pathToFileURL(loader).href,
      script,
      input.operation,
      input.organizationId,
      input.userId,
      input.assetId,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TEST_MEDIA_ASSET_ID: input.assetId,
        TEST_MEDIA_ORGANIZATION_ID: input.organizationId,
        TEST_MEDIA_SIZE_BYTES: String(input.sizeBytes),
        TEST_MEDIA_MIME_TYPE: input.mimeType,
      },
      windowsHide: true,
      timeout: 30_000,
    },
  );
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Database lifecycle runs once.");
});

test("claimed direct uploads clear their claim on V1 delete, browser completion, and privacy erasure", async ({
  request,
}) => {
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const v1AssetId = randomUUID();
  const completeAssetId = randomUUID();
  const privacyOrganizationId = randomUUID();
  const privacyUserId = randomUUID();
  const privacyAssetId = randomUUID();
  const idempotencyKey = `claimed-v1-delete-${randomUUID()}`;
  const sizeBytes = 17;
  try {
    const [fixture] = await sql<
      Array<{ organizationId: string; userId: string }>
    >`
      select organization_id as "organizationId", id as "userId"
      from users
      where email = 'admin@q-academy.de'
      order by created_at
      limit 1
    `;
    expect(fixture).toBeTruthy();

    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, declared_size_bytes, quota_bytes,
        upload_expires_at, direct_upload_claim_token,
        direct_upload_claimed_at
      ) values
      (
        ${v1AssetId}, ${fixture.organizationId}, ${fixture.userId},
        'course_content', 'video', 'pending', 's3',
        ${`tenants/${fixture.organizationId}/assets/${v1AssetId}/video.mp4`},
        ${`incoming/tenants/${fixture.organizationId}/assets/${v1AssetId}/video.mp4`},
        'v1-delete.mp4', 'v1-delete.mp4', 'video/mp4', ${sizeBytes},
        ${sizeBytes}, now() + interval '1 hour', ${randomUUID()}, now()
      ),
      (
        ${completeAssetId}, ${fixture.organizationId}, ${fixture.userId},
        'course_content', 'video', 'pending', 's3',
        ${`tenants/${fixture.organizationId}/assets/${completeAssetId}/video.mp4`},
        ${`incoming/tenants/${fixture.organizationId}/assets/${completeAssetId}/video.mp4`},
        'complete.mp4', 'complete.mp4', 'video/mp4', ${sizeBytes},
        ${sizeBytes}, now() + interval '1 hour', ${randomUUID()}, now()
      )
    `;

    const deleted = await request.delete(`/api/v1/media-assets/${v1AssetId}`, {
      headers: {
        ...authorization,
        "Idempotency-Key": idempotencyKey,
      },
    });
    expect(deleted.status(), await deleted.text()).toBe(200);

    await runBehaviorChild({
      operation: "complete",
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      assetId: completeAssetId,
      sizeBytes,
      mimeType: "video/mp4",
    });

    await sql`
      insert into organizations (id, name, slug)
      values (
        ${privacyOrganizationId}, 'Claim erasure tenant',
        ${`claim-erasure-${privacyOrganizationId.slice(0, 8)}`}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${privacyUserId}, ${privacyOrganizationId},
        ${`claim-erasure-${privacyUserId}@example.test`}, 'credential',
        'Claim', 'Erasure', 'member', 'active'
      )
    `;
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        declared_size_bytes, quota_bytes, upload_expires_at,
        direct_upload_claim_token, direct_upload_claimed_at
      ) values (
        ${privacyAssetId}, ${privacyOrganizationId}, ${privacyUserId},
        ${privacyUserId}, 'avatar', 'image', 'pending', 's3',
        ${`tenants/${privacyOrganizationId}/assets/${privacyAssetId}/avatar.png`},
        ${`incoming/tenants/${privacyOrganizationId}/assets/${privacyAssetId}/avatar.png`},
        'avatar.png', 'avatar.png', 'image/png', ${sizeBytes}, ${sizeBytes},
        now() + interval '1 hour', ${randomUUID()}, now()
      )
    `;
    await runBehaviorChild({
      operation: "privacy",
      organizationId: privacyOrganizationId,
      userId: privacyUserId,
      assetId: privacyAssetId,
      sizeBytes,
      mimeType: "image/png",
    });

    const rows = await sql<
      Array<{
        id: string;
        status: string;
        directUploadClaimToken: string | null;
        directUploadClaimedAt: Date | null;
      }>
    >`
      select id, status,
        direct_upload_claim_token as "directUploadClaimToken",
        direct_upload_claimed_at as "directUploadClaimedAt"
      from media_assets
      where id in (${v1AssetId}, ${completeAssetId}, ${privacyAssetId})
      order by id
    `;
    expect(Object.fromEntries(rows.map((row) => [row.id, row]))).toMatchObject({
      [v1AssetId]: {
        status: "deleted",
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
      },
      [completeAssetId]: {
        status: "uploaded",
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
      },
      [privacyAssetId]: {
        status: "deleted",
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
      },
    });
  } finally {
    await sql`
      delete from api_idempotency_keys where key = ${idempotencyKey}
    `.catch(() => undefined);
    await sql`
      delete from media_assets where id in (${v1AssetId}, ${completeAssetId})
    `.catch(() => undefined);
    await sql`
      delete from organizations where id = ${privacyOrganizationId}
    `.catch(() => undefined);
    await sql.end();
  }
});
