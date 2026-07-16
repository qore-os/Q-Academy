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

test("accessibility readiness waits for hydrated tabs and completed hub forms", () => {
  const helper = readFileSync("tests/helpers/rendered-ui.ts", "utf8");
  const adminCourseHelper = readFileSync(
    "tests/helpers/admin-course.ts",
    "utf8",
  );
  const accessibilitySpecs = [
    "tests/accessibility-layout.spec.ts",
    "tests/accessibility-smoke.spec.ts",
  ].map((path) => readFileSync(path, "utf8"));

  assert.match(
    helper,
    /path === "\/admin\/api"[\s\S]*?\/\^\\\/admin\\\/courses[\s\S]*?main\.getByRole\("tab", \{ selected: true \}\)\)\.toBeEnabled\(\)/,
  );
  assert.doesNotMatch(helper, /Aktive Bearbeiter/);
  assert.match(
    adminCourseHelper,
    /\/\^\\\/admin\\\/courses\\\/\[0-9a-f-\]\{36\}\$\/i/,
  );
  for (const spec of accessibilitySpecs) {
    assert.match(spec, /resolveEditableCoursePath\(page\)/);
    assert.doesNotMatch(
      spec,
      /\/admin\/courses\/[0-9a-f]{8}-[0-9a-f-]{27}/i,
    );
  }
});
