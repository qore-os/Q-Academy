import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SaxesParser } from "saxes";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const expectedImage =
  "zaproxy/zap-stable:2.17.0@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2";

test("CI pins and gates the passive ZAP baseline before the media worker", () => {
  const workflow = source(".github/workflows/ci.yml");
  const appReady = workflow.indexOf('if [[ "$app_ready" != true ]]');
  const zapStep = workflow.indexOf("- name: Run passive OWASP ZAP baseline");
  const mediaStep = workflow.indexOf("- name: Smoke-test production media worker");

  assert.ok(appReady >= 0 && zapStep > appReady && mediaStep > zapStep);
  assert.ok(workflow.includes(`CI_ZAP_IMAGE: ${expectedImage}`));
  assert.doesNotMatch(workflow, /CI_ZAP_IMAGE:.*:(?:latest|stable)(?:@|\s|$)/);
  assert.match(workflow, /id: zap_baseline\s+shell: bash\s+run: bash scripts\/ops\/run-zap-baseline\.sh/);
  assert.match(workflow, /trap - EXIT\s+- name: Run passive OWASP ZAP baseline/);
  assert.match(
    workflow,
    /- name: Stop disposable CI runtime\s+if: always\(\)[\s\S]*docker rm --force q-academy-ci-runtime/,
  );
});

test("ZAP evidence is uploaded by a commit-pinned action even on failure", () => {
  const workflow = source(".github/workflows/ci.yml");
  const uploadStart = workflow.indexOf("- name: Upload OWASP ZAP baseline evidence");
  const mediaStart = workflow.indexOf("- name: Smoke-test production media worker");
  assert.ok(uploadStart >= 0 && mediaStart > uploadStart);

  const uploadStep = workflow.slice(uploadStart, mediaStart);
  assert.match(uploadStep, /if: always\(\)/);
  assert.match(
    uploadStep,
    /uses: actions\/upload-artifact@[a-f0-9]{40}\s+# v6/,
  );
  assert.match(uploadStep, /path: \.artifacts\/zap-baseline/);
  assert.match(uploadStep, /if-no-files-found: warn/);
});

test("ZAP runner is scoped, passive, least-privileged, and fail-closed", () => {
  const runner = source("scripts/ops/run-zap-baseline.sh");

  assert.match(runner, /readonly target_url="http:\/\/academy\.ci\.q-academy\.de:3000\/"/);
  assert.match(runner, /CI_ZAP_IMAGE must be an immutable ZAP image reference/);
  assert.match(runner, /zaproxy\/zap-stable:2\\\.17\\\.0@sha256:\[a-f0-9\]\{64\}/);
  assert.match(runner, /--network host/);
  assert.match(runner, /--add-host academy\.ci\.q-academy\.de:127\.0\.0\.1/);
  assert.match(runner, /--read-only/);
  assert.match(runner, /--cap-drop=ALL/);
  assert.match(runner, /--security-opt=no-new-privileges/);
  assert.match(runner, /--pids-limit=512/);
  assert.match(runner, /--memory=2g/);
  assert.match(runner, /--cpus=2/);
  assert.match(runner, /--env HOME=\/tmp/);
  assert.match(runner, /--workdir \/zap\/wrk/);
  assert.match(runner, /--volume "\$output_dir:\/zap\/wrk:rw"/);
  assert.match(runner, /zap-baseline\.py/);
  assert.match(runner, /--autooff/);
  assert.match(runner, /-n zap-ci\.context/);
  assert.match(runner, /-c zap-baseline\.conf/);
  assert.match(runner, /-T 5/);
  assert.match(runner, /-z "-silent -dir \/tmp\/\.ZAP"/);
  assert.match(runner, /PIPESTATUS\[0\]/);
  assert.match(runner, /exit "\$scan_status"/);

  assert.doesNotMatch(runner, /^\s*-(?:I|i|a|j)(?:\s|$)/m);
  assert.doesNotMatch(runner, /zap-(?:full|api)-scan\.py/);
  assert.doesNotMatch(
    runner,
    /Authorization|Bearer|--env-file|--env (?!HOME=\/tmp)/,
  );

  for (const report of [
    "zap-report.html",
    "zap-report.json",
    "zap-report.md",
    "zap-baseline.log",
    "run-metadata.txt",
    "exit-code.txt",
  ]) {
    assert.ok(runner.includes(report), `Missing ZAP evidence: ${report}`);
  }
});

test("ZAP context is valid XML and cannot crawl outside the disposable origin", () => {
  const context = source("deploy/security/zap-ci.context");
  const parser = new SaxesParser({ xmlns: false });
  assert.doesNotThrow(() => parser.write(context).close());

  assert.match(
    context,
    /<incregexes>http:\/\/academy\\\.ci\\\.q-academy\\\.de:3000\/\.\*<\/incregexes>/,
  );
  assert.match(context, /<excregexes>.*\/api\/internal\/\.\*<\/excregexes>/);
  assert.match(context, /<excregexes>.*\/auth\/oidc\/callback\.\*<\/excregexes>/);
  assert.doesNotMatch(context, /https?:\/\/(?!academy\\\.ci\\\.q-academy\\\.de:3000)/);
});

test("ZAP rule policy fails security findings and only demotes known information", () => {
  const policy = source("deploy/security/zap-baseline.conf");
  const rows = policy
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.ok(rows.length >= 30);
  for (const row of rows) {
    assert.match(row, /^\d+\t(?:FAIL|INFO)\t\(.+\)$/);
  }
  assert.doesNotMatch(policy, /\t(?:WARN|IGNORE)\t/);

  const failures = new Set(
    rows
      .filter((row) => row.includes("\tFAIL\t"))
      .map((row) => row.split("\t", 1)[0]),
  );
  for (const ruleId of [
    "10003",
    "10010",
    "10011",
    "10019",
    "10020",
    "10021",
    "10035",
    "10040",
    "10054",
    "10055",
    "10063",
    "10098",
    "10110",
    "90022",
    "90033",
  ]) {
    assert.ok(failures.has(ruleId), `Rule ${ruleId} must fail CI`);
  }
});

test("security documentation records DAST limits and immutable invocation", () => {
  const guide = source("docs/SECURITY_TESTING.md");
  const policy = source("SECURITY.md");

  assert.ok(guide.includes(expectedImage));
  assert.match(guide, /does not enable the Ajax spider, alpha rules, API scan, full scan, or active/i);
  assert.match(guide, /not a penetration test/i);
  assert.match(guide, /Authenticated role\/tenant coverage/);
  assert.match(policy, /SECURITY_TESTING\.md/);
});
