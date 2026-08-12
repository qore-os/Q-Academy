import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

test("Orbit lease heartbeat passes its server-only behavioral suite", () => {
  const child = path.resolve(
    process.cwd(),
    "tests/helpers/orbit-transfer-lease-unit-child.ts",
  );
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "--test", child],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: childEnvironment,
      timeout: 30_000,
    },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  assert.match(result.stdout, /# pass 4/);
  assert.match(result.stdout, /# fail 0/);
});
