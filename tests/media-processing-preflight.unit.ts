import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveMediaProcessingPreflightConfiguration } from "../src/lib/media/processing-preflight";

const production = {
  NODE_ENV: "production",
  Q_ACADEMY_RUNTIME_ROLE: "media-worker",
  MEDIA_STORAGE_DRIVER: "s3",
  MEDIA_PROCESSING_WORK_ROOT: "/var/lib/q-academy-media-processing/work",
  MEDIA_FFMPEG_PATH: "/usr/bin/ffmpeg",
  MEDIA_FFPROBE_PATH: "/usr/bin/ffprobe",
  MEDIA_TRANSCRIPT_COMMAND: "/opt/stt/transcribe",
};

test("processing preflight resolves an isolated bounded production toolchain", () => {
  const result = resolveMediaProcessingPreflightConfiguration(production);
  assert.match(result.workRoot.replaceAll("\\", "/"), /\/var\/lib\/q-academy-media-processing\/work$/);
  assert.equal(result.transcript.mode, "command");
});

test("processing preflight rejects unsafe roots and ambiguous transcript providers", () => {
  assert.throws(() => resolveMediaProcessingPreflightConfiguration({ ...production, MEDIA_PROCESSING_WORK_ROOT: "/" }), /unsafe/);
  assert.throws(() => resolveMediaProcessingPreflightConfiguration({ ...production, MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY: "/tmp/vtt" }), /not allowed|exactly one/);
  assert.throws(() => resolveMediaProcessingPreflightConfiguration({ ...production, Q_ACADEMY_RUNTIME_ROLE: "app" }), /media-worker/);
});

test("processing preflight stderr exposes only a stable stage and never child stderr", () => {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-media-preflight-"));
  const secret = "STT_TOKEN_MUST_NOT_LEAK";
  const windows = process.platform === "win32";
  const successCommand = windows ? process.env.ComSpec! : "/bin/true";
  const transcriptCommand = windows ? process.env.ComSpec! : "/bin/sh";
  assert.ok(successCommand && transcriptCommand);
  const transcriptArguments = windows
    ? ["/d", "/s", "/c", `echo ${secret} https://token.invalid 1>&2 & exit /b 1`]
    : ["-c", `printf '${secret} https://token.invalid\\n' >&2; exit 1`];
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/media-processing-preflight.ts",
        "--confirm-bucket",
        "test-bucket",
      ],
      {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          MEDIA_PROCESSING_WORK_ROOT: join(directory, "work"),
          MEDIA_FFMPEG_PATH: successCommand,
          MEDIA_FFPROBE_PATH: successCommand,
          MEDIA_TRANSCRIPT_COMMAND: transcriptCommand,
          MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON: JSON.stringify(transcriptArguments),
          MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY: "",
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /"code":"media_processing_preflight_failed"/);
    assert.match(result.stderr, /"stage":"transcript"/);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
    assert.doesNotMatch(result.stderr, /token\.invalid|"detail"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
