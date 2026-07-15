import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import {
  STRATO_RETENTION_SAFETY_MARGIN_MS,
  STRATO_RETENTION_SLA_RESERVE_MS,
  parseStratoPrivacySweepCursor,
  stratoRetentionMaxTraversalAge,
  stratoPrivacySweepScopeFingerprint,
  sweepStratoPrivacyExports,
  type StratoPrivacySweepCursor,
  type StratoPrivacySweepScope,
} from "../src/lib/privacy/strato-retention-sweeper";
import { resolveMediaStorageConfiguration } from "../src/lib/media/storage-configuration";
import { loadProjectEnvironment } from "./load-environment";

const STATE_DIRECTORY = "/var/lib/q-academy-strato-sweeper";
const CURSOR_MARKER = `${STATE_DIRECTORY}/cursor.json`;
const SUCCESS_MARKER = "/tmp/strato-privacy-sweeper.last-success";

function isMissingFile(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readCursor(
  scope: StratoPrivacySweepScope,
): Promise<StratoPrivacySweepCursor | undefined> {
  try {
    return parseStratoPrivacySweepCursor(
      JSON.parse(await readFile(CURSOR_MARKER, "utf8")) as unknown,
      scope,
    );
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

async function replaceMarker(path: string, contents: string) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

async function persistCursor(cursor: StratoPrivacySweepCursor | undefined) {
  if (cursor) {
    await replaceMarker(CURSOR_MARKER, `${JSON.stringify(cursor)}\n`);
    return;
  }
  await unlink(CURSOR_MARKER).catch((error: unknown) => {
    if (!isMissingFile(error)) throw error;
  });
}
const HELP = `Q-Academy STRATO privacy-export sweeper

Required:
  --confirm-bucket <bucket>

Optional:
  --interval-seconds <seconds>
  --max-deletes <count>
  --dry-run
  --help`;

function option(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function integerOption(name: string, fallback: number) {
  const value = option(name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer.`);
  return Number(value);
}

async function main() {
  loadProjectEnvironment();
  const confirmBucket = option("--confirm-bucket");
  if (!confirmBucket) throw new Error("--confirm-bucket is required.");
  const intervalSeconds = integerOption("--interval-seconds", 0);
  if (
    intervalSeconds !== 0 &&
    (intervalSeconds < 300 || intervalSeconds > 86_400)
  ) {
    throw new Error("--interval-seconds must be 0 or between 300 and 86400.");
  }
  const maxDeletes = integerOption("--max-deletes", 500);
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun && intervalSeconds !== 0) {
    throw new Error("--dry-run cannot be combined with a retention loop.");
  }
  const configuration = resolveMediaStorageConfiguration({
    ...process.env,
    NODE_ENV: "production",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_CLAMAV_HOST: "127.0.0.1",
    MEDIA_CLAMAV_PORT: "3310",
  });
  if (configuration.driver !== "s3") {
    throw new Error("The media storage driver is not S3.");
  }
  const cursorScope: StratoPrivacySweepScope = {
    endpoint: configuration.endpoint,
    region: configuration.region,
    bucket: configuration.bucket,
    compatibilityMode: configuration.compatibilityMode,
  };
  const scopeFingerprint = stratoPrivacySweepScopeFingerprint(cursorScope);
  const intervalMs = intervalSeconds * 1_000;
  const maxCycleAgeMs = stratoRetentionMaxTraversalAge(intervalMs);

  do {
    const now = new Date();
    let cursor: StratoPrivacySweepCursor | undefined;
    if (!dryRun) {
      cursor = await readCursor(cursorScope);
      if (!cursor) {
        cursor = {
          version: 2,
          scopeFingerprint,
          cycleStartedAt: now.toISOString(),
        };
        await persistCursor(cursor);
      }
    }
    const result = await sweepStratoPrivacyExports({
      configuration,
      confirmBucket,
      now,
      cursor,
      maxDeletes,
      maxCycleAgeMs: dryRun
        ? STRATO_RETENTION_SAFETY_MARGIN_MS - STRATO_RETENTION_SLA_RESERVE_MS
        : maxCycleAgeMs,
      dryRun,
    });
    if (!dryRun) {
      await persistCursor(result.cursor);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    if (result.mayHaveMore) {
      if (dryRun) {
        throw new Error("The STRATO privacy retention dry-run did not finish.");
      }
      // Continue the persisted traversal immediately. The cycle-age deadline
      // still fails closed, while a normal bounded catch-up does not depend on
      // Docker restart timing.
      continue;
    }
    if (!dryRun) {
      await replaceMarker(
        SUCCESS_MARKER,
        String(Math.floor(Date.now() / 1_000)),
      );
    }
    if (intervalSeconds === 0) break;
    await delay(intervalSeconds * 1_000);
  } while (true);
}

if (process.argv.includes("--help")) {
  process.stdout.write(`${HELP}\n`);
} else {
  void main().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: "strato_privacy_sweep_failed" })}\n`,
    );
    process.exitCode = 1;
  });
}
