import { randomUUID } from "node:crypto";

import {
  scanMediaStreamWithClamAv,
} from "./clamav-scanner";
import type { ClamAvScanResult } from "./clamav-protocol";
import type { ClamAvConfiguration } from "./storage-configuration";

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 30_000;

type Scanner = (input: {
  configuration: ClamAvConfiguration;
  body: AsyncIterable<Uint8Array>;
  expectedSizeBytes: number;
  timeoutMs: number;
}) => Promise<ClamAvScanResult>;

export type ClamAvPreflightResult = Readonly<{
  cleanCanaryVerified: true;
  malwareCanaryBlocked: true;
}>;

export class ClamAvPreflightError extends Error {
  readonly code:
    | "scanner_unavailable"
    | "clean_canary_rejected"
    | "malware_canary_missed"
    | "malware_signature_missing";
  readonly stage: "clean" | "malware";

  constructor(
    code: ClamAvPreflightError["code"],
    message: string,
    stage: ClamAvPreflightError["stage"],
  ) {
    super(message);
    this.name = "ClamAvPreflightError";
    this.code = code;
    this.stage = stage;
  }
}

async function* stream(bytes: Uint8Array) {
  const split = Math.max(1, Math.floor(bytes.byteLength / 2));
  yield bytes.subarray(0, split);
  if (split < bytes.byteLength) yield bytes.subarray(split);
}

function malwareTestBytes() {
  // Split the harmless standard AV test pattern so source scanners do not
  // quarantine the repository itself. It exists only in memory during preflight.
  return Buffer.from(
    [
      "X5O!P%@AP[4\\PZX54(P^)",
      "7CC)7}$EICAR-STANDARD-",
      "ANTIVIRUS-TEST-FILE!$H+H*",
    ].join(""),
    "ascii",
  );
}

async function scan(
  scanner: Scanner,
  configuration: ClamAvConfiguration,
  bytes: Uint8Array,
  stage: ClamAvPreflightError["stage"],
  timeoutMs: number,
) {
  try {
    return await scanner({
      configuration,
      body: stream(bytes),
      expectedSizeBytes: bytes.byteLength,
      timeoutMs,
    });
  } catch {
    throw new ClamAvPreflightError(
      "scanner_unavailable",
      "The ClamAV deep preflight could not complete a bounded stream scan.",
      stage,
    );
  }
}

export async function runClamAvPreflight(input: {
  configuration: ClamAvConfiguration;
  scanner?: Scanner;
  timeoutMs?: number;
}): Promise<ClamAvPreflightResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new ClamAvPreflightError(
      "scanner_unavailable",
      "The ClamAV deep-preflight timeout is invalid.",
      "clean",
    );
  }
  const scanner = input.scanner ?? scanMediaStreamWithClamAv;
  const cleanBytes = Buffer.from(
    `q-academy-clamav-clean-canary-v1:${randomUUID()}`,
    "ascii",
  );
  const clean = await scan(
    scanner,
    input.configuration,
    cleanBytes,
    "clean",
    timeoutMs,
  );
  if (!clean.clean) {
    throw new ClamAvPreflightError(
      "clean_canary_rejected",
      "ClamAV rejected the clean deep-readiness canary.",
      "clean",
    );
  }

  const malware = await scan(
    scanner,
    input.configuration,
    malwareTestBytes(),
    "malware",
    timeoutMs,
  );
  if (malware.clean) {
    throw new ClamAvPreflightError(
      "malware_canary_missed",
      "ClamAV did not reject the standard malware-test canary.",
      "malware",
    );
  }
  if (!malware.signature?.trim()) {
    throw new ClamAvPreflightError(
      "malware_signature_missing",
      "ClamAV rejected the malware-test canary without a signature identity.",
      "malware",
    );
  }
  return { cleanCanaryVerified: true, malwareCanaryBlocked: true };
}
