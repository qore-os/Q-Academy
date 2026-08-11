import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const helper = path.join(root, "scripts", "ci", "validate-npm-cache.sh");
const helperSource = readFileSync(helper, "utf8");
const isWindows = process.platform === "win32";
const linuxSystemPath =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function runtimePath(value: string) {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  const windowsPath = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!windowsPath) return normalized;
  return `/mnt/${windowsPath[1]?.toLowerCase()}${windowsPath[2]}`;
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "q-academy-npm-cache-"));
  const runnerTemp = path.join(directory, "runner-temp");
  const cache = path.join(runnerTemp, "q-academy-npm-cache");
  const cacache = path.join(cache, "_cacache");
  const bin = path.join(directory, "bin");
  const npm = path.join(bin, "npm");
  const verifyMarker = path.join(directory, "npm-cache-verify.calls");
  mkdirSync(runnerTemp);
  mkdirSync(bin);
  writeFileSync(
    npm,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -eq 3 && "$1" == config && "$2" == get && "$3" == cache ]]; then
  [[ "$NPM_CONFIG_OFFLINE" == true ]]
  [[ "$NPM_CONFIG_UPDATE_NOTIFIER" == false ]]
  [[ "$NO_UPDATE_NOTIFIER" == 1 ]]
  printf '%s\\n' "$NPM_CONFIG_CACHE"
  exit 0
fi
if [[ "$#" -eq 4 && "$1" == cache && "$2" == verify && "$3" == --cache ]]; then
  [[ "$4" == "$NPM_CONFIG_CACHE" ]]
  [[ "$NPM_CONFIG_OFFLINE" == true ]]
  [[ "$NPM_CONFIG_UPDATE_NOTIFIER" == false ]]
  [[ "$NO_UPDATE_NOTIFIER" == 1 ]]
  printf 'verify\\n' >>"$Q_ACADEMY_VERIFY_MARKER"
  if [[ "\${Q_ACADEMY_VERIFY_MODE:-keep}" == remove-content ]]; then
    rm -rf -- "$NPM_CONFIG_CACHE/_cacache/content-v2"
  fi
  printf 'verified\n' >"$NPM_CONFIG_CACHE/_cacache/_lastverified"
  exit 0
fi
exit 93
`,
    { mode: 0o700 },
  );
  chmodSync(npm, 0o700);

  const run = (
    arguments_: string[],
    {
      cachePath = cache,
      verifyMode = "keep",
    }: { cachePath?: string; verifyMode?: "keep" | "remove-content" } = {},
  ) => {
    const environment = {
      NPM_CONFIG_CACHE: runtimePath(cachePath),
      Q_ACADEMY_VERIFY_MARKER: runtimePath(verifyMarker),
      Q_ACADEMY_VERIFY_MODE: verifyMode,
      RUNNER_TEMP: runtimePath(runnerTemp),
    };

    if (isWindows) {
      return spawnSync(
        "wsl.exe",
        [
          "-d",
          "Ubuntu",
          "--",
          "/usr/bin/env",
          `PATH=${runtimePath(bin)}:${linuxSystemPath}`,
          ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
          "/bin/bash",
          runtimePath(helper),
          ...arguments_,
        ],
        { encoding: "utf8" },
      );
    }

    return spawnSync("bash", [helper, ...arguments_], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      },
    });
  };

  const populate = () => {
    const content = path.join(cacache, "content-v2", "sha512", "aa", "bb");
    const index = path.join(cacache, "index-v5", "aa", "bb");
    mkdirSync(content, { recursive: true });
    mkdirSync(index, { recursive: true });
    mkdirSync(path.join(cacache, "tmp"), { recursive: true });
    writeFileSync(path.join(content, "content"), "verified content\n");
    writeFileSync(path.join(index, "entry"), "verified index\n");
  };

  return {
    cache,
    cacache,
    directory,
    populate,
    run,
    runnerTemp,
    verifyMarker,
  };
}

function createDirectoryLink(target: string, link: string) {
  symlinkSync(target, link, isWindows ? "junction" : "dir");
}

test("validator prepares the exact isolated root before accepting an empty restore", () => {
  const testFixture = fixture();
  try {
    const prepared = testFixture.run(["--prepare"]);
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(prepared.stdout.trim(), runtimePath(testFixture.cache));
    assert.equal(existsSync(testFixture.cache), true);

    const empty = testFixture.run(["--allow-empty"]);
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(empty.stdout, "");
    assert.equal(existsSync(testFixture.verifyMarker), false);
  } finally {
    rmSync(testFixture.directory, { force: true, recursive: true });
  }
});

test("validator verifies a populated cache and emits only its canonical cacache", () => {
  const testFixture = fixture();
  try {
    assert.equal(testFixture.run(["--prepare"]).status, 0);
    testFixture.populate();

    const populated = testFixture.run([
      "--require-populated",
      "--print-cacache",
    ]);
    assert.equal(populated.status, 0, populated.stderr);
    assert.equal(populated.stdout.trim(), runtimePath(testFixture.cacache));
    assert.equal(readFileSync(testFixture.verifyMarker, "utf8"), "verify\n");

    const corrupted = testFixture.run(["--require-populated"], {
      verifyMode: "remove-content",
    });
    assert.notEqual(corrupted.status, 0);
    assert.match(corrupted.stderr, /_cacache is missing content-v2/);
  } finally {
    rmSync(testFixture.directory, { force: true, recursive: true });
  }
});

test("validator rejects stale roots, path redirection, links, and foreign cache files", () => {
  const stale = fixture();
  try {
    mkdirSync(stale.cache);
    const result = stale.run(["--prepare"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isolated cache path already exists/);
  } finally {
    rmSync(stale.directory, { force: true, recursive: true });
  }

  const redirected = fixture();
  try {
    assert.equal(redirected.run(["--prepare"]).status, 0);
    const foreignCache = path.join(redirected.runnerTemp, "foreign-cache");
    mkdirSync(foreignCache);
    const result = redirected.run(["--allow-empty"], {
      cachePath: foreignCache,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not the prepared isolated path/);
  } finally {
    rmSync(redirected.directory, { force: true, recursive: true });
  }

  const linked = fixture();
  try {
    assert.equal(linked.run(["--prepare"]).status, 0);
    const foreignCacache = path.join(linked.directory, "foreign", "_cacache");
    mkdirSync(foreignCacache, { recursive: true });
    createDirectoryLink(foreignCacache, linked.cacache);
    const result = linked.run(["--allow-empty"]);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /(?:isolated cache contains an unsafe entry|_cacache (?:is a symlink|escaped))/,
    );
  } finally {
    rmSync(linked.directory, { force: true, recursive: true });
  }

  const foreignEntry = fixture();
  try {
    assert.equal(foreignEntry.run(["--prepare"]).status, 0);
    foreignEntry.populate();
    writeFileSync(path.join(foreignEntry.cacache, "credentials.log"), "secret\n");
    const result = foreignEntry.run(["--require-populated"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected root entry/);
  } finally {
    rmSync(foreignEntry.directory, { force: true, recursive: true });
  }

  const linkedLogs = fixture();
  try {
    assert.equal(linkedLogs.run(["--prepare"]).status, 0);
    const foreignLogs = path.join(linkedLogs.directory, "foreign", "_logs");
    mkdirSync(foreignLogs, { recursive: true });
    createDirectoryLink(foreignLogs, path.join(linkedLogs.cache, "_logs"));
    const result = linkedLogs.run(["--allow-empty"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isolated cache contains an unsafe entry/);
  } finally {
    rmSync(linkedLogs.directory, { force: true, recursive: true });
  }
});

test("validator source is fail-closed and performs no network fallback", () => {
  assert.match(helperSource, /^set -euo pipefail$/m);
  assert.match(helperSource, /\[\[ -e "\$cache_input" \|\| -L "\$cache_input" \]\]/);
  assert.match(helperSource, /NPM_CONFIG_CACHE is not the prepared isolated path/);
  assert.match(helperSource, /npm cache verify --cache "\$npm_cache" >&2/);
  assert.match(
    helperSource,
    /find "\$npm_cache" -mindepth 1 ! -type d ! -type f -print -quit/,
  );
  assert.match(helperSource, /! \\\( -type f -name _lastverified \\\)/);
  assert.ok((helperSource.match(/NPM_CONFIG_OFFLINE=true/g) ?? []).length >= 2);
  assert.ok(
    (helperSource.match(/NPM_CONFIG_UPDATE_NOTIFIER=false/g) ?? []).length >= 2,
  );
  assert.ok((helperSource.match(/NO_UPDATE_NOTIFIER=1/g) ?? []).length >= 2);
  assert.doesNotMatch(helperSource, /\bcurl\b|\bwget\b|npm (?:ci|install)/);
  assert.doesNotMatch(helperSource, /\$HOME|\.npmrc/);
  assert.doesNotMatch(helperSource, /rm -rf -- "\$cache_input"/);
});
