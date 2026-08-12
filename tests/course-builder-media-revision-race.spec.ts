import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function waitUntilBlocked(
  observer: ReturnType<typeof postgres>,
  blockerPid: number,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [state] = await observer<Array<{ blocked: boolean }>>`
      select exists (
        select 1
        from pg_stat_activity waiter
        where ${blockerPid} = any(pg_blocking_pids(waiter.pid))
      ) as blocked
    `;
    if (state?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The course-builder mutation never reached the held row lock.");
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Database lifecycle runs once.");
});

test("a stale shared-block save never binds replacement media before its revision lock", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const blocker = postgres(databaseUrl, { max: 1, prepare: false });
  const observer = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const sourceCourseId = randomUUID();
  const targetCourseId = randomUUID();
  const moduleId = randomUUID();
  const sectionId = randomUUID();
  const lessonId = randomUUID();
  const blockId = randomUUID();
  const originalAssetId = randomUUID();
  const replacementAssetId = randomUUID();
  const blockTitle = `Revision video ${suffix}`;
  const replacementName = `replacement-${suffix}.mp4`;
  let releaseBlocker!: () => void;
  let blockerPromise: Promise<unknown> | undefined;
  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        organizationSlug: string;
        ownerId: string;
      }>
    >`
      select u.organization_id as "organizationId",
             o.slug as "organizationSlug", u.id as "ownerId"
      from users u
      join organizations o on o.id = u.organization_id
      where u.email = 'admin@q-academy.de'
      order by u.created_at
      limit 1
    `;
    expect(fixture).toBeTruthy();

    await sql`
      insert into courses (
        id, organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values
      (
        ${sourceCourseId}, ${fixture.organizationId},
        ${`Revision source ${suffix}`}, ${`revision-source-${suffix}`},
        'Source', 'Source course', 'draft', ${fixture.ownerId}
      ),
      (
        ${targetCourseId}, ${fixture.organizationId},
        ${`Revision target ${suffix}`}, ${`revision-target-${suffix}`},
        'Target', 'Target course', 'draft', ${fixture.ownerId}
      )
    `;
    await sql`
      insert into modules (
        id, organization_id, title, description, folder, is_reusable,
        estimated_minutes
      ) values (
        ${moduleId}, ${fixture.organizationId}, ${`Revision module ${suffix}`},
        'Revision race module', 'E2E', true, 10
      )
    `;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, drip_days,
        is_required
      ) values
        (${fixture.organizationId}, ${sourceCourseId}, ${moduleId}, 0, 0, true),
        (${fixture.organizationId}, ${targetCourseId}, ${moduleId}, 0, 0, true)
    `;
    await sql`
      insert into module_sections (
        id, organization_id, module_id, title, sort_order
      ) values (
        ${sectionId}, ${fixture.organizationId}, ${moduleId},
        ${`Revision section ${suffix}`}, 0
      )
    `;
    await sql`
      insert into lessons (
        id, organization_id, module_id, section_id, title, slug, type,
        status, duration_minutes, sort_order
      ) values (
        ${lessonId}, ${fixture.organizationId}, ${moduleId}, ${sectionId},
        ${`Revision lesson ${suffix}`}, ${`revision-lesson-${suffix}`},
        'lesson', 'published', 10, 0
      )
    `;
    for (const [assetId, fileName] of [
      [originalAssetId, `original-${suffix}.mp4`],
      [replacementAssetId, replacementName],
    ] as const) {
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, purpose, kind, status,
          storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          detected_mime_type, declared_size_bytes, actual_size_bytes,
          duration_milliseconds, quota_bytes, content_sha256,
          upload_expires_at, uploaded_at, scan_completed_at
        ) values (
          ${assetId}, ${fixture.organizationId}, ${fixture.ownerId},
          'course_content', 'video', 'ready', 'filesystem',
          ${`tenants/${fixture.organizationId}/assets/${assetId}/${fileName}`},
          ${`incoming/tenants/${fixture.organizationId}/assets/${assetId}/${fileName}`},
          ${fileName}, ${fileName}, 'video/mp4', 'video/mp4', 8, 8, 1000,
          8, ${"a".repeat(64)}, now() + interval '1 hour', now(), now()
        )
      `;
    }
    await sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values
        (${fixture.organizationId}, ${sourceCourseId}, ${originalAssetId}, ${fixture.ownerId}),
        (${fixture.organizationId}, ${targetCourseId}, ${originalAssetId}, ${fixture.ownerId})
    `;
    await sql`
      insert into content_blocks (
        id, lesson_id, type, title, sort_order, required, revision, data
      ) values (
        ${blockId}, ${lessonId}, 'video', ${blockTitle}, 0, false, 1,
        ${sql.json({
          mediaAssetId: originalAssetId,
          mediaAssetName: `original-${suffix}.mp4`,
          videoUrl: `/api/media-assets/${originalAssetId}/download`,
          caption: "Original description.",
        })}
      )
    `;

    const login = await page.request.post("/api/v1/auth/login", {
      data: {
        organizationSlug: fixture.organizationSlug,
        email: "admin@q-academy.de",
        password: "Demo123!",
      },
    });
    expect(login.status()).toBe(200);
    await page.goto(`/admin/courses/${sourceCourseId}`);
    await page.getByRole("button", { name: `${blockTitle}: Bearbeiten` }).click();
    const editor = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await editor
      .getByRole("button", { name: "Geprüftes Medium wiederverwenden" })
      .click();
    await editor.getByPlaceholder("Mediathek durchsuchen").fill(replacementName);
    await editor
      .getByRole("button", { name: "Mediathek durchsuchen", exact: true })
      .click();
    await editor
      .getByRole("button", { name: `${replacementName} auswählen` })
      .click();

    let ready!: (pid: number) => void;
    const blockerReady = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    blockerPromise = blocker.begin(async (transaction) => {
      const [backend] = await transaction<Array<{ pid: number }>>`
        select pg_backend_pid()::int as pid
      `;
      await transaction`
        update content_blocks
        set revision = revision + 1
        where id = ${blockId}
      `;
      ready(backend.pid);
      await release;
    });
    const blockerPid = await blockerReady;

    await editor
      .getByRole("button", { name: "Aenderungen speichern" })
      .click();
    await waitUntilBlocked(observer, blockerPid);
    releaseBlocker();
    await blockerPromise;
    blockerPromise = undefined;

    await expect(
      page.getByRole("main").getByText(
        "Der Inhalt wurde gleichzeitig bearbeitet. Lade die Seite neu.",
        { exact: true },
      ),
    ).toBeVisible();
    const [block] = await sql<
      Array<{ revision: number; data: { mediaAssetId?: string } }>
    >`
      select revision, data from content_blocks where id = ${blockId}
    `;
    expect(block).toMatchObject({
      revision: 2,
      data: { mediaAssetId: originalAssetId },
    });
    const [replacementBindings] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.organizationId}
        and media_asset_id = ${replacementAssetId}
        and course_id in (${sourceCourseId}, ${targetCourseId})
    `;
    expect(replacementBindings.count).toBe(0);
  } finally {
    releaseBlocker?.();
    await blockerPromise?.catch(() => undefined);
    await sql`delete from courses where id in (${sourceCourseId}, ${targetCourseId})`.catch(
      () => undefined,
    );
    await sql`delete from modules where id = ${moduleId}`.catch(() => undefined);
    await sql`
      delete from media_assets
      where id in (${originalAssetId}, ${replacementAssetId})
    `.catch(() => undefined);
    await Promise.all([sql.end(), blocker.end(), observer.end()]);
  }
});
