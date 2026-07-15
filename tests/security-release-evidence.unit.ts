import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("CodeQL runs pinned extended JavaScript and TypeScript analysis", () => {
  const workflow = source(".github/workflows/codeql.yml");
  assert.match(workflow, /security-events: write/);
  assert.match(workflow, /languages: javascript-typescript/);
  assert.match(workflow, /queries: security-extended/);
  assert.match(workflow, /schedule:/);
  const actionLines = workflow
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith("uses:"));
  assert.ok(actionLines.length >= 3);
  for (const line of actionLines) {
    assert.match(line, /@[a-f0-9]{40}(?:\s+#.*)?$/);
  }
});

test("responsible disclosure publishes a private contact and response targets", () => {
  const policy = source("SECURITY.md");
  assert.match(policy, /private vulnerability reporting/i);
  assert.match(policy, /security@q-academy\.de/);
  assert.match(policy, /two business days/);
  assert.match(policy, /five business days/);
  assert.match(policy, /coordinated disclosure/i);
  assert.match(policy, /INCIDENT_RESPONSE_RUNBOOK\.md/);
});

test("third-party notices are lockfile-bound and checked in CI", () => {
  const packageJson = JSON.parse(source("package.json")) as {
    scripts?: Record<string, string>;
  };
  const lockfile = source("package-lock.json");
  const notices = source("THIRD_PARTY_NOTICES.md");
  const generator = source("scripts/generate-third-party-notices.ts");
  const continuousIntegration = source(".github/workflows/ci.yml");
  const digest = createHash("sha256").update(lockfile).digest("hex");

  assert.equal(
    packageJson.scripts?.["notices:check"],
    "tsx scripts/generate-third-party-notices.ts --check",
  );
  assert.ok(notices.includes(`Lockfile SHA-256: \`${digest}\``));
  assert.match(notices, /CycloneDX SBOMs/);
  assert.match(generator, /metadata\.dev === true/);
  assert.match(generator, /Production package metadata is incomplete/);
  assert.match(continuousIntegration, /npm run notices:check/);
});
