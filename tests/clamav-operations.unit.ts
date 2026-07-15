import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { relative, join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const compose = readFileSync(new URL("compose.production.yml", root), "utf8");
const daemonEntrypoint = readFileSync(
  new URL("scripts/ops/clamav-daemon-entrypoint.sh", root),
  "utf8",
);
const signatureHealth = readFileSync(
  new URL("scripts/ops/clamav-signature-health.sh", root),
  "utf8",
);

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

test("ClamAV renderer writes the effective bounded clamd configuration", () => {
  const directory = mkdtempSync(join(process.cwd(), ".clamav-render-"));
  const source = join(directory, "clamd.conf");
  const target = join(directory, "runtime.conf");
  const invalidTarget = join(directory, "invalid.conf");
  writeFileSync(
    source,
    [
      "#StreamMaxLength 100M",
      "StreamMaxLength 200M",
      "MaxFileSize 100M",
      "MaxScanSize 100M",
      "MaxScanTime 120000",
      "ReadTimeout 120",
      "AlertExceedsMax no",
      "TCPSocket 3310",
    ].join("\n"),
  );
  const unixPath = (value: string) =>
    relative(process.cwd(), value).replaceAll("\\", "/");
  try {
    const rendered = spawnSync(
      "bash",
      [
        "scripts/ops/clamav-render-config.sh",
        unixPath(source),
        unixPath(target),
        "123456789",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(rendered.status, 0, rendered.stderr);
    const output = readFileSync(target, "utf8");
    for (const directive of [
      "StreamMaxLength 123456789",
      "MaxFileSize 123456789",
      "MaxScanSize 123456789",
      "MaxScanTime 600000",
      "ReadTimeout 600",
      "AlertExceedsMax yes",
    ]) {
      assert.equal(output.match(new RegExp(`^${directive}$`, "gm"))?.length, 1);
    }
    assert.match(output, /^TCPSocket 3310$/m);

    const invalid = spawnSync(
      "bash",
      [
        "scripts/ops/clamav-render-config.sh",
        unixPath(source),
        unixPath(invalidTarget),
        "2000000001",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(invalid.status, 0);
    assert.throws(() => readFileSync(invalidTarget, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hardened clamd executes only the rendered tmpfs config", () => {
  assert.match(compose, /entrypoint: \["\/init-unprivileged"\]/);
  assert.match(compose, /command: \["\/bin\/sh", "\/opt\/q-academy\/clamav-daemon-entrypoint\.sh"\]/);
  assert.match(compose, /clamav-render-config/);
  assert.doesNotMatch(compose, /CLAMD_CONF_/);
  assert.match(
    daemonEntrypoint,
    /exec clamd --foreground --config-file="\$runtime_config"/,
  );
  assert.match(daemonEntrypoint, /runtime_config=\/tmp\/q-academy-clamd\.conf/);
});

test("ClamAV health reads the CVD header timestamp and rejects touched stale signatures", () => {
  const directory = mkdtempSync(join(process.cwd(), ".clamav-signatures-"));
  const daily = join(directory, "daily.cld");
  const wrapper = join(directory, "run-health.sh");
  const shellPath = (value: string) =>
    relative(process.cwd(), value).replaceAll("\\", "/");
  writeFileSync(
    wrapper,
    [
      "#!/bin/sh",
      'CLAMAV_SIGNATURE_DIRECTORY="$1"',
      "CLAMAV_SIGNATURE_MAX_AGE_SECONDS=3600",
      "export CLAMAV_SIGNATURE_DIRECTORY CLAMAV_SIGNATURE_MAX_AGE_SECONDS",
      "exec /bin/sh scripts/ops/clamav-signature-health.sh signatures",
    ].join("\n"),
  );
  const runSignatureHealth = () =>
    spawnSync(
      "bash",
      [shellPath(wrapper), shellPath(directory)],
      { cwd: process.cwd(), encoding: "utf8" },
    );
  try {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    writeDailyDatabase(daily, nowSeconds - 60);
    utimesSync(daily, new Date(0), new Date(0));
    const current = runSignatureHealth();
    assert.equal(current.status, 0, current.stderr);

    writeDailyDatabase(daily, nowSeconds - 7_200);
    utimesSync(daily, new Date(), new Date());
    const touchedStale = runSignatureHealth();
    assert.notEqual(touchedStale.status, 0);
    assert.match(touchedStale.stderr, /signatures are stale/);

    writeFileSync(daily, "ClamAV-VDB:truncated");
    const malformed = runSignatureHealth();
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /header is invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ClamAV health contract does not use filesystem mtime as signature age", () => {
  assert.match(signatureHealth, /ClamAV-VDB/);
  assert.match(signatureHealth, /bs=512 count=1/);
  assert.doesNotMatch(signatureHealth, /stat -c ['"]%Y/);
});
