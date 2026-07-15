import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRIVACY_DATA_INVENTORY } from "../src/lib/privacy/data-inventory";

test("localized tenant email templates remain shared configuration under DSAR and retention", () => {
  const policy = PRIVACY_DATA_INVENTORY.platform_settings;
  assert.equal(policy.subjectRelation.kind, "embedded");
  assert.equal(policy.exportPolicy.mode, "manual_review");
  assert.deepEqual(policy.exportPolicy.reviewColumns, ["value"]);
  assert.equal(policy.erasurePolicy.action, "review_and_redact");
  assert.ok(
    policy.erasurePolicy.prerequisites.includes("shared_resource_review"),
  );
  assert.ok(policy.legalHold.scopes.includes("profile"));
  assert.match(policy.exportPolicy.description, /email templates/i);

  const exportSource = readFileSync("scripts/export-user-data.ts", "utf8");
  assert.doesNotMatch(exportSource, /from\s+platform_settings/i);

  const cleanupSource = readFileSync(
    "src/lib/operational-cleanup.ts",
    "utf8",
  );
  assert.doesNotMatch(cleanupSource, /platformSettings|platform_settings/);
});
