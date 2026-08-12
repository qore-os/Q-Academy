import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createMediaObjectKey,
  isValidMediaObjectIdentity,
} from "../src/lib/media/storage-key";
import { orbitScopeDecision } from "../src/lib/orbit/policy";
import { publicOrbitTransferJob } from "../src/lib/orbit/transfer-policy";

const sourceOrganizationId = "11111111-1111-4111-8111-111111111111";
const targetOrganizationId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

test("Orbit transfer responses omit source identities and idempotency secrets", () => {
  const publicJob = publicOrbitTransferJob({
    id: "44444444-4444-4444-8444-444444444444",
    workspaceId,
    sourceOrganizationId,
    targetOrganizationId,
    sourceCourseIds: ["55555555-5555-4555-8555-555555555555"],
    targetCourseIds: ["66666666-6666-4666-8666-666666666666"],
    requestedByAccountId: "77777777-7777-4777-8777-777777777777",
    idempotencyKey: "private-idempotency-key",
    requestHash: "a".repeat(64),
    status: "completed",
    preflight: {
      sourceCourseCount: 1,
      targetCourseCount: 0,
      targetCourseLimit: 10,
      mediaAssetCount: 0,
      mediaBytes: 0,
      warnings: [],
      authorMappings: [
        {
          sourceUserId: "88888888-8888-4888-8888-888888888888",
          targetUserId: "99999999-9999-4999-8999-999999999999",
        },
      ],
    },
    failureCode: null,
    startedAt: new Date("2026-07-12T10:00:00.000Z"),
    claimToken: null,
    leaseExpiresAt: null,
    completedAt: new Date("2026-07-12T10:00:01.000Z"),
    createdAt: new Date("2026-07-12T10:00:00.000Z"),
    updatedAt: new Date("2026-07-12T10:00:01.000Z"),
  });

  assert.equal("sourceCourseIds" in publicJob, false);
  assert.equal("requestedByAccountId" in publicJob, false);
  assert.equal("idempotencyKey" in publicJob, false);
  assert.equal("requestHash" in publicJob, false);
  assert.equal("authorMappings" in publicJob.preflight, false);
  assert.equal(publicJob.preflight.authorMappingCount, 1);
  assert.deepEqual(publicJob.targetCourseIds, [
    "66666666-6666-4666-8666-666666666666",
  ]);
});

test("expired, revoked, and partial partner delegations fail closed", () => {
  const base = {
    role: "partner" as const,
    permissionSet: null,
    permission: "transfers:create" as const,
    workspaceOrganizationIds: [sourceOrganizationId, targetOrganizationId],
    requestedOrganizationIds: [sourceOrganizationId, targetOrganizationId],
    now: new Date("2026-07-12T10:00:00.000Z"),
  };
  assert.equal(
    orbitScopeDecision({
      ...base,
      delegations: [
        {
          organizationId: sourceOrganizationId,
          permissions: ["transfers:create"],
          expiresAt: null,
          revokedAt: null,
        },
      ],
    }).allowed,
    false,
  );
  assert.equal(
    orbitScopeDecision({
      ...base,
      requestedOrganizationIds: [sourceOrganizationId],
      delegations: [
        {
          organizationId: sourceOrganizationId,
          permissions: ["transfers:create"],
          expiresAt: new Date("2026-07-12T09:59:59.000Z"),
          revokedAt: null,
        },
      ],
    }).allowed,
    false,
  );
  assert.equal(
    orbitScopeDecision({
      ...base,
      requestedOrganizationIds: [sourceOrganizationId],
      delegations: [
        {
          organizationId: sourceOrganizationId,
          permissions: ["transfers:create"],
          expiresAt: null,
          revokedAt: new Date("2026-07-12T09:00:00.000Z"),
        },
      ],
    }).allowed,
    false,
  );
});

test("media object identities reject traversal and tenant/asset substitution", () => {
  const assetId = "88888888-8888-4888-8888-888888888888";
  assert.equal(
    createMediaObjectKey({
      organizationId: targetOrganizationId,
      assetId,
      safeFileName: "../source.mp4",
    }),
    null,
  );
  assert.equal(
    isValidMediaObjectIdentity({
      organizationId: targetOrganizationId,
      assetId,
      key: `tenants/${sourceOrganizationId}/assets/${assetId}/source.mp4`,
    }),
    false,
  );
});

test("claim redemption never grants the issuer account and audit writes stay append-only", () => {
  const service = readFileSync(
    path.resolve("src/lib/orbit/service.ts"),
    "utf8",
  );
  const access = readFileSync(path.resolve("src/lib/orbit/access.ts"), "utf8");
  const transfer = readFileSync(
    path.resolve("src/lib/orbit/transfer.ts"),
    "utf8",
  );

  assert.match(service, /accountId: redeemerAccountId/);
  assert.match(service, /actorAccountId: redeemerAccountId/);
  assert.doesNotMatch(service, /accountId: claim\.createdByAccountId/);
  assert.doesNotMatch(service, /redeemerAccountId = .*emailAccount\?\.id/);
  assert.match(service, /darf nicht allein ueber eine Tenant-E-Mail verknuepft werden/);
  assert.match(service, /Nur ein Orbit-Eigentuemer darf einen Eigentuemer herabstufen/);
  assert.doesNotMatch(`${service}\n${access}\n${transfer}`, /\.update\(orbitAuditEvents\)/);
  assert.doesNotMatch(`${service}\n${access}\n${transfer}`, /\.delete\(orbitAuditEvents\)/);
  assert.match(access, /instance\.entitlements\.includes\("partner_access"\)/);
  assert.match(service, /permission: "transfers:create"/);
});

test("transfer execution reauthorizes and revalidates both tenant instances", () => {
  const transfer = readFileSync(
    path.resolve("src/lib/orbit/transfer.ts"),
    "utf8",
  );
  const authorizationCalls = transfer.match(/requireOrbitAccess\(\{/g) ?? [];
  assert.ok(authorizationCalls.length >= 3);
  assert.match(transfer, /sourceInstance\.status !== "active"/);
  assert.match(
    transfer,
    /!sourceInstance\.entitlements\.includes\("content_transfer"\)/,
  );
  assert.match(
    transfer,
    /replay\.requestedByAccountId !== initialAccess\.actor\.accountId/,
  );
  assert.match(transfer, /eq\(users\.status, "active"\)/);
  assert.match(transfer, /inArray\(users\.role, ORBIT_TRANSFER_AUTHOR_ROLES\)/);
  assert.match(transfer, /currentTargetAuthors/);
  assert.match(transfer, /\.for\("share"\)/);
  assert.match(transfer, /tx\.insert\(courseAuthors\)/);
  assert.doesNotMatch(transfer, /author_attribution_removed/);
  assert.doesNotMatch(transfer, /metadata: \{[\s\S]*?email/);
});

test("0057 installs the Orbit append-only guard after guarded backfills", () => {
  const migration = readFileSync(
    path.resolve("drizzle/0057_rich_rictor.sql"),
    "utf8",
  );
  const mediaBackfill = migration.indexOf(
    'SET "source_type" = \'manual_text\'',
  );
  const mediaBackfillValidation = migration.indexOf(
    "0057 found an AI media source without an immutable extracted-content snapshot",
  );
  const mediaShapeConstraint = migration.indexOf(
    'ADD CONSTRAINT "ai_agent_version_sources_shape_check"',
  );
  const guardFunction = migration.indexOf(
    'CREATE FUNCTION "public"."prevent_orbit_audit_event_mutation"()',
  );

  assert.ok(mediaBackfill >= 0);
  assert.ok(mediaBackfillValidation > mediaBackfill);
  assert.ok(mediaShapeConstraint > mediaBackfillValidation);
  assert.ok(guardFunction > mediaShapeConstraint);
  assert.match(
    migration,
    /SECURITY DEFINER\s+SET search_path = pg_catalog[\s\S]*RAISE EXCEPTION 'orbit_audit_events is append-only'\s+USING ERRCODE = '55000';/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION "public"\."prevent_orbit_audit_event_mutation"\(\) FROM PUBLIC;/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER "orbit_audit_events_append_only_trigger"\s+BEFORE UPDATE OR DELETE ON "public"\."orbit_audit_events"\s+FOR EACH ROW\s+EXECUTE FUNCTION "public"\."prevent_orbit_audit_event_mutation"\(\);/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER "orbit_audit_events_prevent_truncate_trigger"\s+BEFORE TRUNCATE ON "public"\."orbit_audit_events"\s+FOR EACH STATEMENT\s+EXECUTE FUNCTION "public"\."prevent_orbit_audit_event_mutation"\(\);/,
  );
  assert.match(
    migration,
    /COMMENT ON TRIGGER "orbit_audit_events_append_only_trigger" ON "public"\."orbit_audit_events"/,
  );
  assert.match(
    migration,
    /COMMENT ON TRIGGER "orbit_audit_events_prevent_truncate_trigger" ON "public"\."orbit_audit_events"/,
  );
  assert.equal(
    /(?:UPDATE|DELETE FROM|TRUNCATE)\s+(?:"public"\.)?"orbit_audit_events"/i.test(
      migration.slice(guardFunction),
    ),
    false,
  );
});
