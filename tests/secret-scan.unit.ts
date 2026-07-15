import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  scanGitHistoryForSecrets,
  scanSecretText,
} from "../scripts/secret-scan";

function git(root: string, args: readonly string[]) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "q-academy-secret-history-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "security-test@example.invalid"]);
  git(root, ["config", "user.name", "Security Test"]);
  writeFileSync(join(root, "README.md"), "safe\n", "utf8");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "--quiet", "-m", "initial"]);
  return root;
}

test("secret scan detects provider credentials without returning their values", () => {
  const aws = "AKIA" + "A".repeat(16);
  const github = "ghp_" + "b".repeat(40);
  const findings = scanSecretText("fixture.txt", `${aws}\n${github}\n`);

  assert.deepEqual(
    findings.map(({ rule, line }) => ({ rule, line })),
    [
      { rule: "aws_access_key", line: 1 },
      { rule: "github_legacy_token", line: 2 },
    ],
  );
  assert.equal(JSON.stringify(findings).includes(aws), false);
  assert.equal(JSON.stringify(findings).includes(github), false);
});

test("secret scan ignores placeholders and non-live provider identifiers", () => {
  assert.deepEqual(
    scanSecretText(
      "fixture.example",
      "AWS_ACCESS_KEY_ID=replace-me\nSTRIPE_KEY=sk_test_placeholder\n",
    ),
    [],
  );
});

test("secret scan recognizes private key material", () => {
  const marker = "-----BEGIN " + "PRIVATE KEY-----";
  const findings = scanSecretText("fixture.pem", marker);
  assert.equal(findings[0]?.rule, "private_key");
});

test("history scan detects a deleted credential without returning its value", () => {
  const root = createRepository();
  try {
    const secret = "AKIA" + "Z".repeat(16);
    const historicalPath = join(root, ".env.production");
    writeFileSync(historicalPath, `AWS_ACCESS_KEY_ID=${secret}\n`, "utf8");
    git(root, ["add", ".env.production"]);
    git(root, ["commit", "--quiet", "-m", "historical fixture"]);
    const secretObject = git(root, ["rev-parse", "HEAD:.env.production"]);
    rmSync(historicalPath);
    git(root, ["add", "--all"]);
    git(root, ["commit", "--quiet", "-m", "remove fixture"]);

    const findings = scanGitHistoryForSecrets(root);

    assert.ok(
      findings.some(
        ({ file, rule }) =>
          file === `git-object:${secretObject}:blob` && rule === "aws_access_key",
      ),
    );
    assert.equal(JSON.stringify(findings).includes(secret), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("history scan checks binary blobs instead of silently skipping them", () => {
  const root = createRepository();
  try {
    const secret = "ghp_" + "q".repeat(40);
    writeFileSync(
      join(root, "fixture.bin"),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret, "ascii")]),
    );
    git(root, ["add", "fixture.bin"]);
    git(root, ["commit", "--quiet", "-m", "binary fixture"]);

    const findings = scanGitHistoryForSecrets(root);

    assert.ok(findings.some(({ rule }) => rule === "github_legacy_token"));
    assert.equal(JSON.stringify(findings).includes(secret), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("history scan fails closed for shallow repositories", () => {
  const source = createRepository();
  const parent = mkdtempSync(join(tmpdir(), "q-academy-secret-shallow-"));
  const shallow = join(parent, "checkout");
  try {
    writeFileSync(join(source, "second.txt"), "second\n", "utf8");
    git(source, ["add", "second.txt"]);
    git(source, ["commit", "--quiet", "-m", "second"]);
    mkdirSync(shallow);
    rmSync(shallow, { recursive: true });
    git(parent, [
      "clone",
      "--quiet",
      "--depth",
      "1",
      pathToFileURL(source).href,
      shallow,
    ]);

    assert.throws(
      () => scanGitHistoryForSecrets(shallow),
      /refuses a shallow or unverifiable repository/i,
    );
  } finally {
    rmSync(source, { force: true, recursive: true });
    rmSync(parent, { force: true, recursive: true });
  }
});

test("history scan fails instead of skipping an object beyond its bound", () => {
  const root = createRepository();
  try {
    writeFileSync(join(root, "large.txt"), "x".repeat(1024), "utf8");
    git(root, ["add", "large.txt"]);
    git(root, ["commit", "--quiet", "-m", "bounded fixture"]);

    assert.throws(
      () => scanGitHistoryForSecrets(root, { maxObjectBytes: 512 }),
      /exceeds the bounded secret-scan size and was not skipped/i,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("CI fetches complete history and invokes the dedicated fail-closed gate", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "ci.yml"),
    "utf8",
  );
  const packageManifest = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.match(
    workflow,
    /Check out repository[\s\S]{0,300}fetch-depth: 0/,
  );
  assert.match(
    workflow,
    /Scan tracked files and complete Git history[\s\S]{0,200}npm run security:scan-secrets:history/,
  );
  assert.equal(
    packageManifest.scripts?.["security:scan-secrets:history"],
    "tsx scripts/secret-scan.ts --history",
  );
});
