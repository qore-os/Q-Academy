import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { fetchMediaDownload } from "./helpers/media-download";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiAuthorization = {
  Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
};

async function loginAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function createSubmission(
  request: APIRequestContext,
  input: {
    userId: string;
    courseId: string;
    lessonId: string;
    blockId: string;
    attachmentIds: string[];
    title: string;
    content?: string;
  },
) {
  return request.post("/api/v1/submissions", {
    headers: {
      ...apiAuthorization,
      "Idempotency-Key": `submission-attachment-${input.userId}-${randomUUID()}`,
    },
    data: {
      ...input,
      content:
        input.content === undefined
          ? "Diese isolierte Testabgabe enthaelt ausreichend Text fuer die serverseitige Validierung."
          : input.content,
    },
  });
}

test("ready media attachments bind atomically and remain downloadable for owner and staff", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(150_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const memberEmail = `attachment-owner-${suffix}@example.test`;
  const otherMemberEmail = `attachment-other-${suffix}@example.test`;
  const courseSlug = `attachment-workflow-${suffix}`;
  const submissionTitle = `Abgabe mit Nachweis ${suffix}`;
  let organizationId = "";
  let ownerId = "";
  let memberId = "";
  let otherMemberId = "";
  let externalOrganizationId = "";
  let externalMemberId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let uploadedAssetId = "";
  const blockIds: string[] = [];
  const mediaIds: string[] = [];
  const mediaStoragePaths: string[] = [];
  const requestIds: string[] = [];

  const insertAsset = async (input: {
    organizationId: string;
    userId: string;
    status: "pending" | "ready" | "quarantined";
    name: string;
  }) => {
    const id = randomUUID();
    const size = 64;
    const uploaded = input.status !== "pending";
    const storageKey = `tenants/${input.organizationId}/assets/${id}/ready.txt`;
    if (uploaded) {
      const storagePath = resolve(
        process.cwd(),
        ".data",
        "media",
        ...storageKey.split("/"),
      );
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, Buffer.alloc(size, 0x51));
      mediaStoragePaths.push(storagePath);
    }
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
        upload_expires_at, uploaded_at, scan_completed_at
      ) values (
        ${id}, ${input.organizationId}, ${input.userId}, ${input.userId},
        'submission', 'document', ${input.status}, 'filesystem',
        ${storageKey},
        ${`incoming/tenants/${input.organizationId}/assets/${id}/incoming.txt`},
        ${input.name}, ${`test-${id.slice(0, 8)}.txt`}, 'text/plain',
        ${uploaded ? "text/plain" : null}, ${size}, ${uploaded ? size : null},
        ${size}, now() + interval '1 hour', ${uploaded ? new Date() : null},
        ${uploaded ? new Date() : null}
      )
    `;
    mediaIds.push(id);
    return id;
  };

  try {
    const [fixture] = await sql<
      Array<{ organization_id: string; owner_id: string; password_hash: string }>
    >`
      select owner.organization_id, owner.id as owner_id, template.password_hash
      from users owner
      cross join users template
      where owner.email = 'admin@q-academy.de'
        and template.email = 'lea@q-academy.de'
      limit 1
    `;
    organizationId = fixture.organization_id;
    ownerId = fixture.owner_id;

    const [member] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${memberEmail}, ${fixture.password_hash},
        'Mara', 'Attachment', 'member', 'active'
      ) returning id
    `;
    memberId = member.id;
    const [otherMember] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${otherMemberEmail}, ${fixture.password_hash},
        'Nora', 'Other', 'member', 'active'
      ) returning id
    `;
    otherMemberId = otherMember.id;
    const [externalOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`External ${suffix}`}, ${`external-${suffix}`})
      returning id
    `;
    externalOrganizationId = externalOrganization.id;
    const [externalMember] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${externalOrganizationId}, ${`external-${suffix}@example.test`},
        ${fixture.password_hash}, 'External', 'Member', 'member', 'active'
      ) returning id
    `;
    externalMemberId = externalMember.id;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        certificate_enabled, created_by_id
      ) values (
        ${organizationId}, ${`Attachment Workflow ${suffix}`}, ${courseSlug},
        'Sichere Dateianhaenge fuer Praxisabgaben.',
        'Isolierter Kurs fuer Upload-, Binding- und Downloadtests.',
        'draft', false, ${ownerId}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, folder, is_reusable, estimated_minutes
      ) values (
        ${organizationId}, ${`Attachment Modul ${suffix}`},
        'Mehrere unabhaengige Submission-Bloecke.', 'E2E', false, 20
      ) returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values (${organizationId}, ${courseId}, ${moduleId}, 0, true)
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, sort_order, status
      ) values (
        ${organizationId}, ${moduleId}, ${`Attachment Praxis ${suffix}`},
        ${`attachment-${suffix}`},
        'Abgaben mit mehreren geprueften Dateianhaengen.', 'assignment', 20, 0,
        'published'
      ) returning id
    `;
    lessonId = lesson.id;
    const blockNames = [
      "UI Upload",
      "Pending Asset",
      "Quarantine Asset",
      "Duplicate Asset",
      "Cross Tenant Asset",
      "Rollback Set",
      "Reuse First",
      "Reuse Second",
      "Empty Submission",
    ];
    for (const [sortOrder, title] of blockNames.entries()) {
      const [block] = await sql<Array<{ id: string }>>`
        insert into content_blocks (
          lesson_id, type, title, sort_order, required, data
        ) values (
          ${lessonId}, 'submission', ${title}, ${sortOrder}, false,
          ${sql.json({ prompt: `Testfall ${title}` })}
        ) returning id
      `;
      blockIds.push(block.id);
    }
    await sql`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${organizationId}, ${memberId}, ${courseId}, ${`direct:${courseId}`}
      )
    `;

    await loginAsAdmin(page);
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("button", { name: "Kurs veroeffentlichen" }).click();
    await expect(
      page.getByRole("button", { name: "Aenderungen veroeffentlichen" }),
    ).toBeVisible();

    const pendingAsset = await insertAsset({
      organizationId,
      userId: memberId,
      status: "pending",
      name: "pending.txt",
    });
    const quarantinedAsset = await insertAsset({
      organizationId,
      userId: memberId,
      status: "quarantined",
      name: "quarantined.txt",
    });
    const duplicateAsset = await insertAsset({
      organizationId,
      userId: memberId,
      status: "ready",
      name: "duplicate.txt",
    });
    const externalAsset = await insertAsset({
      organizationId: externalOrganizationId,
      userId: externalMemberId,
      status: "ready",
      name: "external.txt",
    });
    const rollbackAsset = await insertAsset({
      organizationId,
      userId: memberId,
      status: "ready",
      name: "rollback.txt",
    });
    const reusableAsset = await insertAsset({
      organizationId,
      userId: memberId,
      status: "ready",
      name: "reuse.txt",
    });

    const unboundDetail = await request.get(
      `/api/v1/media-assets/${reusableAsset}`,
      { headers: apiAuthorization },
    );
    expect(unboundDetail.status()).toBe(404);
    const unboundDownload = await request.get(
      `/api/v1/media-assets/${reusableAsset}/download`,
      { headers: apiAuthorization, maxRedirects: 0 },
    );
    expect(unboundDownload.status()).toBe(404);
    const unboundList = await request.get(
      "/api/v1/media-assets?purpose=submission&status=ready&limit=100",
      { headers: apiAuthorization },
    );
    expect(unboundList.status()).toBe(200);
    expect(
      ((await unboundList.json()) as { data: Array<{ id: string }> }).data.some(
        ({ id }) => id === reusableAsset,
      ),
    ).toBe(false);

    const invalidCases = [
      { blockId: blockIds[1]!, attachmentIds: [pendingAsset], status: 422 },
      { blockId: blockIds[2]!, attachmentIds: [quarantinedAsset], status: 422 },
      {
        blockId: blockIds[3]!,
        attachmentIds: [duplicateAsset, duplicateAsset],
        status: 422,
      },
      { blockId: blockIds[4]!, attachmentIds: [externalAsset], status: 422 },
      {
        blockId: blockIds[5]!,
        attachmentIds: [rollbackAsset, pendingAsset],
        status: 422,
      },
    ];
    for (const [index, invalid] of invalidCases.entries()) {
      const response = await createSubmission(request, {
        userId: memberId,
        courseId,
        lessonId,
        blockId: invalid.blockId,
        attachmentIds: invalid.attachmentIds,
        title: `Invalid attachment ${index} ${suffix}`,
      });
      requestIds.push(response.headers()["x-request-id"]);
      expect(response.status()).toBe(invalid.status);
    }
    const emptySubmission = await createSubmission(request, {
      userId: memberId,
      courseId,
      lessonId,
      blockId: blockIds[8]!,
      attachmentIds: [],
      title: `Empty submission ${suffix}`,
      content: "",
    });
    requestIds.push(emptySubmission.headers()["x-request-id"]);
    expect(emptySubmission.status()).toBe(422);
    const [rolledBack] = await sql<
      Array<{ submissions: number; attachments: number }>
    >`
      select
        (select count(*)::int from submissions where course_id = ${courseId}
          and block_id = ${blockIds[5]!}) as submissions,
        (select count(*)::int from submission_attachments
          where media_asset_id = ${rollbackAsset}) as attachments
    `;
    expect(rolledBack).toEqual({ submissions: 0, attachments: 0 });

    const firstReuse = await createSubmission(request, {
      userId: memberId,
      courseId,
      lessonId,
      blockId: blockIds[6]!,
      attachmentIds: [reusableAsset],
      title: `Reuse first ${suffix}`,
    });
    requestIds.push(firstReuse.headers()["x-request-id"]);
    expect(firstReuse.status()).toBe(201);
    const firstReuseBody = await firstReuse.json();
    expect(firstReuseBody.data.attachments).toEqual([
      expect.objectContaining({
        id: reusableAsset,
        originalFileName: "reuse.txt",
        downloadHref: `/api/v1/media-assets/${reusableAsset}/download`,
      }),
    ]);
    expect(firstReuseBody.data.attachments[0]).not.toHaveProperty("storageKey");
    expect(
      (
        await request.get(`/api/v1/media-assets/${reusableAsset}`, {
          headers: apiAuthorization,
        })
      ).status(),
    ).toBe(200);
    await fetchMediaDownload(
      request,
      `/api/v1/media-assets/${reusableAsset}/download`,
      { headers: apiAuthorization },
    );

    const secondReuse = await createSubmission(request, {
      userId: memberId,
      courseId,
      lessonId,
      blockId: blockIds[7]!,
      attachmentIds: [reusableAsset],
      title: `Reuse second ${suffix}`,
    });
    requestIds.push(secondReuse.headers()["x-request-id"]);
    expect(secondReuse.status()).toBe(409);

    await loginAsMember(page, memberEmail);
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    const uploadSection = page.getByRole("heading", { name: "UI Upload" }).locator("..");
    await uploadSection.locator('input[type="file"]').setInputFiles({
      name: "praxis-nachweis.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Nachweis fuer den sicheren Browser-Upload mit vollstaendiger Inhaltspruefung.\n",
      ),
    });
    await expect(uploadSection.getByText(/Bereit \|/)).toBeVisible({ timeout: 30_000 });
    const readyScreenshot = `.data/submission-upload-ready-${testInfo.project.name}.png`;
    await page.screenshot({ path: readyScreenshot, fullPage: true });
    await testInfo.attach("submission-upload-ready", {
      path: readyScreenshot,
      contentType: "image/png",
    });
    const deletePattern = "**/api/media-assets/*";
    await page.route(deletePattern, async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            detail: "Eine laufende Sicherheitspruefung kann nicht geloescht werden.",
          }),
        });
      } else {
        await route.continue();
      }
    });
    await uploadSection
      .getByRole("button", { name: "praxis-nachweis.txt entfernen" })
      .click();
    await expect(
      uploadSection.getByText(
        "Die Datei konnte nicht entfernt werden.",
      ),
    ).toBeVisible();
    await expect(uploadSection.getByText("praxis-nachweis.txt", { exact: true })).toBeVisible();
    await page.unroute(deletePattern);
    await uploadSection.getByLabel("Titel", { exact: true }).fill(submissionTitle);
    await expect(uploadSection.getByLabel("Antwort", { exact: true })).toBeEmpty();
    await uploadSection.getByRole("button", { name: "Abgabe einreichen" }).click();
    await expect(
      page.getByText("Deine Abgabe wurde zur Bewertung eingereicht.", { exact: true }),
    ).toBeVisible();
    const memberLink = page.getByRole("link", { name: /praxis-nachweis\.txt/ });
    await expect(memberLink).toBeVisible();
    uploadedAssetId = new URL(
      await memberLink.getAttribute("href") as string,
      "http://127.0.0.1:3000",
    ).pathname.split("/")[3]!;
    const [fileOnlySubmission] = await sql<
      Array<{ content: string | null; attachment_count: number }>
    >`
      select s.content,
        (select count(*)::int from submission_attachments sa
          where sa.submission_id = s.id) as attachment_count
      from submissions s
      where s.course_id = ${courseId} and s.block_id = ${blockIds[0]!}
      limit 1
    `;
    expect(fileOnlySubmission).toEqual({ content: null, attachment_count: 1 });

    await loginAsMember(page, otherMemberEmail);
    const denied = await page.request.get(
      `/api/media-assets/${uploadedAssetId}/download`,
      { maxRedirects: 0 },
    );
    expect(denied.status()).toBe(404);

    await loginAsAdmin(page);
    await page.goto("/admin/tasks");
    await page.getByPlaceholder("Abgaben durchsuchen").fill(submissionTitle);
    await page.locator("button").filter({ hasText: submissionTitle }).click();
    const staffLink = page.getByRole("link", { name: /praxis-nachweis\.txt/ }).first();
    await expect(staffLink).toBeVisible();
    const staffDownload = await page.request.get(
      `/api/media-assets/${uploadedAssetId}/download`,
      { maxRedirects: 0 },
    );
    expect(staffDownload.status()).toBe(200);
    expect(staffDownload.headers()["content-disposition"]).toContain("attachment");
    expect(await staffDownload.text()).toContain("sicheren Browser-Upload");
    const [downloadAudit] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from activity_events
      where entity_id = ${uploadedAssetId}
        and user_id = ${ownerId}
        and type = 'media_asset.downloaded'
        and metadata ->> 'result' = 'authorized'
    `;
    expect(downloadAudit.count).toBeGreaterThan(0);
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (courseId) await sql`delete from courses where id = ${courseId}`;
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    if (mediaIds.length || uploadedAssetId) {
      const ids = [...mediaIds, uploadedAssetId].filter(Boolean);
      await sql`delete from activity_events where entity_id in ${sql(ids)}`;
      await sql`delete from media_assets where id in ${sql(ids)}`;
    }
    if (memberId || otherMemberId) {
      const ids = [memberId, otherMemberId].filter(Boolean);
      if (memberId) {
        await sql`
          delete from api_idempotency_keys
          where key like ${`submission-attachment-${memberId}-%`}
        `;
      }
      await sql`delete from users where id in ${sql(ids)}`;
    }
    if (externalOrganizationId) {
      await sql`delete from organizations where id = ${externalOrganizationId}`;
    }
    await Promise.all(
      mediaStoragePaths.map((storagePath) => rm(storagePath, { force: true })),
    );
    await sql.end();
  }
});
