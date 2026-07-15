import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMediaContentSignature,
  MediaContentInspectionError,
} from "../src/lib/media/content-inspection";

test("media content inspection accepts representative safe signatures", () => {
  assert.doesNotThrow(() =>
    assertMediaContentSignature(
      "image/png",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  );
  assert.doesNotThrow(() =>
    assertMediaContentSignature(
      "video/mp4",
      Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    ),
  );
  assert.doesNotThrow(() =>
    assertMediaContentSignature(
      "application/pdf",
      new TextEncoder().encode("%PDF-1.7"),
    ),
  );
  assert.doesNotThrow(() =>
    assertMediaContentSignature(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    ),
  );
});

test("media content inspection rejects spoofed and empty uploads", () => {
  for (const [mimeType, bytes] of [
    ["image/png", new TextEncoder().encode("<script>alert(1)</script>")],
    ["application/pdf", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])],
    ["text/plain", Uint8Array.from([0x41, 0x00, 0x42])],
  ] as const) {
    assert.throws(
      () => assertMediaContentSignature(mimeType, bytes),
      (error: unknown) =>
        error instanceof MediaContentInspectionError &&
        error.code === "signature_mismatch",
    );
  }
  assert.throws(
    () => assertMediaContentSignature("image/jpeg", new Uint8Array()),
    (error: unknown) =>
      error instanceof MediaContentInspectionError &&
      error.code === "empty_content",
  );
});
