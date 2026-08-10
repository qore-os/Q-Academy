import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  browserUploadErrorMessage,
  browserUploadHeaders,
} from "../src/lib/media/browser-upload";

test("browser upload headers omit forbidden Content-Length", () => {
  assert.deepEqual(
    browserUploadHeaders({
      "Content-Length": "42",
      "Content-Type": "text/plain",
      "If-None-Match": "*",
    }),
    {
      "Content-Type": "text/plain",
      "If-None-Match": "*",
    },
  );
});

test("browser upload header filtering is case insensitive", () => {
  assert.deepEqual(browserUploadHeaders({ "content-length": "42" }), {});
});

test("browser upload errors preserve concrete messages with a localized fallback", () => {
  assert.equal(
    browserUploadErrorMessage(
      new Error("The media file exceeds the configured byte limit."),
      "Upload fehlgeschlagen.",
    ),
    "The media file exceeds the configured byte limit.",
  );
  assert.equal(
    browserUploadErrorMessage(new Error("   "), "Upload fehlgeschlagen."),
    "Upload fehlgeschlagen.",
  );
  assert.equal(
    browserUploadErrorMessage({ message: "untrusted" }, "Upload fehlgeschlagen."),
    "Upload fehlgeschlagen.",
  );
});

test("media upload surfaces preserve concrete errors with localized fallbacks", () => {
  for (const path of [
    "src/components/admin/course-media-source-field.tsx",
    "src/components/academy/community-attachments.tsx",
    "src/components/academy/submission-attachment-uploader.tsx",
    "src/components/media/image-asset-upload-field.tsx",
    "src/components/media/profile-media-asset-field.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /browserUploadErrorMessage\(/, path);
  }
});
