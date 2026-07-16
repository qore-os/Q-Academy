import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

function playwrightSpecs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return playwrightSpecs(path);
    return /\.spec\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("Playwright readiness uses observable UI state instead of network idle", () => {
  const offenders = playwrightSpecs("tests")
    .filter((path) => /\bnetworkidle\b/.test(readFileSync(path, "utf8")))
    .map((path) => relative(process.cwd(), path))
    .sort();

  assert.deepEqual(
    offenders,
    [],
    "Playwright explicitly discourages networkidle for tests; assert the relevant UI state instead.",
  );
});
