import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync("scripts/ops/deploy-release.sh", "utf8");
const rollback = readFileSync("scripts/ops/rollback-release.sh", "utf8");
const common = readFileSync("scripts/ops/release-common.sh", "utf8");
const backup = readFileSync("scripts/ops/postgres-backup.sh", "utf8");
const restore = readFileSync("scripts/ops/postgres-restore.sh", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const compose = readFileSync("compose.production.yml", "utf8");
const migrate = readFileSync("scripts/migrate.ts", "utf8");
const databasePreflight = readFileSync(
  "scripts/ops/database-config-preflight.sh",
  "utf8",
);
const databaseRole = readFileSync(
  "scripts/ops/database-role-entrypoint.sh",
  "utf8",
);
const databasePermissions = readFileSync(
  "scripts/ops/database-permissions-entrypoint.sh",
  "utf8",
);
const backupService = readFileSync(
  "deploy/systemd/q-academy-backup.service",
  "utf8",
);
const backupTimer = readFileSync(
  "deploy/systemd/q-academy-backup.timer",
  "utf8",
);
const incidentRunbook = readFileSync(
  "docs/INCIDENT_RESPONSE_RUNBOOK.md",
  "utf8",
);
const createReleaseArtifact = readFileSync(
  "scripts/ops/create-release-artifact.sh",
  "utf8",
);
const publishReleaseImages = readFileSync(
  "scripts/ops/publish-release-images.sh",
  "utf8",
);
const continuousIntegration = readFileSync(".github/workflows/ci.yml", "utf8");
const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  packageManager?: string;
};
const zapierPackageManifest = JSON.parse(
  readFileSync("integrations/automation-connectors/zapier/package.json", "utf8"),
) as { packageManager?: string };

test("CI and connector lockfiles share one pinned Node and npm toolchain", () => {
  assert.equal(packageManifest.packageManager, "npm@10.9.8");
  assert.equal(zapierPackageManifest.packageManager, "npm@10.9.8");
  assert.equal(
    continuousIntegration.match(/node-version: 22\.23\.1/g)?.length,
    2,
  );
});

test("release deployment is locked, backed up, immutable, and readiness-gated", () => {
  assert.match(deploy, /set -euo pipefail/);
  assert.match(deploy, /flock -n 9/);
  assert.match(deploy, /exec 8>"\$backup_lock_file"/);
  assert.match(deploy, /flock -n 8/);
  assert.match(deploy, /Q_ACADEMY_BACKUP_LOCK_FD=8/);
  assert.match(deploy, /BACKUP_LOCK_FILE="\$backup_lock_file"/);
  assert.match(deploy, /git rev-parse --verify HEAD\^\{commit\}/);
  assert.match(deploy, /release tag must equal git-<full HEAD>/);
  assert.match(deploy, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(deploy, /--target release-verifier/);
  assert.match(deploy, /docker run --rm --network none/);
  assert.doesNotMatch(deploy, /\bnpm\b/);
  assert.match(deploy, /postgres-backup\.sh/);
  assert.match(
    deploy,
    /up -d --no-recreate --wait --wait-timeout 300 postgres/,
  );
  assert.match(
    deploy,
    /up -d --wait --wait-timeout 900 postgres clamav/,
  );
  assert.match(deploy, /predeploy_backup_decision/);
  assert.match(deploy, /pg_class relation_record/);
  assert.match(deploy, /Fresh database has no application relations/);
  assert.match(deploy, /docker image inspect/);
  assert.match(deploy, /q-academy-key-rotation/);
  assert.match(deploy, /q-academy-tenant-ops/);
  assert.match(deploy, /q-academy-media-runner/);
  assert.match(deploy, /q-academy-media-preflight/);
  assert.match(deploy, /q-academy-s3-app-principal-preflight/);
  assert.match(deploy, /RELEASE_IMAGE_MODE:-verified-manifest/);
  assert.match(deploy, /RELEASE_IMAGE_MANIFEST is required/);
  assert.match(deploy, /gh attestation verify "\$release_image_manifest"/);
  assert.match(deploy, /--bundle "\$release_attestation_bundle"/);
  assert.match(deploy, /--repo "\$release_github_repository"/);
  assert.match(deploy, /--signer-workflow "\$release_signer_workflow"/);
  assert.match(deploy, /--source-digest "\$head_commit"/);
  assert.match(deploy, /--deny-self-hosted-runners/);
  assert.match(deploy, /verify_release_image_manifest_checksum/);
  assert.match(deploy, /verify_release_image_manifest/);
  assert.match(deploy, /run docker pull "\$source_image"/);
  assert.match(deploy, /local release tag points to different content/);
  assert.match(deploy, /local-build\)/);
  assert.match(deploy, /build --pull app migrate key-rotation tenant-admin-ops media-runner media-preflight s3-app-principal-preflight/);
  assert.match(deploy, /immutable release image already exists/);
  assert.match(
    deploy,
    /media-preflight[\s\\]+--confirm-bucket "\$media_bucket"/,
  );
  assert.match(
    deploy,
    /s3-app-principal-preflight[\s\\]+--confirm-bucket "\$media_bucket"/,
  );
  assert.match(deploy, /required command is missing: \$command/);
  assert.match(deploy, /timeout --foreground --signal=TERM --kill-after=30s/);
  assert.match(deploy, /S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS/);
  assert.match(deploy, /MEDIA_PROCESSING_PREFLIGHT_TIMEOUT_SECONDS/);
  assert.match(deploy, /api\/v1\/health\/ready/);
  assert.match(deploy, /Q_ACADEMY_EXPECTED_RELEASE=\$release_tag/);
  assert.match(
    deploy,
    /body\?\.data\?\.version!==process\.env\.Q_ACADEMY_EXPECTED_RELEASE/,
  );
  assert.match(deploy, /persist_app_image_tag "\$env_file" "\$release_tag"/);
  assert.match(deploy, /verify_media_work_mount "\$env_file"/);
  assert.match(deploy, /stop -t 30 "\$\{DATABASE_WRITER_SERVICES\[@\]\}"/);
  assert.match(deploy, /run .*database-config-preflight/);
  assert.match(deploy, /run .*database-role/);
  assert.match(deploy, /run .*migrate/);
  assert.match(deploy, /run .*database-permissions/);
  assert.match(deploy, /--wait --wait-timeout 300 "\$\{DATABASE_RUNTIME_SERVICES\[@\]\}"/);
  assert.match(deploy, /exec -T \\\s+-e[^\n]+\\\s+"\$runtime_service" node -e/);
  assert.match(deploy, /DATABASE_DISPATCHER_SERVICES/);
  assert.match(
    deploy,
    /up -d --no-deps --wait \\\s+--wait-timeout "\$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \\\s+"\$\{DATABASE_DISPATCHER_SERVICES\[@\]\}"/,
  );
  assert.match(deploy, /All application and media writers remain stopped/);
  assert.match(deploy, /CURRENT_TAG=/);
  assert.doesNotMatch(deploy, /docker compose down/);
  assert.doesNotMatch(deploy, /db:push/);

  const roleValidation = deploy.indexOf(
    'run "${compose[@]}" run --rm --no-deps -e DATABASE_ROLE_MODE=validate database-role',
  );
  const backupLock = deploy.indexOf('exec 8>"$backup_lock_file"');
  const inheritedBackupContract = deploy.indexOf(
    "Q_ACADEMY_BACKUP_LOCK_FD=8",
  );
  const backupRun = deploy.indexOf(
    "scripts/ops/postgres-backup.sh",
    inheritedBackupContract,
  );
  const writerStop = deploy.indexOf(
    'run "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"',
  );
  const roleReconciliation = deploy.indexOf(
    'run "${compose[@]}" run --rm --no-deps database-role',
    writerStop,
  );
  const appPrincipalPreflight = deploy.indexOf(
    'run_with_timeout "$S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS"',
  );
  const backupDecision = deploy.indexOf(
    'backup_decision="$(predeploy_backup_decision "$initial_install" "$application_relation_count")"',
  );
  assert.ok(roleValidation >= 0 && roleValidation < backupDecision);
  assert.ok(appPrincipalPreflight > roleValidation);
  assert.ok(appPrincipalPreflight < backupDecision);
  assert.ok(backupDecision < backupLock);
  assert.ok(backupLock < inheritedBackupContract);
  assert.ok(inheritedBackupContract < backupRun);
  assert.ok(backupRun < writerStop);
  assert.ok(roleReconciliation > writerStop);
  const dispatcherHealthGate = deploy.indexOf(
    '--wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS"',
  );
  const releasePersistence = deploy.indexOf(
    'persist_app_image_tag "$env_file" "$release_tag"',
  );
  const releaseCompletion = deploy.indexOf(
    "release_completed=true",
    releasePersistence,
  );
  assert.ok(dispatcherHealthGate > writerStop);
  assert.ok(dispatcherHealthGate < releasePersistence);
  assert.ok(releasePersistence < releaseCompletion);
  const prematureBackupLockClose = deploy.indexOf("exec 8>&-");
  assert.ok(
    prematureBackupLockClose === -1 ||
      prematureBackupLockClose > releaseCompletion,
  );
  assert.doesNotMatch(
    deploy.slice(0, writerStop),
    /run "\$\{compose\[@\]\}" run --rm --no-deps database-role/,
  );
});

test("first install skips only an empty database backup", () => {
  assert.match(common, /predeploy_backup_decision\(\)/);
  assert.match(
    common,
    /"\$initial_install" == "true" && "\$application_relation_count" == "0"/,
  );
  assert.match(common, /printf 'skip-empty-initial'/);
  assert.match(common, /printf 'required'/);
  assert.match(deploy, /initial_install=true/);
  assert.match(deploy, /release state must be a regular non-symlink file/);
  assert.match(deploy, /production_env_value "\$state_file" CURRENT_TAG/);
  assert.match(deploy, /release state exists while production APP_IMAGE_TAG is empty/);
  assert.match(deploy, /release state contains an invalid current tag/);

  const dependencyStart = deploy.indexOf(
    'run "${compose[@]}" up -d --no-recreate --wait --wait-timeout 300 postgres',
  );
  const roleValidation = deploy.indexOf(
    'run "${compose[@]}" run --rm --no-deps -e DATABASE_ROLE_MODE=validate database-role',
  );
  const writerStop = deploy.indexOf(
    'run "${compose[@]}" stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"',
  );
  const infrastructureActivation = deploy.indexOf(
    'run "${compose[@]}" up -d --wait --wait-timeout 900 postgres clamav',
  );
  const migration = deploy.indexOf(
    'run "${compose[@]}" run --rm --no-deps migrate',
  );
  const mediaPreflight = deploy.indexOf(
    'run_with_timeout "$MEDIA_PROCESSING_PREFLIGHT_TIMEOUT_SECONDS"',
  );
  assert.ok(dependencyStart >= 0 && dependencyStart < roleValidation);
  assert.ok(writerStop > roleValidation);
  assert.ok(infrastructureActivation > writerStop);
  assert.ok(mediaPreflight > infrastructureActivation);
  assert.ok(mediaPreflight < migration);
  assert.ok(infrastructureActivation < migration);
});

test("pre-deployment backup decision executes fail closed", () => {
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        "set -eu",
        "source scripts/ops/release-common.sh",
        "predeploy_backup_decision true 0",
        "printf '|'",
        "predeploy_backup_decision true 1",
        "printf '|'",
        "predeploy_backup_decision false 0",
        "if predeploy_backup_decision invalid 0 >/dev/null 2>&1; then exit 20; fi",
        "if predeploy_backup_decision true invalid >/dev/null 2>&1; then exit 21; fi",
      ].join("; "),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "skip-empty-initial|required|required");
});

test("child backup validates the inherited deployment lock without self-deadlock", () => {
  assert.match(
    backup,
    /inherited_backup_lock_fd="\$\{Q_ACADEMY_BACKUP_LOCK_FD:-\}"/,
  );
  assert.match(
    backup,
    /inherited_backup_lock_path="\/proc\/\$\$\/fd\/\$\{inherited_backup_lock_fd\}"/,
  );
  assert.match(
    backup,
    /stat -Lc '%d:%i' -- "\$inherited_backup_lock_path"/,
  );
  assert.match(
    backup,
    /stat -Lc '%d:%i' -- "\$BACKUP_LOCK_FILE"/,
  );
  assert.match(backup, /flock -n "\$inherited_backup_lock_fd"/);
  assert.match(backup, /exec 9>"\$\{BACKUP_LOCK_FILE\}"/);
  assert.match(backup, /inherited backup lock descriptor is invalid/i);
  assert.match(backup, /inherited backup lock descriptor is unavailable/i);
  assert.match(
    backup,
    /inherited backup lock descriptor does not match the configured lock file/i,
  );
  assert.match(
    backup,
    /inherited backup lock descriptor could not be locked/i,
  );

  const digest = "a".repeat(64);
  const commit = "b".repeat(40);
  const productionEnvironment = [
    `APP_IMAGE_TAG=git-${commit}`,
    `NODE_IMAGE=registry.invalid/node@sha256:${digest}`,
    `POSTGRES_IMAGE=registry.invalid/postgres@sha256:${digest}`,
    `CLAMAV_IMAGE=registry.invalid/clamav@sha256:${digest}`,
    `CURL_IMAGE=registry.invalid/curl@sha256:${digest}`,
    `PROMETHEUS_IMAGE=registry.invalid/prometheus@sha256:${digest}`,
    `NODE_EXPORTER_IMAGE=registry.invalid/node-exporter@sha256:${digest}`,
    `CADDY_IMAGE=registry.invalid/caddy@sha256:${digest}`,
  ]
    .map((line) => `'${line}'`)
    .join(" ");
  const contractScript = [
    "set -Eeuo pipefail",
    'test_root="/tmp/q-academy-lock-contract-$$"',
    'mkdir -p -- "$test_root"',
    'trap \'rm -rf -- "$test_root"\' EXIT',
    'env_file="$test_root/production.env"',
    'lock_file="$test_root/backup.lock"',
    ': >"$lock_file"',
    `printf '%s\\n' ${productionEnvironment} >"$env_file"`,
    "docker() { printf 'docker-stub-reached\\n' >&2; return 73; }",
    "export -f docker",
    "run_backup() {",
    "  local -a backup_environment=(",
    '    "Q_ACADEMY_ENV_FILE=$env_file"',
    '    "Q_ACADEMY_COMPOSE_FILE=$PWD/compose.production.yml"',
    '    "BACKUP_DIR=$test_root/backups"',
    '    "BACKUP_METRICS_FILE=$test_root/metrics/backup.prom"',
    '    "BACKUP_LOCK_FILE=$lock_file"',
    '    "BACKUP_VERIFY_RESTORE=false"',
    '    "Q_ACADEMY_BACKUP_LOCK_FD=$1"',
    "  )",
    '  env "${backup_environment[@]}" bash scripts/ops/postgres-backup.sh',
    "}",
    'if run_backup invalid >"$test_root/invalid.out" 2>"$test_root/invalid.err"; then exit 20; fi',
    'grep -Fq "The inherited backup lock descriptor is invalid." "$test_root/invalid.err"',
    "exec 8>&- || true",
    'if run_backup 8 >"$test_root/unavailable.out" 2>"$test_root/unavailable.err"; then exit 21; fi',
    'grep -Fq "The inherited backup lock descriptor is unavailable." "$test_root/unavailable.err"',
    'exec 8>"$test_root/wrong.lock"',
    "flock -n 8",
    'if run_backup 8 >"$test_root/mismatch.out" 2>"$test_root/mismatch.err"; then exit 22; fi',
    'grep -Fq "The inherited backup lock descriptor does not match the configured lock file." "$test_root/mismatch.err"',
    'exec 8>"$lock_file"',
    "flock -n 8",
    "set +e",
    'run_backup 8 >"$test_root/valid.out" 2>"$test_root/valid.err"',
    "valid_status=$?",
    "set -e",
    '[[ "$valid_status" -eq 73 ]] || { cat "$test_root/valid.err" >&2; exit 23; }',
    'grep -Fq "docker-stub-reached" "$test_root/valid.err"',
    'if grep -Fqi "could not be locked" "$test_root/valid.err"; then exit 24; fi',
    "printf 'inherited-lock-contract-ok\\n'",
  ].join("\n");
  const result = spawnSync("bash", ["-s"], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: contractScript,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "inherited-lock-contract-ok\n");
});

test("app rollback requires explicit compatibility and never mutates the database", () => {
  assert.match(rollback, /CONFIRM_ROLLBACK_TAG/);
  assert.match(rollback, /MIGRATIONS_BACKWARD_COMPATIBLE/);
  assert.match(rollback, /docker image inspect/);
  assert.match(rollback, /target media runner image is not present locally/);
  assert.match(rollback, /stop -t 30 "\$\{DATABASE_WRITER_SERVICES\[@\]\}"/);
  assert.match(
    rollback,
    /--wait --wait-timeout 300 "\$\{DATABASE_RUNTIME_SERVICES\[@\]\}"/,
  );
  assert.match(rollback, /exec -T \\\s+-e[^\n]+\\\s+"\$runtime_service" node -e/);
  assert.match(rollback, /Q_ACADEMY_EXPECTED_RELEASE=\$target_tag/);
  assert.match(
    rollback,
    /body\?\.data\?\.version!==process\.env\.Q_ACADEMY_EXPECTED_RELEASE/,
  );
  assert.match(rollback, /DATABASE_DISPATCHER_SERVICES/);
  assert.match(
    rollback,
    /up -d --no-deps --wait \\\s+--wait-timeout "\$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \\\s+"\$\{DATABASE_DISPATCHER_SERVICES\[@\]\}"/,
  );
  assert.match(rollback, /All application and media writers remain stopped/);
  assert.match(rollback, /release state and production APP_IMAGE_TAG disagree/);
  assert.match(rollback, /persist_app_image_tag "\$env_file" "\$target_tag"/);
  assert.match(rollback, /verify_media_work_mount "\$env_file"/);
  assert.match(rollback, /Database was not changed/);
  assert.doesNotMatch(rollback, /\bmigrate\b/);
  assert.doesNotMatch(rollback, /postgres-restore/);
  assert.doesNotMatch(rollback, /docker compose down/);

  const dispatcherHealthGate = rollback.indexOf(
    '--wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS"',
  );
  const releasePersistence = rollback.indexOf(
    'persist_app_image_tag "$env_file" "$target_tag"',
  );
  assert.ok(dispatcherHealthGate >= 0 && dispatcherHealthGate < releasePersistence);
});

test("release state and upstream image references fail closed", () => {
  for (const name of [
    "NODE_IMAGE",
    "POSTGRES_IMAGE",
    "CLAMAV_IMAGE",
    "CURL_IMAGE",
    "PROMETHEUS_IMAGE",
    "NODE_EXPORTER_IMAGE",
    "CADDY_IMAGE",
  ]) {
    assert.match(common, new RegExp(`\\b${name}\\b`));
    assert.match(compose, new RegExp(`\\$\\{${name}:\\?`));
  }
  assert.match(common, /@sha256:\[a-f0-9\]\{64\}/);
  for (const name of [
    "Q_ACADEMY_APP_IMAGE",
    "Q_ACADEMY_MIGRATOR_IMAGE",
    "Q_ACADEMY_KEY_ROTATION_IMAGE",
    "Q_ACADEMY_TENANT_OPS_IMAGE",
    "Q_ACADEMY_MEDIA_RUNNER_IMAGE",
    "Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE",
    "Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE",
  ]) {
    assert.match(common, new RegExp(`\\b${name}\\b`));
  }
  assert.match(common, /Q_ACADEMY_RELEASE_TAG/);
  assert.match(common, /Q_ACADEMY_SOURCE_COMMIT/);
  assert.match(common, /Q_ACADEMY_IMAGE_PLATFORM/);
  assert.match(common, /checksum must contain exactly one entry/);
  assert.match(common, /\$actual_digest  \$manifest_basename/);
  assert.match(common, /share one physical directory/);
  assert.match(common, /production_env_value "\$env_file" APP_IMAGE_TAG/);
  assert.match(common, /must occur exactly once in/);
  assert.match(common, /mktemp "\$\{directory\}\/\.\$\{basename\}\.tmp/);
  assert.match(common, /chmod --reference="\$env_file"/);
  assert.match(common, /chown --reference="\$env_file"/);
  assert.match(common, /mv -f -- "\$temporary" "\$env_file"/);
  assert.match(backup, /Q_ACADEMY_APP_IMAGE_TAG_OVERRIDE/);
  assert.match(backup, /verify_and_export_pinned_images/);
  assert.match(restore, /verify_and_export_pinned_images/);
  assert.match(common, /MEDIA_WORK_MOUNT=\/var\/lib\/q-academy-media-processing/);
  assert.match(common, /MEDIA_WORK_SENTINEL=\.q-academy-media-work-root/);
  assert.match(common, /findmnt -n -o TARGET --target/);
  assert.match(common, /findmnt -R -n -o TARGET "\$configured"/);
  assert.match(common, /must not contain nested mounts/);
  assert.match(common, /readlink -f -- "\$configured"/);
  assert.match(common, /nodev nosuid noexec/);
  assert.match(common, /root-owned with mode 0755/);
  assert.match(common, /root-owned with mode 0444/);
  assert.match(common, /UID\/GID 1001 with mode 0700/);
  assert.match(common, /\$configured\/work/);
  assert.match(restore, /verify_media_work_mount/);
  assert.equal(
    compose.match(
      /Q_ACADEMY_APP_VERSION: \$\{APP_IMAGE_TAG:\?Set APP_IMAGE_TAG to the release commit\}/g,
    )?.length,
    2,
  );
});

test("production migration and release verification images contain their runtime inputs", () => {
  const migratorStage = /^FROM base AS migrator\r?\n[\s\S]*?(?=^FROM )/m.exec(
    dockerfile,
  )?.[0];
  assert.ok(migratorStage, "Missing production migrator stage");
  for (const path of [
    "scripts/migrate.ts",
    "scripts/load-environment.ts",
    "src/lib/branding-host-policy.ts",
    "src/lib/database-encoding.ts",
    "src/lib/encryption-keyring.ts",
    "src/lib/migration-history-validation.ts",
    "src/lib/server-environment-validation.ts",
    "src/lib/operational-cleanup-policy.ts",
    "src/lib/media/storage-configuration.ts",
    "src/lib/push/configuration.ts",
  ]) {
    assert.match(migratorStage, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(dockerfile, /^FROM dependencies AS release-verifier$/m);
  assert.match(dockerfile, /^FROM dependencies AS media-preflight$/m);
  assert.match(dockerfile, /^FROM dependencies AS s3-app-principal-preflight$/m);
  assert.equal(
    dockerfile.match(/src\/lib\/media\/s3-privacy-export-lifecycle\.ts/g)
      ?.length,
    2,
  );
  assert.match(dockerfile, /ARG DEBIAN_SNAPSHOT=\d{8}T\d{6}Z/);
  assert.match(dockerfile, /ARG FFMPEG_VERSION=7:5\.1\.9-0\+deb12u1/);
  assert.match(dockerfile, /snapshot\.debian\.org\/archive\/debian-security/);
  assert.equal(
    dockerfile.match(/"ffmpeg=\$\{FFMPEG_VERSION\}"/g)?.length,
    2,
  );
});

test("CI packages, scans, publishes, and attests the exact smoke-tested images", () => {
  for (const target of [
    "migrator",
    "key-rotation",
    "runner",
    "media-runner",
    "media-preflight",
    "s3-app-principal-preflight",
  ]) {
    assert.match(continuousIntegration, new RegExp(`--target ${target}\\b`));
  }
  assert.match(
    continuousIntegration,
    /q-academy-media-runner:\$Q_ACADEMY_CI_RELEASE_TAG/,
  );
  assert.match(
    continuousIntegration,
    /q-academy-media-preflight:\$Q_ACADEMY_CI_RELEASE_TAG/,
  );
  assert.match(
    continuousIntegration,
    /q-academy-s3-app-principal-preflight:\$Q_ACADEMY_CI_RELEASE_TAG/,
  );
  assert.equal(
    continuousIntegration.match(
      /body\?\.data\?\.version!==process\.env\.Q_ACADEMY_CI_RELEASE_TAG/g,
    )?.length,
    2,
  );
  assert.match(continuousIntegration, /TRIVY_VERSION: 0\.70\.0/);
  assert.match(
    continuousIntegration,
    /TRIVY_LINUX_AMD64_SHA256: [a-f0-9]{64}/,
  );
  assert.match(continuousIntegration, /create-release-artifact\.sh/);
  assert.match(continuousIntegration, /publish-release-images\.sh/);
  assert.match(continuousIntegration, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(continuousIntegration, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(continuousIntegration, /packages: write/);

  assert.match(createReleaseArtifact, /--format cyclonedx/);
  assert.match(createReleaseArtifact, /--severity HIGH,CRITICAL/);
  assert.match(createReleaseArtifact, /--ignore-unfixed --exit-code 1/);
  assert.match(createReleaseArtifact, /docker save/);
  assert.match(createReleaseArtifact, /s3-app-principal-preflight/);
  assert.match(createReleaseArtifact, /SHA256SUMS/);
  assert.match(publishReleaseImages, /sha256sum --check --strict/);
  assert.match(publishReleaseImages, /docker push/);
  assert.match(publishReleaseImages, /s3-app-principal-preflight/);
  assert.match(publishReleaseImages, /docker pull "\$pinned_reference"/);
  assert.match(publishReleaseImages, /published_id[^]*expected_id/);
  assert.match(publishReleaseImages, /output manifest already exists/);
  assert.match(
    publishReleaseImages,
    /ln -- "\$temporary_manifest" "\$output_manifest"/,
  );
  assert.match(publishReleaseImages, /output checksum already exists/);
});

test("database bootstrap, ownership, and runtime privileges stay separated", () => {
  assert.match(compose, /POSTGRES_USER: \$\{POSTGRES_BOOTSTRAP_USER:/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_BOOTSTRAP_PASSWORD:/);
  assert.match(compose, /OWNER_DATABASE_USER: \$\{OWNER_POSTGRES_USER:/);
  assert.match(compose, /database-config-preflight\.sh/);
  assert.match(compose, /database-role-entrypoint\.sh/);
  assert.match(compose, /database-permissions-entrypoint\.sh/);
  assert.match(databasePreflight, /exactly 64 hexadecimal characters/);
  assert.match(databaseRole, /alter role :"owner_user" with login password/);
  assert.match(databaseRole, /DATABASE_ROLE_MODE:-reconcile/);
  assert.match(databaseRole, /if \[ "\$role_mode" = "validate" \]/);
  assert.match(
    databaseRole,
    /nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit/,
  );
  assert.match(databaseRole, /q_academy\.bootstrap_role/);
  assert.match(databaseRole, /pg_auth_members/);
  assert.match(compose, /DATABASE_URL: postgresql:\/\/\$\{OWNER_POSTGRES_USER:/);
  assert.match(compose, /PGUSER: \$\{OWNER_POSTGRES_USER:/);
  assert.match(databasePermissions, /begin;[\s\S]*commit;/);
  assert.match(databasePermissions, /grant select \(id, organization_id, avatar_url\) on table public\.users/);
  assert.doesNotMatch(databasePermissions, /grant select on table public\.users/);
  assert.match(databasePermissions, /custom_field_values enable row level security/);
  assert.match(databasePermissions, /platform_settings enable row level security/);
  assert.match(databasePermissions, /security definer/);
  assert.match(databasePermissions, /set search_path to pg_catalog, public/);
  assert.match(migrate, /max: 1/);
  assert.match(migrate, /pg_advisory_lock/);
  assert.match(migrate, /pg_advisory_unlock/);
  assert.match(migrate, /backendPid/);
  assert.match(restore, /createdb .*--owner="\$OWNER_DATABASE_USER"/);
  assert.match(restore, /pg_restore[\s\S]*--username="\$OWNER_DATABASE_USER"/);
  assert.match(backup, /--username="\$POSTGRES_USER"/);
  assert.match(backup, /createdb .*--owner="\$OWNER_DATABASE_USER"/);
  assert.match(backup, /misowned_objects/);
  assert.match(backup, /owner_role\.rolbypassrls/);
});

test("backup verification owns the template public schema before restoring", () => {
  const verificationDatabaseCreation = backup.indexOf(
    'createdb --host=postgres --username="$PGUSER" --owner="$OWNER_DATABASE_USER" --template=template0 "$VERIFY_DATABASE"',
  );
  const publicSchemaConnection = backup.indexOf(
    'psql --host=postgres --username="$PGUSER" --dbname="$VERIFY_DATABASE"',
    verificationDatabaseCreation,
  );
  const publicSchemaOwnership = backup.indexOf(
    'alter schema public owner to :"owner_user";',
    publicSchemaConnection,
  );
  const verificationRestore = backup.indexOf(
    "pg_restore \\",
    publicSchemaOwnership,
  );
  const ownershipAudit = backup.indexOf("misowned_objects", verificationRestore);

  assert.ok(verificationDatabaseCreation >= 0);
  assert.ok(publicSchemaConnection > verificationDatabaseCreation);
  assert.ok(publicSchemaOwnership > publicSchemaConnection);
  assert.ok(verificationRestore > publicSchemaOwnership);
  assert.ok(ownershipAudit > verificationRestore);
});

test("in-place restore isolates every persistent database writer", () => {
  assert.match(
    common,
    /DATABASE_WRITER_SERVICES=\(scheduler media-worker media-maintenance app media-runner\)/,
  );
  assert.match(restore, /compose stop -t 30 "\$\{DATABASE_WRITER_SERVICES\[@\]\}"/);
  assert.match(
    restore,
    /compose up -d --no-deps --wait --wait-timeout 300 "\$\{DATABASE_RUNTIME_SERVICES\[@\]\}"/,
  );
  assert.match(
    restore,
    /compose up -d --no-deps --wait \\\s+--wait-timeout "\$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \\\s+"\$\{DATABASE_DISPATCHER_SERVICES\[@\]\}"/,
  );
  assert.match(restore, /exec -T "\$runtime_service" node -e/);
  assert.match(restore, /All application and media writers remain stopped/);
  assert.match(restore, /exec 8>"\$RELEASE_LOCK_FILE"[\s\S]*exec 9>"\$BACKUP_LOCK_FILE"/);
  assert.match(backup, /BACKUP_LOCK_FILE_DEFAULT/);

  const dispatcherHealthGate = restore.indexOf(
    '--wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS"',
  );
  const restoreCompletion = restore.indexOf("restore_ok=true");
  assert.ok(dispatcherHealthGate >= 0 && dispatcherHealthGate < restoreCompletion);
});

test("dispatcher health gate shares the bounded long-job timeout", () => {
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        "set -eu",
        "source scripts/ops/release-common.sh",
        "declare -p DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS",
        "declare -p DATABASE_DISPATCHER_SERVICES",
      ].join("; "),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS="1800"/,
  );
  assert.match(
    result.stdout,
    /DATABASE_DISPATCHER_SERVICES=.*scheduler.*media-worker.*media-maintenance/,
  );
});

test("systemd schedules the existing verified backup path without importing secrets", () => {
  assert.match(backupService, /^Type=oneshot$/m);
  assert.match(backupService, /^WorkingDirectory=\/opt\/q-academy$/m);
  assert.match(
    backupService,
    /^Environment=Q_ACADEMY_ENV_FILE=\/etc\/q-academy\/production\.env$/m,
  );
  assert.match(
    backupService,
    /^ExecStart=\/opt\/q-academy\/scripts\/ops\/postgres-backup\.sh$/m,
  );
  assert.match(
    backupService,
    /^ConditionPathExists=\/opt\/q-academy\/scripts\/ops\/postgres-backup\.sh$/m,
  );
  assert.match(
    backupService,
    /^ConditionFileNotEmpty=\/etc\/q-academy\/production\.env$/m,
  );
  assert.match(backupService, /^Environment=BACKUP_VERIFY_RESTORE=true$/m);
  assert.match(backupService, /^ProtectSystem=strict$/m);
  assert.match(backupService, /^ReadWritePaths=.*\/var\/backups\/q-academy/m);
  assert.doesNotMatch(backupService, /^EnvironmentFile=/m);

  assert.match(backupTimer, /^OnCalendar=\*-\*-\* 02:15:00$/m);
  assert.match(backupTimer, /^Persistent=true$/m);
  assert.match(backupTimer, /^RandomizedDelaySec=15m$/m);
  assert.match(backupTimer, /^Unit=q-academy-backup\.service$/m);
  assert.match(backupTimer, /^WantedBy=timers\.target$/m);
});

test("incident runbook covers provider degradation, recovery, and communication", () => {
  for (const required of [
    "Q_ACADEMY_APP_VERSION",
    "Queue-Stau",
    "Provider-Ausfall",
    "Security- oder Datenschutz-Incident",
    "KI",
    "Transaktionsmail",
    "S3/Objektspeicher",
    "ClamAV",
    "OIDC",
    "Commerce/Webhooks/n8n",
    "Erstmeldung",
    "Statusupdate",
    "Wiederherstellung",
    "Provider-Eskalation",
  ]) {
    assert.match(incidentRunbook, new RegExp(required.replaceAll("/", "\\/")));
  }
  assert.match(incidentRunbook, /Keine Datenbankmigration/);
  assert.match(incidentRunbook, /kein\s+`docker compose down -v`/);
  assert.match(incidentRunbook, /nicht blind loeschen oder erneut/);
  assert.match(incidentRunbook, /Namen, Rufnummern/);
});
