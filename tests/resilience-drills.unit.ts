import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const script = readFileSync(
  "scripts/ops/staging-database-outage-drill.sh",
  "utf8",
);
const drillEnvironment = readFileSync(
  "scripts/ops/drill-environment.sh",
  "utf8",
);
const workerScript = readFileSync(
  "scripts/ops/staging-worker-outage-drill.sh",
  "utf8",
);
const replicaScript = readFileSync(
  "scripts/ops/staging-app-replica-drain-drill.sh",
  "utf8",
);
const documentation = readFileSync("docs/RESILIENCE_DRILLS.md", "utf8");

test("staging database outage drill requires explicit destructive confirmation", () => {
  for (const option of [
    "--origin",
    "--confirm-origin",
    "--ack",
    "--env-file",
    "--project-name",
  ]) {
    assert.match(script, new RegExp(option));
  }
  assert.match(script, /ACKNOWLEDGEMENT="STAGING_DATABASE_OUTAGE"/);
  assert.match(script, /origin.*!=.*confirm_origin/);
  assert.match(script, /acknowledgement.*!=.*ACKNOWLEDGEMENT/);
});

test("drill target policy rejects local and production-like targets", () => {
  assert.match(script, /\^https:\/\//);
  assert.match(script, /localhost/);
  assert.match(script, /\*\.internal/);
  assert.match(script, /staging\|stage\|stg\|preprod\|sandbox/);
  assert.match(script, /prod\|production\|live/);
  assert.match(script, /env_app_domain.*!=.*hostname/);
  assert.match(script, /-f[\s\S]*env_file[\s\S]*-L[\s\S]*env_file[\s\S]*-r[\s\S]*env_file/);
  assert.match(script, /DOCKER_HOST.*DOCKER_CONTEXT/);
  assert.match(script, /docker_endpoint.*!= unix:\/\/\/\*/);
});

test("drill uses bounded array commands and never evaluates environment data", () => {
  assert.match(script, /declare -a compose=\(\)/);
  assert.match(script, /compose=\([\s\S]*docker compose[\s\S]*--env-file[\s\S]*--project-name/);
  assert.match(script, /timeout --signal=TERM --kill-after=5s/);
  assert.doesNotMatch(script, /\beval\b/);
  assert.doesNotMatch(script, /(?:bash|sh)\s+-c/);
  assert.doesNotMatch(script, /source\s+.*env_file/);
});

test("EXIT trap guarantees PostgreSQL recovery and verifies the health contract", () => {
  assert.match(script, /trap finish EXIT/);
  assert.match(script, /recovery_required=true[\s\S]*stop --timeout[\s\S]*postgres/);
  assert.match(script, /recover_postgres[\s\S]*start postgres/);
  assert.match(script, /running_services_after_start/);
  assert.match(script, /api\/v1\/health\/live/);
  assert.match(script, /api\/v1\/health\/ready/);
  assert.match(script, /outage_live_status.*== "200"/);
  assert.match(script, /outage_ready_status.*!= "200"/);
  assert.match(script, /recovery_live_status.*== "200"/);
  assert.match(script, /recovery_ready_status.*== "200"/);
  assert.match(script, /failure_code="recovery_failed"/);
});

test("drill emits a versioned secret-free JSON report and is documented", () => {
  assert.match(script, /"schemaVersion":1/);
  assert.match(script, /"recoveryAttempted"/);
  assert.match(script, /"recovered"/);
  assert.doesNotMatch(script, /cat\s+.*env_file/);
  assert.match(documentation, /dedicated staging deployment/i);
  assert.match(documentation, /does not\s+authorize a production outage/i);
  assert.match(documentation, /STAGING_DATABASE_OUTAGE/);
  assert.match(documentation, /recovery_failed/);
});

test("shared staging target policy requires duplicate env-bound confirmations", () => {
  assert.match(
    drillEnvironment,
    /validate_q_academy_staging_drill_target\(\)/,
  );
  assert.match(drillEnvironment, /origin.*!=.*confirm_origin/);
  assert.match(
    drillEnvironment,
    /project_name.*!=.*confirm_project_name/,
  );
  assert.match(drillEnvironment, /env_app_domain.*!=.*hostname/);
  assert.match(
    drillEnvironment,
    /env_compose_project.*!=.*project_name/,
  );
  assert.match(drillEnvironment, /staging\|stage\|stg\|preprod\|sandbox/);
  assert.match(drillEnvironment, /prod\*\|live\*/);
  assert.doesNotMatch(
    drillEnvironment,
    /source\s+["']?\$\{?environment_file/,
  );
});

test("shared staging parser accepts only the exact confirmed non-production target", () => {
  const temporaryDirectory = mkdtempSync(
    path.join(root, ".q-academy-staging-target-"),
  );
  const environmentFile = path.join(temporaryDirectory, "staging.env");
  const runnerFile = path.join(temporaryDirectory, "validate.sh");
  const bashEnvironmentFile = path
    .relative(root, environmentFile)
    .replaceAll("\\", "/");
  const bashRunnerFile = path.relative(root, runnerFile).replaceAll("\\", "/");
  writeFileSync(
    environmentFile,
    [
      "APP_DOMAIN=academy.staging.customer-domain.com",
      "COMPOSE_PROJECT_NAME=q-academy-staging",
      "SESSION_SECRET=must-not-be-read-or-printed",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(
    runnerFile,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "source scripts/ops/drill-environment.sh",
      `validate_q_academy_staging_drill_target "$PWD/${bashEnvironmentFile}" "$1" "$2" "$3" "$4"`,
      "printf '%s|%s' \"$Q_ACADEMY_STAGING_PROJECT_NAME\" \"$Q_ACADEMY_STAGING_ORIGIN\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const run = (
    project: string,
    confirmProject: string,
    origin: string,
    confirmOrigin: string,
  ) =>
    spawnSync(
      "bash",
      [bashRunnerFile, project, confirmProject, origin, confirmOrigin],
      { cwd: root, encoding: "utf8" },
    );
  try {
    const valid = run(
      "q-academy-staging",
      "q-academy-staging",
      "https://academy.staging.customer-domain.com",
      "https://academy.staging.customer-domain.com",
    );
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(
      valid.stdout,
      "q-academy-staging|https://academy.staging.customer-domain.com",
    );
    assert.doesNotMatch(valid.stdout + valid.stderr, /must-not-be-read/);

    const production = run(
      "q-academy-production",
      "q-academy-production",
      "https://academy.production.customer-domain.com",
      "https://academy.production.customer-domain.com",
    );
    assert.notEqual(production.status, 0);

    const mismatchedConfirmation = run(
      "q-academy-staging",
      "q-academy-stage",
      "https://academy.staging.customer-domain.com",
      "https://academy.staging.customer-domain.com",
    );
    assert.notEqual(mismatchedConfirmation.status, 0);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("shared Docker policy permits only the active local Unix socket", () => {
  assert.match(
    drillEnvironment,
    /verify_q_academy_local_docker_socket\(\)/,
  );
  assert.match(drillEnvironment, /DOCKER_HOST.*DOCKER_CONTEXT/);
  assert.match(drillEnvironment, /docker_endpoint.*!= unix:\/\/\/\*/);
  assert.match(drillEnvironment, /! -S "\$\{socket_path\}"/);
  assert.match(drillEnvironment, /docker context show/);
  assert.match(drillEnvironment, /docker context inspect/);
  assert.match(drillEnvironment, /docker info/);
  assert.match(drillEnvironment, /timeout --signal=TERM --kill-after=5s 20s/);
  assert.match(
    drillEnvironment,
    /build_q_academy_staging_compose_command\(\)/,
  );
  assert.match(drillEnvironment, /target=\(env -i/);
  assert.match(
    drillEnvironment,
    /Q_ACADEMY_DOCKER_BINARY\}" --host "\$\{Q_ACADEMY_DOCKER_ENDPOINT\}" compose/,
  );
  assert.match(
    drillEnvironment,
    /environment_file.*!=.*Q_ACADEMY_STAGING_ENV_FILE/,
  );
  assert.match(workerScript, /build_q_academy_staging_compose_command/);
  assert.match(replicaScript, /build_q_academy_staging_compose_command/);
  for (const drill of [workerScript, replicaScript]) {
    assert.match(
      drill,
      /Q_ACADEMY_DOCKER_BINARY\}" --host "\$\{Q_ACADEMY_DOCKER_ENDPOINT\}" "\$@"/,
    );
  }
});

test("worker outage drill proves growth, health, trap recovery, and drain", () => {
  for (const option of [
    "--origin",
    "--confirm-origin",
    "--project-name",
    "--confirm-project-name",
    "--ack",
    "--env-file",
  ]) {
    assert.match(workerScript, new RegExp(option));
  }
  assert.match(workerScript, /ACKNOWLEDGEMENT="STAGING_WORKER_OUTAGE"/);
  assert.match(workerScript, /source .*drill-environment\.sh/);
  assert.match(
    workerScript,
    /validate_q_academy_staging_drill_target/,
  );
  assert.match(workerScript, /verify_q_academy_local_docker_socket/);
  assert.match(
    workerScript,
    /stop --timeout.*[\s\S]*scheduler media-worker/,
  );
  assert.match(workerScript, /trap finish EXIT/);
  assert.match(workerScript, /recover_workers[\s\S]*start scheduler media-worker/);
  assert.match(workerScript, /snapshot_depth > baseline_queue_depth/);
  assert.match(workerScript, /snapshot_depth <= baseline_queue_depth/);
  assert.match(workerScript, /snapshot_failed <= baseline_failed_jobs/);
  assert.match(workerScript, /outage_live_status.*!= "200"/);
  assert.match(workerScript, /outage_ready_status.*!= "200"/);
  assert.match(workerScript, /DRAIN_TIMEOUT_SECONDS=900/);
});

test("worker queue evidence keeps metric bearer secrets inside containers", () => {
  assert.match(workerScript, /process\.env\.METRICS_SECRET/);
  assert.match(
    workerScript,
    /exec -T "\$\{service\}" node -e[\s\S]*METRICS_SNAPSHOT_SCRIPT/,
  );
  assert.match(workerScript, /q_academy_queue_depth/);
  assert.match(workerScript, /q_academy_queue_failed/);
  assert.match(workerScript, /"schemaVersion":1/);
  assert.match(workerScript, /"queueIncreaseObserved"/);
  assert.match(workerScript, /"drained"/);
  assert.doesNotMatch(workerScript, /cat\s+.*env_file/);
  assert.doesNotMatch(workerScript, /\beval\b/);
  assert.doesNotMatch(workerScript, /(?:bash|sh)\s+-c/);
});

test("app replica drill drains both same-image project-bound containers", () => {
  for (const option of [
    "--origin",
    "--confirm-origin",
    "--project-name",
    "--confirm-project-name",
    "--ack",
    "--env-file",
    "--session-cookie-file",
  ]) {
    assert.match(replicaScript, new RegExp(option));
  }
  assert.match(
    replicaScript,
    /ACKNOWLEDGEMENT="STAGING_APP_REPLICA_DRAIN"/,
  );
  assert.match(replicaScript, /source .*drill-environment\.sh/);
  assert.match(replicaScript, /--scale app=2 app/);
  assert.match(replicaScript, /com\.docker\.compose\.project/);
  assert.match(replicaScript, /com\.docker\.compose\.service/);
  assert.match(replicaScript, /inspect --format '\{\{\.Image\}\}'/);
  assert.match(
    replicaScript,
    /stop --time "\$\{APP_STOP_TIMEOUT_SECONDS\}"[\s\S]*app_container_ids\[0\]/,
  );
  assert.match(
    replicaScript,
    /stop --time "\$\{APP_STOP_TIMEOUT_SECONDS\}"[\s\S]*app_container_ids\[1\]/,
  );
  assert.match(replicaScript, /trap finish EXIT/);
  assert.match(
    replicaScript,
    /restore_original_topology[\s\S]*--scale "app=\$\{initial_app_replicas\}" app/,
  );
});

test("app drain session probe is private, stable, and absent from JSON", () => {
  assert.match(replicaScript, /\/api\/v1\/me/);
  assert.match(replicaScript, /--cookie "\$\{session_cookie_file\}"/);
  assert.match(replicaScript, /stat -c '%a'/);
  assert.match(replicaScript, /stat -c '%u'/);
  assert.match(replicaScript, /session_file_size > 16384/);
  assert.match(replicaScript, /createHash\("sha256"\)/);
  assert.match(
    replicaScript,
    /last_session_fingerprint.*==.*baseline_session_fingerprint/,
  );
  assert.match(replicaScript, /cleanup_sensitive_files/);
  const reportStart = replicaScript.indexOf("write_report() {");
  const reportEnd = replicaScript.indexOf("\nrun_compose_with_timeout()", reportStart);
  assert.ok(reportStart >= 0 && reportEnd > reportStart);
  const report = replicaScript.slice(reportStart, reportEnd);
  assert.match(report, /"sessionIdentityStable"/);
  assert.doesNotMatch(report, /session_fingerprint|session_cookie_file/);
});

test("all resilience shell contracts pass Bash syntax validation", () => {
  const syntax = spawnSync(
    "bash",
    [
      "-n",
      "scripts/ops/drill-environment.sh",
      "scripts/ops/staging-database-outage-drill.sh",
      "scripts/ops/staging-worker-outage-drill.sh",
      "scripts/ops/staging-app-replica-drain-drill.sh",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("new drills emit exactly one parseable failed JSON object before touching Docker", () => {
  const sharedArguments = [
    "--origin",
    "https://academy.staging.customer-domain.com",
    "--confirm-origin",
    "https://academy.staging.customer-domain.com",
    "--project-name",
    "q-academy-staging",
    "--confirm-project-name",
    "q-academy-staging",
    "--ack",
    "WRONG_ACKNOWLEDGEMENT",
    "--env-file",
    "/not-used/staging.env",
  ];
  for (const [file, extraArguments, expectedDrill] of [
    [
      "scripts/ops/staging-worker-outage-drill.sh",
      [],
      "staging_worker_outage",
    ],
    [
      "scripts/ops/staging-app-replica-drain-drill.sh",
      ["--session-cookie-file", "/not-used/session.cookies"],
      "staging_app_replica_drain",
    ],
  ] as const) {
    const result = spawnSync(
      "bash",
      [file, ...sharedArguments, ...extraArguments],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.drill, expectedDrill);
    assert.equal(report.status, "failed");
    assert.equal(report.failureCode, "acknowledgement_missing");
    assert.doesNotMatch(result.stdout, /WRONG_ACKNOWLEDGEMENT|not-used/);
  }
});

test("resilience runbook preserves evidence boundaries and external gates", () => {
  assert.match(documentation, /STAGING_WORKER_OUTAGE/);
  assert.match(documentation, /STAGING_APP_REPLICA_DRAIN/);
  assert.match(documentation, /legitimate, disposable staging job/i);
  assert.match(documentation, /private curl-compatible cookie jar/i);
  assert.match(documentation, /does not prove multi-host placement/i);
  assert.match(documentation, /general absence of\s+data loss/i);
  assert.match(documentation, /presence in the\s+repository is not evidence/i);
});
