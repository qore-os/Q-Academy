import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const health = readFileSync(
  new URL("../src/app/api/v1/health/route.ts", import.meta.url),
  "utf8",
);
const liveness = readFileSync(
  new URL("../src/app/api/v1/health/live/route.ts", import.meta.url),
  "utf8",
);
const readiness = readFileSync(
  new URL("../src/app/api/v1/health/ready/route.ts", import.meta.url),
  "utf8",
);

test("health endpoints report the validated deployed application version", () => {
  for (const route of [health, liveness, readiness]) {
    assert.match(route, /configuredAppVersion\(\)/);
    assert.doesNotMatch(route, /version:\s*"1\.0\.0"/);
  }
});
