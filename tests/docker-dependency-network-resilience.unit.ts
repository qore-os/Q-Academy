import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync("Dockerfile", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

function stageSource(name: string, nextStage: string) {
  const start = dockerfile.indexOf(`FROM base AS ${name}`);
  const end = dockerfile.indexOf(`FROM ${nextStage}`, start + 1);
  assert.ok(start >= 0 && end > start);
  return dockerfile.slice(start, end);
}

test("npm dependency stages retain a verified cache across interrupted downloads", () => {
  assert.match(dockerfile, /^ARG NPM_CACHE_SEED_SOURCE=scratch$/m);
  assert.match(
    dockerfile,
    /^FROM \$\{NPM_CACHE_SEED_SOURCE\} AS npm-cache-seed$/m,
  );

  const stages = [
    stageSource("dependencies", "dependencies AS release-verifier"),
    stageSource("production-dependencies", "runtime-base AS migrator"),
  ];

  for (const stage of stages) {
    assert.match(
      stage,
      /RUN --mount=type=cache,id=q-academy-npm-cache,target=\/root\/\.npm,sharing=locked/,
    );
    assert.match(stage, /ARG NPM_CONFIG_OFFLINE=false/);
    assert.match(
      stage,
      /--mount=type=bind,from=npm-cache-seed,source=\.,target=\/tmp\/q-academy-npm-cache-seed(?:\s|\\)/,
    );
    assert.doesNotMatch(
      stage,
      /target=\/tmp\/q-academy-npm-cache-seed,(?:rw|readwrite)/,
    );
    assert.match(
      stage,
      /find \/tmp\/q-academy-npm-cache-seed -mindepth 1 ! -type d ! -type f -print -quit/,
    );
    assert.match(
      stage,
      /cp -a \/tmp\/q-academy-npm-cache-seed\/\. \/root\/\.npm\/_cacache\//,
    );
    assert.match(
      stage,
      /NPM_CONFIG_CACHE=\/root\/\.npm NPM_CONFIG_OFFLINE=true NPM_CONFIG_UPDATE_NOTIFIER=false NO_UPDATE_NOTIFIER=1 \\\n\s+npm cache verify --cache \/root\/\.npm/,
    );
    assert.match(
      stage,
      /NPM_CONFIG_CACHE=\/root\/\.npm NPM_CONFIG_OFFLINE="\$NPM_CONFIG_OFFLINE" NPM_CONFIG_UPDATE_NOTIFIER=false NO_UPDATE_NOTIFIER=1 npm ci/,
    );
    assert.match(stage, /npm ci/);
    assert.match(stage, /--no-audit/);
    assert.match(stage, /--no-fund/);
    assert.match(stage, /--prefer-offline/);
    assert.match(stage, /--fetch-retries=5/);
    assert.match(stage, /--fetch-retry-factor=2/);
    assert.match(stage, /--fetch-retry-mintimeout=10000/);
    assert.match(stage, /--fetch-retry-maxtimeout=60000/);
    assert.match(stage, /--maxsockets=5/);
    assert.doesNotMatch(stage, /npm cache clean/);
  }
});

test("Quality seeds only npm cacache and makes every Node image build offline", () => {
  const preparePosition = workflow.indexOf("- name: Prepare isolated npm cache");
  const setupNodePosition = workflow.indexOf("- name: Set up Node.js");
  const restoredPosition = workflow.indexOf("- name: Validate restored npm cache");
  const installPosition = workflow.indexOf("- name: Install dependencies");
  const populatedPosition = workflow.indexOf("- name: Validate populated npm cache");
  const buildPosition = workflow.indexOf(
    "- name: Build and start production containers",
  );
  assert.ok(
    preparePosition >= 0 &&
      preparePosition < setupNodePosition &&
      setupNodePosition < restoredPosition &&
      restoredPosition < installPosition &&
      installPosition < populatedPosition &&
      populatedPosition < buildPosition,
  );
  assert.match(
    workflow,
    /validate-npm-cache[.]sh --prepare[)]"\n\s+printf 'NPM_CONFIG_CACHE=%s\\n' "\$npm_cache" >>"\$GITHUB_ENV"/,
  );
  assert.match(
    workflow,
    /validate-npm-cache[.]sh --allow-empty/,
  );
  assert.match(
    workflow,
    /validate-npm-cache[.]sh --require-populated/,
  );
  assert.match(
    workflow,
    /validate-npm-cache[.]sh \\\n\s+--require-populated \\\n\s+--print-cacache/,
  );
  assert.match(
    workflow,
    /"q-academy-restored-npm-cache=\$npm_cacache"/,
  );
  assert.match(
    workflow,
    /NPM_CACHE_SEED_SOURCE=q-academy-restored-npm-cache/,
  );
  assert.match(workflow, /NPM_CONFIG_OFFLINE=true/);
  assert.doesNotMatch(workflow, /npm config get cache/);
  assert.doesNotMatch(workflow, /\$HOME\/\.npm/);
  assert.doesNotMatch(
    workflow,
    /q-academy-restored-npm-cache=\$(?:HOME|npm_cache)(?:\b|[\/"}])/,
  );

  for (const target of [
    "runner",
    "migrator",
    "key-rotation",
    "tenant-ops",
    "media-runner",
    "media-preflight",
    "s3-app-principal-preflight",
  ]) {
    const targetPosition = workflow.indexOf(`--target ${target}`);
    const buildStart = workflow.lastIndexOf("docker build \\", targetPosition);
    const buildEnd = workflow.indexOf("\n          docker build \\", targetPosition);
    assert.ok(targetPosition >= 0 && buildStart >= 0 && buildEnd > targetPosition);
    assert.match(
      workflow.slice(buildStart, buildEnd),
      /"\$\{npm_build_args\[@\]\}"/,
    );
  }

  assert.equal(
    workflow.match(/"\$\{npm_build_args\[@\]\}"/g)?.length,
    7,
  );
});

test("host npm installs use bounded retries and preserve cacache for post-job save", () => {
  const installStart = workflow.indexOf("- name: Install dependencies");
  const installEnd = workflow.indexOf(
    "- name: Generate disposable CI VAPID keys",
    installStart,
  );
  assert.ok(installStart >= 0 && installEnd > installStart);
  const installs = workflow.slice(installStart, installEnd);

  assert.equal(installs.match(/npm ci/g)?.length, 2);
  for (const option of [
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
    "--fetch-retries=5",
    "--fetch-retry-factor=2",
    "--fetch-retry-mintimeout=10000",
    "--fetch-retry-maxtimeout=60000",
    "--maxsockets=5",
  ]) {
    assert.equal(installs.split(option).length - 1, 2, option);
  }

  assert.doesNotMatch(workflow, /npm cache clean/);
  assert.match(
    workflow,
    /rm -rf -- "\$NPM_CONFIG_CACHE\/_logs" "\$NPM_CONFIG_CACHE\/_npx"/,
  );
  assert.doesNotMatch(workflow, /rm -rf --[^\n]*_cacache/);
});

test("npm lockfiles bind every registry artifact to SHA-512", () => {
  for (const lockfilePath of [
    "package-lock.json",
    "integrations/automation-connectors/zapier/package-lock.json",
  ]) {
    const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8")) as {
      lockfileVersion?: number;
      packages?: Record<
        string,
        {
          bundleDependencies?: string[];
          inBundle?: boolean;
          integrity?: string;
          link?: boolean;
          resolved?: string;
          version?: string;
        }
      >;
    };
    assert.equal(lockfile.lockfileVersion, 3, lockfilePath);
    assert.ok(lockfile.packages, lockfilePath);

    let externalArtifacts = 0;
    for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
      if (!packagePath || metadata.link) continue;
      assert.ok(metadata.version, `${lockfilePath}: ${packagePath} has no version`);

      if (metadata.inBundle) {
        const parentSeparator = packagePath.lastIndexOf("/node_modules/");
        assert.ok(parentSeparator > 0, `${lockfilePath}: ${packagePath}`);
        const parentPath = packagePath.slice(0, parentSeparator);
        const bundledName = packagePath.slice(
          parentSeparator + "/node_modules/".length,
        );
        const parent = lockfile.packages[parentPath];
        assert.ok(
          parent?.bundleDependencies?.includes(bundledName),
          `${lockfilePath}: ${packagePath} lacks an integrity-bound bundle parent`,
        );
        assert.match(parent.integrity ?? "", /^sha512-[A-Za-z0-9+/]+={0,2}$/);
        continue;
      }

      externalArtifacts += 1;
      assert.match(
        metadata.resolved ?? "",
        /^https:\/\/registry\.npmjs\.org\//,
        `${lockfilePath}: ${packagePath}`,
      );
      assert.match(
        metadata.integrity ?? "",
        /^sha512-[A-Za-z0-9+/]+={0,2}$/,
        `${lockfilePath}: ${packagePath}`,
      );
    }
    assert.ok(externalArtifacts > 0, lockfilePath);
  }
});
