import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const courseCopy = getMainPageDictionary("de").admin.courseEditor;

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(page: Page, role: "admin" | "member") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

test("button and gallery blocks work from authoring to responsive learner views", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const courseTitle = `Interaktive Inhalte ${suffix}`;
  const courseSlug = `interactive-content-${suffix}`;
  const moduleTitle = `Interaktive Bausteine ${suffix}`;
  const lessonTitle = `Galerie und Link ${suffix}`;
  const buttonLabel = `Leitfaden ${suffix}`;
  const uploadFileName = `gallery-${suffix}.png`;
  const firstAlt = `Geprueftes Galeriebild ${suffix}`;
  const secondAlt = `Externes Galeriebild ${suffix}`;
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let organizationId = "";

  try {
    const [fixture] = await client<
      Array<{ owner_id: string; member_id: string; organization_id: string }>
    >`
      select
        owner.id as owner_id,
        member.id as member_id,
        owner.organization_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;

    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        certificate_enabled,
        created_by_id
      ) values (
        ${organizationId},
        ${courseTitle},
        ${courseSlug},
        'Button- und Galerie-Bloecke im fokussierten Browsertest.',
        'Dieser Kurs prueft sichere Links, gepruefte Galerie-Assets und responsive Lernansichten.',
        'draft',
        false,
        ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (
        organization_id,
        title,
        description,
        estimated_minutes
      ) values (
        ${organizationId},
        ${moduleTitle},
        'Isoliertes Modul fuer interaktive Inhaltsbloecke.',
        10
      )
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values (${organizationId}, ${courseId}, ${moduleId}, 0, true)
    `;
    const [lesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id,
        module_id,
        title,
        slug,
        summary,
        type,
        duration_minutes,
        sort_order,
        status
      ) values (
        ${organizationId},
        ${moduleId},
        ${lessonTitle},
        'galerie-und-link',
        'Sichere eigenstaendige Handlungs- und Bildbloecke.',
        'lesson',
        10,
        0,
        'published'
      )
      returning id
    `;
    lessonId = lesson.id;
    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${fixture.member_id}, ${courseId}, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id,
        user_id,
        course_id,
        source
      ) values (
        ${organizationId},
        ${fixture.member_id},
        ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;

    await login(page, "admin");
    await page.goto(`/admin/courses/${courseId}`);

    await page
      .getByRole("button", { name: "Button / Link", exact: true })
      .click();
    await expect(
      page.getByText("Inhaltselement hinzugefuegt.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `${courseCopy.block.defaultLearnMore}: ${courseCopy.common.edit}`,
      })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await dialog.getByLabel("Beschriftung").fill(buttonLabel);
    await dialog.getByLabel("Link-Ziel").fill("https://example.com/guide");
    await dialog.getByLabel("Darstellung").selectOption("secondary");
    await dialog
      .getByRole("button", { name: "Aenderungen speichern" })
      .click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Galerie", exact: true }).click();
    await expect(
      page.getByText("Inhaltselement hinzugefuegt.", { exact: true }).last(),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `${courseCopy.palette.gallery}: ${courseCopy.common.edit}`,
      })
      .click();
    dialog = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
    const firstImage = dialog.getByRole("region", { name: "Galeriebild 1" });
    await firstImage
      .getByRole("button", { name: "Galeriebild 1 hochladen" })
      .click();
    await firstImage.locator('input[type="file"]').setInputFiles({
      name: uploadFileName,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(
      firstImage.getByText("Geprüft und bereit", { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await firstImage.getByLabel("Alternativtext").fill(firstAlt);
    await firstImage
      .getByLabel("Bildunterschrift")
      .fill("Geprueftes Bild aus dem privaten Medienspeicher.");

    await dialog.getByRole("button", { name: "Bild hinzufügen" }).click();
    const secondImage = dialog.getByRole("region", { name: "Galeriebild 2" });
    await secondImage
      .getByRole("textbox", { name: "Galeriebild 2-URL" })
      .fill("https://example.com/gallery-two.png");
    await secondImage.getByLabel("Alternativtext").fill(secondAlt);
    await secondImage
      .getByLabel("Bildunterschrift")
      .fill("Zweite sichere HTTP-Bildquelle.");
    await dialog
      .locator("label")
      .filter({ hasText: "Hervorgehoben" })
      .click();
    await dialog
      .getByRole("button", { name: "Aenderungen speichern" })
      .click();
    await expect(dialog).toBeHidden();

    const rows = await client<
      Array<{
        type: string;
        data: {
          button?: { version: number; label: string; href: string; variant: string };
          gallery?: {
            version: number;
            layout: string;
            items: Array<{
              source: string;
              alt: string;
              mediaAssetId?: string;
            }>;
          };
        };
      }>
    >`
      select type, data
      from content_blocks
      where lesson_id = ${lessonId}
      order by sort_order
    `;
    const buttonBlock = rows.find((row) => row.type === "button");
    const galleryBlock = rows.find((row) => row.type === "gallery");
    expect(buttonBlock?.data.button).toMatchObject({
      version: 1,
      label: buttonLabel,
      href: "https://example.com/guide",
      variant: "secondary",
    });
    expect(galleryBlock?.data.gallery).toMatchObject({
      version: 1,
      layout: "featured",
      items: [
        {
          alt: firstAlt,
          source: expect.stringMatching(/^\/api\/media-assets\/.+\/download$/),
          mediaAssetId: expect.any(String),
        },
        {
          alt: secondAlt,
          source: "https://example.com/gallery-two.png",
        },
      ],
    });
    const mediaAssetId = galleryBlock?.data.gallery?.items[0]?.mediaAssetId;
    expect(mediaAssetId).toBeTruthy();
    const [binding] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${organizationId}
        and course_id = ${courseId}
        and media_asset_id = ${mediaAssetId!}
    `;
    expect(binding.count).toBe(1);

    await expect(page.getByRole("link", { name: buttonLabel })).toBeVisible();
    await expect(page.getByRole("img", { name: firstAlt })).toBeVisible();
    await expect(page.getByRole("img", { name: secondAlt })).toBeVisible();

    await page.goto(`/admin/courses/${courseId}/preview?lesson=${lessonId}`);
    await expect(page.getByRole("link", { name: buttonLabel })).toBeVisible();
    await expect(page.getByRole("region", { name: "Bildergalerie" })).toBeVisible();

    await page.goto(`/admin/courses/${courseId}`);
    await page
      .getByRole("button", { name: "Kurs veröffentlichen" })
      .click();
    await expect(
      page.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<Array<{ count: number }>>`
          select count(*)::int as count
          from course_versions
          where course_id = ${courseId}
        `;
        return row.count;
      })
      .toBe(1);

    await login(page, "member");
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    const learnerButton = page.getByRole("link", { name: buttonLabel });
    await expect(learnerButton).toHaveAttribute(
      "href",
      "https://example.com/guide",
    );
    await expect(learnerButton).toHaveAttribute("target", "_blank");
    await expect(learnerButton).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
    const privateImage = page.getByRole("img", { name: firstAlt });
    await expect(privateImage).toHaveAttribute(
      "src",
      `/api/media-assets/${mediaAssetId}/download`,
    );
    await expect(privateImage).toBeVisible();
    await expect(page.getByRole("img", { name: secondAlt })).toBeVisible();
    const authorized = await page.request.get(
      `/api/media-assets/${mediaAssetId}/download`,
    );
    expect(authorized.status()).toBe(200);
    expect(authorized.headers()["content-type"]).toBe("image/png");

    const gallery = page.getByRole("region", { name: "Bildergalerie" });
    const columnCount = await gallery.locator("ul").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean)
        .length,
    );
    expect(columnCount).toBe(testInfo.project.name === "mobile" ? 1 : 2);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`interactive-blocks-${testInfo.project.name}.png`),
      fullPage: false,
    });
  } finally {
    const assets = uploadFileName
      ? await client<
          Array<{
            id: string;
            storage_key: string;
            staging_storage_key: string;
          }>
        >`
          select id, storage_key, staging_storage_key
          from media_assets
          where original_file_name = ${uploadFileName}
        `
      : [];
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id in (${courseId || null}, ${moduleId || null}, ${lessonId || null})
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    for (const asset of assets) {
      await client`delete from media_assets where id = ${asset.id}`;
      for (const key of [asset.storage_key, asset.staging_storage_key]) {
        await unlink(
          resolve(process.cwd(), ".data", "media", ...key.split("/")),
        ).catch(() => undefined);
      }
    }
    await client.end({ timeout: 5 });
  }
});
