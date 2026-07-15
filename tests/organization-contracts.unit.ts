import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseTenantContractArguments,
  tenantContractInput,
} from "../scripts/set-tenant-contract";
import { organizationContractDatabaseError } from "../src/lib/organization-contract-errors";

test("tenant contract CLI parses bounded revisioned limits", () => {
  const parsed = tenantContractInput(
    parseTenantContractArguments([
      "--slug",
      "pilot-academy",
      "--plan",
      "business_2026",
      "--status",
      "active",
      "--seat-limit",
      "50",
      "--course-limit",
      "100",
      "--storage-limit",
      "10737418240",
      "--ai-credits",
      "5000",
      "--expected-revision",
      "2",
      "--confirm",
      "pilot-academy",
      "--features",
      "ai,oidc_sso,native_mobile",
    ]),
  );

  assert.equal(parsed.seatLimit, 50);
  assert.equal(parsed.courseLimit, 100);
  assert.equal(parsed.storageLimitBytes, 10_737_418_240);
  assert.equal(parsed.expectedRevision, 2);
  assert.deepEqual(parsed.featureEntitlements, [
    "ai",
    "oidc_sso",
    "native_mobile",
  ]);
});

test("tenant contract CLI rejects confirmation, duplicate entitlements, and unsafe limits", () => {
  const base = [
    "--slug", "pilot-academy",
    "--plan", "business_2026",
    "--status", "active",
    "--seat-limit", "50",
    "--course-limit", "100",
    "--storage-limit", "10737418240",
    "--ai-credits", "5000",
    "--expected-revision", "0",
    "--confirm", "foreign-academy",
  ];
  assert.throws(
    () => tenantContractInput(parseTenantContractArguments(base)),
    /confirm muss exakt/,
  );
  assert.throws(
    () =>
      tenantContractInput(
        parseTenantContractArguments([
          ...base.slice(0, -2),
          "--confirm", "pilot-academy",
          "--features", "ai,ai",
        ]),
      ),
    /nicht doppelt/,
  );
  assert.throws(
    () => parseTenantContractArguments(["--slug", "pilot", "--unknown", "x"]),
    /Unbekannte Option/,
  );
});

test("known database contract constraints become conflict responses", () => {
  for (const constraint of [
    "organization_seat_limit_enforced",
    "organization_course_limit_enforced",
    "organization_storage_limit_enforced",
  ]) {
    const error = organizationContractDatabaseError({
      cause: { constraint },
    });
    assert.equal(error?.status, 409);
    assert.equal(error?.code, "conflict");
  }
  assert.equal(
    organizationContractDatabaseError({
      constraint_name: "organization_seat_limit_enforced",
    })?.status,
    409,
  );
  assert.equal(organizationContractDatabaseError({ constraint: "other" }), null);
});

test("contract limits are wired through schema, app paths, REST and operations", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const service = readFileSync("src/lib/organization-contracts.ts", "utf8");
  const members = readFileSync("src/app/api/v1/members/route.ts", "utf8");
  const courses = readFileSync("src/app/api/v1/courses/route.ts", "utf8");
  const media = readFileSync("src/lib/media/asset-service.ts", "utf8");
  const aiPolicy = readFileSync("src/lib/ai/agent-policy.ts", "utf8");
  const aiCourse = readFileSync("src/lib/admin/ai-course-actions.ts", "utf8");
  const openapi = readFileSync("src/lib/api/openapi.ts", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const migration = readFileSync("drizzle/0058_reflective_argent.sql", "utf8");

  assert.match(schema, /organization_contracts/);
  assert.match(schema, /feature_entitlements/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(members, /assertOrganizationSeatCapacity/);
  assert.match(courses, /assertOrganizationCourseCapacity/);
  assert.match(media, /assertOrganizationStorageCapacity/);
  assert.match(aiPolicy, /organizationContracts\.aiMonthlyCredits/);
  assert.match(aiPolicy, /attempts.*bucket\.cost/);
  assert.match(aiCourse, /units: 25/);
  assert.match(openapi, /\/organization\/contract/);
  assert.match(openapi, /OrganizationContractOverview/);
  assert.match(packageJson, /tenant:contract/);
  assert.match(migration, /users_contract_seat_limit/);
  assert.match(migration, /courses_contract_course_limit/);
  assert.match(migration, /media_assets_contract_storage_limit/);
  assert.match(migration, /organization_contracts_limit_floor/);
});
