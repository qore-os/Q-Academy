import { expect, test, type Page } from "@playwright/test";

import { getMediaUploadCopy } from "../src/lib/i18n/media-upload";
import { getMemberExperienceCopy } from "../src/lib/i18n/member-experience";
import { getSettingsAdminCopy } from "../src/lib/i18n/settings-admin";
import {
  createFileDataTransfer,
  dropFiles,
} from "./helpers/media-drop";

const settingsCopy = getSettingsAdminCopy("de");
const mediaCopy = getMemberExperienceCopy("de").media;
const uploadCopy = getMediaUploadCopy("de");
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const png = Buffer.from(pngBase64, "base64");

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

test("branding media accepts an accessible drag-and-drop upload", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  await page.goto("/admin/settings");

  const label = settingsCopy.design.lightLogo;
  const field = page.getByText(label, { exact: true }).locator("..");
  const dropTarget = field.locator(".brand-radius").first();
  await expect(dropTarget).toBeVisible();

  const dataTransfer = await createFileDataTransfer(page, [
    { name: "drag-logo.png", mimeType: "image/png", buffer: png },
  ]);

  let assetId = "";
  try {
    await dropTarget.dispatchEvent("dragenter", { dataTransfer });
    await expect(
      field.getByText(uploadCopy.dropActiveSingle, { exact: true }),
    ).toBeVisible();
    await dropTarget.screenshot({
      path: testInfo.outputPath(`media-drop-${testInfo.project.name}.png`),
    });

    await dropTarget.dispatchEvent("drop", { dataTransfer });
    await expect(field.getByText(mediaCopy.ready, { exact: true })).toBeVisible(
      {
        timeout: 45_000,
      },
    );
    assetId = await field
      .locator('input[name="logoLightAssetId"]')
      .inputValue();
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(
      field.getByRole("img", { name: mediaCopy.preview(label) }),
    ).toHaveAttribute("src", /^blob:/);

    await field.getByRole("button", { name: mediaCopy.remove(label) }).click();
    await expect(field.locator('input[name="logoLightAssetId"]')).toHaveValue(
      "",
    );
    await expect(
      field.getByRole("img", { name: mediaCopy.preview(label) }),
    ).toHaveCount(0);
    assetId = "";
  } finally {
    await dataTransfer.dispose();
    if (assetId) {
      await page.request.delete(`/api/media-assets/${assetId}`);
    }
  }
});

test("STRATO direct POST stays indeterminate and a visible retry never replays the file", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const assetId = "10000000-0000-4000-8000-000000000091";
  const statusUrl = `/api/media-assets/${assetId}/upload-status`;
  const completeUrl = `/api/media-assets/${assetId}/complete-upload`;
  const claimUrl = `/api/media-assets/${assetId}/direct-upload-claim`;
  let createRequests = 0;
  let claimRequests = 0;
  let completionRequests = 0;
  const providerMethods: string[] = [];
  let releaseProvider!: () => void;
  const providerReleased = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const pendingAsset = {
    id: assetId,
    purpose: "branding",
    kind: "image",
    status: "pending",
    originalFileName: "strato-logo.png",
    safeFileName: "strato-logo.png",
    declaredMimeType: "image/png",
    declaredSizeBytes: png.length,
    actualSizeBytes: null,
    durationMilliseconds: null,
    statusUrl,
    completeUrl,
  };

  await page.route("**/api/media-assets", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data:
          createRequests === 1
            ? {
                ...pendingAsset,
                completionTransport: "direct-post",
                directPostClaimUrl: claimUrl,
                directPostClaimState: "available",
                upload: null,
              }
            : {
                ...pendingAsset,
                completionPending: true,
                completionTransport: "direct-post",
                upload: null,
              },
      }),
    });
  });
  await page.route(`**${claimUrl}`, async (route) => {
    claimRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          state: "send_authorized",
          upload: {
            transport: "s3",
            method: "POST",
            url: "https://storage.example.test/strato-upload",
            fields: { key: "incoming/strato-logo.png", policy: "signed" },
          },
        },
      }),
    });
  });
  await page.route("https://storage.example.test/strato-upload", async (route) => {
    providerMethods.push(route.request().method());
    await providerReleased;
    await route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin":
          route.request().headers()["origin"] ?? "*",
      },
    });
  });
  await page.route(`**${completeUrl}`, async (route) => {
    completionRequests += 1;
    if (completionRequests <= 3) {
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({
          detail: "The media object is missing.",
          errors: { reason: "object_missing" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { completed: true } }),
    });
  });
  await page.route(`**${statusUrl}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...pendingAsset,
          status: "ready",
          actualSizeBytes: png.length,
        },
      }),
    });
  });

  try {
    await loginAsAdmin(page);
    await page.goto("/admin/settings");
    const label = settingsCopy.design.lightLogo;
    const field = page.getByText(label, { exact: true }).locator("..");
    const dropTarget = field.locator(".brand-radius").first();
    await dropFiles(page, dropTarget, [
      { name: "strato-logo.png", mimeType: "image/png", buffer: png },
    ]);

    const progressbar = field.getByRole("progressbar");
    await expect(progressbar).toHaveAttribute(
      "aria-valuetext",
      uploadCopy.transferring,
    );
    await expect(progressbar).not.toHaveAttribute("aria-valuenow");
    await expect(progressbar).not.toHaveAttribute("aria-valuemin");
    await expect(progressbar).not.toHaveAttribute("aria-valuemax");
    await expect(field).not.toContainText(/\d+\s*%/);

    releaseProvider();
    const retry = field
      .getByRole("button", {
        name: mediaCopy.upload(label),
        exact: true,
      })
      .and(field.locator('button[type="button"]'));
    await expect(retry).toBeVisible({ timeout: 15_000 });
    await retry.click();
    await expect(field.getByText(mediaCopy.ready, { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    expect(createRequests).toBe(2);
    expect(claimRequests).toBe(1);
    expect(completionRequests).toBe(4);
    expect(providerMethods).toEqual(["POST"]);
  } finally {
    releaseProvider();
  }
});
