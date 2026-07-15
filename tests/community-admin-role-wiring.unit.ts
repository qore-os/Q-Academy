import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const protectedSources = [
  ["src/app/(admin)/admin/community/page.tsx", "community.view"],
  ["src/lib/community-actions.ts", "community.manage"],
  ["src/lib/community-governance-actions.ts", "community.manage"],
  ["src/lib/community-moderation-case-actions.ts", "community.manage"],
  ["src/lib/community-report-actions.ts", "community.manage"],
] as const;

test("community administration excludes trainer-only admin-area access", () => {
  for (const [sourcePath, permission] of protectedSources) {
    const source = readFileSync(path.resolve(process.cwd(), sourcePath), "utf8");
    assert.match(
      source,
      new RegExp(`requireTeamPermission\\(\"${permission.replace(".", "\\.")}\"\\)`),
      `${sourcePath} must enforce its central community permission.`,
    );
    assert.doesNotMatch(
      source,
      /requireAdmin\(\)/,
      `${sourcePath} must not grant trainer-level admin-area access.`,
    );
  }
});
