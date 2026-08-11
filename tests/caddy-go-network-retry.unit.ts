import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const retryScript = path.join(
  root,
  "scripts",
  "ops",
  "caddy-go-network-retry.sh",
);
const retrySource = readFileSync(retryScript, "utf8");
const isWindows = process.platform === "win32";
const linuxSystemPath =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function runtimePath(value: string) {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  const windowsPath = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!windowsPath) {
    return normalized;
  }

  return `/mnt/${windowsPath[1]?.toLowerCase()}${windowsPath[2]}`;
}

function runBashScript({
  arguments: scriptArguments,
  directory,
  environment,
  pathPrefix,
  script,
}: {
  arguments: string[];
  directory: string;
  environment: Record<string, string>;
  pathPrefix?: string;
  script: string;
}) {
  if (isWindows) {
    const searchPath = pathPrefix
      ? `${runtimePath(pathPrefix)}:${linuxSystemPath}`
      : linuxSystemPath;
    const environmentArguments = Object.entries(environment).map(
      ([name, value]) => `${name}=${value}`,
    );

    return spawnSync(
      "wsl.exe",
      [
        "-d",
        "Ubuntu",
        "--cd",
        runtimePath(directory),
        "--",
        "/usr/bin/env",
        `PATH=${searchPath}`,
        ...environmentArguments,
        "/bin/bash",
        runtimePath(script),
        ...scriptArguments,
      ],
      { encoding: "utf8" },
    );
  }

  const searchPath = pathPrefix
    ? `${pathPrefix}:${process.env.PATH ?? ""}`
    : process.env.PATH;
  return spawnSync("bash", [script, ...scriptArguments], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      PATH: searchPath,
    },
  });
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "q-academy-caddy-go-retry-"));
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  const go = path.join(bin, "go");
  const sleep = path.join(bin, "sleep");

  writeFileSync(
    go,
    `#!/usr/bin/env bash
set -euo pipefail
count=0
if [[ -f "$Q_ACADEMY_ATTEMPT_FILE" ]]; then
  count="$(cat "$Q_ACADEMY_ATTEMPT_FILE")"
fi
count=$((count + 1))
printf '%s\\n' "$count" >"$Q_ACADEMY_ATTEMPT_FILE"
[[ "$(cat go.mod)" == baseline-mod ]] || exit 91
[[ "$(cat go.sum)" == baseline-sum ]] || exit 92
if [[ "\${Q_ACADEMY_GO_MODE:-retry}" == hang ]]; then
  printf 'partial-mod-%s\\n' "$count" >go.mod
  printf 'partial-sum-%s\\n' "$count" >go.sum
  printf '{"partial":%s}\\n' "$count"
  trap '' TERM
  exec /bin/sleep 10
fi
if ((count < Q_ACADEMY_SUCCEED_ON)); then
  printf 'partial-mod-%s\\n' "$count" >go.mod
  printf 'partial-sum-%s\\n' "$count" >go.sum
  printf '{"partial":%s}\\n' "$count"
  printf 'read tcp: connection reset by peer\\n' >&2
  exit 75
fi
printf 'selected-mod\\n' >go.mod
printf 'selected-sum\\n' >go.sum
printf '{"attempt":%s}\\n' "$count"
`,
    { mode: 0o700 },
  );
  writeFileSync(
    sleep,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$1" >>"$Q_ACADEMY_SLEEP_FILE"
`,
    { mode: 0o700 },
  );
  chmodSync(go, 0o700);
  chmodSync(sleep, 0o700);
  writeFileSync(path.join(directory, "go.mod"), "baseline-mod\n");
  writeFileSync(path.join(directory, "go.sum"), "baseline-sum\n");

  const attemptFile = path.join(directory, "attempts");
  const sleepFile = path.join(directory, "sleeps");
  const outputFile = path.join(directory, "result.json");
  const run = ({
    goArguments = ["mod", "download", "all"],
    helperPath = retryScript,
    label = "module-download-all",
    mode = "retry",
    succeedOn,
  }: {
    goArguments?: string[];
    helperPath?: string;
    label?: string;
    mode?: "hang" | "retry";
    succeedOn: number;
  }) =>
    runBashScript({
      arguments: [
        "--module-files",
        "--label",
        label,
        "--output",
        runtimePath(outputFile),
        "--",
        "go",
        ...goArguments,
      ],
      directory,
      environment: {
        GOENV: "off",
        GONOPROXY: "",
        GONOSUMDB: "",
        GOPRIVATE: "",
        GOPROXY: "https://proxy.golang.org",
        GOSUMDB: "sum.golang.org",
        GOTOOLCHAIN: "local",
        Q_ACADEMY_ATTEMPT_FILE: runtimePath(attemptFile),
        Q_ACADEMY_GO_MODE: mode,
        Q_ACADEMY_SLEEP_FILE: runtimePath(sleepFile),
        Q_ACADEMY_SUCCEED_ON: String(succeedOn),
      },
      pathPrefix: bin,
      script: helperPath,
    });

  return { attemptFile, bin, directory, outputFile, run, sleepFile };
}

test("Caddy Go network steps are retried with pinned integrity controls", () => {
  assert.match(retrySource, /^readonly MAX_ATTEMPTS=4$/m);
  assert.match(retrySource, /^readonly -a BACKOFF_SECONDS=\(2 4 8\)$/m);
  assert.match(retrySource, /^readonly ATTEMPT_TIMEOUT_SECONDS=300$/m);
  assert.match(retrySource, /^readonly ATTEMPT_KILL_AFTER_SECONDS=15$/m);
  assert.match(
    retrySource,
    /timeout \\\n+      --signal=TERM \\\n+      --kill-after="\$\{ATTEMPT_KILL_AFTER_SECONDS\}s" \\\n+      "\$\{ATTEMPT_TIMEOUT_SECONDS\}s"/,
  );
  assert.match(retrySource, /only an exact Go command may be retried/);
  assert.match(retrySource, /GOPROXY is not pinned/);
  assert.match(retrySource, /GOSUMDB is not pinned/);
  assert.match(retrySource, /no fallback was attempted/);

  assert.match(dockerfile, /ENV GOENV=off/);
  assert.match(dockerfile, /GOPROXY=https:\/\/proxy[.]golang[.]org/);
  assert.match(dockerfile, /GOSUMDB=sum[.]golang[.]org/);
  assert.doesNotMatch(dockerfile, /GOPROXY=[^\n]*direct/);
  assert.doesNotMatch(dockerfile, /GONOSUMDB=\S|GOPRIVATE=\S/);
  assert.equal(
    dockerfile.match(/\/bin\/bash "\$go_network_retry"/g)?.length,
    8,
  );

  for (const contract of [
    /--module-files[\s\\]+--label x-text-target-download[\s\\]+--output \/tmp\/caddy-x-text-module[.]json[\s\\]+-- go mod download -json "golang[.]org\/x\/text@v\$\{CADDY_X_TEXT_VERSION\}"/,
    /--module-files[\s\\]+--label grpc-target-download[\s\\]+--output \/tmp\/caddy-grpc-module[.]json[\s\\]+-- go mod download -json "google[.]golang[.]org\/grpc@v\$\{CADDY_GRPC_VERSION\}"/,
    /--module-files[\s\\]+--label upstream-module-list[\s\\]+--output \/tmp\/caddy-modules[.]before[\s\\]+-- go list -mod=mod -m all/,
    /--module-files[\s\\]+--label pinned-module-upgrade[\s\\]+-- go get/,
    /--module-files[\s\\]+--label module-tidy[\s\\]+-- go mod tidy/,
    /--module-files[\s\\]+--label module-download-all[\s\\]+-- go mod download all/,
    /--label patched-module-list[\s\\]+--output \/tmp\/caddy-modules[.]after[\s\\]+-- go list -mod=readonly -m all/,
    /--module-files[\s\\]+--label locked-module-download[\s\\]+--output \/tmp\/caddy-module-download[.]json[\s\\]+-- go mod download -json "\$module@\$selected_version"/,
  ]) {
    assert.match(dockerfile, contract);
  }

  const downloadAll = dockerfile.indexOf("--label module-download-all");
  const verify = dockerfile.indexOf("go mod verify", downloadAll);
  const graphGate = dockerfile.indexOf("$CADDY_MODULE_GRAPH_SHA256", verify);
  const lockedDownloads = dockerfile.indexOf("--label locked-module-download", graphGate);
  const finalSumGate = dockerfile.indexOf(
    "$CADDY_PATCHED_GO_SUM_SHA256",
    lockedDownloads,
  );
  const offline = dockerfile.indexOf("export GOPROXY=off", lockedDownloads);
  const vendor = dockerfile.indexOf("go mod vendor", offline);
  const build = dockerfile.indexOf("CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build", vendor);
  assert.ok(downloadAll >= 0 && downloadAll < verify);
  assert.ok(verify < graphGate && graphGate < lockedDownloads);
  assert.ok(lockedDownloads < finalSumGate && finalSumGate < offline);
  assert.ok(offline < vendor && vendor < build);
  assert.doesNotMatch(
    dockerfile.slice(dockerfile.indexOf("FROM ${CADDY_BUILDER_IMAGE}"), offline),
    /GOSUMDB=off/,
  );
  assert.match(
    dockerfile.slice(offline, vendor),
    /export GOPROXY=off GOSUMDB=off;[\s\S]*test "\$\(go env GOPROXY\)" = off;[\s\S]*test "\$\(go env GOSUMDB\)" = off/,
  );
});

test("retry restores module files and publishes only successful output", () => {
  const testFixture = fixture();
  try {
    const result = testFixture.run({ succeedOn: 3 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(testFixture.attemptFile, "utf8"), "3\n");
    assert.equal(readFileSync(testFixture.sleepFile, "utf8"), "2\n4\n");
    assert.equal(readFileSync(testFixture.outputFile, "utf8"), '{"attempt":3}\n');
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.mod"), "utf8"),
      "selected-mod\n",
    );
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.sum"), "utf8"),
      "selected-sum\n",
    );
    assert.match(result.stderr, /attempt 1\/4/);
    assert.match(result.stderr, /attempt 2\/4/);
  } finally {
    rmSync(testFixture.directory, { force: true, recursive: true });
  }
});

test("retry exhausts exactly four attempts without leaking partial state", () => {
  const testFixture = fixture();
  try {
    const result = testFixture.run({
      goArguments: ["mod", "download", "-json", "example.com/locked@v1.2.3"],
      label: "locked-module-download",
      succeedOn: 99,
    });
    assert.equal(result.status, 75, result.stderr);
    assert.equal(readFileSync(testFixture.attemptFile, "utf8"), "4\n");
    assert.equal(readFileSync(testFixture.sleepFile, "utf8"), "2\n4\n8\n");
    assert.equal(existsSync(testFixture.outputFile), false);
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.mod"), "utf8"),
      "baseline-mod\n",
    );
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.sum"), "utf8"),
      "baseline-sum\n",
    );
    assert.match(result.stderr, /failed after 4 attempts \(exit 75\)/);
    assert.match(result.stderr, /locked-module-download/);
    assert.match(result.stderr, /no fallback was attempted/);
  } finally {
    rmSync(testFixture.directory, { force: true, recursive: true });
  }
});

test("hard timeout kills hangs, retries, and enforces the scaled maximum", () => {
  const testFixture = fixture();
  const boundedHelper = path.join(testFixture.directory, "bounded-retry.sh");
  try {
    const boundedSource = retrySource
      .replace(
        "readonly ATTEMPT_TIMEOUT_SECONDS=300",
        "readonly ATTEMPT_TIMEOUT_SECONDS=0.2",
      )
      .replace(
        "readonly ATTEMPT_KILL_AFTER_SECONDS=15",
        "readonly ATTEMPT_KILL_AFTER_SECONDS=0.1",
      );
    assert.notEqual(boundedSource, retrySource);
    writeFileSync(boundedHelper, boundedSource, { mode: 0o700 });

    const startedAt = performance.now();
    const result = testFixture.run({
      helperPath: boundedHelper,
      mode: "hang",
      succeedOn: 99,
    });
    const durationMs = performance.now() - startedAt;

    assert.ok(result.status === 124 || result.status === 137, result.stderr);
    assert.equal(readFileSync(testFixture.attemptFile, "utf8"), "4\n");
    assert.equal(readFileSync(testFixture.sleepFile, "utf8"), "2\n4\n8\n");
    assert.equal(existsSync(testFixture.outputFile), false);
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.mod"), "utf8"),
      "baseline-mod\n",
    );
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.sum"), "utf8"),
      "baseline-sum\n",
    );
    assert.ok(durationMs >= 600, `timeout completed too early: ${durationMs}ms`);
    assert.ok(durationMs < 5_000, `timeout exceeded its bound: ${durationMs}ms`);
    assert.equal(4 * (300 + 15) + 2 + 4 + 8, 1_274);
  } finally {
    rmSync(testFixture.directory, { force: true, recursive: true });
  }
});

test("TERM restores module files while normal success keeps mutations", () => {
  const testFixture = fixture();
  const timeout = path.join(testFixture.bin, "timeout");
  try {
    writeFileSync(
      timeout,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'signal-partial-mod\\n' >go.mod
printf 'signal-partial-sum\\n' >go.sum
kill -TERM "$PPID"
exit 143
`,
      { mode: 0o700 },
    );
    chmodSync(timeout, 0o700);

    const result = testFixture.run({ succeedOn: 1 });
    assert.equal(result.status, 143, result.stderr);
    assert.equal(existsSync(testFixture.outputFile), false);
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.mod"), "utf8"),
      "baseline-mod\n",
    );
    assert.equal(
      readFileSync(path.join(testFixture.directory, "go.sum"), "utf8"),
      "baseline-sum\n",
    );
  } finally {
    rmSync(testFixture.directory, { force: true, recursive: true });
  }
});

test("retry rejects non-Go commands before execution", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "q-academy-caddy-go-reject-"));
  const marker = path.join(directory, "executed");
  try {
    const result = runBashScript({
      arguments: [
        "--label",
        "reject-non-go",
        "--",
        "sh",
        "-c",
        'touch -- "$1"',
        "reject-non-go",
        runtimePath(marker),
      ],
      directory,
      environment: {
        GOENV: "off",
        GONOPROXY: "",
        GONOSUMDB: "",
        GOPRIVATE: "",
        GOPROXY: "https://proxy.golang.org",
        GOSUMDB: "sum.golang.org",
        GOTOOLCHAIN: "local",
      },
      script: retryScript,
    });
    assert.equal(result.status, 64);
    assert.equal(existsSync(marker), false);
    assert.match(result.stderr, /only an exact Go command may be retried/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
