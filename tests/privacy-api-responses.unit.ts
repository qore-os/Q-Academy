import assert from "node:assert/strict";
import test from "node:test";

import type {
  PrivacyExportArtifact,
  PrivacyLegalHold,
  PrivacyRequest,
  PrivacyRequestEvent,
} from "../src/db/schema";
import {
  privacyRequestDetailData,
  privacySubjectData,
} from "../src/lib/api/privacy-responses";
import { privacyRequestCreateSchema } from "../src/lib/api/schemas";

const now = new Date("2026-07-11T10:00:00.000Z");
const later = new Date("2026-07-12T10:00:00.000Z");

test("privacy API request bodies reject undeclared fields", () => {
  const parsed = privacyRequestCreateSchema.safeParse({
    subjectUserId: "10000000-0000-4000-8000-000000000001",
    clientRequestId: "customer-case-1001",
    type: "access_export",
    lifecycleAction: "approve",
  });
  assert.equal(parsed.success, false);
});

test("privacy API detail projection excludes internal and sensitive fields", () => {
  const request = {
    id: "10000000-0000-4000-8000-000000000010",
    organizationId: "10000000-0000-4000-8000-000000000011",
    subjectUserId: "10000000-0000-4000-8000-000000000012",
    subjectReference: "subject-reference-secret",
    requestedById: "10000000-0000-4000-8000-000000000013",
    clientRequestId: "customer-case-1001",
    type: "access_export",
    status: "processing",
    dueAt: later,
    identityVerifiedAt: now,
    identityVerifiedById: "10000000-0000-4000-8000-000000000014",
    approvedAt: now,
    approvedById: "10000000-0000-4000-8000-000000000015",
    processingStartedAt: now,
    completedAt: null,
    backupExpiresAt: null,
    policyVersion: "privacy-v1",
    policySnapshot: { secretPolicy: "policy-snapshot-secret" },
    statusReason: "legal-hold-reason-secret",
    processingAttempt: 4,
    processingClaimToken: "10000000-0000-4000-8000-000000000016",
    processingClaimedAt: now,
    processingLeaseExpiresAt: later,
    createdAt: now,
    updatedAt: now,
  } as PrivacyRequest;
  const event = {
    id: "10000000-0000-4000-8000-000000000020",
    organizationId: request.organizationId,
    requestId: request.id,
    actorReference: "actor-reference-secret",
    event: "legal_hold.created",
    fromStatus: null,
    toStatus: null,
    metadata: {
      scope: "audit",
      artifactId: "10000000-0000-4000-8000-000000000030",
      reference: "hold-reference-secret",
      reason: "hold-reason-secret",
      reasonCode: "hold-reason-code-secret",
      nested: { credential: "nested-secret" },
    },
    createdAt: now,
  } as PrivacyRequestEvent;
  const hold = {
    id: "10000000-0000-4000-8000-000000000040",
    organizationId: request.organizationId,
    requestId: request.id,
    subjectUserId: request.subjectUserId,
    subjectReference: request.subjectReference,
    scope: "audit",
    reference: "hold-reference-secret",
    reason: "hold-reason-secret",
    legalBasis: "legal-basis-secret",
    createdById: "10000000-0000-4000-8000-000000000041",
    startsAt: now,
    expiresAt: later,
    releasedAt: null,
    releasedById: null,
    releaseReason: null,
    createdAt: now,
    updatedAt: now,
  } as PrivacyLegalHold;
  const artifact = {
    id: "10000000-0000-4000-8000-000000000030",
    organizationId: request.organizationId,
    requestId: request.id,
    status: "failed",
    format: "json",
    storageDriver: "s3",
    storageKey: "storage-key-secret",
    storageVersionId: "storage-version-secret",
    storageEtag: "storage-etag-secret",
    safeFileName: "privacy-export.json",
    contentType: "application/json",
    manifestSha256: null,
    artifactSha256: null,
    sizeBytes: null,
    fileCount: null,
    expiresAt: later,
    readyAt: null,
    deletedAt: null,
    failureCode: "provider_error",
    failureDetail: "failure-detail-secret",
    createdAt: now,
    updatedAt: now,
  } as PrivacyExportArtifact;

  const result = privacyRequestDetailData({
    request,
    subject: {
      id: request.subjectUserId,
      email: "subject@example.test",
      firstName: "Data",
      lastName: "Subject",
    },
    events: [event],
    holds: [hold],
    artifacts: [artifact],
  });

  assert.deepEqual(result.events[0]?.metadata, {
    scope: "audit",
    artifactId: artifact.id,
  });
  assert.deepEqual(result.legalHolds[0], {
    id: hold.id,
    scope: "audit",
    startsAt: now,
    expiresAt: later,
    releasedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(result.artifacts[0]?.failureCode, "provider_error");
  assert.equal("storageKey" in result.artifacts[0]!, false);
  assert.equal("failureDetail" in result.artifacts[0]!, false);

  const serialized = JSON.stringify(result);
  for (const secret of [
    "subject-reference-secret",
    "actor-reference-secret",
    "policy-snapshot-secret",
    "legal-hold-reason-secret",
    "hold-reference-secret",
    "hold-reason-secret",
    "hold-reason-code-secret",
    "legal-basis-secret",
    "nested-secret",
    "storage-key-secret",
    "storage-version-secret",
    "storage-etag-secret",
    "failure-detail-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked`);
  }
});

test("privacy API renders erased subjects as unavailable", () => {
  assert.equal(privacySubjectData(null), null);
  assert.equal(
    privacySubjectData({
      id: null,
      email: null,
      firstName: null,
      lastName: null,
    }),
    null,
  );
});
