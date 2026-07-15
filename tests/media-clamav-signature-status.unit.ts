import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readClamAvSignatureStatus,
  readClamAvSignatureStatusFromEnvironment,
} from "../src/lib/media/clamav-signature-status";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function writeDailyDatabase(path: string, timestampSeconds: number) {
  const header = [
    "ClamAV-VDB",
    "14 Jul 2026 12-00 +0000",
    "28000",
    "3000000",
    "90",
    "0123456789abcdef0123456789abcdef",
    "signature",
    "builder",
    String(timestampSeconds),
  ].join(":");
  assert.ok(header.length <= 512);
  writeFileSync(path, header.padEnd(512, " "));
}

test("ClamAV signature status uses the internal database timestamp and enforces age", async () => {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-clamav-status-"));
  try {
    const daily = join(directory, "daily.cld");
    const issuedAt = Math.floor(NOW.getTime() / 1_000) - 60 * 60;
    writeDailyDatabase(daily, issuedAt);
    const unrelatedMtime = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1_000);
    utimesSync(daily, unrelatedMtime, unrelatedMtime);
    const current = await readClamAvSignatureStatus({
      directory,
      maxAgeSeconds: 2 * 60 * 60,
      now: NOW,
    });
    assert.equal(current.current, true);
    assert.equal(current.ageSeconds, 3_600);
    assert.equal(current.timestampSeconds, issuedAt);

    const stale = await readClamAvSignatureStatus({
      directory,
      maxAgeSeconds: 3_600,
      now: new Date(NOW.getTime() + 1_000),
    });
    assert.equal(stale.current, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("touching a stale database does not make its internal timestamp current", async () => {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-clamav-touched-"));
  try {
    const daily = join(directory, "daily.cvd");
    const staleTimestamp = Math.floor(NOW.getTime() / 1_000) - 2 * 60 * 60;
    writeDailyDatabase(daily, staleTimestamp);
    utimesSync(daily, NOW, NOW);

    const status = await readClamAvSignatureStatus({
      directory,
      maxAgeSeconds: 60 * 60,
      now: NOW,
    });
    assert.equal(status.current, false);
    assert.equal(status.timestampSeconds, staleTimestamp);
    assert.equal(status.ageSeconds, 2 * 60 * 60);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an invalid sibling database makes the complete signature status unavailable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-clamav-sibling-"));
  try {
    writeDailyDatabase(
      join(directory, "daily.cld"),
      Math.floor(NOW.getTime() / 1_000) - 60,
    );
    writeFileSync(join(directory, "daily.cvd"), "ClamAV-VDB:truncated");

    const status = await readClamAvSignatureStatus({
      directory,
      maxAgeSeconds: 3_600,
      now: NOW,
    });
    assert.equal(status.current, false);
    assert.equal(status.timestampSeconds, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a symlinked daily database fails closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-clamav-symlink-"));
  try {
    writeDailyDatabase(
      join(directory, "daily.cld"),
      Math.floor(NOW.getTime() / 1_000) - 60,
    );
    try {
      symlinkSync("daily.cld", join(directory, "daily.cvd"), "file");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "EPERM" || error.code === "EACCES")
      ) {
        symlinkSync(directory, join(directory, "daily.cvd"), "junction");
      } else {
        throw error;
      }
    }

    const status = await readClamAvSignatureStatus({
      directory,
      maxAgeSeconds: 3_600,
      now: NOW,
    });
    assert.equal(status.current, false);
    assert.equal(status.timestampSeconds, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing, future, or invalidly configured signatures fail closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "q-academy-clamav-invalid-"));
  try {
    const missing = await readClamAvSignatureStatus({
      directory,
      maxAgeSeconds: 3_600,
      now: NOW,
    });
    assert.equal(missing.current, false);
    assert.equal(missing.timestampSeconds, 0);

    const future = join(directory, "daily.cld");
    writeDailyDatabase(
      future,
      Math.floor(NOW.getTime() / 1_000) + 10 * 60,
    );
    assert.equal(
      (
        await readClamAvSignatureStatus({
          directory,
          maxAgeSeconds: 3_600,
          now: NOW,
        })
      ).current,
      false,
    );

    writeFileSync(future, "ClamAV-VDB:truncated");
    assert.equal(
      (
        await readClamAvSignatureStatus({
          directory,
          maxAgeSeconds: 3_600,
          now: NOW,
        })
      ).current,
      false,
    );

    const invalid = await readClamAvSignatureStatusFromEnvironment(
      {
        MEDIA_CLAMAV_SIGNATURE_DIRECTORY: directory,
        CLAMAV_SIGNATURE_MAX_AGE_SECONDS: "unbounded",
      },
      NOW,
    );
    assert.equal(invalid.current, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
