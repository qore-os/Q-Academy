import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Semgrep CE runs a pinned, isolated, evidence-producing SAST gate", () => {
  const workflow = source(".github/workflows/sast.yml");
  const continuousIntegration = source(".github/workflows/ci.yml");
  assert.match(workflow, /^permissions:\s+contents: read$/m);
  assert.doesNotMatch(workflow, /security-events:/);
  assert.match(
    workflow,
    /SEMGREP_IMAGE: semgrep\/semgrep:1\.169\.0-nonroot@sha256:[a-f0-9]{64}/,
  );
  assert.match(workflow, /SEMGREP_RULESET_COUNT: "1074"/);
  assert.match(workflow, /SEMGREP_RULESET_SHA256: [a-f0-9]{64}/);
  assert.ok(workflow.includes(".split(/(?=^- )/m)"));
  assert.match(workflow, /block\.matchAll\(/);
  assert.match(workflow, /Semgrep rule must contain one top-level ID/);
  assert.match(workflow, /Semgrep rule count or uniqueness changed/);
  assert.match(workflow, /createHash\("sha256"\)\.update\(canonical\)/);
  assert.match(workflow, /--network none/);
  assert.match(workflow, /--read-only/);
  assert.match(workflow, /--cap-drop ALL/);
  assert.match(workflow, /--security-opt no-new-privileges:true/);
  assert.match(workflow, /--oss-only/);
  assert.match(workflow, /--metrics=off/);
  assert.match(workflow, /--strict/);
  assert.match(workflow, /--error/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.doesNotMatch(workflow, /--severity (?:ERROR|WARNING|INFO)/);
  assert.match(workflow, /--timeout 180/);
  assert.match(workflow, /--max-target-bytes 2000000/);
  for (const path of [
    "android/gradlew",
    "scripts/ops/docker-egress-firewall.sh",
    "scripts/ops/postgres-backup-restore-drill.sh",
    "scripts/ops/postgres-backup.sh",
    "scripts/ops/staging-app-replica-drain-drill.sh",
    "scripts/ops/staging-storage-pipeline-outage-drill.sh",
  ]) {
    assert.ok(workflow.includes(`--exclude ${path} \\`), path);
  }
  assert.doesNotMatch(workflow, /--exclude (?:scripts|android)\/\*+/);
  assert.match(workflow, /--json-output \/output\/semgrep\.json/);
  assert.match(workflow, /--sarif-output \/output\/semgrep\.sarif/);
  assert.match(workflow, /"\$SEMGREP_IMAGE" semgrep scan/);
  assert.doesNotMatch(workflow, /"\$SEMGREP_IMAGE" scan/);
  assert.match(workflow, /scan_exit_code=%s/);
  assert.match(workflow, /evidence_complete=%s/);
  assert.match(workflow, /Semgrep evidence contract is invalid/);
  assert.match(workflow, /sha256sum semgrep\.json semgrep\.sarif semgrep\.txt/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /Upload SAST evidence/);
  assert.match(workflow, /^  workflow_call:$/m);
  assert.match(workflow, /schedule:/);
  assert.match(
    continuousIntegration,
    /^  sast:\s+name: Required SAST release gate\s+uses: \.\/\.github\/workflows\/sast\.yml$/m,
  );
  assert.match(
    continuousIntegration,
    /needs: \[verify, backup-restore-drill, sast\]/,
  );
  const actionLines = workflow
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith("uses:"));
  assert.ok(actionLines.length >= 2);
  for (const line of actionLines) {
    assert.match(line, /@[a-f0-9]{40}(?:\s+#.*)?$/);
  }
});

test("database setup runs guarded modules without a child process or shell", () => {
  const setup = source("scripts/setup-db.ts");
  assert.doesNotMatch(setup, /node:child_process|\bspawn(?:Sync)?\b|shell:/);
  const guard = setup.indexOf("assertDestructiveSeedAllowed");
  const migrate = setup.indexOf('await import("./migrate")');
  const seed = setup.indexOf('await import("./seed")');
  assert.ok(guard >= 0 && guard < migrate && migrate < seed);
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
