import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getImageLightboxCopy } from "../src/lib/i18n/image-lightbox";
import type { AppLocale } from "../src/lib/i18n/model";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(
  page: Page,
  origin: string,
  email: string,
  password: string,
  destination: "/admin" | "/academy",
) {
  await page.context().clearCookies();
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .locator('form:has(input[name="email"]) button[type="submit"]')
    .click();
  await page.waitForURL(`${origin}${destination}`);
}

test("community attachments and GalleryContent share an accessible localized image lightbox", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const locale: AppLocale = testInfo.project.name === "mobile" ? "fr" : "en";
  const copy = getImageLightboxCopy(locale);
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const slug = `lightbox-${locale}-${suffix}`;
  const origin = `http://${slug}.localhost:3000`;
  const ownerEmail = `lightbox-owner-${suffix}@example.test`;
  const memberEmail = `lightbox-member-${suffix}@example.test`;
  const password = "Demo123!";
  const postTitle = `Tenant post ${suffix}`;
  const postContent = `Tenant-authored community content ${suffix}`;
  const imageNames = [
    `Tenant image one ${suffix}.webp`,
    `Tenant image two ${suffix}.webp`,
  ];
  const documentName = `Tenant document ${suffix}.txt`;
  const galleryAlts = [
    `Tenant gallery alt one ${suffix}`,
    `Tenant gallery alt two ${suffix}`,
  ];
  const galleryCaptions = [
    `Tenant gallery caption one ${suffix}`,
    `Tenant gallery caption two ${suffix}`,
  ];
  const writtenFiles: string[] = [];

  try {
    const [template] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    if (!template) throw new Error("Seeded login fixture is missing.");

    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId}, ${`Lightbox tenant ${suffix}`}, ${slug}, ${locale}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
        (
          ${ownerId}, ${organizationId}, ${ownerEmail}, ${template.passwordHash},
          'Lightbox', 'Owner', 'owner', 'active', ${locale}
        ),
        (
          ${memberId}, ${organizationId}, ${memberEmail}, ${template.passwordHash},
          'Lightbox', 'Member', 'member', 'active', ${locale}
        )
    `;
    const [area] = await sql<Array<{ id: string }>>`
      insert into community_areas (
        organization_id, title, slug, description, sort_order
      ) values (
        ${organizationId}, ${`Media area ${suffix}`}, ${`media-area-${suffix}`},
        ${`Tenant area description ${suffix}`}, 0
      )
      returning id
    `;
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Media space ${suffix}`},
        ${`media-space-${suffix}`}, ${`Tenant space description ${suffix}`},
        '#2b9188', 'discussion', 'open', 0
      )
      returning id
    `;
    const [post] = await sql<Array<{ id: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content,
        moderation_state, moderation_version, published_at
      ) values (
        ${organizationId}, ${space.id}, ${memberId}, ${postTitle}, ${postContent},
        'published', 1, now()
      )
      returning id
    `;

    const imageBuffers = await Promise.all([
      readFile(
        resolve(process.cwd(), "public/images/courses/foundations.webp"),
      ),
      readFile(resolve(process.cwd(), "public/images/courses/prompts.webp")),
    ]);

    async function createAsset(input: {
      name: string;
      kind: "image" | "document";
      mimeType: string;
      extension: string;
      body: Buffer;
    }) {
      const id = randomUUID();
      const storageKey = `tenants/${organizationId}/assets/${id}/ready.${input.extension}`;
      const stagingStorageKey = `incoming/tenants/${organizationId}/assets/${id}/incoming.${input.extension}`;
      const storagePath = resolve(
        process.cwd(),
        ".data",
        "media",
        ...storageKey.split("/"),
      );
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, input.body);
      writtenFiles.push(storagePath);
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
          status, storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          detected_mime_type, declared_size_bytes, actual_size_bytes,
          quota_bytes, upload_expires_at, uploaded_at, scan_completed_at
        ) values (
          ${id}, ${organizationId}, ${memberId}, ${memberId}, 'community',
          ${input.kind}, 'ready', 'filesystem', ${storageKey},
          ${stagingStorageKey}, ${input.name},
          ${`lightbox-${id.slice(0, 8)}.${input.extension}`}, ${input.mimeType},
          ${input.mimeType}, ${input.body.length}, ${input.body.length},
          ${input.body.length}, now() + interval '1 hour', now(), now()
        )
      `;
      return id;
    }

    const imageIds = await Promise.all(
      imageNames.map((name, index) =>
        createAsset({
          name,
          kind: "image",
          mimeType: "image/webp",
          extension: "webp",
          body: imageBuffers[index],
        }),
      ),
    );
    const documentId = await createAsset({
      name: documentName,
      kind: "document",
      mimeType: "text/plain",
      extension: "txt",
      body: Buffer.from(`Tenant document content ${suffix}.\n`, "utf8"),
    });
    await sql`
      insert into community_post_attachments (
        organization_id, post_id, media_asset_id, sort_order
      ) values
        (${organizationId}, ${post.id}, ${imageIds[0]}, 0),
        (${organizationId}, ${post.id}, ${imageIds[1]}, 1),
        (${organizationId}, ${post.id}, ${documentId}, 2)
    `;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        certificate_enabled, created_by_id
      ) values (
        ${organizationId}, ${`Gallery course ${suffix}`},
        ${`gallery-course-${suffix}`}, 'Lightbox gallery fixture.',
        'Tenant-authored gallery preview.', 'draft', false, ${ownerId}
      )
      returning id
    `;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, estimated_minutes
      ) values (
        ${organizationId}, ${`Gallery module ${suffix}`},
        'Lightbox module fixture.', 5
      )
      returning id
    `;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      ) values (${organizationId}, ${course.id}, ${learningModule.id}, 0, true)
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, sort_order, status
      ) values (
        ${organizationId}, ${learningModule.id}, ${`Gallery lesson ${suffix}`},
        ${`gallery-lesson-${suffix}`}, 'Lightbox lesson fixture.', 'lesson',
        5, 0, 'published'
      )
      returning id
    `;
    await sql`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, 'gallery', ${`Gallery ${suffix}`}, 0, false,
        ${sql.json({
          gallery: {
            version: 1,
            layout: "grid",
            items: [
              {
                source: "/images/courses/foundations.webp",
                alt: galleryAlts[0],
                caption: galleryCaptions[0],
              },
              {
                source: "/images/courses/prompts.webp",
                alt: galleryAlts[1],
                caption: galleryCaptions[1],
              },
            ],
          },
        })}
      )
    `;

    await login(page, origin, memberEmail, password, "/academy");
    await page.goto(`${origin}/academy/community`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const article = page.locator(`#post-${post.id}`);
    await expect(article.getByText(postContent, { exact: true })).toBeVisible();
    const firstTrigger = article.getByRole("button", {
      name: copy.openImage(imageNames[0]),
    });
    await firstTrigger.click();

    let dialog = page.getByRole("dialog", { name: copy.dialogTitle });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: copy.close }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("img", { name: imageNames[0] }),
    ).toBeVisible();
    await expect(
      dialog.getByText(copy.position("1", "2"), { exact: false }),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      dialog.getByRole("img", { name: imageNames[1] }),
    ).toBeVisible();
    await dialog
      .getByRole("button", {
        name: copy.selectImage(copy.position("1", "2"), imageNames[0]),
      })
      .click();
    await expect(
      dialog.getByRole("img", { name: imageNames[0] }),
    ).toBeVisible();

    const thumbnailButtons = dialog
      .getByRole("list", { name: copy.thumbnails })
      .getByRole("button");
    await thumbnailButtons.last().focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("link", { name: copy.openOriginal }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("link", { name: copy.openOriginal }),
    ).toHaveAttribute(
      "href",
      `/api/media-assets/${imageIds[0]}/download?disposition=inline`,
    );

    const viewport = page.viewportSize();
    const dialogBox = await dialog.boundingBox();
    expect(viewport).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
      viewport!.width + 1,
    );
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(
      viewport!.height + 1,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`community-lightbox-${locale}.png`),
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(firstTrigger).toBeFocused();
    await expect(
      article.getByRole("link", { name: new RegExp(documentName) }),
    ).toHaveAttribute("href", `/api/media-assets/${documentId}/download`);

    await login(page, origin, ownerEmail, password, "/admin");
    await page.goto(
      `${origin}/admin/courses/${course.id}/preview?lesson=${lesson.id}`,
      { waitUntil: "networkidle" },
    );
    const gallery = page.getByRole("region", { name: copy.galleryLabel });
    await expect(
      gallery.getByText(galleryCaptions[0], { exact: true }),
    ).toBeVisible();
    const galleryTrigger = gallery.getByRole("button", {
      name: copy.openImage(galleryAlts[0]),
    });
    await galleryTrigger.click();
    dialog = page.getByRole("dialog", { name: copy.dialogTitle });
    await expect(
      dialog.getByText(galleryCaptions[0], { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: copy.next }).click();
    await expect(
      dialog.getByRole("img", { name: galleryAlts[1] }),
    ).toBeVisible();
    await expect(
      dialog.getByText(galleryCaptions[1], { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(
      dialog.getByRole("img", { name: galleryAlts[0] }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`gallery-lightbox-${locale}.png`),
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(galleryTrigger).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = 'replica'`;
      await transaction`delete from organizations where id = ${organizationId}`;
    });
    await sql.end();
    await Promise.all(
      writtenFiles.map((path) => unlink(path).catch(() => undefined)),
    );
  }
});
