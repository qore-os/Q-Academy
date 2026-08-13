import { expect, test, type Page } from "@playwright/test";
import { createFile } from "mp4box";
import postgres from "postgres";

import { getCourseSupportCopy } from "../src/lib/i18n/course-support";
import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import { getVideoWorkflowCopy } from "../src/lib/i18n/video-workflow";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const workflowCopy = getVideoWorkflowCopy("de");
const mediaCopy = getCourseSupportCopy("de").media;
const builderCopy = getMainPageDictionary("de").admin.courseEditor;
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

test("video poster and description workflow fits the editor", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const blockTitle = `Poster ${suffix}`;
  let courseId = "";
  let moduleId = "";
  let uploadedVideoId = "";
  let uploadedPosterId = "";
  let transcriptReady = false;
  let thumbnailAttempts = 0;
  let thumbnailAtMilliseconds = -1;
  let thumbnailJobId = "";
  let descriptionRequests = 0;
  let failNextDescriptionRequest = true;
  let releaseDescriptionFailure!: () => void;
  const descriptionFailureReleased = new Promise<void>((resolve) => {
    releaseDescriptionFailure = resolve;
  });
  const adversarialDescription = "x".repeat(5_000);
  try {
    const [owner] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${owner.organization_id}, ${`Video workflow ${suffix}`},
        ${`video-workflow-${suffix}`}, 'Video workflow test course.',
        'Video workflow test course with enough descriptive content.',
        'draft', ${owner.id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<{ id: string }[]>`
      insert into modules (organization_id, title, estimated_minutes)
      values (${owner.organization_id}, ${`Module ${suffix}`}, 10)
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order
      ) values (${owner.organization_id}, ${courseId}, ${moduleId}, 0)
    `;
    const [lesson] = await client<{ id: string }[]>`
      insert into lessons (
        organization_id, module_id, title, slug, sort_order
      ) values (
        ${owner.organization_id}, ${moduleId}, ${`Lesson ${suffix}`},
        ${`lesson-${suffix}`}, 0
      ) returning id
    `;
    await client`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, 'video', ${blockTitle}, 0, false,
        ${client.json({
          videoUrl: "https://example.com/training-video.mp4",
          caption: "Alte Beschreibung.",
          transcript: {
            version: 1,
            language: "de",
            segments: [
              { startMs: 0, endMs: 2_000, text: "Ein kurzer Lerninhalt." },
            ],
          },
        })}
      )
    `;

    await loginAsOwner(page);
    await page.route("**/api/media-assets/*/processing**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const body = request.postDataJSON() as {
          type?: string;
          atMilliseconds?: number;
        };
        if (body.type === "transcript") {
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({
              id: "10000000-0000-4000-8000-000000000001",
              type: "transcript",
              status: "queued",
            }),
          });
          return;
        }
        if (body.type === "thumbnail") {
          thumbnailAttempts += 1;
          thumbnailAtMilliseconds = body.atMilliseconds ?? -1;
          thumbnailJobId =
            thumbnailAttempts === 1
              ? "20000000-0000-4000-8000-000000000001"
              : "20000000-0000-4000-8000-000000000002";
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({
              id: thumbnailJobId,
              type: "thumbnail",
              status: "queued",
              atMilliseconds: thumbnailAtMilliseconds,
            }),
          });
          return;
        }
      } else if (request.method() === "GET") {
        const jobs: Array<Record<string, unknown>> = [];
        if (!transcriptReady) {
          jobs.push({
            id: "10000000-0000-4000-8000-000000000001",
            type: "transcript",
            status: "queued",
            language: "de",
          });
        }
        if (thumbnailJobId) {
          jobs.push({
            id: thumbnailJobId,
            type: "thumbnail",
            status: thumbnailAttempts === 1 ? "failed" : "succeeded",
            atMilliseconds: thumbnailAtMilliseconds,
          });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobs,
            transcript: transcriptReady
              ? {
                  language: "de",
                  webVtt:
                    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEin sicherer Lerninhalt.",
                }
              : null,
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.route(
      "**/api/media-assets/*/video-description",
      async (route) => {
        descriptionRequests += 1;
        if (failNextDescriptionRequest) {
          await descriptionFailureReleased;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ detail: "deferred failure" }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ description: adversarialDescription }),
        });
      },
    );
    await page.goto(`/admin/courses/${courseId}`);
    await page
      .getByRole("button", { name: `${blockTitle}: Bearbeiten` })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(workflowCopy.descriptionLabel)).toHaveValue(
      "Alte Beschreibung.",
    );
    await expect(dialog.locator('textarea[name="transcriptVtt"]')).not.toHaveValue(
      "",
    );
    await expect(
      dialog.getByRole("button", { name: workflowCopy.descriptionGenerate }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: mediaCopy.uploadLabel("Video") })
      .click();
    await dialog
      .locator('input[type="file"][accept*="video/mp4"]')
      .setInputFiles({
        name: "replacement-video.mp4",
        mimeType: "video/mp4",
        buffer: mp4VideoFixture(),
      });
    await expect(dialog.getByText(mediaCopy.ready, { exact: true })).toBeVisible(
      { timeout: 45_000 },
    );
    uploadedVideoId = await dialog
      .locator('input[name="mediaAssetId"]:not([disabled])')
      .inputValue();
    expect(uploadedVideoId).toMatch(/^[0-9a-f-]{36}$/i);
    const [uploadedVideo] = await client<
      Array<{ duration_milliseconds: number | null; status: string }>
    >`
      select duration_milliseconds, status
      from media_assets
      where id = ${uploadedVideoId}
    `;
    expect(uploadedVideo).toEqual({
      duration_milliseconds: 1_000,
      status: "ready",
    });
    await expect(dialog.locator("video").first()).toHaveAttribute(
      "src",
      `/api/media-assets/${uploadedVideoId}/download`,
    );
    await expect(dialog.locator('textarea[name="transcriptVtt"]')).toHaveValue(
      "",
    );
    await expect(dialog.getByLabel(workflowCopy.descriptionLabel)).toHaveValue(
      "",
    );
    await expect(
      dialog.getByRole("button", { name: workflowCopy.descriptionGenerate }),
    ).toBeDisabled();
    let posterGroup = dialog.locator(
      `[role="group"][aria-label="${workflowCopy.posterTitle}"]`,
    );
    await expect(posterGroup).toBeVisible();
    await expect(
      posterGroup.getByRole("button", { name: workflowCopy.posterFrame }),
    ).toBeDisabled();
    await expect(dialog.locator('input[name="videoPoster"]')).toHaveValue("");

    await posterGroup
      .getByRole("button", { name: workflowCopy.posterUpload })
      .click();
    const initialSaveButton = dialog.getByRole("button", {
      name: builderCopy.dialogs.saveChanges,
    });
    await expect(initialSaveButton).toBeDisabled();
    const dropTarget = dialog
      .locator("label[for]:visible")
      .filter({ hasText: mediaCopy.selectFile });
    await expect(dropTarget).toBeVisible();
    const dataTransfer = await page.evaluateHandle((encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (value) =>
        value.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], "custom-poster.png", { type: "image/png" }),
      );
      return transfer;
    }, pngBase64);
    await dropTarget.dispatchEvent("drop", { dataTransfer });
    let posterAssetInput = dialog.locator(
      'input[name="videoPosterAssetId"]:not([disabled])',
    );
    await expect(posterAssetInput).not.toHaveValue("", { timeout: 45_000 });
    uploadedPosterId = await posterAssetInput.inputValue();
    expect(uploadedPosterId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(initialSaveButton).toBeEnabled();
    await expect(dialog.getByLabel(workflowCopy.descriptionLabel)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: workflowCopy.descriptionGenerate }),
    ).toBeDisabled();
    await initialSaveButton.click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await page
      .getByRole("button", { name: `${blockTitle}: Bearbeiten` })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await expect(dialog).toBeVisible();
    posterGroup = dialog.locator(
      `[role="group"][aria-label="${workflowCopy.posterTitle}"]`,
    );
    await expect(
      posterGroup.getByRole("button", { name: workflowCopy.posterFrame }),
    ).toBeEnabled();
    await expect(
      posterGroup.getByRole("button", { name: workflowCopy.posterUpload }),
    ).toHaveAttribute("aria-pressed", "true");
    posterAssetInput = dialog.locator(
      'input[name="videoPosterAssetId"]:not([disabled])',
    );
    await expect(posterAssetInput).toHaveValue(uploadedPosterId);
    const saveButton = dialog.getByRole("button", {
      name: builderCopy.dialogs.saveChanges,
    });
    await posterGroup
      .getByRole("button", { name: workflowCopy.posterFrame })
      .click();
    await expect(saveButton).toBeDisabled();
    const createFrameButton = dialog.getByRole("button", {
      name: workflowCopy.posterFrameCreate,
    });
    await createFrameButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(
      dialog.getByText(workflowCopy.posterFrameFailed, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('input[name="videoPoster"]')).toHaveValue("");
    await expect(saveButton).toBeDisabled();
    await createFrameButton.click();
    await expect(saveButton).toBeDisabled();
    await expect(
      dialog.getByText(workflowCopy.posterFrameSucceeded, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('input[name="videoPoster"]')).toHaveValue(
      JSON.stringify({
        version: 1,
        source: "frame",
        atMilliseconds: thumbnailAtMilliseconds,
      }),
    );
    await expect(saveButton).toBeEnabled();
    expect(thumbnailAttempts).toBe(2);
    await dialog.locator('textarea[name="transcriptVtt"]').fill("manual draft");
    await page.waitForTimeout(250);
    expect(descriptionRequests).toBe(0);
    transcriptReady = true;
    await page.waitForTimeout(2_500);
    await expect(dialog.locator('textarea[name="transcriptVtt"]')).toHaveValue(
      "manual draft",
    );
    await dialog.getByRole("button", { name: /Automatisch transkribieren/ }).click();
    await expect(dialog.locator('textarea[name="transcriptVtt"]')).toHaveValue(
      /Ein sicherer Lerninhalt\./,
      { timeout: 10_000 },
    );
    await expect(dialog.getByLabel(workflowCopy.descriptionLabel)).toHaveValue(
      "",
    );
    expect(descriptionRequests).toBe(0);
    const descriptionIntent = dialog.locator(
      'input[name="videoDescriptionIntent"]',
    );
    await dialog
      .getByRole("button", { name: workflowCopy.descriptionGenerate })
      .click();
    await expect(saveButton).toBeDisabled();
    await expect(descriptionIntent).toHaveValue("automatic");
    releaseDescriptionFailure();
    await expect(saveButton).toBeEnabled();
    await expect(descriptionIntent).toHaveValue("automatic");
    failNextDescriptionRequest = false;
    await dialog
      .getByRole("button", { name: workflowCopy.descriptionGenerate })
      .click();
    await expect.poll(() => descriptionRequests).toBe(2);
    const descriptionSuggestion = dialog.getByText(adversarialDescription, {
      exact: true,
    });
    await expect(descriptionSuggestion).toBeVisible();
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await dialog
      .getByRole("button", { name: workflowCopy.descriptionAccept })
      .click();
    await expect(descriptionIntent).toHaveValue("touched");
    await expect(dialog.getByLabel(workflowCopy.descriptionLabel)).toHaveValue(
      adversarialDescription,
    );
    await dialog.screenshot({
      path: testInfo.outputPath(`video-workflow-${testInfo.project.name}.png`),
    });
    await dataTransfer.dispose();
  } finally {
    if (!uploadedPosterId) {
      uploadedPosterId = await page
        .locator('input[name="videoPosterAssetId"]:not([disabled])')
        .first()
        .inputValue()
        .catch(() => "");
    }
    if (uploadedPosterId) {
      await page
        .evaluate(
          (assetId) =>
            fetch(`/api/media-assets/${assetId}`, {
              method: "DELETE",
              credentials: "same-origin",
            }).then((response) => response.ok),
          uploadedPosterId,
        )
        .catch(() => undefined);
    }
    if (!uploadedVideoId) {
      uploadedVideoId = await page
        .locator('input[name="mediaAssetId"]:not([disabled])')
        .first()
        .inputValue()
        .catch(() => "");
    }
    if (uploadedVideoId) {
      await page
        .evaluate(
          (assetId) =>
            fetch(`/api/media-assets/${assetId}`, {
              method: "DELETE",
              credentials: "same-origin",
            }).then((response) => response.ok),
          uploadedVideoId,
        )
        .catch(() => undefined);
    }
    if (courseId) await client`delete from courses where id = ${courseId}`;
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    await client.end();
  }
});
