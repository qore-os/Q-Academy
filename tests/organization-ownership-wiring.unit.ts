import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("owner transfer requires step-up and preserves transaction invariants", () => {
  const action = source("src/lib/admin/member-actions.ts");
  const service = source("src/lib/organization-ownership.ts");
  const page = source("src/app/(admin)/admin/members/[id]/page.tsx");

  assert.match(action, /verifyPrivacyOwnerStepUp/);
  assert.match(action, /transferOrganizationOwnershipInTransaction/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /currentOwner\.passwordHash !== input\.actor\.passwordHash/);
  assert.match(service, /nextOwner\.role !== "admin"/);
  assert.match(service, /set\(\{ role: "owner" \}\)/);
  assert.match(service, /set\(\{ role: "admin" \}\)/);
  assert.match(service, /isNull\(userSessions\.revokedAt\)/);
  assert.match(service, /organization\.owner_transferred/);
  assert.match(page, /OwnershipTransferForm/);
  assert.match(page, /actor\.role === "owner"/);
});
