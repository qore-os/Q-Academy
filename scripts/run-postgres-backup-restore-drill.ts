import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(
  "scripts",
  "ops",
  "postgres-backup-restore-drill.sh",
);
const arguments_ = process.argv.slice(2);

if (arguments_.includes("--help")) {
  console.log(`Usage:
  npm run test:backup-restore-drill
  npm run test:backup-restore-drill:required

Runs an isolated PostgreSQL backup/restore drill through the production Compose
database-role contract. Missing Bash, Docker Compose, or a running Docker daemon
causes a clean skip unless the required target is used.`);
  process.exit(0);
}

const unsupportedArguments = arguments_.filter((value) => value !== "--require");
if (unsupportedArguments.length > 0) {
  console.error(`Unknown argument: ${unsupportedArguments.join(" ")}`);
  process.exit(2);
}

const configuredPrerequisitesRequired = process.env.Q_ACADEMY_DRILL_REQUIRED;
if (
  configuredPrerequisitesRequired !== undefined &&
  configuredPrerequisitesRequired !== "true" &&
  configuredPrerequisitesRequired !== "false"
) {
  console.error("Q_ACADEMY_DRILL_REQUIRED must be true or false.");
  process.exit(2);
}
const prerequisitesRequired =
  arguments_.includes("--require") || configuredPrerequisitesRequired === "true";
const pinnedImagePattern =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;

if (prerequisitesRequired) {
  for (const variableName of [
    "Q_ACADEMY_DRILL_NODE_IMAGE",
    "Q_ACADEMY_DRILL_POSTGRES_IMAGE",
  ] as const) {
    const image = process.env[variableName];
    if (!image) {
      console.error(
        `Required PostgreSQL backup/restore drill needs ${variableName} with an immutable sha256 digest.`,
      );
      process.exit(1);
    }
    if (!pinnedImagePattern.test(image)) {
      console.error(
        `Required PostgreSQL backup/restore drill rejects mutable ${variableName}: ${image}`,
      );
      process.exit(1);
    }
  }
}

const probeOptions = {
  cwd: rootDirectory,
  stdio: "ignore",
  timeout: 15_000,
  windowsHide: true,
} as const;

function probeSucceeded(result: ReturnType<typeof spawnSync>) {
  return result.status === 0 && !result.error;
}

function unavailable(message: string): never {
  const prefix = prerequisitesRequired
    ? "PostgreSQL backup/restore drill prerequisite failed"
    : "SKIP PostgreSQL backup/restore drill";
  const output = `${prefix}: ${message}`;
  if (prerequisitesRequired) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
  process.exit(0);
}

if (!probeSucceeded(spawnSync("bash", ["--version"], probeOptions))) {
  unavailable("Bash is unavailable.");
}
if (
  !probeSucceeded(
    spawnSync("docker", ["compose", "version"], probeOptions),
  )
) {
  unavailable("the Docker CLI or Compose plugin is unavailable.");
}
if (!probeSucceeded(spawnSync("docker", ["info"], probeOptions))) {
  unavailable("the Docker daemon is unavailable.");
}

const result = spawnSync("bash", [scriptPath], {
  cwd: rootDirectory,
  env: {
    ...process.env,
    Q_ACADEMY_DRILL_REQUIRED: prerequisitesRequired ? "true" : "false",
  },
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  console.error(`Could not start the PostgreSQL backup/restore drill: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  console.error(`PostgreSQL backup/restore drill terminated by ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
