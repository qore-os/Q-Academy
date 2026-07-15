import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectAndScanMediaStream,
  MediaContentInspectionError,
} from "../src/lib/media/scan-core";

async function* chunks(...values: Uint8Array[]) {
  for (const value of values) yield value;
}

test("media scan validates text across chunk and signature boundaries", async () => {
  const prefix = new TextEncoder().encode("a".repeat(511));
  const umlaut = new TextEncoder().encode("ue");
  const result = await inspectAndScanMediaStream({
    body: chunks(prefix, umlaut),
    expectedSizeBytes: prefix.length + umlaut.length,
    mimeType: "text/plain",
  });
  assert.equal(result.clean, true);
  assert.equal(result.scanner, "signature");
  assert.equal(result.durationMilliseconds, null);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("media scan rejects control bytes and invalid UTF-8 after byte 512", async () => {
  const prefix = new TextEncoder().encode("a".repeat(512));
  for (const suffix of [
    Uint8Array.from([0x41, 0x00, 0x42]),
    Uint8Array.from([0xc3, 0x28]),
  ]) {
    await assert.rejects(
      inspectAndScanMediaStream({
        body: chunks(prefix, suffix),
        expectedSizeBytes: prefix.length + suffix.length,
        mimeType: "text/plain",
      }),
      (error: unknown) => error instanceof MediaContentInspectionError,
    );
  }
});

test("media scan preserves content errors when a scanner consumes the body", async () => {
  const spoofed = new TextEncoder().encode("not a png");
  await assert.rejects(
    inspectAndScanMediaStream({
      body: chunks(spoofed),
      expectedSizeBytes: spoofed.length,
      mimeType: "image/png",
      scanner: async (body) => {
        for await (const chunk of body) void chunk;
        return { clean: true, signature: null };
      },
    }),
    (error: unknown) => error instanceof MediaContentInspectionError,
  );
});
