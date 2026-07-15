import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_SIZE_LIMITS_BY_PURPOSE,
  MediaPolicyError,
  allowedMediaMimeTypes,
  createSafeMediaFileName,
  isMediaMimeTypeAllowed,
  normalizeDeclaredMediaMimeType,
  validateMediaUploadPolicy,
} from "../src/lib/media/mime-policy";
import { MAX_SCANNABLE_MEDIA_BYTES } from "../src/lib/media/storage-configuration";

test("media MIME policy exposes purpose-specific allowlists", () => {
  assert.equal(isMediaMimeTypeAllowed("course_content", "video/mp4"), true);
  assert.equal(isMediaMimeTypeAllowed("submission", "application/pdf"), true);
  assert.equal(isMediaMimeTypeAllowed("avatar", "image/webp"), true);
  assert.equal(
    isMediaMimeTypeAllowed("branding", "image/vnd.microsoft.icon"),
    true,
  );

  assert.equal(isMediaMimeTypeAllowed("avatar", "video/mp4"), false);
  assert.equal(isMediaMimeTypeAllowed("branding", "image/gif"), false);
  assert.equal(isMediaMimeTypeAllowed("course_content", "image/svg+xml"), false);
  assert.equal(isMediaMimeTypeAllowed("submission", "text/html"), false);
  assert.equal(isMediaMimeTypeAllowed("submission", "application/zip"), false);
  assert.ok(allowedMediaMimeTypes("avatar").length < allowedMediaMimeTypes("submission").length);
});

test("media MIME policy normalizes safe recorder parameters", () => {
  assert.equal(
    normalizeDeclaredMediaMimeType(" Video/WebM; codecs=vp9,opus "),
    "video/webm",
  );
  assert.throws(
    () => normalizeDeclaredMediaMimeType("video/mp4\r\ntext/html"),
    (error: unknown) =>
      error instanceof MediaPolicyError && error.code === "invalid_mime_type",
  );
  assert.throws(
    () => normalizeDeclaredMediaMimeType("not-a-mime"),
    (error: unknown) =>
      error instanceof MediaPolicyError && error.code === "invalid_mime_type",
  );
});

test("media filenames discard paths, dangerous extensions and reserved names", () => {
  assert.equal(
    createSafeMediaFileName("../../Quarterly Report.PDF.exe", "application/pdf"),
    "quarterly-report-pdf.pdf",
  );
  assert.equal(
    createSafeMediaFileName("C:\\fakepath\\Muenchen Portraet.PNG", "image/jpeg"),
    "muenchen-portraet.jpg",
  );
  assert.equal(createSafeMediaFileName("CON.txt", "text/plain"), "file-con.txt");
  assert.equal(createSafeMediaFileName(".env", "text/plain"), "env.txt");

  const longName = createSafeMediaFileName(`${"a".repeat(300)}.png`, "image/png");
  assert.ok(longName.length <= 120);
  assert.match(longName, /^[a-z0-9][a-z0-9_-]{0,114}\.[a-z0-9]{1,8}$/);
  for (const [fileName, mimeType] of [
    [`${"a".repeat(300)}.png`, "image/png"],
    [`${"b".repeat(300)}.txt`, "text/plain"],
    [`Ueber.${"mehrpunktig.".repeat(40)}Datei.PNG`, "image/png"],
    [`${"\u{1f600}".repeat(200)}.txt`, "text/plain"],
  ] as const) {
    const safeName = createSafeMediaFileName(fileName, mimeType);
    assert.ok(safeName.length <= 120);
    assert.match(safeName, /^[a-z0-9][a-z0-9_-]{0,114}\.[a-z0-9]{1,8}$/);
  }
});

test("media upload decisions combine purpose and global size limits", () => {
  const decision = validateMediaUploadPolicy({
    purpose: "course_content",
    declaredMimeType: "video/mp4",
    originalFileName: "Launch Film.final.MOV",
    sizeBytes: 50 * 1024 * 1024,
    globalMaxUploadBytes: 100 * 1024 * 1024,
  });

  assert.equal(decision.mimeType, "video/mp4");
  assert.equal(decision.kind, "video");
  assert.equal(decision.safeFileName, "launch-film-final.mp4");
  assert.equal(decision.maxBytes, 100 * 1024 * 1024);
  assert.equal(decision.contentInspectionRequired, true);
  assert.equal(decision.malwareScanRequired, true);
});

test("media upload policy accepts the purpose boundary and rejects one byte over", () => {
  const maxBytes = MEDIA_SIZE_LIMITS_BY_PURPOSE.avatar.image;
  assert.doesNotThrow(() =>
    validateMediaUploadPolicy({
      purpose: "avatar",
      declaredMimeType: "image/png",
      originalFileName: "avatar.png",
      sizeBytes: maxBytes,
    }),
  );
  assert.throws(
    () =>
      validateMediaUploadPolicy({
        purpose: "avatar",
        declaredMimeType: "image/png",
        originalFileName: "avatar.png",
        sizeBytes: maxBytes + 1,
      }),
    (error: unknown) =>
      error instanceof MediaPolicyError && error.code === "file_too_large",
  );
});

test("video policy stays inside the ClamAV 1.5 hard scan boundary", () => {
  assert.equal(
    MEDIA_SIZE_LIMITS_BY_PURPOSE.course_content.video,
    MAX_SCANNABLE_MEDIA_BYTES,
  );
  assert.equal(
    MEDIA_SIZE_LIMITS_BY_PURPOSE.submission.video,
    MAX_SCANNABLE_MEDIA_BYTES,
  );
  assert.throws(
    () =>
      validateMediaUploadPolicy({
        purpose: "course_content",
        declaredMimeType: "video/mp4",
        originalFileName: "too-large.mp4",
        sizeBytes: MAX_SCANNABLE_MEDIA_BYTES + 1,
      }),
    (error: unknown) =>
      error instanceof MediaPolicyError && error.code === "file_too_large",
  );
});

test("media upload policy rejects invalid purpose, type and byte counts", () => {
  assert.throws(
    () =>
      validateMediaUploadPolicy({
        purpose: "unknown",
        declaredMimeType: "image/png",
        originalFileName: "image.png",
        sizeBytes: 1,
      }),
    (error: unknown) =>
      error instanceof MediaPolicyError && error.code === "invalid_purpose",
  );
  assert.throws(
    () =>
      validateMediaUploadPolicy({
        purpose: "avatar",
        declaredMimeType: "video/mp4",
        originalFileName: "movie.mp4",
        sizeBytes: 1,
      }),
    (error: unknown) =>
      error instanceof MediaPolicyError && error.code === "unsupported_mime_type",
  );
  for (const sizeBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        validateMediaUploadPolicy({
          purpose: "submission",
          declaredMimeType: "application/pdf",
          originalFileName: "answer.pdf",
          sizeBytes,
        }),
      (error: unknown) =>
        error instanceof MediaPolicyError && error.code === "invalid_size",
    );
  }
});
