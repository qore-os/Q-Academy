import assert from "node:assert/strict";
import test from "node:test";
import { fromBufferPromise } from "yauzl";
import { createStoredZip } from "../src/lib/privacy/stored-zip";
import { MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES } from "../src/lib/privacy/export-limits";

async function zipContents(bytes: Buffer) {
  const archive = await fromBufferPromise(bytes);
  const result = new Map<string, Buffer>();
  try {
    for await (const entry of archive.eachEntry()) {
      const stream = await archive.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      result.set(entry.fileName, Buffer.concat(chunks));
    }
  } finally {
    archive.close();
  }
  return result;
}

test("privacy ZIP contains structured data, manifest and binary media", async () => {
  const binary = Buffer.from([0, 1, 2, 255]);
  const archive = createStoredZip([
    { path: "data.json", bytes: Buffer.from('{"ok":true}\n') },
    { path: "media/asset-id/photo.jpg", bytes: binary },
    { path: "manifest.json", bytes: Buffer.from('{"schemaVersion":1}\n') },
  ]);
  const contents = await zipContents(archive);
  assert.deepEqual([...contents.keys()], [
    "data.json",
    "media/asset-id/photo.jpg",
    "manifest.json",
  ]);
  assert.equal(contents.get("data.json")?.toString("utf8"), '{"ok":true}\n');
  assert.deepEqual(contents.get("media/asset-id/photo.jpg"), binary);
});

test("privacy ZIP rejects duplicate and traversal entry paths", () => {
  assert.throws(
    () =>
      createStoredZip([
        { path: "data.json", bytes: Buffer.from("one") },
        { path: "data.json", bytes: Buffer.from("two") },
      ]),
    /Duplicate ZIP entry/,
  );
  for (const path of ["../secret", "/absolute", "media\\file", "a//b"]) {
    assert.throws(
      () => createStoredZip([{ path, bytes: Buffer.from("x") }]),
      /entry path is invalid/,
    );
  }
});

test("privacy ZIP rejects an oversized entry during metadata preflight", () => {
  const oversized = {
    byteLength: MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES + 1,
  } as Uint8Array;
  assert.throws(
    () => createStoredZip([{ path: "data.json", bytes: oversized }]),
    /ZIP export exceeds the supported size/,
  );
});
