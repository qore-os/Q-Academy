import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UploadTransferIndicator } from "../src/components/media/upload-transfer-indicator";
import { getMediaUploadCopy } from "../src/lib/i18n/media-upload";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const browserUpload = readFileSync(
  "src/lib/media/browser-session-upload.ts",
  "utf8",
);
const dropHook = readFileSync("src/lib/use-file-drop.ts", "utf8");
const indicator = readFileSync(
  "src/components/media/upload-transfer-indicator.tsx",
  "utf8",
);
const globalStyles = readFileSync("src/app/globals.css", "utf8");
const uploadSurfaces = [
  "src/components/admin/course-media-source-field.tsx",
  "src/components/media/image-asset-upload-field.tsx",
  "src/components/media/profile-media-asset-field.tsx",
  "src/components/academy/submission-attachment-uploader.tsx",
  "src/components/academy/community-attachments.tsx",
] as const;

test("the browser contract distinguishes measured transfers from direct POST activity", () => {
  assert.match(browserUpload, /export type BrowserSessionTransferStatus/);
  assert.match(browserUpload, /kind: "determinate"/);
  assert.match(browserUpload, /transport: "single-put" \| "multipart"/);
  assert.match(browserUpload, /kind: "indeterminate"/);
  assert.match(browserUpload, /transport: "direct-post"/);
  assert.match(browserUpload, /onTransferStatus\?:/);

  const uploadFile = browserUpload.slice(
    browserUpload.indexOf("function uploadFile("),
    browserUpload.indexOf("function sha256Base64("),
  );
  const directPost = uploadFile.slice(
    uploadFile.lastIndexOf('if (authorization.method === "POST") {'),
  );
  assert.doesNotMatch(directPost, /xhr\.upload\.onprogress/);
  assert.doesNotMatch(directPost, /setRequestHeader/);
  assert.match(directPost, /xhr\.send\(form\)/);
});

test("the shared drop hook accepts only file payloads and blocks browser navigation", () => {
  assert.match(dropHook, /types\.includes\("Files"\)/);
  assert.match(dropHook, /event\.preventDefault\(\)/);
  assert.match(
    dropHook,
    /event\.dataTransfer\.dropEffect = disabled \? "none" : "copy"/,
  );
  assert.match(dropHook, /if \(disabled\) return/);
  assert.match(dropHook, /multiple \? files : files\.slice\(0, 1\)/);
});

test("all five session-media fields expose drop and transport-aware progress UI", () => {
  for (const path of uploadSurfaces) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /useFileDrop\(\{/);
    assert.match(source, /\.\.\.fileDropProps/);
    assert.match(source, /onTransferStatus/);
    assert.match(source, /UploadTransferIndicator/);
    assert.match(source, /getMediaUploadCopy/);
  }
});

test("the transfer bar is accessible, animated, and reduced-motion safe", () => {
  assert.match(indicator, /role="progressbar"/);
  const determinate = renderToStaticMarkup(
    createElement(UploadTransferIndicator, {
      status: { kind: "determinate", transport: "single-put", progress: 42 },
      label: "42 percent",
    }),
  );
  assert.match(determinate, /aria-valuemin="0"/);
  assert.match(determinate, /aria-valuemax="100"/);
  assert.match(determinate, /aria-valuenow="42"/);

  const indeterminate = renderToStaticMarkup(
    createElement(UploadTransferIndicator, {
      status: { kind: "indeterminate", transport: "direct-post" },
      label: "Transferring file",
    }),
  );
  assert.match(indeterminate, /aria-valuetext="Transferring file"/);
  assert.doesNotMatch(indeterminate, /aria-value(?:min|max|now)=/);
  assert.doesNotMatch(indeterminate, /%/);
  assert.match(indicator, /media-upload-indeterminate/);
  assert.match(globalStyles, /@keyframes media-upload-indeterminate/);
  assert.match(globalStyles, /prefers-reduced-motion: reduce/);
});

test("drop and indeterminate transfer states are localized for every app locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const localized = getMediaUploadCopy(locale);
    assert.ok(localized.transferring.length > 4, locale);
    assert.ok(localized.dropActiveSingle.length > 4, locale);
    assert.ok(localized.dropActiveMultiple.length > 4, locale);
  }
});
