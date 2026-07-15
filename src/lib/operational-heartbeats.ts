import "server-only";

import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

export type OperationalWorker =
  | "scheduler"
  | "media-scan"
  | "media-maintenance";

const heartbeatPaths: Record<OperationalWorker, string> = {
  scheduler: "/tmp/q-academy-scheduler.last-success",
  "media-scan": "/tmp/q-academy-media-scan.last-success",
  "media-maintenance": "/tmp/q-academy-media-maintenance.last-success",
};

function validEpochSeconds(value: string, nowSeconds: number) {
  if (!/^\d{1,12}$/.test(value)) return 0;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= nowSeconds
    ? timestamp
    : 0;
}

export async function recordOperationalWorkerSuccess(
  worker: OperationalWorker,
  now = new Date(),
) {
  const timestamp = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;

  const destination = heartbeatPaths[worker];
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(/* turbopackIgnore: true */ temporary, `${timestamp}\n`, {
      encoding: "ascii",
      mode: 0o600,
    });
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ destination,
    );
    return true;
  } catch {
    return false;
  }
}

export async function readOperationalWorkerSuccess(
  worker: OperationalWorker,
  now = new Date(),
) {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  try {
    const value = (
      await readFile(
        /* turbopackIgnore: true */ heartbeatPaths[worker],
        "ascii",
      )
    ).trim();
    return validEpochSeconds(value, nowSeconds);
  } catch {
    return 0;
  }
}
