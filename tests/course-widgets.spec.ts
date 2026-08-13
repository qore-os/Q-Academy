import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${apiKey}` };

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

async function closeContext(context: BrowserContext | null) {
  if (context) await context.close().catch(() => undefined);
}

function mutationHeaders(key: string) {
  return { ...authorization, "Idempotency-Key": key };
}

test("course widgets are tenant-safe, versioned, and manageable through UI and REST", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop lifecycle runs once.");
  test.setTimeout(180_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const courseTitle = `Widget-Kurs ${suffix}`;
  const courseSlug = `widget-kurs-${suffix}`;
  const infoTitle = `Live-Sprechstunde ${suffix}`;
  const updatedInfoTitle = `Woechentliche Sprechstunde ${suffix}`;
  const draftInfoTitle = `Entwurf Sprechstunde ${suffix}`;
  const imageAlt = `Lernwerkstatt ${suffix}`;
  const apiPrefix = `widget-${suffix}`;
  const requestIds: string[] = [];
  let organizationId = "";
  let ownerId = "";
  let memberId = "";
  let courseId = "";
  let foreignOrganizationId = "";
  let foreignUserId = "";
  let widgetMediaAssetId = "";
  let restMediaAssetId = "";
  let cloneId = "";
  let adminContext: BrowserContext | null = null;
  let memberContext: BrowserContext | null = null;

  try {
    const [fixture] = await client<
      Array<{
        owner_id: string;
        member_id: string;
        organization_id: string;
        password_hash: string;
        owner_first_name: string;
      }>
    >`
      select
        owner.id as owner_id,
        member.id as member_id,
        owner.organization_id,
        owner.password_hash,
        owner.first_name as owner_first_name
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    ownerId = fixture.owner_id;
    memberId = fixture.member_id;

    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, certificate_enabled, created_by_id
      ) values (
        ${organizationId}, ${courseTitle}, ${courseSlug},
        'Kurs mit stabil publizierten Uebersichtskarten.',
        'Ein fokussierter Kurs fuer Autor-, Info- und verlinkte Bild-Karten.',
        'draft', false, ${ownerId}
      )
      returning id
    `;
    courseId = course.id;
    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${organizationId}, ${memberId}, ${courseId}, ${`direct:${enrollment.id}`}
      )
    `;
    restMediaAssetId = randomUUID();
    await client`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes,
        quota_bytes, upload_expires_at, uploaded_at, scan_completed_at,
        content_sha256
      ) values (
        ${restMediaAssetId}, ${organizationId}, ${ownerId},
        'course_content', 'image', 'ready', 'filesystem',
        ${`tenants/${organizationId}/assets/${restMediaAssetId}/rest-widget.png`},
        ${`incoming/tenants/${organizationId}/assets/${restMediaAssetId}/rest-widget.png`},
        'rest-widget.png', 'rest-widget.png', 'image/png', 'image/png',
        128, 128, 128, now() + interval '1 hour', now(), now(),
        ${"b".repeat(64)}
      )
    `;

    const [foreignOrganization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign widgets ${suffix}`}, ${`foreign-widgets-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await client<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${foreignOrganizationId}, ${`trainer-${suffix}@example.test`},
        ${fixture.password_hash}, 'Foreign', 'Trainer', 'trainer', 'active'
      )
      returning id
    `;
    foreignUserId = foreignUser.id;
    const [foreignCourse] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status
      ) values (
        ${foreignOrganizationId}, 'Foreign widget course',
        ${`foreign-widget-course-${suffix}`},
        'Nicht fuer den Demo-Tenant sichtbar.',
        'Dieser Kurs prueft die REST-Tenantgrenze fuer Kurs-Widgets.', 'draft'
      )
      returning id
    `;

    await expect(
      client`
        insert into course_widgets (
          organization_id, course_id, type, author_user_id, sort_order
        ) values (${organizationId}, ${courseId}, 'author', ${foreignUserId}, 0)
      `,
    ).rejects.toThrow();

    const apiCreate = await request.post(`/api/v1/courses/${courseId}/widgets`, {
      headers: mutationHeaders(`${apiPrefix}-create`),
      data: {
        type: "info",
        title: `API Hinweis ${suffix}`,
        text: "Wird ueber den v1-Vertrag erstellt.",
        linkUrl: "/academy/events",
      },
    });
    requestIds.push(apiCreate.headers()["x-request-id"]);
    expect(apiCreate.status()).toBe(201);
    const apiWidgetId = (await apiCreate.json()).data.id as string;

    const apiRead = await request.get(
      `/api/v1/courses/${courseId}/widgets/${apiWidgetId}`,
      { headers: authorization },
    );
    requestIds.push(apiRead.headers()["x-request-id"]);
    expect(apiRead.status()).toBe(200);
    await expect(apiRead.json()).resolves.toMatchObject({
      data: { id: apiWidgetId, type: "info", sortOrder: 0 },
    });

    const apiUpdate = await request.patch(
      `/api/v1/courses/${courseId}/widgets/${apiWidgetId}`,
      {
        headers: mutationHeaders(`${apiPrefix}-update`),
        data: {
          type: "info",
          title: `API Hinweis aktualisiert ${suffix}`,
          text: "Der PATCH-Vertrag ersetzt die typspezifischen Daten.",
          linkUrl: "https://example.test/widgets",
        },
      },
    );
    requestIds.push(apiUpdate.headers()["x-request-id"]);
    expect(apiUpdate.status()).toBe(200);

    const apiReorder = await request.patch(
      `/api/v1/courses/${courseId}/widgets`,
      {
        headers: mutationHeaders(`${apiPrefix}-order`),
        data: { orderedIds: [apiWidgetId] },
      },
    );
    requestIds.push(apiReorder.headers()["x-request-id"]);
    expect(apiReorder.status()).toBe(200);

    const unsafeLink = await request.post(
      `/api/v1/courses/${courseId}/widgets`,
      {
        headers: mutationHeaders(`${apiPrefix}-unsafe-link`),
        data: {
          type: "info",
          title: "Unsicher",
          text: "Dieser Link muss abgelehnt werden.",
          linkUrl: "javascript:alert(1)",
        },
      },
    );
    requestIds.push(unsafeLink.headers()["x-request-id"]);
    expect(unsafeLink.status()).toBe(422);

    const privateImage = await request.post(
      `/api/v1/courses/${courseId}/widgets`,
      {
        headers: mutationHeaders(`${apiPrefix}-private-image`),
        data: {
          type: "image_link",
          imageUrl: `/api/media-assets/${randomUUID()}/download`,
          altText: "Privates Medium",
          linkUrl: "/academy/courses",
        },
      },
    );
    requestIds.push(privateImage.headers()["x-request-id"]);
    expect(privateImage.status()).toBe(422);

    const validPrivateImage = await request.post(
      `/api/v1/courses/${courseId}/widgets`,
      {
        headers: mutationHeaders(`${apiPrefix}-private-image-valid`),
        data: {
          type: "image_link",
          mediaAssetId: restMediaAssetId,
          altText: "Privates REST-Medium",
          linkUrl: "/academy/courses",
        },
      },
    );
    requestIds.push(validPrivateImage.headers()["x-request-id"]);
    expect(validPrivateImage.status()).toBe(201);
    const privateWidget = (await validPrivateImage.json()).data as {
      id: string;
      mediaAssetId: string;
      imageUrl: string;
    };
    expect(privateWidget).toMatchObject({
      mediaAssetId: restMediaAssetId,
      imageUrl: `/api/media-assets/${restMediaAssetId}/download`,
    });
    const deletePrivateWidget = await request.delete(
      `/api/v1/courses/${courseId}/widgets/${privateWidget.id}`,
      { headers: mutationHeaders(`${apiPrefix}-private-image-delete`) },
    );
    requestIds.push(deletePrivateWidget.headers()["x-request-id"]);
    expect(deletePrivateWidget.status()).toBe(200);
    const [retainedRestBinding] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${organizationId}
        and course_id = ${courseId}
        and media_asset_id = ${restMediaAssetId}
    `;
    expect(retainedRestBinding.count).toBe(1);

    const foreignAuthor = await request.post(
      `/api/v1/courses/${courseId}/widgets`,
      {
        headers: mutationHeaders(`${apiPrefix}-foreign-author`),
        data: {
          type: "author",
          authorUserId: foreignUserId,
          roleLabel: "Fremder Autor",
        },
      },
    );
    requestIds.push(foreignAuthor.headers()["x-request-id"]);
    expect(foreignAuthor.status()).toBe(422);

    const foreignCourseResponse = await request.post(
      `/api/v1/courses/${foreignCourse.id}/widgets`,
      {
        headers: mutationHeaders(`${apiPrefix}-foreign-course`),
        data: {
          type: "info",
          title: "Tenantfremd",
          text: "Dieser Kurs darf nicht erreichbar sein.",
        },
      },
    );
    requestIds.push(foreignCourseResponse.headers()["x-request-id"]);
    expect(foreignCourseResponse.status()).toBe(404);

    const apiDelete = await request.delete(
      `/api/v1/courses/${courseId}/widgets/${apiWidgetId}`,
      { headers: mutationHeaders(`${apiPrefix}-delete`) },
    );
    requestIds.push(apiDelete.headers()["x-request-id"]);
    expect(apiDelete.status()).toBe(200);

    const [apiEvidence] = await client<
      Array<{ activity_count: number; audit_count: number; widget_count: number }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and type like 'course.widget.%'
            and (
              metadata ->> 'courseId' = ${courseId}
              or entity_id = ${courseId}
            )) as activity_count,
        (select count(*)::int from api_audit_logs
          where request_id = any(${requestIds}::uuid[])
            and action like 'course.widget.%') as audit_count,
        (select count(*)::int from course_widgets where course_id = ${courseId}) as widget_count
    `;
    expect(apiEvidence.activity_count).toBeGreaterThanOrEqual(4);
    expect(apiEvidence.audit_count).toBe(requestIds.length);
    expect(apiEvidence.widget_count).toBe(0);

    adminContext = await browser.newContext();
    memberContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const memberPage = await memberContext.newPage();
    await login(adminPage, "admin");
    await adminPage.goto(`/admin/courses/${courseId}`);
    await adminPage.getByRole("tab", { name: "Widgets" }).click();

    await adminPage.getByRole("button", { name: "Autor-Karte", exact: true }).click();
    let form = adminPage.locator("form").filter({ hasText: "Widget anlegen" });
    await form.getByLabel("Teammitglied").selectOption(ownerId);
    await form.getByLabel("Rolle", { exact: true }).fill("Praxis-Mentor");
    await form
      .getByLabel("Beschreibung")
      .fill("Begleitet den Transfer in den Arbeitsalltag.");
    await form.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(adminPage.getByText("Kurs-Widget angelegt.")).toBeVisible();

    await adminPage.getByRole("button", { name: "Info-Karte", exact: true }).click();
    form = adminPage.locator("form").filter({ hasText: "Widget anlegen" });
    await form.getByLabel("Titel").fill(infoTitle);
    await form
      .getByLabel("Text")
      .fill("Fragen werden jeden Freitag gemeinsam geklaert.");
    await form.getByLabel("Link (optional)").fill("/academy/events");
    await form.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(adminPage.getByText(infoTitle, { exact: true })).toBeVisible();

    await adminPage.getByRole("button", { name: "Bild-Karte", exact: true }).click();
    form = adminPage.locator("form").filter({ hasText: "Widget anlegen" });
    await form.locator('input[type="file"]').setInputFiles({
      name: "private-widget.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      form.getByText("Geprüft und bereit", { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await form.getByLabel("Alternativtext").fill(imageAlt);
    await form.getByLabel("Link", { exact: true }).fill("/academy/courses");
    await form.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(adminPage.getByAltText(imageAlt)).toBeVisible();
    const [privateWidgetRow] = await client<
      Array<{ media_asset_id: string; image_url: string; binding_count: number }>
    >`
      select
        cw.media_asset_id,
        cw.image_url,
        (select count(*)::int from course_media_assets cma
          where cma.organization_id = cw.organization_id
            and cma.course_id = cw.course_id
            and cma.media_asset_id = cw.media_asset_id) as binding_count
      from course_widgets cw
      where cw.organization_id = ${organizationId}
        and cw.course_id = ${courseId}
        and cw.type = 'image_link'
        and cw.alt_text = ${imageAlt}
      limit 1
    `;
    widgetMediaAssetId = privateWidgetRow.media_asset_id;
    expect(privateWidgetRow).toEqual({
      media_asset_id: widgetMediaAssetId,
      image_url: `/api/media-assets/${widgetMediaAssetId}/download`,
      binding_count: 1,
    });
    const boundDelete = await adminPage.evaluate(async (assetId) => {
      const response = await fetch(`/api/media-assets/${assetId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      return response.status;
    }, widgetMediaAssetId);
    expect(boundDelete).toBe(409);

    const deleteTitle = `Zu loeschen ${suffix}`;
    await adminPage.getByRole("button", { name: "Info-Karte", exact: true }).click();
    form = adminPage.locator("form").filter({ hasText: "Widget anlegen" });
    await form.getByLabel("Titel").fill(deleteTitle);
    await form.getByLabel("Text").fill("Nur fuer den Loeschtest.");
    await form.getByRole("button", { name: "Widget anlegen" }).click();
    const deleteCard = adminPage.locator("article").filter({ hasText: deleteTitle });
    await deleteCard.getByRole("button", { name: "Info-Karte löschen" }).click();
    await deleteCard.getByRole("button", { name: "Löschen", exact: true }).click();
    await expect(adminPage.getByText(deleteTitle, { exact: true })).toBeHidden();

    let infoCard = adminPage.locator("article").filter({ hasText: infoTitle });
    const infoWidgetId = await infoCard.getAttribute("data-widget-id");
    expect(infoWidgetId).toBeTruthy();
    infoCard = adminPage.locator(`[data-widget-id="${infoWidgetId}"]`);
    await infoCard.getByRole("button", { name: "Info-Karte bearbeiten" }).click();
    await infoCard.getByLabel("Titel").fill(updatedInfoTitle);
    await infoCard
      .getByRole("button", { name: "Änderungen speichern" })
      .click();
    await expect(
      adminPage.getByText(updatedInfoTitle, { exact: true }),
    ).toBeVisible();

    let imageCard = adminPage.locator("article").filter({ has: adminPage.getByAltText(imageAlt) });
    await imageCard
      .getByRole("button", { name: "Bild-Karte nach oben" })
      .click();
    await expect
      .poll(async () => {
        const rows = await client<Array<{ type: string }>>`
          select type from course_widgets where course_id = ${courseId}
          order by sort_order, id
        `;
        return rows.map((row) => row.type).join(",");
      })
      .toBe("author,image_link,info");
    imageCard = adminPage.locator("article").filter({ has: adminPage.getByAltText(imageAlt) });
    await imageCard
      .getByRole("button", { name: "Bild-Karte nach oben" })
      .click();
    await expect
      .poll(async () => {
        const rows = await client<Array<{ type: string }>>`
          select type from course_widgets where course_id = ${courseId}
          order by sort_order, id
        `;
        return rows.map((row) => row.type).join(",");
      })
      .toBe("image_link,author,info");

    await adminPage.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect(
      adminPage.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();

    const [published] = await client<
      Array<{
        widget_count: number;
        schema_version: number;
        first_type: string;
        media_asset_id: string;
        image_url: string;
        author_name: string;
        info_title: string;
      }>
    >`
      select
        jsonb_array_length(cv.snapshot -> 'widgets') as widget_count,
        (cv.snapshot ->> 'schemaVersion')::int as schema_version,
        cv.snapshot -> 'widgets' -> 0 ->> 'type' as first_type,
        cv.snapshot -> 'widgets' -> 0 ->> 'mediaAssetId' as media_asset_id,
        cv.snapshot -> 'widgets' -> 0 ->> 'imageUrl' as image_url,
        cv.snapshot -> 'widgets' -> 1 -> 'author' ->> 'firstName' as author_name,
        cv.snapshot -> 'widgets' -> 2 ->> 'title' as info_title
      from courses c
      join course_versions cv on cv.id = c.published_version_id
      where c.id = ${courseId}
    `;
    expect(published).toEqual({
      widget_count: 3,
      schema_version: 6,
      first_type: "image_link",
      media_asset_id: widgetMediaAssetId,
      image_url: `/api/media-assets/${widgetMediaAssetId}/download`,
      author_name: fixture.owner_first_name,
      info_title: updatedInfoTitle,
    });

    const cloneResponse = await request.post(
      `/api/v1/courses/${courseId}/clone`,
      {
        headers: mutationHeaders(`${apiPrefix}-clone`),
        data: { title: `Widget-Kurs Clone ${suffix}` },
      },
    );
    requestIds.push(cloneResponse.headers()["x-request-id"]);
    expect(cloneResponse.status()).toBe(201);
    cloneId = (await cloneResponse.json()).data.id as string;
    const [cloneEvidence] = await client<
      Array<{ media_asset_id: string; image_url: string; binding_count: number }>
    >`
      select
        cw.media_asset_id,
        cw.image_url,
        (select count(*)::int from course_media_assets cma
          where cma.organization_id = cw.organization_id
            and cma.course_id = cw.course_id
            and cma.media_asset_id = cw.media_asset_id) as binding_count
      from course_widgets cw
      where cw.organization_id = ${organizationId}
        and cw.course_id = ${cloneId}
        and cw.type = 'image_link'
      limit 1
    `;
    expect(cloneEvidence).toEqual({
      media_asset_id: widgetMediaAssetId,
      image_url: `/api/media-assets/${widgetMediaAssetId}/download`,
      binding_count: 1,
    });

    await login(memberPage, "member");
    await memberPage.goto(`/academy/courses/${courseSlug}`);
    await expect(memberPage.getByAltText(imageAlt)).toBeVisible();
    await expect(memberPage.getByText("Praxis-Mentor", { exact: true })).toBeVisible();
    await expect(
      memberPage.getByRole("heading", { name: updatedInfoTitle }),
    ).toBeVisible();
    expect(
      await memberPage.locator("[data-course-widget]").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-course-widget")),
      ),
    ).toEqual(["image_link", "author", "info"]);

    await adminPage.getByRole("tab", { name: "Widgets" }).click();
    infoCard = adminPage.locator(`[data-widget-id="${infoWidgetId}"]`);
    await infoCard.getByRole("button", { name: "Info-Karte bearbeiten" }).click();
    await infoCard.getByLabel("Titel").fill(draftInfoTitle);
    await infoCard
      .getByRole("button", { name: "Änderungen speichern" })
      .click();
    await memberPage.reload();
    await expect(
      memberPage.getByRole("heading", { name: updatedInfoTitle }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("heading", { name: draftInfoTitle }),
    ).toBeHidden();
  } finally {
    const mediaIds = [widgetMediaAssetId, restMediaAssetId].filter(Boolean);
    const storageKeys = mediaIds.length
      ? await client<
          Array<{ storage_key: string; staging_storage_key: string }>
        >`
          select storage_key, staging_storage_key
          from media_assets
          where id = any(${mediaIds}::uuid[])
        `
      : [];
    await closeContext(adminContext);
    await closeContext(memberContext);
    if (requestIds.length) {
      await client`delete from api_audit_logs where request_id = any(${requestIds}::uuid[])`;
    }
    if (organizationId) {
      await client`
        delete from api_idempotency_keys
        where organization_id = ${organizationId} and key like ${`${apiPrefix}%`}
      `;
    }
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id = ${courseId}
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    if (cloneId) await client`delete from courses where id = ${cloneId}`;
    if (mediaIds.length) {
      await client`delete from media_assets where id = any(${mediaIds}::uuid[])`;
      for (const key of storageKeys.flatMap((row) => [
        row.storage_key,
        row.staging_storage_key,
      ])) {
        await unlink(
          resolve(process.cwd(), ".data", "media", ...key.split("/")),
        ).catch(() => undefined);
      }
    }
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end();
  }
});

test("course widget editor and learner cards fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only viewport audit.");
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const slug = `mobile-widgets-${suffix}`;
  let courseId = "";
  try {
    const [fixture] = await client<
      Array<{ owner_id: string; member_id: string; organization_id: string }>
    >`
      select owner.id as owner_id, member.id as member_id, owner.organization_id
      from users owner
      join users member on member.organization_id = owner.organization_id
        and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, certificate_enabled, created_by_id
      ) values (
        ${fixture.organization_id}, ${`Mobile Widgets ${suffix}`}, ${slug},
        'Responsive Kurs-Widgets fuer kleine Viewports.',
        'Autor-, Info- und Bild-Karten bleiben im mobilen Kurs ohne Ueberlauf.',
        'draft', false, ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;
    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${fixture.member_id}, ${courseId}, true) returning id
    `;
    await client`
      insert into course_access_grants (organization_id, user_id, course_id, source)
      values (
        ${fixture.organization_id}, ${fixture.member_id}, ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;
    await client`
      insert into course_widgets (
        organization_id, course_id, type, sort_order, author_user_id,
        author_role, author_description
      ) values (
        ${fixture.organization_id}, ${courseId}, 'author', 0, ${fixture.owner_id},
        'Mobile Kursleitung', 'Ansprechperson fuer den mobilen Lernpfad.'
      )
    `;
    await client`
      insert into course_widgets (
        organization_id, course_id, type, sort_order, title, text, link_url
      ) values (
        ${fixture.organization_id}, ${courseId}, 'info', 1,
        'Mobiler Hinweis', 'Diese Karte passt ohne horizontales Scrollen.',
        '/academy/events'
      )
    `;
    await client`
      insert into course_widgets (
        organization_id, course_id, type, sort_order, image_url, alt_text, link_url
      ) values (
        ${fixture.organization_id}, ${courseId}, 'image_link', 2,
        '/images/courses/foundations.webp', 'Mobiles Kursbild', '/academy/courses'
      )
    `;

    await login(page, "admin");
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("tab", { name: "Widgets" }).click();
    await expect(page.getByRole("heading", { name: "Kurs-Widgets" })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect(
      page.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();

    await page.context().clearCookies();
    await login(page, "member");
    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByText("Mobile Kursleitung", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mobiler Hinweis" })).toBeVisible();
    await expect(page.getByAltText("Mobiles Kursbild")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("course-widgets-mobile.png"),
      fullPage: true,
    });
  } finally {
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id = ${courseId}
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    await client.end();
  }
});
