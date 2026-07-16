import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync("scripts/ops/deploy-release.sh", "utf8");
const rollback = readFileSync("scripts/ops/rollback-release.sh", "utf8");
const reconcile = readFileSync(
  "scripts/ops/reconcile-production.sh",
  "utf8",
);
const emergencyStop = readFileSync(
  "scripts/ops/q-academy-emergency-stop.sh",
  "utf8",
);
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
const runtimeService = readFileSync(
  "deploy/systemd/q-academy-runtime.service",
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
const webmDurationPreflight = readFileSync(
  "scripts/webm-duration-preflight.ts",
  "utf8",
);
const continuousIntegration = readFileSync(".github/workflows/ci.yml", "utf8");
const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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
  assert.match(deploy, /Q_ACADEMY_KEY_ROTATION_IMAGE/);
  assert.match(deploy, /Q_ACADEMY_TENANT_OPS_IMAGE/);
  assert.match(deploy, /Q_ACADEMY_MEDIA_RUNNER_IMAGE/);
  assert.match(deploy, /Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE/);
  assert.match(deploy, /Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE/);
  assert.match(deploy, /Q_ACADEMY_DISPATCHER_IMAGE/);
  assert.match(deploy, /Q_ACADEMY_CADDY_IMAGE/);
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
  assert.match(deploy, /build --pull app migrate key-rotation tenant-admin-ops media-runner media-preflight s3-app-principal-preflight scheduler caddy/);
  assert.match(deploy, /immutable release image already exists/);
  assert.match(deploy, /target release image is not present locally/);
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
  assert.match(deploy, /configure_media_s3_release_services "\$env_file"/);
  assert.match(
    deploy,
    /compose=\(docker compose --env-file "\$env_file" -f "\$compose_file" "\$\{MEDIA_S3_COMPOSE_PROFILE_ARGS\[@\]\}"\)/,
  );
  assert.match(
    deploy,
    /strato_compose=\(docker compose --env-file "\$env_file" -f "\$compose_file" --profile strato\)/,
  );
  assert.match(
    deploy,
    /--wait-timeout "\$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS" \\\s+"\$\{MEDIA_S3_RELEASE_SERVICES\[@\]\}"/,
  );
  assert.match(deploy, /stop -t 30 "\$\{DATABASE_WRITER_SERVICES\[@\]\}"/);
  assert.match(
    deploy,
    /run "\$\{strato_compose\[@\]\}" rm --force --stop "\$STRATO_PRIVACY_SWEEPER_SERVICE"/,
  );
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
  assert.match(
    deploy,
    /run "\$\{compose\[@\]\}" run --rm --no-deps caddy-volume-init/,
  );
  assert.match(
    deploy,
    /up -d --no-deps --force-recreate --wait \\\s+--wait-timeout "\$CADDY_WAIT_TIMEOUT_SECONDS" caddy/,
  );
  assert.match(
    deploy,
    /Caddy and all application, media, and STRATO deletion writers remain stopped/,
  );
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
  const stratoSweeperIsolation = deploy.indexOf(
    'run "${strato_compose[@]}" rm --force --stop "$STRATO_PRIVACY_SWEEPER_SERVICE"',
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
  assert.ok(stratoSweeperIsolation > writerStop);
  assert.ok(stratoSweeperIsolation < roleReconciliation);
  assert.ok(roleReconciliation > writerStop);
  const dispatcherHealthGate = deploy.indexOf(
    '--wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS"',
  );
  const releasePersistence = deploy.indexOf(
    'persist_app_image_tag "$env_file" "$release_tag"',
  );
  const stratoSweeperHealthGate = deploy.indexOf(
    '--wait-timeout "$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS"',
  );
  const releaseCompletion = deploy.indexOf(
    "release_completed=true",
    releasePersistence,
  );
  assert.ok(dispatcherHealthGate > writerStop);
  assert.ok(dispatcherHealthGate < releasePersistence);
  assert.ok(stratoSweeperHealthGate > dispatcherHealthGate);
  assert.ok(stratoSweeperHealthGate < releasePersistence);
  const caddyVolumeInit = deploy.indexOf(
    'run "${compose[@]}" run --rm --no-deps caddy-volume-init',
  );
  const caddyHealthGate = deploy.indexOf(
    '--wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy',
  );
  const externalReadiness = deploy.indexOf(
    'run verify_external_release_readiness "$app_domain" "$release_tag"',
  );
  assert.ok(caddyVolumeInit > writerStop);
  assert.ok(caddyVolumeInit < caddyHealthGate);
  assert.ok(caddyHealthGate < externalReadiness);
  assert.ok(externalReadiness < releasePersistence);
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

test("deploy and rollback seal Compose egress networks before provider or runtime starts", () => {
  for (const [name, operation, firstStartNeedle] of [
    [
      "deploy",
      deploy,
      'run "${compose[@]}" up -d --no-recreate --wait --wait-timeout 300 postgres',
    ],
    [
      "rollback",
      rollback,
      'run "${compose[@]}" up -d --no-deps --wait --wait-timeout 300 "${DATABASE_RUNTIME_SERVICES[@]}"',
    ],
  ] as const) {
    assert.match(operation, /project_name="\$\(compose_project_name "\$\{compose\[@\]\}"\)"/);
    assert.match(
      operation,
      /run "\$\{compose\[@\]\}" create --no-build --no-recreate \\\s+"\$\{RELEASE_NETWORK_BOOTSTRAP_SERVICES\[@\]\}"/,
      name,
    );
    assert.match(
      operation,
      /run bash "\$ROOT_DIR\/scripts\/ops\/docker-egress-firewall[.]sh" apply/,
      name,
    );
    assert.match(
      operation,
      /run bash "\$ROOT_DIR\/scripts\/ops\/docker-egress-firewall[.]sh" verify/,
      name,
    );
    assert.doesNotMatch(operation, /\bufw\b/i, name);

    const project = operation.indexOf(
      'project_name="$(compose_project_name "${compose[@]}")"',
    );
    const create = operation.indexOf(
      'run "${compose[@]}" create --no-build --no-recreate',
    );
    const apply = operation.indexOf(
      'docker-egress-firewall.sh" apply',
      create,
    );
    const verify = operation.indexOf(
      'docker-egress-firewall.sh" verify',
      apply,
    );
    const providerPreflight = operation.indexOf(
      'run_with_timeout "$S3_APP_PRINCIPAL_PREFLIGHT_TIMEOUT_SECONDS"',
      verify,
    );
    const firstStart = operation.indexOf(firstStartNeedle, verify);
    assert.ok(project >= 0 && project < create, name);
    assert.ok(create < apply && apply < verify, name);
    assert.ok(verify < providerPreflight, name);
    assert.ok(verify < firstStart, name);
    assert.doesNotMatch(operation.slice(create, apply), /\bcaddy\b/, name);
  }
});

test("Caddy is the final public activation and every failed operation closes it", () => {
  for (const [name, operation, persistenceNeedle] of [
    [
      "deploy",
      deploy,
      'persist_app_image_tag "$env_file" "$release_tag"',
    ],
    [
      "rollback",
      rollback,
      'persist_app_image_tag "$env_file" "$target_tag"',
    ],
  ] as const) {
    assert.match(operation, /"\$\{compose\[@\]\}" stop -t 30 caddy/);
    assert.match(operation, /run "\$\{compose\[@\]\}" stop -t 30 caddy/);
    assert.match(operation, /caddy_activation_started=true/);

    const dispatcher = operation.indexOf(
      '--wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS"',
    );
    const sweeper = operation.indexOf(
      '--wait-timeout "$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS"',
      dispatcher,
    );
    const volumeInit = operation.indexOf(
      'run "${compose[@]}" run --rm --no-deps caddy-volume-init',
      sweeper,
    );
    const caddy = operation.indexOf(
      '--wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy',
      volumeInit,
    );
    const external = operation.indexOf(
      'run verify_external_release_readiness "$app_domain"',
      caddy,
    );
    const persistence = operation.indexOf(persistenceNeedle, external);
    assert.ok(dispatcher >= 0 && dispatcher < sweeper, name);
    assert.ok(sweeper < volumeInit && volumeInit < caddy, name);
    assert.ok(caddy < external && external < persistence, name);
  }
});

test("boot reconcile is versioned, migration-free, and fail closed around Docker", () => {
  assert.equal(compose.match(/restart: "on-failure:5"/g)?.length, 11);
  assert.doesNotMatch(compose, /restart: unless-stopped/);
  const syntax = spawnSync("bash", ["-n", "scripts/ops/reconcile-production.sh"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(reconcile, /RECONCILE_CONTRACT_VERSION=1/);
  assert.match(reconcile, /flock -n 9/);
  assert.match(reconcile, /release state and production APP_IMAGE_TAG disagree/);
  assert.match(reconcile, /Git HEAD does not match the active release controller/);
  assert.match(reconcile, /active runtime image is missing/);
  assert.match(
    reconcile,
    /docker ps --quiet --no-trunc \\\s+--filter "label=com[.]docker[.]compose[.]project=\$RECONCILE_PRODUCTION_PROJECT"/,
  );
  assert.match(reconcile, /docker stop --time 30 "\$\{container_ids\[@\]\}"/);
  assert.match(
    reconcile,
    /"\$\{compose\[@\]\}" create --no-build --no-recreate \\\s+"\$\{RELEASE_NETWORK_BOOTSTRAP_SERVICES\[@\]\}"/,
  );
  assert.doesNotMatch(reconcile, /\bmigrate\b|postgres-restore|persist_app_image_tag|gh attestation|docker pull/);

  const create = reconcile.indexOf(
    '"${compose[@]}" create --no-build --no-recreate',
  );
  const apply = reconcile.indexOf(
    'docker-egress-firewall.sh" apply',
    create,
  );
  const verify = reconcile.indexOf(
    'docker-egress-firewall.sh" verify',
    apply,
  );
  const firstStart = reconcile.indexOf(
    '"${compose[@]}" up -d --wait --wait-timeout 900 postgres clamav',
    verify,
  );
  const dispatcher = reconcile.indexOf(
    '--wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS"',
    firstStart,
  );
  const monitoring = reconcile.indexOf(
    '"${monitoring_compose[@]}" up -d',
    dispatcher,
  );
  const caddy = reconcile.indexOf(
    '--wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy',
    monitoring,
  );
  assert.ok(create >= 0 && create < apply && apply < verify);
  assert.ok(verify < firstStart && firstStart < dispatcher);
  assert.ok(dispatcher < monitoring && monitoring < caddy);
  assert.doesNotMatch(reconcile.slice(create, apply), /\bcaddy\b/);
  assert.match(
    reconcile,
    /Production reconcile failed[.] Caddy and every Q-Academy runtime were stopped/,
  );

  assert.match(runtimeService, /^BindsTo=docker[.]service$/m);
  assert.match(runtimeService, /^PartOf=docker[.]service$/m);
  assert.match(runtimeService, /^After=.*docker[.]service$/m);
  assert.match(runtimeService, /^ExecStart=\/usr\/bin\/bash .*reconcile-production[.]sh start$/m);
  assert.match(
    runtimeService,
    /^ExecStopPost=-\/usr\/local\/libexec\/q-academy-emergency-stop$/m,
  );
  assert.match(runtimeService, /^ConditionFileIsExecutable=\/usr\/local\/libexec\/q-academy-emergency-stop$/m);
  assert.match(runtimeService, /^ExecStartPre=\/usr\/bin\/test ! -L \/opt\/q-academy$/m);
  assert.match(runtimeService, /^ExecStartPre=.*find \/opt\/q-academy -xdev ! -user root/m);
  assert.match(runtimeService, /^ExecStartPre=.*find \/opt\/q-academy -xdev -perm \/022/m);
  assert.match(emergencyStop, /PRODUCTION_PROJECT=q-academy/);
  assert.match(emergencyStop, /label=com[.]docker[.]compose[.]project=\$PRODUCTION_PROJECT/);
  assert.match(emergencyStop, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(emergencyStop, /docker stop --time 30/);
  assert.doesNotMatch(emergencyStop, /docker compose|source |\/opt\/q-academy/);
  assert.match(runtimeService, /^WantedBy=docker[.]service multi-user[.]target$/m);
  assert.match(runtimeService, /^TimeoutStartSec=2h$/m);
  assert.match(runtimeService, /^Restart=on-failure$/m);
  assert.match(runtimeService, /^RestartSec=5m$/m);
  assert.match(runtimeService, /^StartLimitIntervalSec=30m$/m);
  assert.match(runtimeService, /^StartLimitBurst=3$/m);
  assert.doesNotMatch(runtimeService, /^EnvironmentFile=/m);
});

test("pending releases are durable, controller-bound, and recover only explicitly", () => {
  assert.match(common, /PENDING_RELEASE_SCHEMA_VERSION=1/);
  assert.match(
    common,
    /PENDING_RELEASE_FILE_DEFAULT=\/var\/lib\/q-academy\/releases\/pending[.]env/,
  );
  assert.match(common, /NR == 7 && !invalid/);
  for (const field of [
    "SCHEMA_VERSION",
    "FROM_TAG",
    "TO_TAG",
    "CONTROLLER_COMMIT",
    "PHASE",
    "MIGRATIONS_MAY_HAVE_RUN",
    "CREATED_AT",
  ]) {
    assert.match(common, new RegExp(`allowed\\["${field}"\\]`));
  }
  assert.match(common, /"\$to_tag" == "git-\$\{controller_commit\}"/);
  assert.match(common, /PHASE=migrations-may-have-run/);
  assert.match(common, /MIGRATIONS_MAY_HAVE_RUN=true/);
  assert.match(common, /Existing pending release directory must be root-owned with mode 0700/);
  assert.doesNotMatch(common, /chown root:root "\$directory"/);
  assert.match(
    common,
    /mv -f -- "\$temporary" "\$marker_file" \|\|\s+! sync -f "\$directory"/,
  );
  assert.match(
    common,
    /rm -- "\$marker_file" \|\| return 1\s+sync -f "\$\(dirname -- "\$marker_file"\)"/,
  );
  assert.match(
    common,
    /mv -f -- "\$temporary" "\$env_file"; then[\s\S]*sync -f "\$directory"/,
  );

  for (const operation of [deploy, rollback]) {
    assert.match(operation, /pending_file="\$PENDING_RELEASE_FILE_DEFAULT"/);
    assert.doesNotMatch(operation, /\$\{PENDING_RELEASE_FILE:-/);
    const earlyMarkerGuard = operation.indexOf(
      'if [[ -e "$pending_file" || -L "$pending_file" ]]',
    );
    const environmentCheck = operation.indexOf('[[ -f "$env_file"');
    assert.ok(earlyMarkerGuard >= 0 && earlyMarkerGuard < environmentCheck);
    assert.match(operation, /pending_release_guarded[\s\S]*dry_run/);
    assert.match(
      operation,
      /pending_release_guarded" == "true" && "\$release_lock_acquired" == "true"/,
    );
    assert.match(
      operation,
      /stop_production_compose_project "\$PRODUCTION_COMPOSE_PROJECT"/,
    );
    assert.match(operation, /sync -f "\$\(dirname -- "\$state_file"\)"/);
    const lockAttempt = operation.indexOf('flock -n 9 || fail "another release operation is active"');
    const lockOwned = operation.indexOf("release_lock_acquired=true", lockAttempt);
    const stateOrEnvironmentValidation = Math.min(
      ...[
        operation.indexOf('[[ -f "$env_file"'),
        operation.indexOf('[[ -f "$state_file"'),
      ].filter((index) => index >= 0),
    );
    assert.ok(lockAttempt >= 0 && lockAttempt < lockOwned);
    assert.ok(lockOwned < stateOrEnvironmentValidation);
  }

  assert.match(deploy, /CONFIRM_RESUME_FAILED_RELEASE/);
  assert.match(deploy, /pending release belongs to a different target/);
  assert.match(deploy, /pending release belongs to a different controller checkout/);
  assert.match(
    deploy,
    /run write_pending_release_marker "\$pending_file" "\$previous_tag" "\$release_tag" "\$head_commit"/,
  );
  const backupRun = deploy.indexOf(
    "scripts/ops/postgres-backup.sh",
    deploy.indexOf("Q_ACADEMY_BACKUP_LOCK_FD=8"),
  );
  const markerWrite = deploy.indexOf("run write_pending_release_marker");
  const migration = deploy.indexOf(
    'run "${compose[@]}" run --rm --no-deps migrate',
  );
  const externalReady = deploy.indexOf(
    'run verify_external_release_readiness "$app_domain" "$release_tag"',
  );
  const environmentPersist = deploy.indexOf(
    'persist_app_image_tag "$env_file" "$release_tag"',
    externalReady,
  );
  const stateRename = deploy.indexOf(
    'mv -f "$temporary_state" "$state_file"',
    environmentPersist,
  );
  const stateSync = deploy.indexOf(
    'sync -f "$(dirname -- "$state_file")"',
    stateRename,
  );
  const markerRemove = deploy.indexOf(
    'remove_pending_release_marker "$pending_file"',
    stateSync,
  );
  assert.ok(backupRun >= 0 && backupRun < markerWrite);
  assert.ok(markerWrite < migration);
  assert.ok(externalReady < environmentPersist);
  assert.ok(environmentPersist < stateRename && stateRename < stateSync);
  assert.ok(stateSync < markerRemove);

  assert.match(
    rollback,
    /"\$controller_commit" == "\$head_commit".*active release controller/,
  );
  assert.match(
    rollback,
    /"\$head_commit" == "\$pending_controller_commit".*different controller checkout/,
  );
  assert.match(
    rollback,
    /"\$current_tag" == "\$pending_from_tag" && "\$configured_tag" == "\$pending_from_tag"/,
  );
  assert.match(rollback, /pending rollback target must equal FROM_TAG/);
  assert.match(rollback, /initial-install pending release can only be resumed forward or recovered from backup/);
  const rollbackStateSync = rollback.indexOf(
    'sync -f "$(dirname -- "$state_file")"',
  );
  const rollbackMarkerRemove = rollback.indexOf(
    'remove_pending_release_marker "$pending_file"',
    rollbackStateSync,
  );
  assert.ok(rollbackStateSync >= 0 && rollbackStateSync < rollbackMarkerRemove);

  const markerRefusal = reconcile.indexOf(
    'if [[ -e "$RECONCILE_PENDING_RELEASE_FILE" || -L "$RECONCILE_PENDING_RELEASE_FILE" ]]',
  );
  const sharedSource = reconcile.indexOf(
    'source "${ROOT_DIR}/scripts/ops/release-common.sh"',
  );
  const stopAction = reconcile.indexOf('if [[ "$action" == "stop" ]]');
  const lockAcquisition = reconcile.indexOf('exec 9>"$lock_file"');
  assert.match(
    reconcile,
    /RECONCILE_PENDING_RELEASE_FILE=\/var\/lib\/q-academy\/releases\/pending[.]env/,
  );
  assert.ok(markerRefusal >= 0 && markerRefusal < sharedSource);
  assert.ok(stopAction >= 0 && stopAction < lockAcquisition);
  assert.ok(stopAction < sharedSource);
  assert.doesNotMatch(runtimeService, /^ConditionFileNotEmpty=/m);

  const dockerFailure = spawnSync(
    "bash",
    [
      "-c",
      [
        "source scripts/ops/release-common.sh",
        "docker() { return 73; }",
        "if stop_production_compose_project q-academy >/dev/null 2>&1; then exit 20; fi",
      ].join("; "),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(dockerFailure.status, 0, dockerFailure.stderr);
});

test("external readiness is bounded and bound to the exact release version", () => {
  assert.match(common, /verify_external_release_readiness\(\)/);
  assert.match(common, /--connect-timeout 10 --max-time 30/);
  assert.match(common, /--retry 12 --retry-delay 5 --retry-all-errors/);
  assert.match(
    common,
    /version != os[.]environ\["Q_ACADEMY_EXPECTED_RELEASE"\]/,
  );
  assert.match(
    deploy,
    /run verify_external_release_readiness "\$app_domain" "\$release_tag"/,
  );
  assert.match(
    rollback,
    /run verify_external_release_readiness "\$app_domain" "\$target_tag"/,
  );
  assert.match(
    reconcile,
    /verify_external_release_readiness "\$app_domain" "\$current_tag"/,
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

test("release S3 mode selects the STRATO profile and sweeper fail closed", () => {
  assert.match(
    common,
    /STRATO_PRIVACY_SWEEPER_SERVICE=strato-privacy-sweeper/,
  );
  const contractScript = [
    "set -Eeuo pipefail",
    "source scripts/ops/release-common.sh",
    'test_root="/tmp/q-academy-s3-release-contract-$$"',
    'mkdir -p -- "$test_root"',
    'trap \'rm -rf -- "$test_root"\' EXIT',
    'env_file="$test_root/production.env"',
    "write_environment() {",
    "  printf '%s\\n' \"$@\" >\"$env_file\"",
    "}",
    "print_selection() {",
    "  local profiles services",
    "  profiles=\"$(IFS=,; printf '%s' \"${MEDIA_S3_COMPOSE_PROFILE_ARGS[*]}\")\"",
    "  services=\"$(IFS=,; printf '%s' \"${MEDIA_S3_RELEASE_SERVICES[*]}\")\"",
    "  printf '%s|%s|%s|%s\\n' \"$profiles\" \"$services\" \"$MEDIA_S3_COMPATIBILITY_MODE\" \"$MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED\"",
    "}",
    "export MEDIA_S3_COMPATIBILITY_MODE=untrusted-shell-override",
    "export MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=untrusted-shell-override",
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=versioned" "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=false"',
    'configure_media_s3_release_services "$env_file"',
    "print_selection",
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive" "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=true"',
    'configure_media_s3_release_services "$env_file"',
    "print_selection",
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive" "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=false"',
    'if configure_media_s3_release_services "$env_file" 2>/dev/null; then exit 20; fi',
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=unknown" "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=true"',
    'if configure_media_s3_release_services "$env_file" 2>/dev/null; then exit 21; fi',
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive" "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=True"',
    'if configure_media_s3_release_services "$env_file" 2>/dev/null; then exit 22; fi',
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive"',
    'if configure_media_s3_release_services "$env_file" 2>/dev/null; then exit 23; fi',
    'marker="$test_root/must-not-exist"',
    'write_environment "MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive;touch $marker" "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=true"',
    'if configure_media_s3_release_services "$env_file" 2>/dev/null; then exit 24; fi',
    '[[ ! -e "$marker" ]]',
  ].join("\n");
  const result = spawnSync("bash", ["-s"], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: contractScript,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "||versioned|false\n--profile,strato|strato-privacy-sweeper|strato-hidrive|true\n",
  );
});

test("child backup validates the inherited deployment lock without self-deadlock", () => {
  assert.match(
    backup,
    /pending release blocks standalone backups until explicit recovery completes/i,
  );
  assert.match(
    backup,
    /"\$active_release_tag" != "\$pending_backup_tag"/,
  );
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
    `PROMETHEUS_IMAGE=registry.invalid/prometheus@sha256:${digest}`,
    `NODE_EXPORTER_IMAGE=registry.invalid/node-exporter@sha256:${digest}`,
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
  assert.match(rollback, /target release image is not present locally/);
  assert.match(
    rollback,
    /target_runtime_components=\(app media-runner media-preflight s3-app-principal-preflight\)/,
  );
  assert.match(rollback, /target_runtime_components\+=\(dispatcher caddy\)/);
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
  assert.match(
    rollback,
    /run "\$\{compose\[@\]\}" run --rm --no-deps caddy-volume-init/,
  );
  assert.match(
    rollback,
    /up -d --no-deps --force-recreate --wait \\\s+--wait-timeout "\$CADDY_WAIT_TIMEOUT_SECONDS" caddy/,
  );
  assert.match(
    rollback,
    /Caddy and all application, media, and STRATO deletion writers remain stopped/,
  );
  assert.match(rollback, /release state and production APP_IMAGE_TAG disagree/);
  assert.match(rollback, /persist_app_image_tag "\$env_file" "\$target_tag"/);
  assert.match(rollback, /verify_media_work_mount "\$env_file"/);
  assert.match(rollback, /configure_media_s3_release_services "\$env_file"/);
  assert.match(
    rollback,
    /compose=\(docker compose --env-file "\$env_file" -f "\$compose_file" "\$\{MEDIA_S3_COMPOSE_PROFILE_ARGS\[@\]\}"\)/,
  );
  assert.match(
    rollback,
    /strato_compose=\(docker compose --env-file "\$env_file" -f "\$compose_file" --profile strato\)/,
  );
  assert.match(
    rollback,
    /run "\$\{strato_compose\[@\]\}" rm --force --stop "\$STRATO_PRIVACY_SWEEPER_SERVICE"/,
  );
  assert.match(
    rollback,
    /"\$\{strato_compose\[@\]\}" stop -t 30 "\$STRATO_PRIVACY_SWEEPER_SERVICE"/,
  );
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
  const stratoSweeperHealthGate = rollback.indexOf(
    '--wait-timeout "$STRATO_PRIVACY_SWEEPER_WAIT_TIMEOUT_SECONDS"',
  );
  assert.ok(dispatcherHealthGate >= 0 && dispatcherHealthGate < releasePersistence);
  assert.ok(stratoSweeperHealthGate > dispatcherHealthGate);
  assert.ok(stratoSweeperHealthGate < releasePersistence);
  const caddyVolumeInit = rollback.indexOf(
    'run "${compose[@]}" run --rm --no-deps caddy-volume-init',
  );
  const caddyHealthGate = rollback.indexOf(
    '--wait-timeout "$CADDY_WAIT_TIMEOUT_SECONDS" caddy',
  );
  const externalReadiness = rollback.indexOf(
    'run verify_external_release_readiness "$app_domain" "$target_tag"',
  );
  assert.ok(caddyVolumeInit >= 0 && caddyVolumeInit < caddyHealthGate);
  assert.ok(caddyHealthGate < externalReadiness);
  assert.ok(externalReadiness < releasePersistence);
});

test("release state and upstream image references fail closed", () => {
  for (const name of [
    "NODE_IMAGE",
    "POSTGRES_IMAGE",
    "CLAMAV_IMAGE",
    "PROMETHEUS_IMAGE",
    "NODE_EXPORTER_IMAGE",
  ]) {
    assert.match(common, new RegExp(`\\b${name}\\b`));
    assert.match(compose, new RegExp(`\\$\\{${name}:\\?`));
  }
  assert.match(common, /@sha256:\[a-f0-9\]\{64\}/);
  for (const name of [
    "Q_ACADEMY_POSTGRES_IMAGE",
    "Q_ACADEMY_APP_IMAGE",
    "Q_ACADEMY_MIGRATOR_IMAGE",
    "Q_ACADEMY_KEY_ROTATION_IMAGE",
    "Q_ACADEMY_TENANT_OPS_IMAGE",
    "Q_ACADEMY_MEDIA_RUNNER_IMAGE",
    "Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE",
    "Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE",
    "Q_ACADEMY_DISPATCHER_IMAGE",
    "Q_ACADEMY_CADDY_IMAGE",
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
  const migratorStage = /^FROM runtime-base AS migrator\r?\n[\s\S]*?(?=^FROM )/m.exec(
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
  assert.match(dockerfile, /^FROM runtime-base AS media-preflight$/m);
  assert.match(dockerfile, /^FROM runtime-base AS s3-app-principal-preflight$/m);
  assert.equal(
    dockerfile.match(/src\/lib\/media\/s3-privacy-export-lifecycle\.ts/g)
      ?.length,
    2,
  );
  assert.match(dockerfile, /ARG DEBIAN_SNAPSHOT=20260714T202849Z/);
  assert.match(
    dockerfile,
    /ARG CA_CERTIFICATES_VERSION=20230311\+deb12u1/,
  );
  assert.match(dockerfile, /ARG FFMPEG_VERSION=7:5\.1\.9-0\+deb12u1/);
  assert.match(dockerfile, /ARG MESA_VERSION=22\.3\.6-1\+deb12u2/);
  assert.match(dockerfile, /snapshot\.debian\.org\/archive\/debian-security/);
  assert.equal(
    dockerfile.match(/"ca-certificates=\$\{CA_CERTIFICATES_VERSION\}"/g)
      ?.length,
    2,
  );
  assert.equal(
    dockerfile.match(/"ffmpeg=\$\{FFMPEG_VERSION\}"/g)?.length,
    2,
  );
  for (const packageName of [
    "libgbm1",
    "libgl1-mesa-dri",
    "libglapi-mesa",
    "libglx-mesa0",
  ]) {
    assert.equal(
      dockerfile.match(
        new RegExp(`"${packageName}=\\$\\{MESA_VERSION\\}"`, "g"),
      )?.length,
      2,
      packageName,
    );
  }
  assert.equal(
    dockerfile.match(
      /s\|http:\/\/snapshot\.debian\.org\|https:\/\/snapshot\.debian\.org\|g/g,
    )?.length,
    2,
  );
  assert.equal(
    dockerfile.match(
      /apt-get --error-on=any -o Acquire::Check-Valid-Until=false update/g,
    )?.length,
    4,
  );
  assert.equal(
    dockerfile.match(
      /test -r \/usr\/share\/keyrings\/debian-archive-keyring\.gpg/g,
    )?.length,
    2,
  );
  assert.equal(
    dockerfile.match(
      /test -s \/etc\/ssl\/certs\/ca-certificates\.crt/g,
    )?.length,
    2,
  );
  assert.doesNotMatch(
    dockerfile,
    /Verify-Peer|allow-insecure|trusted=(?:yes|true)/i,
  );
});

test("production runtime images omit package managers and development dependencies", () => {
  assert.equal(packageManifest.dependencies?.tsx, "^4.23.1");
  assert.equal(packageManifest.devDependencies?.tsx, undefined);

  const stageMatches = [
    ...dockerfile.matchAll(/^FROM .+ AS ([a-z0-9-]+)\r?$/gm),
  ];
  const stageSource = (name: string) => {
    const index = stageMatches.findIndex((match) => match[1] === name);
    assert.notEqual(index, -1, `Missing Docker stage ${name}`);
    const start = stageMatches[index].index;
    const end = stageMatches[index + 1]?.index ?? dockerfile.length;
    return dockerfile.slice(start, end);
  };

  const runtimeBase = stageSource("runtime-base");
  assert.match(runtimeBase, /rm -rf --[\s\S]*\/usr\/local\/lib\/node_modules\/npm/);
  for (const command of ["npm", "npx", "corepack", "yarn", "yarnpkg"]) {
    assert.match(runtimeBase, new RegExp(`! command -v ${command}\\b`));
  }

  for (const name of [
    "migrator",
    "key-rotation",
    "tenant-ops",
    "s3-preflight",
    "s3-app-principal-preflight",
    "media-preflight",
    "runner",
  ]) {
    const stage = stageSource(name);
    assert.match(stage, new RegExp(`^FROM runtime-base AS ${name}$`, "m"));
    assert.match(stage, /COPY --from=production-dependencies[^\n]+\/app\/node_modules/);
    assert.doesNotMatch(stage, /COPY --from=dependencies/);
  }
  assert.match(dockerfile, /^FROM runner AS media-runner$/m);
});

test("pinned media image blocks releases on durationless WebM regressions", () => {
  assert.match(
    dockerfile,
    /COPY --chown=nextjs:nodejs [^\n]*scripts\/webm-duration-preflight\.ts[^\n]* \.\/scripts\//,
  );
  assert.match(webmDurationPreflight, /WEBM_PREFLIGHT_FFMPEG = "\/usr\/bin\/ffmpeg"/);
  assert.match(webmDurationPreflight, /WEBM_PREFLIGHT_FFPROBE = "\/usr\/bin\/ffprobe"/);
  assert.match(webmDurationPreflight, /probeWebmDurationStream\(/);
  assert.match(webmDurationPreflight, /shell: false/);
  assert.match(webmDurationPreflight, /child\.stdout\.once\("error"/);
  assert.match(webmDurationPreflight, /child\.stderr\.once\("error"/);

  const durationlessSmoke = continuousIntegration.match(
    /docker run --rm \\\r?\n\s+--network none \\\r?\n\s+--read-only \\[\s\S]{0,1600}?scripts\/webm-duration-preflight\.ts/,
  )?.[0];
  assert.ok(durationlessSmoke, "Durationless WebM image smoke is missing.");
  assert.match(durationlessSmoke, /--user 1001:1001/);
  assert.match(durationlessSmoke, /--security-opt no-new-privileges=true/);
  assert.match(durationlessSmoke, /--cap-drop ALL/);
  assert.match(durationlessSmoke, /--pids-limit 64/);
  assert.match(durationlessSmoke, /--memory 256m/);
  assert.match(durationlessSmoke, /--tmpfs \/tmp:rw,nosuid,nodev,noexec,size=16m,uid=1001,gid=1001/);
  assert.match(durationlessSmoke, /--entrypoint node/);
  assert.match(
    durationlessSmoke,
    /q-academy-media-preflight:\$Q_ACADEMY_CI_RELEASE_TAG/,
  );
  assert.match(durationlessSmoke, /--conditions=react-server --import tsx/);
  assert.doesNotMatch(durationlessSmoke, /\|\| true|--network host|--volume/);
});

test("CI packages, scans, publishes, and attests the exact smoke-tested images", () => {
  for (const target of [
    "caddy",
    "dispatcher",
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
  assert.match(
    continuousIntegration,
    /q-academy-dispatcher:\$Q_ACADEMY_CI_RELEASE_TAG/,
  );
  assert.match(
    continuousIntegration,
    /q-academy-caddy:\$Q_ACADEMY_CI_RELEASE_TAG/,
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
    /CI_PROMETHEUS_IMAGE: prom\/prometheus:v3\.13\.1@sha256:3c42b892cf723fa54d2f262c37a0e1f80aa8c8ddb1da7b9b0df9455a35a7f893/,
  );
  assert.match(
    continuousIntegration,
    /CI_CA_CERTIFICATES_VERSION: 20230311\+deb12u1/,
  );
  assert.match(continuousIntegration, /CI_DEBIAN_SNAPSHOT: 20260714T202849Z/);
  assert.match(continuousIntegration, /CI_MESA_VERSION: 22\.3\.6-1\+deb12u2/);
  assert.match(
    continuousIntegration,
    /CI_CADDY_BUILDER_IMAGE: golang:1[.]26[.]5-bookworm@sha256:[a-f0-9]{64}/,
  );
  assert.match(continuousIntegration, /CI_CADDY_VERSION: "2[.]11[.]4"/);
  assert.match(
    continuousIntegration,
    /CI_CADDY_BUILDABLE_ARTIFACT_SHA256: [a-f0-9]{64}/,
  );
  assert.match(continuousIntegration, /CI_CADDY_SOURCE_DATE_EPOCH: "[0-9]{10}"/);
  const pinnedNodeImage =
    "node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
  assert.equal(continuousIntegration.split(pinnedNodeImage).length - 1, 2);
  assert.match(dockerfile, new RegExp(`ARG NODE_IMAGE=${pinnedNodeImage}`));
  assert.equal(
    continuousIntegration.match(
      /--build-arg CA_CERTIFICATES_VERSION="\$CI_CA_CERTIFICATES_VERSION"/g,
    )?.length,
    2,
  );
  assert.equal(
    continuousIntegration.match(
      /--build-arg MESA_VERSION="\$CI_MESA_VERSION"/g,
    )?.length,
    2,
  );
  assert.match(
    continuousIntegration,
    /test ! -e \/usr\/local\/lib\/node_modules\/npm/,
  );
  assert.match(continuousIntegration, /test ! -e \/app\/node_modules\/drizzle-kit/);
  assert.match(
    continuousIntegration,
    /tsx_image_components=\(migrator key-rotation tenant-ops media-preflight s3-app-principal-preflight\)/,
  );
  assert.doesNotMatch(continuousIntegration, /tsx_image_components=\([^\n]*dispatcher/);
  assert.match(
    continuousIntegration,
    /shell_image_components=\(postgres app migrator key-rotation tenant-ops media-runner media-preflight s3-app-principal-preflight dispatcher\)/,
  );
  assert.doesNotMatch(continuousIntegration, /shell_image_components=\([^\n]*caddy/);
  assert.match(
    continuousIntegration,
    /dpkg-query -W -f='\$\{Version\}' "\$package"/,
  );
  assert.match(
    continuousIntegration,
    /TRIVY_LINUX_AMD64_SHA256: [a-f0-9]{64}/,
  );
  assert.match(continuousIntegration, /create-release-artifact\.sh/);
  assert.match(continuousIntegration, /publish-release-images\.sh/);
  assert.match(continuousIntegration, /actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(continuousIntegration, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(continuousIntegration, /packages: write/);

  assert.match(createReleaseArtifact, /--format json --list-all-pkgs/);
  assert.match(createReleaseArtifact, /trivy convert --quiet --format cyclonedx/);
  assert.equal(createReleaseArtifact.match(/trivy image /g)?.length, 2);
  assert.match(createReleaseArtifact, /--severity HIGH,CRITICAL/);
  assert.match(createReleaseArtifact, /--ignore-unfixed --exit-code 1/);
  assert.match(continuousIntegration, /docker builder prune --all --force/);
  assert.match(continuousIntegration, /docker image prune --force/);
  assert.doesNotMatch(continuousIntegration, /docker (?:image|system) prune --all/);
  assert.match(continuousIntegration, /cmp --silent "\$before_manifest" "\$after_manifest"/);
  assert.match(
    continuousIntegration,
    /image="q-academy-\$component:\$Q_ACADEMY_CI_RELEASE_TAG"/,
  );
  assert.match(continuousIntegration, /printf '%s ' "\$image"/);
  assert.match(
    continuousIntegration,
    /docker image inspect --format 'id=\{\{\.Id\}\} size=\{\{\.Size\}\}' "\$image"/,
  );
  assert.doesNotMatch(continuousIntegration, /join \.RepoTags/);
  assert.match(continuousIntegration, /required_bytes=\$\(\(6 \* 1024 \* 1024 \* 1024\)\)/);
  assert.match(continuousIntegration, /TMPDIR: \$\{\{ runner\.temp \}\}/);
  assert.match(createReleaseArtifact, /docker save/);
  assert.match(createReleaseArtifact, /s3-app-principal-preflight/);
  assert.match(createReleaseArtifact, /dispatcher caddy/);
  assert.match(createReleaseArtifact, /CI_CA_CERTIFICATES_VERSION/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_CA_CERTIFICATES_VERSION/);
  assert.match(createReleaseArtifact, /CI_MESA_VERSION/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_MESA_VERSION/);
  assert.match(createReleaseArtifact, /CI_CADDY_BUILDER_IMAGE/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_CADDY_BUILDER_IMAGE/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_CADDY_VERSION/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_CADDY_BUILDABLE_ARTIFACT_SHA256/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_CADDY_SOURCE_DATE_EPOCH/);
  assert.match(createReleaseArtifact, /SHA256SUMS/);
  assert.match(publishReleaseImages, /sha256sum --check --strict/);
  assert.match(publishReleaseImages, /docker push/);
  assert.match(publishReleaseImages, /s3-app-principal-preflight/);
  assert.match(publishReleaseImages, /dispatcher caddy/);
  assert.match(publishReleaseImages, /docker pull "\$pinned_reference"/);
  assert.match(publishReleaseImages, /published_id[^]*expected_id/);
  assert.match(publishReleaseImages, /output manifest already exists/);
  assert.match(
    publishReleaseImages,
    /ln -- "\$temporary_manifest" "\$output_manifest"/,
  );
  assert.match(publishReleaseImages, /output checksum already exists/);
  const exactComponents =
    "postgres app migrator key-rotation tenant-ops media-runner media-preflight s3-app-principal-preflight dispatcher caddy";
  assert.match(
    common,
    new RegExp(
      `RELEASE_IMAGE_COMPONENTS=\\([\\s\\S]*${exactComponents.replaceAll(" ", "\\s+")}\\s*\\)`,
    ),
  );
  assert.match(
    createReleaseArtifact,
    new RegExp(`image_components=\\(${exactComponents}\\)`),
  );
  assert.match(
    publishReleaseImages,
    new RegExp(`image_components=\\(${exactComponents}\\)`),
  );
  assert.equal(
    continuousIntegration.match(new RegExp(`image_components=\\(${exactComponents}\\)`, "g"))?.length,
    2,
  );
  assert.match(continuousIntegration, /Scratch Caddy image unexpectedly contains \/bin\/sh/);
  assert.match(
    continuousIntegration,
    /--network none --user 0:0 --read-only \\\s+--security-opt no-new-privileges=true \\\s+--cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH/,
  );
  assert.match(
    continuousIntegration,
    /--network none --user 10001:10001 --read-only \\\s+--cap-drop ALL --security-opt no-new-privileges=true/,
  );
  assert.match(continuousIntegration, /caddy-volume-v1/);
  assert.match(
    continuousIntegration,
    /--entrypoint \/usr\/bin\/caddy \\\s+"\$caddy_image" validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile/,
  );
});

test("release publisher uses the tested Docker identity model on a hosted runner", () => {
  const publisherStart = continuousIntegration.indexOf("  publish-release:");
  const publisher = continuousIntegration.slice(publisherStart);
  const setupStep = publisher.indexOf(
    "docker/setup-docker-action@6d7cfa65f60a9dda7b46e5513fa982536f3c9877",
  );
  const verifyStep = publisher.indexOf(
    "- name: Verify publisher Docker image store",
  );
  const loginStep = publisher.indexOf(
    "- name: Authenticate to GitHub Container Registry",
  );
  const publishStep = publisher.indexOf(
    "- name: Publish the exact tested image IDs",
  );

  assert.ok(publisherStart >= 0);
  assert.match(publisher, /^    runs-on: ubuntu-latest$/m);
  assert.doesNotMatch(publisher, /^    runs-on: self-hosted$/m);
  assert.match(publisher, /^          version: v29\.4\.0$/m);
  assert.match(publisher, /^          set-host: true$/m);
  assert.match(publisher, /"containerd-snapshotter": true/);
  assert.match(publisher, /^          expected_version="29\.4\.0"$/m);
  assert.match(
    publisher,
    /docker version --format '\{\{\.Server\.Version\}\}'/,
  );
  assert.match(publisher, /actual_version" != "\$expected_version/);
  assert.match(
    publisher,
    /docker info --format '\{\{ \.DriverStatus \}\}'/,
  );
  assert.match(publisher, /grep -Fq 'io\.containerd\.snapshotter\.v1'/);
  assert.ok(setupStep >= 0);
  assert.ok(verifyStep > setupStep);
  assert.ok(loginStep > verifyStep);
  assert.ok(publishStep > loginStep);
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

test("release controllers bind readiness to a root-owned LF production environment", () => {
  assert.match(common, /verify_release_environment_security\(\)/);
  assert.match(common, /must be owned by root:root/);
  assert.match(common, /must use LF line endings/);
  assert.match(common, /must not traverse symlinks/);
  assert.match(common, /must not be group- or world-writable/);
  assert.match(
    reconcile,
    /verify_release_environment_security "\$env_file"/,
  );

  for (const controller of [deploy, rollback]) {
    assert.match(
      controller,
      /app_domain="\$\(production_env_value "\$env_file" APP_DOMAIN\)"/,
    );
    assert.match(
      controller,
      /requested_app_domain" == "\$app_domain"/,
    );
  }
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
