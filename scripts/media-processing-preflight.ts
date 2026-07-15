import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

import { runClamAvPreflight } from "../src/lib/media/clamav-preflight";
import { createAwsS3ProviderContractAdapter } from "../src/lib/media/s3-provider-contract-aws";
import { runS3ProviderContractPreflight } from "../src/lib/media/s3-provider-contract";
import { runStratoS3CompatibilityPreflight } from "../src/lib/media/s3-strato-compatibility-preflight";
import { resolveMediaProcessingPreflightConfiguration } from "../src/lib/media/processing-preflight";
import { runBoundedMediaCommand } from "../src/lib/media/processing-provider";
import { resolveMediaStorageConfiguration } from "../src/lib/media/storage-configuration";
import { validateProductionMediaWorkerEnvironment } from "../src/lib/server-environment-validation";
import { loadProjectEnvironment } from "./load-environment";

function bucketArgument(argv: readonly string[]) {
  const index = argv.indexOf("--confirm-bucket");
  const bucket = index >= 0 ? argv[index + 1]?.trim() : "";
  if (!bucket) throw new Error("--confirm-bucket is required.");
  return bucket;
}

type MediaPreflightStage =
  | "configuration"
  | "environment_validation"
  | "ffmpeg"
  | "ffprobe"
  | "transcript"
  | "work_filesystem"
  | "storage_configuration"
  | "clamav"
  | "s3_provider";
let currentStage: MediaPreflightStage = "configuration";

function browserOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "");
}

async function main() {
  currentStage = "configuration";
  loadProjectEnvironment();
  const bucket = bucketArgument(process.argv.slice(2));
  const configuration = resolveMediaProcessingPreflightConfiguration(process.env);
  if (process.env.NODE_ENV === "production") {
    currentStage = "environment_validation";
    validateProductionMediaWorkerEnvironment(process.env);
  }
  currentStage = "ffmpeg";
  await runBoundedMediaCommand({ executable: configuration.ffmpeg, arguments: ["-version"], timeoutMs: 30_000 });
  currentStage = "ffprobe";
  await runBoundedMediaCommand({ executable: configuration.ffprobe, arguments: ["-version"], timeoutMs: 30_000 });
  currentStage = "transcript";
  if (configuration.transcript.mode === "command") {
    await runBoundedMediaCommand({ executable: configuration.transcript.executable, arguments: configuration.transcript.arguments, timeoutMs: 30_000 });
  } else {
    await access(configuration.transcript.directory, constants.R_OK);
  }
  currentStage = "work_filesystem";
  await mkdir(configuration.workRoot, { recursive: true, mode: 0o700 });
  const canary = resolve(configuration.workRoot, `.preflight-${process.pid}`);
  await writeFile(canary, "ok", { flag: "wx", mode: 0o600 });
  await rm(canary, { force: true });

  currentStage = "storage_configuration";
  const storage = resolveMediaStorageConfiguration(process.env);
  if (storage.driver !== "s3") throw new Error("S3 storage is required.");
  currentStage = "clamav";
  const clamAv = await runClamAvPreflight({
    configuration: storage.clamAv,
  });
  currentStage = "s3_provider";
  if (storage.compatibilityMode === "strato-hidrive") {
    const result = await runStratoS3CompatibilityPreflight({
      configuration: storage,
      confirmBucket: bucket,
      expectedOrigin: browserOrigin(),
    });
    console.log(JSON.stringify({
      ok: true,
      bucket: result.bucket,
      cleanup: "verified",
      storageMode: result.mode,
      nativeVersioning: result.nativeVersioning,
      nativeLifecycle: result.nativeLifecycle,
      principalIsolationVerified: result.principalIsolationVerified,
      clamAv,
      ffmpeg: true,
      ffprobe: true,
      transcript: configuration.transcript.mode,
      workRoot: configuration.workRoot,
    }));
    return;
  }
  const adapter = createAwsS3ProviderContractAdapter(storage);
  try {
    const result = await runS3ProviderContractPreflight({ adapter, confirmBucket: bucket });
    console.log(JSON.stringify({ ok: true, bucket: result.bucket, cleanup: "verified", clamAv, ffmpeg: true, ffprobe: true, transcript: configuration.transcript.mode, workRoot: configuration.workRoot }));
  } finally {
    adapter.destroy();
  }
}

await main().catch((error) => {
  void error;
  console.error(JSON.stringify({
    ok: false,
    code: "media_processing_preflight_failed",
    stage: currentStage,
  }));
  process.exitCode = 1;
});
