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
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const drill = readFileSync(
  path.join(root, "scripts", "ops", "postgres-backup-restore-drill.sh"),
  "utf8",
);
const drillEnvironment = readFileSync(
  path.join(root, "scripts", "ops", "drill-environment.sh"),
  "utf8",
);
const restore = readFileSync(
  path.join(root, "scripts", "ops", "postgres-restore.sh"),
  "utf8",
);
const ciWorkflow = readFileSync(
  path.join(root, ".github", "workflows", "ci.yml"),
  "utf8",
);
const documentation = readFileSync(
  path.join(root, "docs", "ROOTSERVER_DEPLOYMENT.md"),
  "utf8",
);
const drillLauncher = readFileSync(
  path.join(root, "scripts", "run-postgres-backup-restore-drill.ts"),
  "utf8",
);

test("backup/restore drill is isolated and exercises the production role contract", () => {
  assert.equal(
    packageJson.scripts?.["test:backup-restore-drill"],
    "tsx scripts/run-postgres-backup-restore-drill.ts",
  );
  assert.equal(
    packageJson.scripts?.["test:backup-restore-drill:required"],
    "tsx scripts/run-postgres-backup-restore-drill.ts --require",
  );
  assert.match(drill, /project_name="qacademy-drill-\$\{token\}"/);
  assert.match(drill, /compose\.production\.yml/);
  assert.match(drill, /database-role/);
  assert.match(drill, /database-permissions/);
  assert.match(drill, /config --format json/);
  assert.match(drill, /database_role_image/);
  assert.match(drill, /database_permissions_image/);
  assert.match(drill, /effective_migrator_image/);
  assert.match(drill, /drill NODE_IMAGE must be pinned/);
  assert.match(drill, /build migrate/);
  assert.match(drill, /run --rm --no-deps migrate/);
  assert.match(drill, /used_migrator_image_id/);
  assert.doesNotMatch(drill, /CURL_IMAGE|CADDY_IMAGE/);
  assert.doesNotMatch(drillEnvironment, /CURL_IMAGE|CADDY_IMAGE/);
  assert.match(drill, /scripts\/ops\/postgres-backup\.sh/);
  assert.match(drill, /scripts\/ops\/postgres-restore\.sh/);
  assert.doesNotMatch(drill, /\bpg_restore\b/);
  assert.equal(
    drill.match(/BACKUP_LOCK_FILE="\$\{work_dir\}\/backup\.lock"/g)?.length,
    2,
  );
  assert.match(drill, /backup_restore_drill_records/);
  assert.match(drill, /down --volumes --remove-orphans/);
  assert.match(drill, /docker image rm "\$\{migrator_image\}"/);
  assert.match(drill, /Cleanup failed to remove Compose project and volumes/);
  assert.match(drill, /Cleanup failed to remove disposable migrator image/);
  assert.match(drill, /Cleanup failed to remove temporary drill directory/);
  assert.doesNotMatch(
    drill,
    /down --volumes --remove-orphans[^\n]*\|\| true/,
  );
  assert.doesNotMatch(drill, /docker image rm[^\n]*\|\| true/);
  assert.match(drill, /RESTORE_IN_PLACE=false/);
  assert.match(drill, /REPLACE_TARGET_DATABASE=false/);
  assert.match(drill, /ALLOW_UNVERIFIED_BACKUP=false/);
  assert.match(documentation, /npm run test:backup-restore-drill/);
  assert.match(documentation, /npm run test:backup-restore-drill:required/);
});

test("backup/restore prerequisite probes use only fixed process names", () => {
  assert.doesNotMatch(drillLauncher, /spawnSync\(command/);
  assert.match(drillLauncher, /spawnSync\("bash", \["--version"\]/);
  assert.match(
    drillLauncher,
    /spawnSync\("docker", \["compose", "version"\]/,
  );
  assert.match(drillLauncher, /spawnSync\("docker", \["info"\]/);
});

test("side-by-side restore skips only the in-place media and runtime gates", () => {
  const inPlaceBranch = restore.indexOf(
    'if [[ "${target_database}" == "${source_database}" ]]',
  );
  const mediaMountGate = restore.indexOf('verify_media_work_mount "${ENV_FILE}"');
  const writerStop = restore.indexOf(
    'compose stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"',
    mediaMountGate,
  );
  assert.ok(inPlaceBranch >= 0);
  assert.ok(mediaMountGate > inPlaceBranch);
  assert.ok(writerStop > mediaMountGate);
  assert.equal(restore.match(/verify_media_work_mount/g)?.length, 1);
  assert.match(restore, /Side-by-side restore completed into database/);
});

test("in-place restore retries a partial writer stop and reports only confirmed state", () => {
  const cleanupStart = restore.indexOf("cleanup_failed_restore() {");
  const cleanupEndMarker = "\n}\ntrap cleanup_failed_restore EXIT";
  const cleanupEnd = restore.indexOf(cleanupEndMarker, cleanupStart);
  assert.ok(cleanupStart >= 0);
  assert.ok(cleanupEnd > cleanupStart);
  const cleanupFunction = restore.slice(cleanupStart, cleanupEnd + 2);
  const temporaryDirectory = mkdtempSync(
    path.join(root, ".q-academy-restore-cleanup-"),
  );
  const runnerFile = path.join(temporaryDirectory, "run-cleanup.sh");
  const bashRunnerFile = path.relative(root, runnerFile).replaceAll("\\", "/");
  writeFileSync(
    runnerFile,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "DATABASE_WRITER_SERVICES=(scheduler media-worker app)",
      "restore_ok=false",
      "in_place=true",
      "stop_calls=0",
      'cleanup_stop_fails="${1:-false}"',
      "compose() {",
      '  if [[ "$1" == "stop" ]]; then',
      "    stop_calls=$((stop_calls + 1))",
      '    if (( stop_calls == 1 )) || [[ "${cleanup_stop_fails}" == "true" ]]; then',
      "      return 1",
      "    fi",
      "    return 0",
      "  fi",
      '  if [[ "$1" == "ps" ]]; then',
      "    return 0",
      "  fi",
      "  return 1",
      "}",
      cleanupFunction,
      'if compose stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"; then',
      "  exit 91",
      "fi",
      "set +e",
      "cleanup_failed_restore",
      "cleanup_status=$?",
      "set -e",
      'printf "cleanup_status=%s stop_calls=%s\\n" "${cleanup_status}" "${stop_calls}"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const runCleanup = (cleanupStopFails: boolean) =>
    spawnSync("bash", [bashRunnerFile, cleanupStopFails ? "true" : "false"], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    const recovered = runCleanup(false);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(recovered.stdout, "cleanup_status=0 stop_calls=2\n");
    assert.match(recovered.stderr, /All application and media writers remain stopped/);
    assert.doesNotMatch(recovered.stderr, /could be confirmed stopped/);

    const unconfirmed = runCleanup(true);
    assert.equal(unconfirmed.status, 0, unconfirmed.stderr);
    assert.equal(unconfirmed.stdout, "cleanup_status=1 stop_calls=2\n");
    assert.match(unconfirmed.stderr, /could be confirmed stopped/);
    assert.doesNotMatch(
      unconfirmed.stderr,
      /All application and media writers remain stopped/,
    );
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("required backup/restore drill gates release publication with pinned images", () => {
  assert.match(ciWorkflow, /^  backup-restore-drill:$/m);
  assert.match(
    ciWorkflow,
    /Q_ACADEMY_DRILL_NODE_IMAGE: node:[^\s]+@sha256:[a-f0-9]{64}/,
  );
  assert.match(
    ciWorkflow,
    /Q_ACADEMY_DRILL_POSTGRES_IMAGE: postgres:[^\s]+@sha256:[a-f0-9]{64}/,
  );
  assert.match(
    ciWorkflow,
    /run: npm run test:backup-restore-drill:required/,
  );
  assert.match(
    ciWorkflow,
    /needs: \[verify, backup-restore-drill, sast\]/,
  );
  assert.ok(
    ciWorkflow.indexOf("  backup-restore-drill:") <
      ciWorkflow.indexOf("  publish-release:"),
  );
});

test("required backup/restore drill rejects missing or mutable image inputs", () => {
  const command = [
    "--import",
    "tsx",
    path.join("scripts", "run-postgres-backup-restore-drill.ts"),
    "--require",
  ];
  const withoutImages = spawnSync(process.execPath, command, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      Q_ACADEMY_DRILL_NODE_IMAGE: "",
      Q_ACADEMY_DRILL_POSTGRES_IMAGE: "",
    },
  });
  assert.equal(withoutImages.status, 1, withoutImages.stdout);
  assert.match(
    withoutImages.stderr,
    /needs Q_ACADEMY_DRILL_NODE_IMAGE with an immutable sha256 digest/,
  );

  const withMutablePostgresImage = spawnSync(process.execPath, command, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      Q_ACADEMY_DRILL_NODE_IMAGE: `node:22@sha256:${"1".repeat(64)}`,
      Q_ACADEMY_DRILL_POSTGRES_IMAGE: "postgres:16",
    },
  });
  assert.equal(withMutablePostgresImage.status, 1, withMutablePostgresImage.stdout);
  assert.match(
    withMutablePostgresImage.stderr,
    /rejects mutable Q_ACADEMY_DRILL_POSTGRES_IMAGE: postgres:16/,
  );
});

test("backup/restore drill rejects an invalid required-mode environment value", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join("scripts", "run-postgres-backup-restore-drill.ts"),
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        Q_ACADEMY_DRILL_REQUIRED: "tru",
      },
    },
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /Q_ACADEMY_DRILL_REQUIRED must be true or false/);
  assert.doesNotMatch(result.stdout, /SKIP PostgreSQL backup\/restore drill/);
});

test("generated drill environment overrides poisoned host Compose and database values", () => {
  assert.doesNotMatch(drillEnvironment, /source\s+.*environment_file/);
  assert.match(drillEnvironment, /printf -v "\$\{name\}" '%s' "\$\{value\}"/);
  assert.match(
    drillEnvironment,
    /SESSION_SECRET AUTH_RATE_LIMIT_SECRET CADDY_TLS_ASK_SECRET/,
  );
  const generatedEnvironment = drill.match(
    /cat >"\$\{env_file\}" <<ENV\n([\s\S]*?)\nENV/,
  );
  assert.ok(generatedEnvironment);
  const projectName = "qacademy-drill-0123456789ab";
  const markerName = ".q-academy-drill-env-injection-marker";
  const markerPath = path.join(root, markerName);
  const temporaryDirectory = mkdtempSync(
    path.join(root, ".q-academy-drill-env-"),
  );
  const environmentFile = path.join(temporaryDirectory, "drill.env");
  const runnerFile = path.join(temporaryDirectory, "run-parser.sh");
  const bashEnvironmentFile = path
    .relative(root, environmentFile)
    .replaceAll("\\", "/");
  const bashRunnerFile = path.relative(root, runnerFile).replaceAll("\\", "/");
  const values = new Map(
    generatedEnvironment[1].split("\n").map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  assert.equal(
    values.get("CADDY_TLS_ASK_SECRET"),
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  assert.equal(
    values.get("MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON"),
    '["https://drill.invalid"]',
  );
  values.set("COMPOSE_PROJECT_NAME", projectName);
  values.set("APP_IMAGE_TAG", "git-0000000000000000000000000000000000000000");
  values.set("NODE_IMAGE", `node:22@sha256:${"1".repeat(64)}`);
  values.set("POSTGRES_IMAGE", `postgres:16@sha256:${"2".repeat(64)}`);
  values.set("POSTGRES_DB", "qa_drill_0123456789ab");
  values.set("POSTGRES_BOOTSTRAP_USER", "qa_bootstrap_0123456789ab");
  values.set("OWNER_POSTGRES_USER", "qa_owner_0123456789ab");
  values.set("APP_POSTGRES_USER", "qa_app_0123456789ab");
  values.set("MEDIA_POSTGRES_USER", "qa_media_0123456789ab");
  const literalMediaPath = `$(touch ${markerName}); literal path with spaces`;
  values.set("MEDIA_PROCESSING_WORK_DIR", literalMediaPath);
  const environmentContent = `${[...values]
    .map(([name, value]) => `${name}=${value}`)
    .join("\n")}\n`;
  rmSync(markerPath, { force: true });
  writeFileSync(
    runnerFile,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "export COMPOSE_PROJECT_NAME=production-project",
      "export NODE_IMAGE=poisoned-node-image",
      "export POSTGRES_DB=production_database",
      "export POSTGRES_BOOTSTRAP_USER=production_bootstrap",
      "source scripts/ops/drill-environment.sh",
      `activate_q_academy_drill_environment '${bashEnvironmentFile}' '${projectName}'`,
      "printf '%s|%s|%s|%s|%s' \"$COMPOSE_PROJECT_NAME\" \"$POSTGRES_DB\" \"$POSTGRES_BOOTSTRAP_USER\" \"$NODE_IMAGE\" \"$MEDIA_PROCESSING_WORK_DIR\"",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const runParser = (content: string) => {
    writeFileSync(environmentFile, content, { mode: 0o600 });
    return spawnSync("bash", [bashRunnerFile], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
  };
  try {
    const result = runParser(environmentContent);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `${projectName}|qa_drill_0123456789ab|qa_bootstrap_0123456789ab|node:22@sha256:${"1".repeat(64)}|${literalMediaPath}`,
    );
    assert.equal(existsSync(markerPath), false);

    for (const [invalidContent, message] of [
      [`${environmentContent}POSTGRES_DB=duplicate\n`, /Duplicate.*POSTGRES_DB/],
      [
        environmentContent
          .split("\n")
          .filter((line) => !line.startsWith("SUPPORT_EMAIL="))
          .join("\n"),
        /missing SUPPORT_EMAIL/,
      ],
      [`${environmentContent}not-an-assignment\n`, /Invalid drill environment line/],
    ] as const) {
      const invalid = runParser(invalidContent);
      assert.equal(invalid.status, 1, invalid.stdout);
      assert.match(invalid.stderr, message);
    }
  } finally {
    rmSync(markerPath, { force: true });
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("backup/restore drill skips or fails cleanly when Bash is unavailable", () => {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
  ) as NodeJS.ProcessEnv;
  environment.PATH = "";
  const command = [
    "--import",
    "tsx",
    path.join("scripts", "run-postgres-backup-restore-drill.ts"),
  ];
  const optional = spawnSync(process.execPath, command, {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  assert.equal(optional.status, 0, optional.stderr);
  assert.match(optional.stdout, /SKIP PostgreSQL backup\/restore drill: Bash/);

  const required = spawnSync(process.execPath, [...command, "--require"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...environment,
      Q_ACADEMY_DRILL_NODE_IMAGE: `node:22@sha256:${"1".repeat(64)}`,
      Q_ACADEMY_DRILL_POSTGRES_IMAGE: `postgres:16@sha256:${"2".repeat(64)}`,
    },
  });
  assert.equal(required.status, 1, required.stdout);
  assert.match(
    required.stderr,
    /PostgreSQL backup\/restore drill prerequisite failed: Bash/,
  );
});
