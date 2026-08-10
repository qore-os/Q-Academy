import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const sast = readFileSync(
  new URL("../.github/workflows/sast.yml", import.meta.url),
  "utf8",
);

function job(workflow: string, name: string, nextName?: string) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:`, start + 1) : -1;
  assert.ok(start >= 0, `Missing ${name} job.`);
  assert.ok(end > start || end === -1, `Invalid ${name} job boundary.`);
  return workflow.slice(start, end === -1 ? undefined : end);
}

function assertLocalSystemDockerTarget(workflowJob: string) {
  assert.match(
    workflowJob,
    /^      DOCKER_HOST: unix:\/\/\/var\/run\/docker\.sock$/m,
  );
  assert.match(workflowJob, /^      DOCKER_CONTEXT: default$/m);
  assert.match(workflowJob, /- name: Verify local system Docker target/);
  assert.match(workflowJob, /\[\[ -S \/var\/run\/docker\.sock \]\]/);
  assert.match(
    workflowJob,
    /docker context inspect default --format '\{\{\.Endpoints\.docker\.Host\}\}'/,
  );
  assert.match(workflowJob, /\[\[ "\$context_host" == "\$DOCKER_HOST" \]\]/);
  assert.match(
    workflowJob,
    /docker version --format '\{\{\.Server\.Version\}\}' >\/dev\/null/,
  );
}

test("system-Docker release gates ignore a stale runner current context", () => {
  const backup = job(ci, "backup-restore-drill", "sast");
  const analyze = job(sast, "analyze");

  assertLocalSystemDockerTarget(backup);
  assertLocalSystemDockerTarget(analyze);
  assert.ok(
    backup.indexOf("Verify local system Docker target") <
      backup.indexOf("Run required production backup/restore drill"),
  );
  assert.ok(
    analyze.indexOf("Verify local system Docker target") <
      analyze.indexOf("Run isolated Semgrep Community Edition scan"),
  );
});

test("Quality isolates setup-docker main and post hooks from persistent CLI state", () => {
  const verify = job(ci, "verify", "backup-restore-drill");
  const isolation = verify.indexOf("- name: Isolate tested Docker CLI state");
  const setup = verify.indexOf("- name: Set up tested Docker image store");

  assert.ok(isolation >= 0 && setup > isolation);
  const isolationStep = verify.slice(isolation, setup);
  assert.match(
    isolationStep,
    /mktemp -d "\$RUNNER_TEMP\/q-academy-docker-config\.XXXXXX"/,
  );
  assert.match(isolationStep, /chmod 0700 "\$docker_config"/);
  assert.match(
    isolationStep,
    /printf 'DOCKER_CONFIG=%s\\n' "\$docker_config" >>"\$GITHUB_ENV"/,
  );
  assert.doesNotMatch(verify, /docker context use default/);
});
