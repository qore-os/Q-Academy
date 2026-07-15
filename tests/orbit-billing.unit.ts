import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateOrbitBillingProjection,
  currentOrbitBillingPeriod,
  dueOrbitBillingPeriods,
  previousOrbitBillingPeriod,
} from "../src/lib/orbit/billing-policy";
import { orbitScopeDecision } from "../src/lib/orbit/policy";
import {
  orbitBillingUpdateSchema,
  orbitBootstrapSchema,
} from "../src/lib/orbit/schemas";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("Orbit billing projects additional customer instances using integer cents", () => {
  const projection = calculateOrbitBillingProjection({
    pricing: {
      currency: "EUR",
      billingInterval: "monthly",
      baseFeeCents: 9_900,
      includedInstanceSlots: 2,
      additionalInstanceFeeCents: 2_500,
      revision: 4,
    },
    instanceCount: 5,
    period: {
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
  assert.equal(projection.additionalInstanceCount, 3);
  assert.equal(projection.subtotalCents, 17_400);
  assert.equal(projection.pricingRevision, 4);
});

test("Orbit billing periods use deterministic UTC calendar boundaries", () => {
  const now = new Date("2026-01-15T23:45:00-08:00");
  assert.deepEqual(currentOrbitBillingPeriod("monthly", now), {
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.deepEqual(previousOrbitBillingPeriod("monthly", now), {
    start: new Date("2025-12-01T00:00:00.000Z"),
    end: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.deepEqual(previousOrbitBillingPeriod("annual", now), {
    start: new Date("2025-01-01T00:00:00.000Z"),
    end: new Date("2026-01-01T00:00:00.000Z"),
  });
});

test("Orbit bootstrap exposes both immutable billing intervals", () => {
  const annual = orbitBootstrapSchema.parse({
    workspaceName: "Annual workspace",
    workspaceSlug: "annual-workspace",
    instanceSlotLimit: 5,
    billingInterval: "annual",
  });
  assert.equal(annual.billingInterval, "annual");
  assert.equal(
    orbitBootstrapSchema.parse({
      workspaceName: "Monthly workspace",
      workspaceSlug: "monthly-workspace",
    }).billingInterval,
    "monthly",
  );
  const service = readFileSync("src/lib/orbit/service.ts", "utf8");
  assert.match(service, /const billingInterval = input\.billingInterval/);
});

test("manual Orbit billing rejects every non-null external reference", () => {
  const result = orbitBillingUpdateSchema.safeParse({
    status: "active",
    currency: "EUR",
    billingInterval: "monthly",
    baseFeeCents: 0,
    includedInstanceSlots: 1,
    additionalInstanceFeeCents: 0,
    settlementMode: "manual",
    externalCustomerReference: "",
    expectedRevision: 1,
  });
  assert.equal(result.success, false);
});

test("Orbit billing reconciliation returns every due gap in chronological order", () => {
  assert.deepEqual(
    dueOrbitBillingPeriods(
      "monthly",
      new Date("2026-03-15T12:00:00.000Z"),
      [new Date("2026-04-01T00:00:00.000Z")],
      new Date("2026-07-14T12:00:00.000Z"),
    ),
    [
      {
        start: new Date("2026-03-01T00:00:00.000Z"),
        end: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        start: new Date("2026-05-01T00:00:00.000Z"),
        end: new Date("2026-06-01T00:00:00.000Z"),
      },
      {
        start: new Date("2026-06-01T00:00:00.000Z"),
        end: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
  );
});

test("Orbit billing fails closed for unsafe amounts and partner access", () => {
  assert.throws(
    () =>
      calculateOrbitBillingProjection({
        pricing: {
          currency: "EUR",
          billingInterval: "monthly",
          baseFeeCents: Number.MAX_SAFE_INTEGER,
          includedInstanceSlots: 0,
          additionalInstanceFeeCents: 1,
          revision: 1,
        },
        instanceCount: 1,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateOrbitBillingProjection({
        pricing: {
          currency: "EUR",
          billingInterval: "monthly",
          baseFeeCents: 100_000_000_001,
          includedInstanceSlots: 0,
          additionalInstanceFeeCents: 0,
          revision: 1,
        },
        instanceCount: 0,
      }),
    RangeError,
  );
  const decision = orbitScopeDecision({
    role: "partner",
    permissionSet: null,
    permission: "billing:read",
    workspaceOrganizationIds: [organizationId],
    requestedOrganizationIds: [],
    delegations: [],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.permissions.has("billing:read"), false);
});

test("Orbit billing mutations are revision controlled, audited, and idempotent", () => {
  const service = readFileSync("src/lib/orbit/service.ts", "utf8");
  assert.match(service, /eq\(orbitBillingAccounts\.revision, input\.expectedRevision\)/);
  assert.match(service, /action: "billing\.configuration\.updated"/);
  assert.match(service, /action: "billing\.period\.finalized"/);
  assert.match(service, /dueOrbitBillingPeriods/);
  assert.match(service, /finalizedCount/);
  assert.match(service, /requireLockedOrbitBillingManager/);
  assert.match(
    service,
    /requireLockedOrbitBillingManager[\s\S]*orbitWorkspaceMemberships[\s\S]*\.for\("update"\)[\s\S]*orbitPermissionSets[\s\S]*\.for\("update"\)/,
  );
  assert.match(service, /membership\.permissionSetId && !permissionSet/);
  assert.equal(
    service.match(/orbit-billing:\$\{workspaceId\}/g)?.length,
    2,
    "Pricing updates and period reconciliation must share one workspace lock.",
  );
  assert.match(service, /\.onConflictDoNothing\(\)/);
  assert.doesNotMatch(service, /\.update\(orbitBillingStatements\)/);
  assert.doesNotMatch(service, /\.delete\(orbitBillingStatements\)/);
});

test("0072 backfills and protects immutable historical pricing", () => {
  const migration = readFileSync(
    "drizzle/0072_orbit_billing_price_versions.sql",
    "utf8",
  );
  const backfill = migration.indexOf(
    'INSERT INTO "orbit_billing_price_versions"',
  );
  const amountPreflight = migration.indexOf(
    "Orbit billing amount exceeds the JavaScript-safe pricing ceiling",
  );
  const guard = migration.indexOf(
    'CREATE FUNCTION "public"."protect_orbit_billing_price_version"()',
  );
  assert.ok(backfill > 0);
  assert.ok(amountPreflight > backfill);
  assert.ok(guard > amountPreflight);
  assert.match(
    migration,
    /TIMESTAMPTZ '1970-01-01 00:00:00\+00'/,
  );
  assert.match(migration, /ON CONFLICT \("workspace_id", "revision"\) DO NOTHING/);
  assert.match(migration, /amounts_check" CHECK[\s\S]*NOT VALID/);
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON "public"\."orbit_billing_price_versions"/,
  );
  assert.match(
    migration,
    /BEFORE TRUNCATE ON "public"\."orbit_billing_price_versions"/,
  );
  assert.match(
    migration,
    /to_jsonb\(NEW\) - 'created_by_account_id'[\s\S]*to_jsonb\(OLD\) - 'created_by_account_id'/,
  );
});

test("0071 backfills existing workspaces and protects finalized billing facts", () => {
  const migration = readFileSync(
    "drizzle/0071_orbit_billing_control_plane.sql",
    "utf8",
  );
  const backfill = migration.indexOf('INSERT INTO "orbit_billing_accounts"');
  const permissionValidation = migration.indexOf(
    'VALIDATE CONSTRAINT "orbit_permission_sets_permissions_check"',
  );
  const guard = migration.indexOf(
    'CREATE FUNCTION "public"."protect_orbit_billing_statement"()',
  );
  assert.ok(backfill > 0);
  assert.ok(permissionValidation > backfill);
  assert.ok(guard > permissionValidation);
  assert.match(migration, /ON CONFLICT \("workspace_id"\) DO NOTHING/);
  assert.match(
    migration,
    /to_jsonb\(NEW\) - 'finalized_by_account_id'[\s\S]*to_jsonb\(OLD\) - 'finalized_by_account_id'/,
  );
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON "public"\."orbit_billing_statements"/,
  );
  assert.match(
    migration,
    /BEFORE TRUNCATE ON "public"\."orbit_billing_statements"/,
  );
  assert.match(
    migration,
    /SECURITY DEFINER\s+SET search_path = pg_catalog/,
  );
});
