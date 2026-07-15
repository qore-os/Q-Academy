import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ClamAvPreflightError,
  runClamAvPreflight,
} from "../src/lib/media/clamav-preflight";
import { resolveClamAvConfiguration } from "../src/lib/media/storage-configuration";

const configuration = {
  host: "clamav",
  port: 3310,
  required: true,
} as const;

async function bytes(body: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("ClamAV deep preflight verifies a clean stream and blocks the runtime malware canary", async () => {
  const scanned: Buffer[] = [];
  const result = await runClamAvPreflight({
    configuration,
    scanner: async (input) => {
      const value = await bytes(input.body);
      assert.equal(value.byteLength, input.expectedSizeBytes);
      scanned.push(value);
      return scanned.length === 1
        ? { clean: true, signature: null }
        : { clean: false, signature: "Eicar-Test-Signature" };
    },
  });

  assert.deepEqual(result, {
    cleanCanaryVerified: true,
    malwareCanaryBlocked: true,
  });
  assert.match(scanned[0]?.toString("ascii") ?? "", /^q-academy-clamav-clean-canary-v1:/);
  assert.equal(scanned[1]?.byteLength, 68);
  assert.match(scanned[1]?.toString("ascii") ?? "", /EICAR-STANDARD-ANTIVIRUS/);
});

test("ClamAV deep preflight fails closed for false positives, false negatives, and transport errors", async () => {
  await assert.rejects(
    runClamAvPreflight({
      configuration,
      scanner: async () => ({ clean: false, signature: "unexpected" }),
    }),
    (error: unknown) =>
      error instanceof ClamAvPreflightError &&
      error.code === "clean_canary_rejected" &&
      error.stage === "clean",
  );

  let scans = 0;
  await assert.rejects(
    runClamAvPreflight({
      configuration,
      scanner: async () => {
        scans += 1;
        return scans === 1
          ? { clean: true, signature: null }
          : { clean: true, signature: null };
      },
    }),
    (error: unknown) =>
      error instanceof ClamAvPreflightError &&
      error.code === "malware_canary_missed" &&
      error.stage === "malware",
  );

  await assert.rejects(
    runClamAvPreflight({
      configuration,
      scanner: async () => {
        throw new Error("connect ECONNREFUSED secret.internal");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ClamAvPreflightError);
      assert.equal(error.code, "scanner_unavailable");
      assert.doesNotMatch(error.message, /secret\.internal|ECONNREFUSED/);
      return true;
    },
  );
});

test("ClamAV-only configuration resolution does not require S3 credentials", () => {
  assert.deepEqual(
    resolveClamAvConfiguration({
      NODE_ENV: "production",
      MEDIA_CLAMAV_HOST: "ClamAV",
      MEDIA_CLAMAV_PORT: "3310",
    }),
    configuration,
  );
  assert.throws(
    () =>
      resolveClamAvConfiguration({
        NODE_ENV: "production",
        MEDIA_CLAMAV_HOST: "https://clamav.invalid",
      }),
    /MEDIA_CLAMAV_HOST/,
  );
});

test("the complete malware-test vector is never stored as one source literal", async () => {
  const source = await readFile(
    new URL("../src/lib/media/clamav-preflight.ts", import.meta.url),
    "utf8",
  );
  const runtimeVector = [
    "X5O!P%@AP[4\\PZX54(P^)",
    "7CC)7}$EICAR-STANDARD-",
    "ANTIVIRUS-TEST-FILE!$H+H*",
  ].join("");
  assert.equal(runtimeVector.length, 68);
  assert.equal(source.includes(runtimeVector), false);
});
