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

type CacheRunOptions = {
  cacheGid?: string;
  cacheMode?: string;
  cachePath?: string;
  cacheRuntimePath?: string;
  cacheUid?: string;
  verifyMode?: "keep" | "remove-content";
};

function runtimePath(value: string) {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  const windowsPath = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!windowsPath) return normalized;
  return `/mnt/${windowsPath[1]?.toLowerCase()}${windowsPath[2]}`;
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "q-academy-npm-cache-"));
  const runnerTemp = path.join(directory, "runner-temp");
  const legacyCache = path.join(runnerTemp, "q-academy-npm-cache");
  const bin = path.join(directory, "bin");
  const npm = path.join(bin, "npm");
  const stat = path.join(bin, "stat");
  const verifyMarker = path.join(directory, "npm-cache-verify.calls");
  let cache: string | undefined = legacyCache;
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
  writeFileSync(
    stat,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -eq 3 && "$1" == --format=%u:%g:%a && "$2" == -- ]]; then
  cache_uid="\${Q_ACADEMY_CACHE_UID:-$(id -u)}"
  cache_gid="\${Q_ACADEMY_CACHE_GID:-$(id -g)}"
  printf '%s:%s:%s\\n' "$cache_uid" "$cache_gid" "$Q_ACADEMY_CACHE_MODE"
  exit 0
fi
exec /usr/bin/stat "$@"
`,
    { mode: 0o700 },
  );
  chmodSync(stat, 0o700);

  const currentCache = () => {
    if (!cache) throw new Error("The fixture cache has not been prepared.");
    return cache;
  };

  const run = (
    arguments_: string[],
    {
      cacheGid = "",
      cacheMode = "700",
      cachePath,
      cacheRuntimePath,
      cacheUid = "",
      verifyMode = "keep",
    }: CacheRunOptions = {},
  ) => {
    const configuredCache = cachePath ?? cache ?? legacyCache;
    const environment = {
      NPM_CONFIG_CACHE: cacheRuntimePath ?? runtimePath(configuredCache),
      Q_ACADEMY_CACHE_GID: cacheGid,
      Q_ACADEMY_CACHE_MODE: cacheMode,
      Q_ACADEMY_CACHE_UID: cacheUid,
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

  const prepare = (options: CacheRunOptions = {}) => {
    const result = run(["--prepare"], options);
    if (result.status === 0) {
      const preparedBasename = path.posix.basename(result.stdout.trim());
      cache = path.join(runnerTemp, preparedBasename);
    }
    return result;
  };

  const populate = () => {
    const cacache = path.join(currentCache(), "_cacache");
    const content = path.join(cacache, "content-v2", "sha512", "aa", "bb");
    const index = path.join(cacache, "index-v5", "aa", "bb");
    mkdirSync(content, { recursive: true });
    mkdirSync(index, { recursive: true });
    mkdirSync(path.join(cacache, "tmp"), { recursive: true });
    writeFileSync(path.join(content, "content"), "verified content\n");
    writeFileSync(path.join(index, "entry"), "verified index\n");
  };

  return {
    get cache() {
      return currentCache();
    },
    get cacache() {
      return path.join(currentCache(), "_cacache");
    },
    directory,
    legacyCache,
    populate,
    prepare,
    run,
    runnerTemp,
    verifyMarker,
  };
}

function createDirectoryLink(target: string, link: string) {
  symlinkSync(target, link, isWindows ? "junction" : "dir");
}

test("validator creates or safely reuses only the stable isolated root", () => {
  const testFixture = fixture();
  try {
    const first = testFixture.prepare();
    assert.equal(first.status, 0, first.stderr);
    const firstCache = testFixture.cache;
    assert.equal(first.stdout.trim(), runtimePath(firstCache));
    assert.equal(path.basename(firstCache), "q-academy-npm-cache");
    assert.equal(existsSync(firstCache), true);

    const sentinel = path.join(firstCache, "sentinel");
    writeFileSync(sentinel, "must survive\n");
    const second = testFixture.prepare();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(testFixture.cache, firstCache);
    assert.equal(second.stdout.trim(), runtimePath(testFixture.cache));
    assert.equal(readFileSync(sentinel, "utf8"), "must survive\n");

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
    assert.equal(testFixture.prepare().status, 0);
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

test("validator rejects path, owner, mode, link, and cache-structure faults", () => {
  const redirected = fixture();
  try {
    assert.equal(redirected.prepare().status, 0);
    const foreignCache = path.join(redirected.runnerTemp, "foreign-cache");
    mkdirSync(foreignCache);
    const result = redirected.run(["--allow-empty"], {
      cachePath: foreignCache,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not the exact isolated cache path/);
  } finally {
    rmSync(redirected.directory, { force: true, recursive: true });
  }

  const nested = fixture();
  try {
    assert.equal(nested.prepare().status, 0);
    const nestedCache = path.join(
      nested.runnerTemp,
      "nested",
      "q-academy-npm-cache",
    );
    mkdirSync(nestedCache, { recursive: true });
    const result = nested.run(["--allow-empty"], { cachePath: nestedCache });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not the exact isolated cache path/);
  } finally {
    rmSync(nested.directory, { force: true, recursive: true });
  }

  const nonCanonical = fixture();
  try {
    assert.equal(nonCanonical.prepare().status, 0);
    const cacheBasename = path.basename(nonCanonical.cache);
    const result = nonCanonical.run(["--allow-empty"], {
      cacheRuntimePath: `${runtimePath(nonCanonical.cache)}/../${cacheBasename}`,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /NPM_CONFIG_CACHE is not canonical/);
  } finally {
    rmSync(nonCanonical.directory, { force: true, recursive: true });
  }

  const wrongOwner = fixture();
  try {
    mkdirSync(wrongOwner.cache);
    const result = wrongOwner.prepare({
      cacheUid: "4294967294",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ownership is invalid/);
  } finally {
    rmSync(wrongOwner.directory, { force: true, recursive: true });
  }

  const wrongMode = fixture();
  try {
    mkdirSync(wrongMode.cache);
    const result = wrongMode.prepare({ cacheMode: "755" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mode is not 0700/);
  } finally {
    rmSync(wrongMode.directory, { force: true, recursive: true });
  }

  const linkedRoot = fixture();
  try {
    const foreignRoot = path.join(linkedRoot.directory, "foreign-root");
    mkdirSync(foreignRoot);
    createDirectoryLink(foreignRoot, linkedRoot.cache);
    const result = linkedRoot.prepare();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isolated cache root is a symlink/);
  } finally {
    rmSync(linkedRoot.directory, { force: true, recursive: true });
  }

  const nonDirectory = fixture();
  try {
    writeFileSync(nonDirectory.cache, "not a directory\n");
    const result = nonDirectory.prepare();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isolated cache root is missing/);
  } finally {
    rmSync(nonDirectory.directory, { force: true, recursive: true });
  }

  const linked = fixture();
  try {
    assert.equal(linked.prepare().status, 0);
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
    assert.equal(foreignEntry.prepare().status, 0);
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
    mkdirSync(linkedLogs.cache);
    const foreignLogs = path.join(linkedLogs.directory, "foreign", "_logs");
    mkdirSync(foreignLogs, { recursive: true });
    createDirectoryLink(foreignLogs, path.join(linkedLogs.cache, "_logs"));
    const result = linkedLogs.prepare();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /isolated cache contains an unsafe entry/);
  } finally {
    rmSync(linkedLogs.directory, { force: true, recursive: true });
  }
});

test("validator source is fail-closed and performs no network fallback", () => {
  assert.match(helperSource, /^set -euo pipefail$/m);
  assert.match(
    helperSource,
    /readonly CACHE_DIRECTORY_NAME=q-academy-npm-cache/,
  );
  assert.match(helperSource, /expected_cache="\$runner_temp\/\$CACHE_DIRECTORY_NAME"/);
  assert.match(
    helperSource,
    /\[\[ ! -e "\$cache_input" && ! -L "\$cache_input" \]\]/,
  );
  assert.match(helperSource, /mkdir -- "\$cache_input"/);
  assert.match(helperSource, /NPM_CONFIG_CACHE is not canonical/);
  assert.match(helperSource, /npm_cache" == "\$expected_cache/);
  assert.match(helperSource, /stat --format='%u:%g:%a'/);
  assert.match(helperSource, /cache_uid[\s\S]*id -u/);
  assert.match(helperSource, /cache_gid[\s\S]*id -g/);
  assert.match(helperSource, /cache_mode" == 700/);
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
  assert.doesNotMatch(helperSource, /\bmktemp\b/);
  assert.doesNotMatch(helperSource, /isolated cache path already exists/);
  assert.doesNotMatch(helperSource, /rm -rf[^\n]*cache/);
});
