import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const drillPath = "scripts/ops/staging-storage-pipeline-outage-drill.sh";
const environmentPath = "scripts/ops/drill-environment.sh";
const helperPath = "scripts/ops/staging-storage-drill-json.mjs";
const documentationPath = "docs/RESILIENCE_DRILLS.md";
const drill = readFileSync(drillPath, "utf8");
const environment = readFileSync(environmentPath, "utf8");
const helper = readFileSync(helperPath, "utf8");

test("storage drill requires exact staging, project, bucket, and destructive acknowledgement", () => {
  for (const option of [
    "--origin",
    "--confirm-origin",
    "--project-name",
    "--confirm-project-name",
    "--bucket",
    "--confirm-bucket",
    "--ack",
    "--env-file",
    "--session-cookie-file",
  ]) {
    assert.match(drill, new RegExp(option));
  }
  assert.match(
    drill,
    /ACKNOWLEDGEMENT="STAGING_STORAGE_PIPELINE_OUTAGE"/,
  );
  assert.match(
    drill,
    /validate_q_academy_staging_storage_drill_target/,
  );
  assert.match(environment, /bucket.*!=.*confirm_bucket/);
  assert.match(environment, /env_bucket.*!=.*bucket/);
  assert.match(environment, /staging[\s\S]*stage[\s\S]*stg[\s\S]*preprod[\s\S]*sandbox/);
  assert.match(environment, /prod\*\|live\*/);
  assert.doesNotMatch(environment, /source\s+.*environment_file/);
});

test("storage target validator accepts only the exact env-bound non-production bucket", () => {
  const temporaryDirectory = mkdtempSync(
    path.join(root, ".q-academy-storage-target-"),
  );
  const environmentFile = path.join(temporaryDirectory, "staging.env");
  const runnerFile = path.join(temporaryDirectory, "validate.sh");
  const bashEnvironmentFile = path
    .relative(root, environmentFile)
    .replaceAll("\\", "/");
  const bashRunnerFile = path.relative(root, runnerFile).replaceAll("\\", "/");
  const writeEnvironment = (bucket: string, endpoint: string) =>
    writeFileSync(
      environmentFile,
      [
        "APP_DOMAIN=academy.staging.customer-domain.com",
        "COMPOSE_PROJECT_NAME=q-academy-staging",
        `MEDIA_S3_BUCKET=${bucket}`,
        `MEDIA_S3_ENDPOINT=${endpoint}`,
        "MEDIA_S3_SECRET_ACCESS_KEY=must-not-be-read-or-printed",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  writeEnvironment(
    "q-academy-staging-media",
    "https://objects.storage-provider.com",
  );
  writeFileSync(
    runnerFile,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "source scripts/ops/drill-environment.sh",
      `validate_q_academy_staging_storage_drill_target "$PWD/${bashEnvironmentFile}" "$1" "$2" "$3" "$4" "$5" "$6"`,
      "printf 'validated'",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const run = (bucket: string, confirmBucket: string) =>
    spawnSync(
      "bash",
      [
        bashRunnerFile,
        "q-academy-staging",
        "q-academy-staging",
        "https://academy.staging.customer-domain.com",
        "https://academy.staging.customer-domain.com",
        bucket,
        confirmBucket,
      ],
      { cwd: root, encoding: "utf8" },
    );

  try {
    const valid = run(
      "q-academy-staging-media",
      "q-academy-staging-media",
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout, "validated");
    assert.doesNotMatch(
      valid.stdout + valid.stderr,
      /must-not-be-read-or-printed/,
    );

    const mismatch = run(
      "q-academy-staging-media",
      "q-academy-stage-media",
    );
    assert.notEqual(mismatch.status, 0);

    writeEnvironment(
      "q-academy-production-media",
      "https://objects.storage-provider.com",
    );
    const production = run(
      "q-academy-production-media",
      "q-academy-production-media",
    );
    assert.notEqual(production.status, 0);

    writeEnvironment(
      "q-academy-staging-media",
      "http://objects.storage-provider.com",
    );
    const insecureEndpoint = run(
      "q-academy-staging-media",
      "q-academy-staging-media",
    );
    assert.notEqual(insecureEndpoint.status, 0);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("storage outage is constrained to the exact project network and Docker socket", () => {
  assert.match(drill, /verify_q_academy_local_docker_socket/);
  assert.match(drill, /build_q_academy_staging_compose_command/);
  assert.match(drill, /--profile operations config --services/);
  assert.match(
    drill,
    /Q_ACADEMY_DOCKER_BINARY\}" --host "\$\{Q_ACADEMY_DOCKER_ENDPOINT\}"/,
  );
  assert.match(
    drill,
    /com\.docker\.compose\.project=\$\{validated_project_name\}/,
  );
  assert.match(drill, /com\.docker\.compose\.network=egress/);
  assert.match(drill, /network disconnect[\s\S]*egress_network_id/);
  assert.match(
    drill,
    /network connect --alias media-runner[\s\S]*egress_network_id/,
  );
  assert.match(drill, /verify_project_service_container/);
  assert.match(drill, /network_project.*!=.*validated_project_name/);
  assert.doesNotMatch(drill, /network (?:prune|rm)/);
});

test("storage outage proves one durable retry while public health remains green", () => {
  assert.match(
    drill,
    /stop --timeout "\$\{WORKER_STOP_TIMEOUT_SECONDS\}"[\s\\]+media-worker/,
  );
  assert.match(drill, /STORAGE_PROBE_SCRIPT/);
  assert.match(drill, /app_storage_endpoint_reachable/);
  assert.match(drill, /write-download-config/);
  assert.match(drill, /--noproxy '\*'/);
  assert.match(drill, /randomBytes\(32\)/);
  assert.match(drill, /MEDIA_DISPATCH_SCRIPT/);
  assert.match(drill, /process\.env\.CRON_SECRET/);
  assert.match(drill, /validate-dispatch[\s\\]+[\s\S]*retrying/);
  assert.match(drill, /outage_queue_depth.*!= "1"/);
  assert.match(drill, /outage_failed_jobs.*!= "0"/);
  assert.match(drill, /queue="media_processing"/);
  assert.match(drill, /outage_processing_queue_depth.*!= "0"/);
  assert.match(drill, /api\/v1\/health\/live/);
  assert.match(drill, /api\/v1\/health\/ready/);
  assert.match(drill, /outage_live_status.*!= "200"/);
  assert.match(drill, /outage_ready_status.*!= "200"/);
});

test("EXIT trap restores network, workers, test-data state, and one-off containers", () => {
  assert.match(drill, /trap finish EXIT/);
  assert.match(drill, /recovery_required=true[\s\S]*workers_stopped=true/);
  const finishStart = drill.indexOf("finish() {");
  const finishEnd = drill.indexOf("\ntrap finish EXIT", finishStart);
  const finish = drill.slice(finishStart, finishEnd);
  assert.ok(finishStart > 0 && finishEnd > finishStart);
  assert.ok(
    finish.indexOf("connect_media_runner_egress") <
      finish.indexOf("restore_media_workers"),
  );
  assert.ok(
    finish.indexOf("restore_media_workers") <
      finish.indexOf("cleanup_test_asset"),
  );
  assert.match(finish, /remove_preflight_container/);
  assert.match(finish, /cleanup_sensitive_files/);
  assert.match(drill, /ps --all[\s\S]*name=\^\/\$\{preflight_container_name\}\$/);
  assert.match(finish, /failure_code="recovery_failed"/);
  assert.match(drill, /com\.docker\.compose\.oneoff/);
  assert.match(drill, /provider_canary_cleanup_verified=true/);
  assert.match(drill, /test_data_deletion_requested=true/);
});

test("storage evidence keeps credentials, signed URLs, identities, and hashes private", () => {
  assert.match(drill, /umask 077/);
  assert.match(drill, /work_directory_mode.*!= "700"/);
  assert.match(drill, /session_file_mode/);
  assert.match(drill, /MEDIA_METRICS_SCRIPT/);
  assert.match(drill, /process\.env\.METRICS_SECRET/);
  assert.match(drill, /curl --config "\$\{upload_config_file\}"/);
  assert.match(helper, /writeFileSync\(configPath, config/);
  assert.match(helper, /mode: 0o600/);
  assert.match(helper, /url\.username/);
  assert.match(helper, /url\.password/);
  const reportStart = drill.indexOf("write_report() {");
  const reportEnd = drill.indexOf("\nrun_compose_with_timeout()", reportStart);
  const report = drill.slice(reportStart, reportEnd);
  for (const forbidden of [
    "validated_bucket",
    "validated_storage_endpoint",
    "session_cookie_file",
    "asset_id",
    "media_runner_container_id",
    "egress_network_id",
    "canary_hash",
    "download_hash",
  ]) {
    assert.doesNotMatch(report, new RegExp(forbidden));
  }
});

test("private JSON helper validates upload, retry, asset, session, and preflight contracts", () => {
  const temporaryDirectory = mkdtempSync(
    path.join(root, ".q-academy-storage-json-"),
  );
  const id = "10000000-0000-4000-8000-000000000001";
  const canary = path.join(temporaryDirectory, "canary.txt");
  const create = path.join(temporaryDirectory, "create.json");
  const config = path.join(temporaryDirectory, "upload.curl");
  const session = path.join(temporaryDirectory, "session.json");
  const asset = path.join(temporaryDirectory, "asset.json");
  const dispatch = path.join(temporaryDirectory, "dispatch.json");
  const preflight = path.join(temporaryDirectory, "preflight.log");
  const downloadHeaders = path.join(temporaryDirectory, "download-headers.txt");
  const downloadConfig = path.join(temporaryDirectory, "download.curl");
  const downloadOutput = path.join(temporaryDirectory, "download.txt");
  const canaryBody = "Q-Academy storage resilience test\n";
  const signedUrl =
    `https://q-academy-staging-media.objects.storage-provider.com/incoming/tenants/20000000-0000-4000-8000-000000000002/assets/${id}/incoming.txt?X-Amz-Signature=must-not-leak&x-amz-meta-asset-id=${id}&x-amz-meta-organization-id=20000000-0000-4000-8000-000000000002`;
  const signedDownloadUrl =
    `https://q-academy-staging-media.objects.storage-provider.com/tenants/20000000-0000-4000-8000-000000000002/assets/${id}/ready.txt?X-Amz-Signature=must-not-leak`;
  const run = (...arguments_: string[]) =>
    spawnSync(process.execPath, [helperPath, ...arguments_], {
      cwd: root,
      encoding: "utf8",
    });

  try {
    writeFileSync(canary, canaryBody, { mode: 0o600 });
    writeFileSync(
      session,
      JSON.stringify({
        data: {
          id,
          organizationId: "20000000-0000-4000-8000-000000000002",
          sessionId: "30000000-0000-4000-8000-000000000003",
          role: "member",
          status: "active",
        },
      }),
    );
    writeFileSync(
      create,
      JSON.stringify({
        data: {
          id,
          purpose: "community",
          status: "pending",
          originalFileName: "q-academy-storage-drill.txt",
          declaredMimeType: "text/plain",
          declaredSizeBytes: Buffer.byteLength(canaryBody),
          statusUrl: `/api/media-assets/${id}`,
          completeUrl: `/api/media-assets/${id}/complete`,
          upload: {
            transport: "s3",
            method: "PUT",
            url: signedUrl,
            headers: {
              "Content-Length": String(Buffer.byteLength(canaryBody)),
              "Content-Type": "text/plain",
              "If-None-Match": "*",
            },
            expiresInSeconds: 900,
          },
        },
      }),
      { mode: 0o600 },
    );
    const upload = run(
      "write-upload-config",
      create,
      session,
      id,
      canary,
      config,
      "https://objects.storage-provider.com",
      "q-academy-staging-media",
    );
    assert.equal(upload.status, 0, upload.stderr);
    assert.equal(upload.stdout, "");
    assert.match(readFileSync(config, "utf8"), /X-Amz-Signature/);
    assert.doesNotMatch(upload.stdout + upload.stderr, /must-not-leak/);

    writeFileSync(
      downloadHeaders,
      `HTTP/2 307\r\nlocation: ${signedDownloadUrl}\r\ncache-control: private, no-store\r\n\r\n`,
      { mode: 0o600 },
    );
    writeFileSync(downloadOutput, "", { mode: 0o600 });
    const download = run(
      "write-download-config",
      downloadHeaders,
      session,
      id,
      downloadConfig,
      downloadOutput,
      "https://objects.storage-provider.com",
      "q-academy-staging-media",
    );
    assert.equal(download.status, 0, download.stderr);
    assert.equal(download.stdout, "");
    assert.match(readFileSync(downloadConfig, "utf8"), /X-Amz-Signature/);
    assert.doesNotMatch(download.stdout + download.stderr, /must-not-leak/);

    assert.equal(run("validate-session", session).status, 0);

    writeFileSync(asset, JSON.stringify({ data: { id, status: "ready" } }));
    assert.equal(run("validate-asset", asset, id, "ready").status, 0);
    const readStatus = run("read-asset-status", asset, id);
    assert.equal(readStatus.status, 0);
    assert.equal(readStatus.stdout, "ready");

    writeFileSync(
      asset,
      JSON.stringify({
        data: {
          id,
          status: "uploaded",
          scanAttempt: 1,
          scanFailureCode: "storage_unavailable",
        },
      }),
    );
    assert.equal(run("validate-retry-asset", asset, id).status, 0);

    writeFileSync(
      dispatch,
      JSON.stringify({
        data: {
          processed: 1,
          scans: ["retrying"],
          processing: [],
          backlog: { depth: 1, failed: 0 },
          processingBacklog: { depth: 0, failed: 0 },
        },
      }),
    );
    assert.equal(
      run("validate-dispatch", dispatch, "retrying").status,
      0,
    );

    writeFileSync(
      preflight,
      `${JSON.stringify({
        ok: true,
        cleanup: "verified",
        ffmpeg: true,
        ffprobe: true,
        clamAv: {
          cleanCanaryVerified: true,
          malwareCanaryBlocked: true,
        },
      })}\n`,
    );
    assert.equal(run("validate-preflight", preflight).status, 0);

    const invalidConfig = path.join(temporaryDirectory, "invalid.curl");
    const invalid = run(
      "write-upload-config",
      create,
      session,
      id,
      canary,
      invalidConfig,
      "https://different.storage-provider.com",
      "q-academy-staging-media",
    );
    assert.notEqual(invalid.status, 0);
    assert.equal(existsSync(invalidConfig), false);
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /must-not-leak/);

    const wrongPathStyleCreate = path.join(
      temporaryDirectory,
      "wrong-path-style.json",
    );
    const wrongPathStyleConfig = path.join(
      temporaryDirectory,
      "wrong-path-style.curl",
    );
    const wrongPathStylePayload = JSON.parse(readFileSync(create, "utf8")) as {
      data: { upload: { url: string } };
    };
    wrongPathStylePayload.data.upload.url =
      "https://objects.storage-provider.com/q-academy-prod-media/incoming/test?X-Amz-Signature=must-not-leak";
    writeFileSync(wrongPathStyleCreate, JSON.stringify(wrongPathStylePayload));
    const wrongPathStyle = run(
      "write-upload-config",
      wrongPathStyleCreate,
      session,
      id,
      canary,
      wrongPathStyleConfig,
      "https://objects.storage-provider.com",
      "q-academy-staging-media",
    );
    assert.notEqual(wrongPathStyle.status, 0);
    assert.equal(existsSync(wrongPathStyleConfig), false);
    assert.doesNotMatch(
      wrongPathStyle.stdout + wrongPathStyle.stderr,
      /must-not-leak/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("storage drill fails before Docker with exactly one parseable JSON report", () => {
  const result = spawnSync(
    "bash",
    [
      drillPath,
      "--origin",
      "https://academy.staging.customer-domain.com",
      "--confirm-origin",
      "https://academy.staging.customer-domain.com",
      "--project-name",
      "q-academy-staging",
      "--confirm-project-name",
      "q-academy-staging",
      "--bucket",
      "q-academy-staging-media",
      "--confirm-bucket",
      "q-academy-staging-media",
      "--ack",
      "WRONG_ACKNOWLEDGEMENT",
      "--env-file",
      "/not-used-storage-env",
      "--session-cookie-file",
      "/not-used-storage-cookie",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const report = JSON.parse(lines[0]) as {
    status: string;
    failureCode: string;
  };
  assert.equal(report.status, "failed");
  assert.equal(report.failureCode, "acknowledgement_missing");
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /WRONG_ACKNOWLEDGEMENT|not-used-storage/,
  );
});

test("storage drill scripts pass Bash and Node syntax validation", () => {
  const bash = spawnSync(
    "bash",
    ["-n", environmentPath, drillPath],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(bash.status, 0, bash.stderr);
  const node = spawnSync(process.execPath, ["--check", helperPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(node.status, 0, node.stderr);
});

test("resilience documentation states the storage drill evidence boundary", () => {
  const documentation = readFileSync(documentationPath, "utf8");
  assert.match(documentation, /STAGING_STORAGE_PIPELINE_OUTAGE/);
  assert.match(documentation, /media-runner egress/i);
  assert.match(documentation, /provider-wide outage/i);
  assert.match(documentation, /physical asset cleanup/i);
  assert.match(documentation, /verified cleanup/i);
});
