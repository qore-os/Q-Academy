import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createFile } from "mp4box";
import postgres from "postgres";

import { getCourseParityCopy } from "../src/lib/i18n/course-parity";
import { getCourseSupportCopy } from "../src/lib/i18n/course-support";
import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import { getVideoWorkflowCopy } from "../src/lib/i18n/video-workflow";
import { dropFiles } from "./helpers/media-drop";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const mediaCopy = getCourseSupportCopy("de").media;
const videoCopy = getCourseParityCopy("de").video;
const workflowCopy = getVideoWorkflowCopy("de");
const builderCopy = getMainPageDictionary("de").admin.courseEditor;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function mp4VideoFixture() {
  const file = createFile(true);
  file.init({
    brands: ["isom", "iso2", "mp41"],
    duration: 1_000,
    timescale: 1_000,
  });
  const trackId = file.addTrack({
    type: "avc1",
    hdlr: "vide",
    width: 16,
    height: 16,
    duration: 1_000,
    media_duration: 1_000,
    timescale: 1_000,
  });
  file.addSample(trackId, Uint8Array.from([0, 0, 0, 1, 9, 0x10]), {
    duration: 1_000,
    dts: 0,
    cts: 0,
    is_sync: true,
  });
  return Buffer.from(new Uint8Array(file.getBuffer().buffer));
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

test("a new video replacement defers server processing until it is saved", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Replacement lifecycle runs once.");
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const blockTitle = `Replacement lifecycle ${suffix}`;
  let courseId = "";
  let moduleId = "";
  let uploadedVideoId = "";
  let uploadedPosterId = "";
  let processingRequests = 0;
  const processingMethods: string[] = [];
  let processingResponse: "stored" | "delayed-missing" = "stored";
  let releaseMissingTranscript: (() => void) | undefined;
  const missingTranscriptGate = new Promise<void>((resolve) => {
    releaseMissingTranscript = resolve;
  });
  let descriptionRequests = 0;
  const storageKeys: string[] = [];

  try {
    const [owner] = await sql<Array<{ id: string; organization_id: string }>>`
      select id, organization_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${owner.organization_id}, ${`Replacement course ${suffix}`},
        ${`replacement-course-${suffix}`}, 'Replacement lifecycle.',
        'Video replacement lifecycle for deferred browser processing.',
        'draft', ${owner.id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (organization_id, title, estimated_minutes)
      values (${owner.organization_id}, ${`Replacement module ${suffix}`}, 10)
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order
      ) values (${owner.organization_id}, ${courseId}, ${moduleId}, 0)
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, sort_order
      ) values (
        ${owner.organization_id}, ${moduleId}, ${`Replacement lesson ${suffix}`},
        ${`replacement-lesson-${suffix}`}, 0
      )
      returning id
    `;
    await sql`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, 'video', ${blockTitle}, 0, false,
        ${sql.json({
          videoUrl: "https://example.com/original-video.mp4",
          caption: "Original description.",
        })}
      )
    `;

    await page.route("**/api/media-assets/*/processing**", async (route) => {
      processingRequests += 1;
      processingMethods.push(route.request().method());
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            id: "10000000-0000-4000-8000-000000000092",
            type: "transcript",
            status: "queued",
          }),
        });
        return;
      }
      if (processingResponse === "delayed-missing") {
        await missingTranscriptGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jobs: [], transcript: null }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobs: [],
          transcript: {
            language: "de",
            webVtt:
              "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nGespeicherter Lerninhalt.",
          },
        }),
      });
    });
    await page.route(
      "**/api/media-assets/*/video-description",
      async (route) => {
        descriptionRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            description: "Beschreibung fuer den gespeicherten Videoinhalt.",
          }),
        });
      },
    );

    await loginAsOwner(page);
    await page.goto(`/admin/courses/${courseId}`);
    await page
      .getByRole("button", { name: `${blockTitle}: Bearbeiten` })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await dialog
      .getByRole("button", { name: mediaCopy.uploadLabel("Video") })
      .click();
    const videoDropTarget = dialog
      .locator("label[for]:visible")
      .filter({ hasText: mediaCopy.selectFile })
      .first();
    await dropFiles(page, videoDropTarget, [
      {
        name: "replacement-video.mp4",
        mimeType: "video/mp4",
        buffer: mp4VideoFixture(),
      },
    ]);
    await expect(dialog.getByText(mediaCopy.ready, { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    uploadedVideoId = await dialog
      .locator('input[name="mediaAssetId"]:not([disabled])')
      .inputValue();
    expect(uploadedVideoId).toMatch(/^[0-9a-f-]{36}$/i);

    const posterGroup = dialog.locator(
      `[role="group"][aria-label="${workflowCopy.posterTitle}"]`,
    );
    const frameMode = posterGroup.getByRole("button", {
      name: workflowCopy.posterFrame,
    });
    const uploadMode = posterGroup.getByRole("button", {
      name: workflowCopy.posterUpload,
    });
    const variantsButton = dialog.getByRole("button", {
      name: videoCopy.createVariants,
    });
    const transcriptButton = dialog.getByRole("button", {
      name: videoCopy.transcribe,
    });
    const descriptionButton = dialog.getByRole("button", {
      name: workflowCopy.descriptionGenerate,
    });
    await expect(frameMode).toBeDisabled();
    await expect(uploadMode).toBeEnabled();
    await expect(variantsButton).toBeDisabled();
    await expect(transcriptButton).toBeDisabled();
    await expect(descriptionButton).toBeDisabled();

    await uploadMode.click();
    const posterDropTarget = dialog
      .locator("label[for]:visible")
      .filter({ hasText: mediaCopy.selectFile })
      .first();
    await dropFiles(page, posterDropTarget, [
      {
        name: "replacement-poster.png",
        mimeType: "image/png",
        buffer: png,
      },
    ]);
    const posterAssetInput = dialog.locator(
      'input[name="videoPosterAssetId"]:not([disabled])',
    );
    await expect(posterAssetInput).not.toHaveValue("", { timeout: 45_000 });
    uploadedPosterId = await posterAssetInput.inputValue();
    expect(uploadedPosterId).toMatch(/^[0-9a-f-]{36}$/i);
    await page.waitForTimeout(250);
    expect(processingRequests).toBe(0);
    expect(descriptionRequests).toBe(0);

    await dialog
      .getByRole("button", { name: builderCopy.dialogs.saveChanges })
      .click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await page
      .getByRole("button", { name: `${blockTitle}: Bearbeiten` })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await expect(dialog).toBeVisible();
    const reopenedPosterGroup = dialog.locator(
      `[role="group"][aria-label="${workflowCopy.posterTitle}"]`,
    );
    await expect(
      reopenedPosterGroup.getByRole("button", {
        name: workflowCopy.posterFrame,
      }),
    ).toBeEnabled();
    await expect(
      reopenedPosterGroup.getByRole("button", {
        name: workflowCopy.posterUpload,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      dialog.getByRole("button", { name: videoCopy.createVariants }),
    ).toBeEnabled();
    const reopenedTranscriptButton = dialog.getByRole("button", {
      name: videoCopy.transcribe,
    });
    await expect(dialog.locator('textarea[name="transcriptVtt"]')).toHaveValue(
      /Gespeicherter Lerninhalt\./,
      { timeout: 10_000 },
    );
    await expect(reopenedTranscriptButton).toBeEnabled();
    expect(processingRequests).toBeGreaterThanOrEqual(1);
    expect(processingMethods).not.toContain("POST");
    expect(processingMethods.every((method) => method === "GET")).toBe(true);
    expect(descriptionRequests).toBe(0);
    const reopenedDescriptionButton = dialog.getByRole("button", {
      name: workflowCopy.descriptionGenerate,
    });
    await expect(reopenedDescriptionButton).toBeEnabled();
    await reopenedDescriptionButton.click();
    await expect.poll(() => descriptionRequests).toBe(1);

    await dialog
      .getByRole("button", { name: builderCopy.common.closeDialog })
      .click();
    await expect(dialog).toBeHidden();
    processingResponse = "delayed-missing";
    const requestsBeforeLocalEdit = processingRequests;
    await page
      .getByRole("button", { name: `${blockTitle}: Bearbeiten` })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    const locallyEditedTranscript =
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nManuell bearbeiteter Inhalt.";
    const transcriptTextarea = dialog.locator('textarea[name="transcriptVtt"]');
    await expect.poll(() => processingRequests).toBeGreaterThan(
      requestsBeforeLocalEdit,
    );
    await transcriptTextarea.fill(locallyEditedTranscript);
    releaseMissingTranscript?.();
    await expect(transcriptTextarea).toHaveValue(locallyEditedTranscript);
    await page.waitForTimeout(500);
    await expect(transcriptTextarea).toHaveValue(locallyEditedTranscript);
    expect(processingMethods).not.toContain("POST");
  } finally {
    releaseMissingTranscript?.();
    const assetIds = [uploadedVideoId, uploadedPosterId].filter(Boolean);
    if (assetIds.length) {
      const rows = await sql<
        Array<{ storage_key: string; staging_storage_key: string }>
      >`
        select storage_key, staging_storage_key
        from media_assets
        where id in ${sql(assetIds)}
      `;
      storageKeys.push(
        ...rows.flatMap((row) => [row.storage_key, row.staging_storage_key]),
      );
    }
    if (courseId) await sql`delete from courses where id = ${courseId}`;
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    if (assetIds.length) {
      await sql`delete from activity_events where entity_id in ${sql(assetIds)}`;
      await sql`delete from media_assets where id in ${sql(assetIds)}`;
    }
    await sql.end();
    for (const key of storageKeys) {
      await unlink(
        resolve(process.cwd(), ".data", "media", ...key.split("/")),
      ).catch(() => undefined);
    }
  }
});
