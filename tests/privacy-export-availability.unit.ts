import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BoundedObjectReadError,
  readBoundedFile,
  readBoundedFileHandle,
  readBoundedObjectBody,
} from "../src/lib/privacy/bounded-object-reader";
import {
  MAX_PRIVACY_EXPORT_MEDIA_ROWS,
  MAX_PRIVACY_EXPORT_MEDIA_BYTES,
  MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES,
  MAX_PRIVACY_EXPORT_STORED_BYTES,
  MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
  PRIVACY_EXPORT_DOWNLOAD_MAX_DURATION_MS,
  PRIVACY_EXPORT_OBJECT_READ_TIMEOUT_MS,
} from "../src/lib/privacy/export-limits";
import { PrivacyRuntimeCapacity } from "../src/lib/privacy/runtime-capacity";
import { createPrivacyExportDownloadStream } from "../src/lib/privacy/export-download-stream";

function errorCode(error: unknown) {
  return error instanceof BoundedObjectReadError ? error.code : null;
}

test("privacy export body reader returns only the exact declared byte count", async () => {
  const body = (async function* () {
    yield Uint8Array.from([1, 2]);
    yield Uint8Array.from([3, 4, 5]);
  })();
  const bytes = await readBoundedObjectBody({
    body,
    maxBytes: 5,
    expectedBytes: 5,
    deadlineAt: Date.now() + 1_000,
  });
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
});

test("privacy export body reader aborts, destroys and returns an oversized stream", async () => {
  let destroyed = false;
  let returned = false;
  let index = 0;
  const iterator: AsyncIterator<unknown> = {
    async next() {
      index += 1;
      return index === 1
        ? { done: false, value: Buffer.alloc(4, 1) }
        : { done: false, value: Buffer.alloc(5, 2) };
    },
    async return() {
      returned = true;
      return { done: true, value: undefined };
    },
  };
  const body = {
    [Symbol.asyncIterator]: () => iterator,
    destroy() {
      destroyed = true;
    },
  };
  const abortController = new AbortController();

  await assert.rejects(
    readBoundedObjectBody({
      body,
      maxBytes: 8,
      expectedBytes: 8,
      deadlineAt: Date.now() + 1_000,
      abortController,
    }),
    (error) => errorCode(error) === "invalid_size",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(abortController.signal.aborted, true);
  assert.equal(destroyed, true);
  assert.equal(returned, true);
});

test("privacy export body reader enforces one total deadline on a stalled stream", async () => {
  let destroyed = false;
  let returned = false;
  const iterator: AsyncIterator<unknown> = {
    next: () => new Promise(() => undefined),
    async return() {
      returned = true;
      return { done: true, value: undefined };
    },
  };
  const body = {
    [Symbol.asyncIterator]: () => iterator,
    destroy() {
      destroyed = true;
    },
  };
  const abortController = new AbortController();
  const startedAt = Date.now();

  await assert.rejects(
    readBoundedObjectBody({
      body,
      maxBytes: 8,
      expectedBytes: 8,
      deadlineAt: Date.now() + 25,
      abortController,
    }),
    (error) => errorCode(error) === "timeout",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(abortController.signal.aborted, true);
  assert.equal(destroyed, true);
  assert.equal(returned, true);
});

test("privacy export local reader rejects oversized files before allocating their contents", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "q-academy-dsar-"));
  const file = path.join(directory, "artifact.enc");
  try {
    await writeFile(file, Buffer.alloc(16, 7));
    const bytes = await readBoundedFile({
      path: file,
      maxBytes: 16,
      deadlineAt: Date.now() + 1_000,
    });
    assert.equal(bytes.byteLength, 16);
    await assert.rejects(
      readBoundedFile({
        path: file,
        maxBytes: 15,
        deadlineAt: Date.now() + 1_000,
      }),
      (error) => errorCode(error) === "invalid_size",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("privacy export local reader rejects trailing bytes and final identity changes", async () => {
  const content = Buffer.from([1, 2, 3]);
  let statCalls = 0;
  const handle = {
    async stat() {
      statCalls += 1;
      return {
        isFile: () => true,
        size: statCalls === 1 ? 3 : 4,
        dev: 1,
        ino: 2,
      };
    },
    async read(buffer: Buffer, offset: number, length: number, position: number) {
      if (position === content.byteLength) {
        buffer[offset] = 4;
        return { bytesRead: 1 };
      }
      const bytesRead = Math.min(length, content.byteLength - position);
      content.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead };
    },
  };
  await assert.rejects(
    readBoundedFileHandle({
      handle,
      maxBytes: 4,
      deadlineAt: Date.now() + 1_000,
    }),
    (error) => errorCode(error) === "invalid_size",
  );
});

test("privacy export availability limits match the bounded envelope contract", () => {
  assert.equal(MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES, 16 * 1024 * 1024);
  assert.equal(MAX_PRIVACY_EXPORT_STORED_BYTES, 64 * 1024 * 1024);
  assert.equal(MAX_PRIVACY_EXPORT_MEDIA_BYTES, 12 * 1024 * 1024);
  assert.equal(MAX_PRIVACY_EXPORT_MEDIA_ROWS, 2_000);
  assert.equal(PRIVACY_EXPORT_DOWNLOAD_MAX_DURATION_MS, 10 * 60_000);
  assert.equal(PRIVACY_EXPORT_OBJECT_READ_TIMEOUT_MS, 30_000);
  assert.ok(MAX_PRIVACY_EXPORT_MEDIA_BYTES < MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES);
});

test("privacy runtime capacity is bounded and lease-identity fenced", () => {
  const semaphore = new PrivacyRuntimeCapacity(2);
  const first = semaphore.claim();
  const second = semaphore.claim();
  assert.ok(first);
  assert.ok(second);
  assert.equal(semaphore.claim(), null);

  assert.equal(semaphore.release(first), true);
  const replacement = semaphore.claim();
  assert.ok(replacement);
  assert.equal(semaphore.release(first), false);
  assert.equal(semaphore.claim(), null);

  assert.equal(semaphore.release(second), true);
  assert.equal(semaphore.release(replacement), true);
});

test("privacy runtime capacity defaults to one non-expiring process slot", () => {
  const capacity = new PrivacyRuntimeCapacity();
  const lease = capacity.claim();
  assert.ok(lease);
  assert.equal(capacity.claim(), null);
  assert.equal(capacity.release(lease), true);
});

test("privacy export response retains capacity until stream close or cancel", async () => {
  let completedReleases = 0;
  const complete = createPrivacyExportDownloadStream({
    bytes: Uint8Array.from([1, 2, 3, 4]),
    chunkBytes: 2,
    maxDurationMs: 1_000,
    release: async () => {
      completedReleases += 1;
    },
  });
  const reader = complete.stream.getReader();
  assert.equal(completedReleases, 0);
  assert.deepEqual(await reader.read(), {
    done: false,
    value: Uint8Array.from([1, 2]),
  });
  assert.equal(completedReleases, 0);
  assert.deepEqual(await reader.read(), {
    done: false,
    value: Uint8Array.from([3, 4]),
  });
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completedReleases, 1);
  reader.releaseLock();

  let cancelledReleases = 0;
  const cancelled = createPrivacyExportDownloadStream({
    bytes: Uint8Array.from([1, 2, 3, 4]),
    chunkBytes: 2,
    maxDurationMs: 1_000,
    release: async () => {
      cancelledReleases += 1;
    },
  });
  await cancelled.stream.cancel();
  await cancelled.abort();
  assert.equal(cancelledReleases, 1);
});

test("privacy export response deadline releases a never-read stream exactly once", async () => {
  let releases = 0;
  const response = createPrivacyExportDownloadStream({
    bytes: Uint8Array.from([1, 2, 3, 4]),
    maxDurationMs: 20,
    release: async () => {
      releases += 1;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const reader = response.stream.getReader();
  await assert.rejects(reader.read(), /total deadline/);
  await response.abort();
  assert.equal(releases, 1);
});

test("privacy export response deadline releases a stalled stream exactly once", async () => {
  let releases = 0;
  const response = createPrivacyExportDownloadStream({
    bytes: Uint8Array.from([1, 2, 3, 4]),
    chunkBytes: 1,
    maxDurationMs: 20,
    release: async () => {
      releases += 1;
    },
  });
  const reader = response.stream.getReader();
  assert.deepEqual(await reader.read(), {
    done: false,
    value: Uint8Array.from([1]),
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await assert.rejects(reader.read(), /total deadline/);
  await response.abort();
  assert.equal(releases, 1);
});
