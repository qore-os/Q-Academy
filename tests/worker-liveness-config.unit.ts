import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(
  new URL("../compose.production.yml", import.meta.url),
  "utf8",
);

function serviceBlock(serviceName: string) {
  const escapedName = serviceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`^  ${escapedName}:[^\\r\\n]*$`, "m").exec(
    compose,
  );
  assert.ok(start?.index !== undefined, `Missing ${serviceName} service`);
  const remaining = compose.slice(start.index + start[0].length);
  const nextService = remaining.search(
    /\r?\n  [a-z0-9][a-z0-9-]*:[^\r\n]*\r?\n/m,
  );
  return compose.slice(
    start.index,
    nextService === -1
      ? compose.length
      : start.index + start[0].length + nextService,
  );
}

for (const [serviceName, marker] of [
  ["scheduler", "/tmp/scheduler.last-success"],
  ["media-worker", "/tmp/media-worker.last-success"],
  ["media-maintenance", "/tmp/media-maintenance.last-success"],
] as const) {
  test(`${serviceName} fails closed and exposes a success heartbeat`, () => {
    const service = serviceBlock(serviceName);

    assert.match(service, /restart: unless-stopped/);
    assert.match(service, /WORKER_MAX_CONSECUTIVE_FAILURES:/);
    assert.match(service, /WORKER_HEARTBEAT_STALE_SECONDS:/);
    assert.match(service, /then :; else status=000; fi/);
    assert.match(service, /consecutive_failures="\$\$\(\(consecutive_failures \+ 1\)\)"/);
    assert.match(service, /if \[ "\$\$\{consecutive_failures\}" -ge "\$\$\{WORKER_MAX_CONSECUTIVE_FAILURES\}" \]; then exit 1; fi/);
    assert.match(service, new RegExp(`success_marker=${marker.replace(/[.]/g, "\\.")}`));
    assert.match(service, /2\?\?\)[^]*mv "\$\$\{success_marker\}\.tmp" "\$\$\{success_marker\}"/);
    assert.match(service, new RegExp(`test -s ${marker.replace(/[.]/g, "\\.")}`));
    assert.match(service, /now - last_success/);
    assert.doesNotMatch(service, /\|\| true/);
    assert.doesNotMatch(service, /failure[^\n]*\$\$\{body\}/);
    assert.doesNotMatch(
      service,
      /printf[^\n]*authorization_header[^\n]*>&2/,
    );
  });
}

test("worker liveness does not create an application-readiness dependency", () => {
  const app = serviceBlock("app");
  const scheduler = serviceBlock("scheduler");

  assert.doesNotMatch(app, /scheduler:/);
  assert.match(scheduler, /app:\s+condition: service_healthy/);
  assert.match(app, /\/api\/v1\/health\/ready/);
});
