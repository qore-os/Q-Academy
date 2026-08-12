import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AiApiKeyCredentialError,
  loadAiApiKey,
} from "../src/lib/ai/api-key-credential-core";

function withTemporaryDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-ai-key-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("AI key files take precedence over the local legacy environment", () => {
  withTemporaryDirectory((directory) => {
    const file = join(directory, "credential");
    writeFileSync(file, "  file-secret\n", { mode: 0o600 });
    assert.equal(
      loadAiApiKey({
        NODE_ENV: "development",
        AI_API_KEY_FILE: file,
        AI_API_KEY: "legacy-secret",
      }),
      "file-secret",
    );
  });
});

test("configured missing, empty and oversized AI key files fail closed", () => {
  withTemporaryDirectory((directory) => {
    const missing = join(directory, "missing");
    assert.throws(
      () => loadAiApiKey({ NODE_ENV: "development", AI_API_KEY_FILE: missing }),
      AiApiKeyCredentialError,
    );

    const empty = join(directory, "empty");
    writeFileSync(empty, " \n", { mode: 0o600 });
    assert.throws(
      () => loadAiApiKey({ NODE_ENV: "development", AI_API_KEY_FILE: empty }),
      /empty/,
    );

    const oversized = join(directory, "oversized");
    writeFileSync(oversized, "x".repeat(16 * 1024 + 1), { mode: 0o600 });
    assert.throws(
      () =>
        loadAiApiKey({ NODE_ENV: "development", AI_API_KEY_FILE: oversized }),
      /too large/,
    );
  });
});

test("AI key symlinks are rejected by descriptor-level no-follow opening", (context) => {
  withTemporaryDirectory((directory) => {
    const target = join(directory, "target");
    const link = join(directory, "link");
    writeFileSync(target, "secret", { mode: 0o600 });
    try {
      symlinkSync(target, link, "file");
    } catch {
      context.skip("Filesystem does not permit symlink creation.");
      return;
    }
    assert.throws(
      () => loadAiApiKey({ NODE_ENV: "development", AI_API_KEY_FILE: link }),
      AiApiKeyCredentialError,
    );
  });
});

test("production ignores inline AI keys and accepts an unconfigured provider", () => {
  assert.equal(
    loadAiApiKey({ NODE_ENV: "production", AI_API_KEY: "inline-secret" }),
    null,
  );
  assert.equal(loadAiApiKey({ NODE_ENV: "production" }), null);

  let closed = false;
  const emptyFileAccess = {
    open: () => 11,
    lstat: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 0,
      uid: 1001,
      gid: 1001,
      mode: 0o100400,
      dev: 1,
      ino: 2,
    }),
    fstat: () => emptyFileAccess.lstat(),
    read: () => Buffer.alloc(0),
    close: () => {
      closed = true;
    },
  };
  assert.equal(
    loadAiApiKey(
      { NODE_ENV: "production", AI_API_KEY_FILE: "/run/credential" },
      emptyFileAccess as never,
    ),
    null,
  );
  assert.equal(closed, true);
});

test("production validates file ownership and mode on the opened descriptor", () => {
  let closed = false;
  const fileAccess = {
    open: () => 11,
    lstat: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 8,
      uid: 1001,
      gid: 1001,
      mode: 0o100400,
      dev: 1,
      ino: 2,
    }),
    fstat: () => fileAccess.lstat(),
    read: () => Buffer.from("secret\n"),
    close: () => {
      closed = true;
    },
  };
  assert.equal(
    loadAiApiKey(
      { NODE_ENV: "production", AI_API_KEY_FILE: "/run/credential" },
      fileAccess as never,
    ),
    "secret",
  );
  assert.equal(closed, true);

  assert.throws(
    () =>
      loadAiApiKey(
        { NODE_ENV: "production", AI_API_KEY_FILE: "/run/credential" },
        {
          ...fileAccess,
          fstat: () => ({ ...fileAccess.fstat(), mode: 0o100440 }),
        } as never,
      ),
    /1001:1001 with mode 0400/,
  );
});
