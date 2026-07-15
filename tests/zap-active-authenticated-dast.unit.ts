import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACTIVE_DAST_ACK,
  ACTIVE_DAST_IMAGE,
  buildActiveDastDockerArgs,
  DEFAULT_ACTIVE_DAST_BOUNDS,
  validateActiveDastBounds,
  validateActiveDastConfirmation,
  validatePublicTargetAddresses,
} from "../src/lib/operations/active-dast";
import { parseActiveDastCli } from "../scripts/ops/run-zap-active-authenticated";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const validConfirmation = {
  origin: "https://dast-ephemeral-staging.security.example.com",
  confirmOrigin: "https://dast-ephemeral-staging.security.example.com",
  project: "dast-ephemeral-staging",
  confirmProject: "dast-ephemeral-staging",
  ack: ACTIVE_DAST_ACK,
};

test("active DAST requires two exact confirmations and the destructive ACK", () => {
  assert.deepEqual(validateActiveDastConfirmation(validConfirmation), {
    origin: validConfirmation.origin,
    hostname: "dast-ephemeral-staging.security.example.com",
    project: validConfirmation.project,
  });
  assert.throws(() =>
    validateActiveDastConfirmation({ ...validConfirmation, confirmOrigin: validConfirmation.origin + "/" }),
  );
  assert.throws(() =>
    validateActiveDastConfirmation({ ...validConfirmation, confirmProject: "dast-isolated-staging" }),
  );
  assert.throws(() => validateActiveDastConfirmation({ ...validConfirmation, ack: "yes" }));
});

test("active DAST rejects production, local, IP, HTTP, and ambiguously marked targets", () => {
  for (const origin of [
    "https://dast-ephemeral-staging-prod.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "http://dast-ephemeral-staging.security.example.com",
    "https://dast-staging.security.example.com",
    "https://ephemeral-staging.security.example.com",
    "https://dast-ephemeral.security.example.com",
    "https://dast-ephemeral-staging.security.example.com:8443",
    "https://dast-ephemeral-staging.security.example.com/admin",
  ]) {
    assert.throws(() => validateActiveDastConfirmation({ ...validConfirmation, origin, confirmOrigin: origin }), origin);
  }
  assert.throws(() =>
    validateActiveDastConfirmation({
      ...validConfirmation,
      project: "dast-ephemeral-staging-production",
      confirmProject: "dast-ephemeral-staging-production",
    }),
  );
});

test("DNS validation rejects every private, reserved, local, and mixed answer", () => {
  assert.deepEqual(validatePublicTargetAddresses(["8.8.8.8", "1.1.1.1"]), {
    addresses: ["1.1.1.1", "8.8.8.8"],
    pinnedIpv4: "8.8.8.8",
  });
  for (const addresses of [
    ["127.0.0.1"],
    ["10.0.0.4"],
    ["169.254.1.1"],
    ["192.0.2.5"],
    ["::1"],
    ["fc00::1"],
    ["8.8.8.8", "10.0.0.4"],
    [],
  ]) {
    assert.throws(() => validatePublicTargetAddresses(addresses), addresses.join(","));
  }
});

test("scan time and request bounds have hard lower, upper, and aggregate limits", () => {
  assert.deepEqual(validateActiveDastBounds(DEFAULT_ACTIVE_DAST_BOUNDS), DEFAULT_ACTIVE_DAST_BOUNDS);
  assert.throws(() => validateActiveDastBounds({ ...DEFAULT_ACTIVE_DAST_BOUNDS, maxRequests: 5_001 }));
  assert.throws(() => validateActiveDastBounds({ ...DEFAULT_ACTIVE_DAST_BOUNDS, activeScanMinutes: 31 }));
  assert.throws(() => validateActiveDastBounds({ ...DEFAULT_ACTIVE_DAST_BOUNDS, spiderMinutes: 0 }));
  assert.throws(() =>
    validateActiveDastBounds({ ...DEFAULT_ACTIVE_DAST_BOUNDS, maxRuntimeMinutes: 10 }),
  );
});

test("CLI parser accepts no implicit values, duplicates, or unbounded overrides", () => {
  const required = [
    "--origin",
    validConfirmation.origin,
    "--confirm-origin",
    validConfirmation.origin,
    "--project",
    validConfirmation.project,
    "--confirm-project",
    validConfirmation.project,
    "--ack",
    ACTIVE_DAST_ACK,
    "--owner-credentials-file",
    "/secure/owner.json",
    "--member-credentials-file",
    "/secure/member.json",
    "--output",
    "/evidence/report.json",
  ];
  assert.equal(parseActiveDastCli(required).bounds.maxRequests, 5_000);
  assert.throws(() => parseActiveDastCli([...required, "--max-requests", "5001"]));
  assert.throws(() => parseActiveDastCli([...required, "--origin", validConfirmation.origin]));
  assert.throws(() => parseActiveDastCli([...required, "--unknown", "value"]));
});

test("Docker invocation is pinned, least-privileged, isolated, and file-secret only", () => {
  const ownerPath = "/secure/owner.json";
  const memberPath = "/secure/member.json";
  const args = buildActiveDastDockerArgs({
    origin: validConfirmation.origin,
    hostname: "dast-ephemeral-staging.security.example.com",
    project: validConfirmation.project,
    containerName: "q-academy-zap-active-test",
    uid: 1001,
    gid: 1001,
    pinnedIpv4: "8.8.8.8",
    ownerCredentialsPath: ownerPath,
    memberCredentialsPath: memberPath,
    wrapperPath: "/repo/deploy/security/run-zap-active-container.py",
    evidenceDirectory: "/tmp/evidence",
    bounds: DEFAULT_ACTIVE_DAST_BOUNDS,
  });
  const invocation = args.join(" ");
  assert.ok(args.includes(ACTIVE_DAST_IMAGE));
  for (const control of [
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=512",
    "--memory=3g",
    "--memory-swap=3g",
    "--cpus=2",
    "--shm-size=256m",
    "nofile=4096:4096",
    "--network=bridge",
    "--dns=127.0.0.1",
    "--tmpfs",
    "--add-host",
  ]) {
    assert.ok(args.includes(control), control);
  }
  assert.match(invocation, /dast-ephemeral-staging\.security\.example\.com:8\.8\.8\.8/);
  assert.match(invocation, /src=\/secure\/owner\.json,dst=\/run\/secrets\/owner\.json,readonly/);
  assert.match(invocation, /src=\/secure\/member\.json,dst=\/run\/secrets\/member\.json,readonly/);
  assert.doesNotMatch(invocation, /--network[= ]host|--privileged|--env-file|bash -c|sh -c|:latest/);
  assert.doesNotMatch(invocation, /owner-secret-value|member-secret-value|password=/i);
});

test("container wrapper keeps raw auth and traffic data in tmpfs and exports a whitelist", () => {
  const wrapper = source("deploy/security/run-zap-active-container.py");
  assert.match(wrapper, /"method": "json"/);
  assert.match(wrapper, /"loginRequestBody": login_body/);
  assert.match(wrapper, /"sessionManagement": \{"method": "cookie"\}/);
  assert.match(wrapper, /"owner-context"|f"\{role\}-context"/);
  assert.match(wrapper, /"owner-user"|f"\{role\}-user"/);
  assert.match(wrapper, /\/api\/v1\/auth\/login/);
  assert.match(wrapper, /\/api\/v1\/me/);
  assert.match(wrapper, /\/api\/v1\/auth\/logout/);
  assert.match(wrapper, /"type": "openapi"/);
  assert.match(wrapper, /"type": "spider"/);
  assert.match(wrapper, /"type": "spiderAjax"/);
  assert.match(wrapper, /"scopeCheck": "Strict"/);
  assert.match(wrapper, /"type": "activeScan-policy"/);
  assert.match(wrapper, /"POLICY_QA_CICD"/);
  assert.match(wrapper, /"TEST_TIMING", "OUT_OF_BAND"/);
  assert.match(wrapper, /"statistic": "stats\.network\.send\.success"/);
  assert.match(wrapper, /"statistic": "stats\.network\.send\.failure"/);
  assert.match(wrapper, /"type": "monitor"/);
  assert.match(wrapper, /"template": "traditional-json-plus"/);
  assert.match(wrapper, /RAW_REPORT_FILE = Path\("\/tmp\/raw-zap-report\.json"\)/);
  assert.match(wrapper, /SAFE_REPORT_FILE = Path\("\/evidence\/scanner-result\.json"\)/);
  assert.match(wrapper, /subprocess\.DEVNULL/);
  assert.match(wrapper, /os\.umask\(0o077\)/);
  assert.match(wrapper, /logs_contain_secret/);
  for (const field of ["pluginId", "alertRef", "name", "risk", "confidence", "cweId", "wascId", "count"]) {
    assert.ok(wrapper.includes(`"${field}"`), field);
  }
  assert.doesNotMatch(wrapper, /\/evidence\/(?:raw|plan|zap\.log)/);
});

test("host runner validates roles, proves logout, force-cleans, and never transports secret values", () => {
  const runner = source("scripts/ops/run-zap-active-authenticated.ts");
  assert.match(runner, /process\.platform !== "linux"/);
  assert.match(runner, /metadata\.uid !== currentUid/);
  assert.match(runner, /metadata\.mode & 0o777\) !== 0o400/);
  assert.match(runner, /resolve4\(hostname\), resolve6\(hostname\)/);
  assert.match(runner, /pinnedIpv4/);
  assert.match(runner, /loginData\.user\?\.role !== input\.expectedRole/);
  assert.match(runner, /\/api\/v1\/me\/sessions/);
  assert.match(runner, /\/api\/v1\/auth\/logout/);
  assert.match(runner, /anonymous\.status !== 401/);
  assert.match(runner, /"authentication_required"/);
  assert.match(runner, /finally \{[\s\S]*docker[\s\S]*rm[\s\S]*--force/);
  assert.doesNotMatch(runner, /spawn\(command|runIgnored\(/);
  assert.match(
    runner,
    /spawn\("docker", args, \{ stdio: "ignore", shell: false \}\)/,
  );
  assert.match(runner, /validateScannerEvidence/);
  assert.match(runner, /credentials\.password/);
  assert.doesNotMatch(runner, /--env-file|PASSWORD=|EMAIL=|stdio: "inherit"|shell: true/);
});

test("security guide separates destructive authenticated DAST from the passive CI gate", () => {
  const guide = source("docs/SECURITY_TESTING.md");
  assert.ok(guide.includes(ACTIVE_DAST_IMAGE));
  assert.ok(guide.includes(ACTIVE_DAST_ACK));
  assert.match(guide, /disposable/i);
  assert.match(guide, /Owner[\s\S]*Member/);
  assert.match(guide, /0400/);
  assert.match(guide, /production[\s\S]*localhost[\s\S]*IP/i);
  assert.match(guide, /raw[\s\S]*tmpfs/i);
  assert.match(guide, /not.*CI/i);
});
