import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

import { testEnvironmentValue as environmentValue } from "./helpers/test-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function dispatch(request: APIRequestContext) {
  const secret = environmentValue("CRON_SECRET");
  return request.post("/api/internal/jobs/media/maintenance?limit=5", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

type Fixture = {
  organization_id: string;
  admin_id: string;
  member_id: string;
  course_id: string;
};

async function loadFixture(sql: postgres.Sql) {
  const [fixture] = await sql<Fixture[]>`
    select o.id as organization_id,
      (select id from users where organization_id = o.id and role in ('owner', 'admin') limit 1) as admin_id,
      (select id from users where organization_id = o.id and role = 'member' limit 1) as member_id,
      (select id from courses where organization_id = o.id limit 1) as course_id
    from organizations o
    where exists (select 1 from courses where organization_id = o.id)
      and exists (
        select 1 from users
        where organization_id = o.id and role in ('owner', 'admin')
      )
      and exists (
        select 1 from users
        where organization_id = o.id and role = 'member'
      )
    limit 1
  `;
  if (!fixture) throw new Error("Media retention fixture is unavailable.");
  return fixture;
}

async function insertReadyAsset(
  sql: postgres.Sql,
  fixture: Fixture,
  input: {
    id: string;
    purpose: "submission" | "course_content";
    scannedAgo: string;
  },
) {
  await sql`
    insert into media_assets (
      id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
      status, storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      declared_size_bytes, actual_size_bytes, quota_bytes, upload_expires_at,
      uploaded_at, scan_completed_at, content_sha256, created_at, updated_at
    ) values (
      ${input.id}, ${fixture.organization_id}, ${fixture.admin_id},
      ${fixture.member_id}, ${input.purpose}, 'document', 'ready', 'filesystem',
      ${`tenants/${fixture.organization_id}/assets/${input.id}/ready.txt`},
      ${`incoming/tenants/${fixture.organization_id}/assets/${input.id}/incoming.txt`},
      'retention.txt', 'retention.txt', 'text/plain', 1, 1, 1,
      now() + interval '1 hour', now() - ${input.scannedAgo}::interval,
      now() - ${input.scannedAgo}::interval, ${"0".repeat(64)},
      now() - ${input.scannedAgo}::interval,
      now() - ${input.scannedAgo}::interval
    )
  `;
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Database retention runs once.");
});

test("media retention expires old unbound submission and course assets", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const fixture = await loadFixture(sql);
  const submissionId = randomUUID();
  const ids = {
    oldUnbound: randomUUID(),
    bound: randomUUID(),
    courseContent: randomUUID(),
    boundCourseContent: randomUUID(),
    fresh: randomUUID(),
  };
  try {
    await sql`
      insert into submissions (
        id, organization_id, user_id, course_id, title, type, content
      ) values (
        ${submissionId}, ${fixture.organization_id}, ${fixture.member_id},
        ${fixture.course_id}, 'Retention submission', 'text', 'Retention test'
      )
    `;
    await insertReadyAsset(sql, fixture, {
      id: ids.oldUnbound,
      purpose: "submission",
      scannedAgo: "25 hours",
    });
    await insertReadyAsset(sql, fixture, {
      id: ids.bound,
      purpose: "submission",
      scannedAgo: "25 hours",
    });
    await insertReadyAsset(sql, fixture, {
      id: ids.courseContent,
      purpose: "course_content",
      scannedAgo: "25 hours",
    });
    await insertReadyAsset(sql, fixture, {
      id: ids.boundCourseContent,
      purpose: "course_content",
      scannedAgo: "25 hours",
    });
    await insertReadyAsset(sql, fixture, {
      id: ids.fresh,
      purpose: "submission",
      scannedAgo: "23 hours",
    });
    await sql`
      insert into submission_attachments (
        organization_id, submission_id, media_asset_id
      ) values (
        ${fixture.organization_id}, ${submissionId}, ${ids.bound}
      )
    `;
    await sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values (
        ${fixture.organization_id}, ${fixture.course_id},
        ${ids.boundCourseContent}, ${fixture.admin_id}
      )
    `;

    const response = await dispatch(request);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: {
        expiredUnattachedSubmissionAssets: number;
        expiredUnattachedCourseAssets: number;
      };
    };
    expect(body.data.expiredUnattachedSubmissionAssets).toBeGreaterThanOrEqual(1);
    expect(body.data.expiredUnattachedCourseAssets).toBeGreaterThanOrEqual(1);

    const rows = await sql<
      Array<{
        id: string;
        status: string;
        scan_failure_code: string | null;
        quota_bytes: string;
        storage_deleted_at: Date | null;
      }>
    >`
      select id, status, scan_failure_code, quota_bytes, storage_deleted_at
      from media_assets
      where id in (
        ${ids.oldUnbound}, ${ids.bound}, ${ids.courseContent},
        ${ids.boundCourseContent}, ${ids.fresh}
      )
    `;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.oldUnbound)).toMatchObject({
      status: "deleted",
      scan_failure_code: "unattached_submission_expired",
      quota_bytes: "1",
      storage_deleted_at: null,
    });
    expect(byId.get(ids.bound)?.status).toBe("ready");
    expect(byId.get(ids.courseContent)).toMatchObject({
      status: "deleted",
      scan_failure_code: "unattached_course_content_expired",
      quota_bytes: "1",
      storage_deleted_at: null,
    });
    expect(byId.get(ids.boundCourseContent)?.status).toBe("ready");
    expect(byId.get(ids.fresh)?.status).toBe("ready");
  } finally {
    await sql`
      delete from submission_attachments where submission_id = ${submissionId}
    `;
    await sql`
      delete from course_media_assets where media_asset_id = ${ids.boundCourseContent}
    `;
    await sql`
      delete from media_assets
      where id in (
        ${ids.oldUnbound}, ${ids.bound}, ${ids.courseContent},
        ${ids.boundCourseContent}, ${ids.fresh}
      )
    `;
    await sql`delete from submissions where id = ${submissionId}`;
    await sql.end();
  }
});

test("a concurrent attachment bind owns the asset lock before retention", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const fixture = await loadFixture(sql);
  const submissionId = randomUUID();
  const assetId = randomUUID();
  let releaseBinding!: () => void;
  let bindingLocked!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseBinding = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    bindingLocked = resolve;
  });
  let binding: Promise<unknown> | null = null;
  try {
    await sql`
      insert into submissions (
        id, organization_id, user_id, course_id, title, type, content
      ) values (
        ${submissionId}, ${fixture.organization_id}, ${fixture.member_id},
        ${fixture.course_id}, 'Concurrent retention', 'text', 'Retention race'
      )
    `;
    await insertReadyAsset(sql, fixture, {
      id: assetId,
      purpose: "submission",
      scannedAgo: "25 hours",
    });

    // This is the same row-lock protocol used by bindSubmissionAttachments.
    binding = sql.begin(async (tx) => {
      await tx`select id from media_assets where id = ${assetId} for update`;
      bindingLocked();
      await release;
      await tx`
        insert into submission_attachments (
          organization_id, submission_id, media_asset_id
        ) values (
          ${fixture.organization_id}, ${submissionId}, ${assetId}
        )
      `;
    });
    await locked;

    const whileBinding = await dispatch(request);
    expect(whileBinding.status()).toBe(200);
    releaseBinding();
    await binding;

    const afterBinding = await dispatch(request);
    expect(afterBinding.status()).toBe(200);
    const [result] = await sql<
      Array<{ status: string; attachments: number }>
    >`
      select a.status,
        (select count(*)::int from submission_attachments sa
          where sa.organization_id = a.organization_id
            and sa.media_asset_id = a.id) as attachments
      from media_assets a
      where a.id = ${assetId}
    `;
    expect(result).toEqual({ status: "ready", attachments: 1 });
  } finally {
    releaseBinding();
    if (binding) await binding.catch(() => undefined);
    await sql`
      delete from submission_attachments where submission_id = ${submissionId}
    `;
    await sql`delete from media_assets where id = ${assetId}`;
    await sql`delete from submissions where id = ${submissionId}`;
    await sql.end();
  }
});
