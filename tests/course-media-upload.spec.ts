import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

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

test("private course media is scanned, versioned and limited to course access", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const outsiderEmail = `course-media-outsider-${suffix}@q-academy.test`;
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let mediaAssetId = "";

  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        owner_id: string;
        member_id: string;
        password_hash: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        member.id as member_id,
        member.password_hash
      from users owner
      join users member on member.organization_id = owner.organization_id
      where owner.email = 'admin@q-academy.de'
        and member.email = 'lea@q-academy.de'
      limit 1
    `;
    const [outsider] = await sql<{ id: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${fixture.organization_id}, ${outsiderEmail}, ${fixture.password_hash},
        'Course', 'Outsider', 'member', 'active'
      ) returning id
    `;
    const courseSlug = `private-media-${suffix}`;
    const [course] = await sql<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values (
        ${fixture.organization_id}, ${`Privater Medienkurs ${suffix}`},
        ${courseSlug}, 'Private Kursmedien.',
        'E2E-Kurs fuer sichere private Medien.', 'draft', ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<{ id: string }[]>`
      insert into modules (
        organization_id, title, folder, is_reusable, estimated_minutes
      ) values (${fixture.organization_id}, 'Privates Medienmodul', 'E2E', false, 15)
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, drip_days, is_required
      )
      values (${fixture.organization_id}, ${courseId}, ${moduleId}, 0, 0, true)
    `;
    const [lesson] = await sql<{ id: string }[]>`
      insert into lessons (
        organization_id, module_id, title, slug, type, status,
        duration_minutes, sort_order
      ) values (
        ${fixture.organization_id}, ${moduleId}, 'Private Medienlektion',
        ${`private-media-${suffix}`},
        'lesson', 'published', 15, 0
      ) returning id
    `;
    lessonId = lesson.id;
    await sql`
      insert into enrollments (user_id, course_id, status, progress, access_active)
      values (${fixture.member_id}, ${courseId}, 'not_started', 0, true)
    `;

    await loginAsAdmin(page);
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("button", { name: "Bild", exact: true }).click();
    await page.getByRole("button", { name: "Bild: Bearbeiten" }).click();
    const editor = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await editor.getByLabel("Titel").fill("Privates Kursbild");
    await editor
      .getByRole("button", { name: "Bild hochladen", exact: true })
      .click();
    await editor.locator('input[type="file"]').setInputFiles({
      name: "private-course.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(editor.getByText("Geprueft und bereit", { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    await editor
      .getByLabel("Bildunterschrift")
      .fill("Nur fuer berechtigte Teilnehmende.");
    await editor
      .getByRole("button", { name: "Aenderungen speichern" })
      .click();
    await expect(page.getByRole("img", { name: "Privates Kursbild" })).toBeVisible();

    const [block] = await sql<
      Array<{ media_asset_id: string; image_url: string }>
    >`
      select
        data->>'mediaAssetId' as media_asset_id,
        data->>'imageUrl' as image_url
      from content_blocks
      where lesson_id = ${lessonId} and type = 'image'
      limit 1
    `;
    mediaAssetId = block.media_asset_id;
    expect(block.image_url).toBe(`/api/media-assets/${mediaAssetId}/download`);
    const [bindingBeforePublish] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.organization_id}
        and course_id = ${courseId}
        and media_asset_id = ${mediaAssetId}
    `;
    expect(bindingBeforePublish.count).toBe(1);

    const boundDelete = await page.evaluate(async (assetId) => {
      const response = await fetch(`/api/media-assets/${assetId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      return response.status;
    }, mediaAssetId);
    expect(boundDelete).toBe(409);

    await page.getByRole("button", { name: "Kurs veroeffentlichen" }).click();
    await expect(
      page.getByRole("button", { name: "Aenderungen veroeffentlichen" }),
    ).toBeVisible();
    const [published] = await sql<
      Array<{ media_asset_id: string; versions: number }>
    >`
      select
        cv.snapshot #>> '{modules,0,lessons,0,blocks,0,data,mediaAssetId}'
          as media_asset_id,
        count(*) over ()::int as versions
      from course_versions cv
      where cv.course_id = ${courseId} and cv.published_at is not null
      order by cv.version desc
      limit 1
    `;
    expect(published.media_asset_id).toBe(mediaAssetId);
    expect(published.versions).toBe(1);

    await loginAsMember(page, "lea@q-academy.de");
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    const privateImage = page.getByRole("img", { name: "Privates Kursbild" });
    await expect(privateImage).toBeVisible();
    await expect(privateImage).toHaveAttribute(
      "src",
      `/api/media-assets/${mediaAssetId}/download`,
    );
    const authorized = await page.request.get(
      `/api/media-assets/${mediaAssetId}/download`,
    );
    expect(authorized.status()).toBe(200);
    expect(authorized.headers()["content-type"]).toBe("image/png");

    await loginAsMember(page, outsiderEmail);
    const denied = await page.request.get(
      `/api/media-assets/${mediaAssetId}/download`,
    );
    expect(denied.status()).toBe(404);
    const deniedLesson = await page.goto(
      `/academy/courses/${courseSlug}/learn/${lessonId}`,
    );
    expect(deniedLesson?.status()).toBe(404);

    await sql`delete from users where id = ${outsider.id}`;
  } finally {
    let storageKeys: Array<{ storage_key: string; staging_storage_key: string }> = [];
    if (mediaAssetId) {
      storageKeys = await sql`
        select storage_key, staging_storage_key
        from media_assets where id = ${mediaAssetId}
      `;
    }
    if (courseId) await sql`delete from courses where id = ${courseId}`;
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql`delete from users where email = ${outsiderEmail}`;
    if (mediaAssetId) {
      await sql`delete from media_assets where id = ${mediaAssetId}`;
      for (const key of storageKeys.flatMap((row) => [row.storage_key, row.staging_storage_key])) {
        await unlink(resolve(process.cwd(), ".data", "media", ...key.split("/"))).catch(
          () => undefined,
        );
      }
    }
    await sql.end();
  }
});
