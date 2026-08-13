import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("member preview shows every resolved poster until its video starts", async ({
  page,
}, testInfo) => {
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const videoAssetIds = [randomUUID(), randomUUID(), randomUUID()];
  const uploadedPosterId = randomUUID();
  const titles = {
    auto: `Auto Poster ${suffix}`,
    frame: `Frame Poster ${suffix}`,
    upload: `Upload Poster ${suffix}`,
  };
  let courseId = "";
  let moduleId = "";

  try {
    const [owner] = await sql<Array<{ id: string; organizationId: string }>>`
      select id, organization_id as "organizationId"
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    expect(owner).toBeTruthy();
    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values (
        ${owner.organizationId}, ${`Poster Preview ${suffix}`},
        ${`poster-preview-${suffix}`}, 'Poster preview.',
        'Poster-first member preview test.', 'draft', ${owner.id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (organization_id, title, estimated_minutes)
      values (${owner.organizationId}, ${`Poster Module ${suffix}`}, 5)
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order
      ) values (${owner.organizationId}, ${courseId}, ${moduleId}, 0)
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, status, sort_order
      ) values (
        ${owner.organizationId}, ${moduleId}, ${`Poster Lesson ${suffix}`},
        ${`poster-lesson-${suffix}`}, 'published', 0
      ) returning id
    `;
    await sql`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values
        (
          ${lesson.id}, 'video', ${titles.auto}, 0, false,
          ${sql.json({
            mediaAssetId: videoAssetIds[0],
            videoUrl: `/api/media-assets/${videoAssetIds[0]}/download`,
          })}
        ),
        (
          ${lesson.id}, 'video', ${titles.frame}, 1, false,
          ${sql.json({
            mediaAssetId: videoAssetIds[1],
            videoUrl: `/api/media-assets/${videoAssetIds[1]}/download`,
            videoPoster: {
              version: 1,
              source: "frame",
              atMilliseconds: 4_200,
            },
          })}
        ),
        (
          ${lesson.id}, 'video', ${titles.upload}, 2, false,
          ${sql.json({
            mediaAssetId: videoAssetIds[2],
            videoUrl: `/api/media-assets/${videoAssetIds[2]}/download`,
            videoPoster: {
              version: 1,
              source: "upload",
              mediaAssetId: uploadedPosterId,
              mediaAssetName: "poster.png",
            },
          })}
        )
    `;

    await page.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value(this: HTMLMediaElement) {
          const current = Number(this.dataset.playInvocations ?? "0");
          this.dataset.playInvocations = String(current + 1);
          this.dispatchEvent(new Event("play"));
          return Promise.resolve();
        },
      });
    });
    await page.route("**/api/media-assets/**", async (route) => {
      const url = route.request().url();
      const isPoster =
        url.includes("/derivatives/thumbnail") ||
        url.includes(`/media-assets/${uploadedPosterId}/download`);
      await route.fulfill({
        status: 200,
        contentType: isPoster ? "image/png" : "video/mp4",
        body: isPoster ? png : Buffer.alloc(0),
      });
    });

    await page.goto("/login");
    await page
      .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
      .click();
    await page.waitForURL("**/admin");
    await page.goto(`/admin/courses/${courseId}/preview?lesson=${lesson.id}`);

    const cases = [
      {
        title: titles.auto,
        poster: `/api/media-assets/${videoAssetIds[0]}/derivatives/thumbnail`,
      },
      {
        title: titles.frame,
        poster: `/api/media-assets/${videoAssetIds[1]}/derivatives/thumbnail?atMilliseconds=4200`,
      },
      {
        title: titles.upload,
        poster: `/api/media-assets/${uploadedPosterId}/download`,
      },
    ];

    for (const entry of cases) {
      const section = page
        .getByRole("heading", { name: entry.title, exact: true })
        .locator("..");
      const start = section.getByRole("button", {
        name: `${entry.title} abspielen`,
        exact: true,
      });
      const video = section.locator("video");
      await expect(start).toBeVisible();
      await expect(start.locator("img")).toHaveAttribute("src", entry.poster);
      await expect(video).toHaveAttribute("preload", "none");

      await start.click();
      await expect(start).toHaveCount(0);
      await expect(video).toHaveAttribute("data-play-invocations", "1");
      await expect(video).toHaveAttribute("preload", "metadata");

      await video.evaluate((element) => {
        element.dispatchEvent(new Event("pause"));
        element.dispatchEvent(new Event("ended"));
      });
      await expect(section.locator("[data-video-poster-start]")).toHaveCount(0);
    }
  } finally {
    if (courseId) await sql`delete from courses where id = ${courseId}`;
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end({ timeout: 5 });
  }
});
