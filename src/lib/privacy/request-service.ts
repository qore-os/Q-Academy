import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db, postgresClient } from "@/db";
import {
  activityEvents,
  mediaAssets,
  organizations,
  privacyExportArtifacts,
  privacyLegalHolds,
  privacyRequestEvents,
  privacyRequests,
  users,
  type PrivacyRequest,
} from "@/db/schema";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { buildUserDataExport } from "../../../scripts/export-user-data";
import {
  PRIVACY_BACKUP_ERASURE_DAYS,
  PRIVACY_EXPORT_RETENTION_DAYS,
  PRIVACY_POLICY_VERSION,
  PRIVACY_REQUEST_DUE_DAYS,
  canTransitionPrivacyRequest,
  privacyPolicySnapshot,
  type PrivacyRequestStatus,
} from "@/lib/privacy/policy";
import { buildPrivacyBinaryExport } from "@/lib/privacy/binary-export";
import {
  applyMemberErasure,
  buildMemberErasureMediaPlan,
  purgeMemberErasureMedia,
} from "@/lib/privacy/erasure-executor";
import {
  privacyActorReference,
  privacySubjectReference,
} from "@/lib/privacy/subject-reference";
import {
  deletePrivacyExport,
  privacyExportStorageKey,
  storePrivacyExport,
} from "@/lib/privacy/export-storage";
import type { PrivacyRequestCreateInput } from "@/lib/privacy/request-schemas";

type PrivacyActor = {
  kind: "user" | "api_key" | "system";
  id: string;
  userId?: string | null;
};

type PrivacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PrivacyRequestServiceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    readonly code:
      | "invalid_transition"
      | "not_found"
      | "idempotency_conflict"
      | "processing_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrivacyRequestServiceError";
  }
}

export const PRIVACY_PROCESSING_LEASE_MS = 15 * 60_000;
export const PRIVACY_PROCESSING_LEASE_RENEW_INTERVAL_MS = 30_000;

class PrivacyProcessingLeaseLostError extends PrivacyRequestServiceError {
  constructor() {
    super(
      409,
      "invalid_transition",
      "Der Verarbeitungsauftrag hat seine aktive Lease verloren.",
    );
    this.name = "PrivacyProcessingLeaseLostError";
  }
}

type PrivacyProcessingClaim = {
  organizationId: string;
  requestId: string;
  claimToken: string;
};

type StoredPrivacyExport = Awaited<ReturnType<typeof storePrivacyExport>>;

export async function renewPrivacyProcessingLease(
  claim: PrivacyProcessingClaim,
  options: { leaseMs?: number } = {},
) {
  const leaseMs = options.leaseMs ?? PRIVACY_PROCESSING_LEASE_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError("The privacy processing lease duration is invalid.");
  }
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: privacyRequests.id })
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.id, claim.requestId),
          eq(privacyRequests.organizationId, claim.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return null;

    const [renewed] = await tx
      .update(privacyRequests)
      .set({
        processingLeaseExpiresAt: sql`clock_timestamp() + (${leaseMs}::bigint * interval '1 millisecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(privacyRequests.id, claim.requestId),
          eq(privacyRequests.organizationId, claim.organizationId),
          eq(privacyRequests.status, "processing"),
          eq(privacyRequests.processingClaimToken, claim.claimToken),
          sql`${privacyRequests.processingLeaseExpiresAt} > clock_timestamp()`,
        ),
      )
      .returning({
        processingLeaseExpiresAt: privacyRequests.processingLeaseExpiresAt,
      });
    return renewed ?? null;
  });
}

function createPrivacyProcessingLeaseHeartbeat(claim: PrivacyProcessingClaim) {
  let stopped = false;
  let lost = false;
  let inFlight: Promise<boolean> | null = null;

  const renew = () => {
    if (stopped || lost) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const pending = renewPrivacyProcessingLease(claim)
      .then((renewed) => Boolean(renewed))
      .catch(() => false)
      .then((active) => {
        if (!active) lost = true;
        return active;
      });
    inFlight = pending;
    void pending.finally(() => {
      if (inFlight === pending) inFlight = null;
    });
    return pending;
  };

  const timer = setInterval(() => {
    void renew();
  }, PRIVACY_PROCESSING_LEASE_RENEW_INTERVAL_MS);
  timer.unref?.();

  return {
    isLost: () => lost,
    renewOrThrow: async () => {
      if (!(await renew())) throw new PrivacyProcessingLeaseLostError();
    },
    markLost: () => {
      lost = true;
    },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

function actorReference(organizationId: string, actor: PrivacyActor) {
  return privacyActorReference(organizationId, actor.kind, actor.id);
}

function dueDate(now: Date) {
  return new Date(now.getTime() + PRIVACY_REQUEST_DUE_DAYS * 86_400_000);
}

async function appendRequestEvent(
  tx: PrivacyTransaction,
  input: {
    organizationId: string;
    requestId: string;
    actor: PrivacyActor;
    event: string;
    fromStatus?: PrivacyRequestStatus | null;
    toStatus?: PrivacyRequestStatus | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(privacyRequestEvents).values({
    organizationId: input.organizationId,
    requestId: input.requestId,
    actorReference: actorReference(input.organizationId, input.actor),
    event: input.event,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    metadata: input.metadata ?? {},
  });
}

async function appendActivity(
  tx: PrivacyTransaction,
  input: {
    organizationId: string;
    requestId: string;
    actor: PrivacyActor;
    type: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actor.userId ?? null,
    type: input.type,
    entityType: "privacy_request",
    entityId: input.requestId,
    metadata: input.metadata ?? {},
  });
}

async function lockRequest(
  tx: PrivacyTransaction,
  organizationId: string,
  requestId: string,
) {
  const [record] = await tx
    .select()
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.id, requestId),
        eq(privacyRequests.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!record) {
    throw new PrivacyRequestServiceError(
      404,
      "not_found",
      "Der Datenschutzfall wurde nicht gefunden.",
    );
  }
  return record;
}

async function processingClaimLeaseIsActive(
  tx: PrivacyTransaction,
  claim: PrivacyProcessingClaim,
) {
  const [fence] = await tx
    .select({
      active: sql<boolean>`${privacyRequests.processingLeaseExpiresAt} > clock_timestamp()`,
    })
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.id, claim.requestId),
        eq(privacyRequests.organizationId, claim.organizationId),
        eq(privacyRequests.status, "processing"),
        eq(privacyRequests.processingClaimToken, claim.claimToken),
      ),
    )
    .limit(1);
  return fence?.active === true;
}

async function lockActiveProcessingClaim(
  tx: PrivacyTransaction,
  claim: PrivacyProcessingClaim,
) {
  const current = await lockRequest(
    tx,
    claim.organizationId,
    claim.requestId,
  );
  if (
    current.status !== "processing" ||
    current.processingClaimToken !== claim.claimToken ||
    !(await processingClaimLeaseIsActive(tx, claim))
  ) {
    return null;
  }
  return current;
}

function assertTransition(
  current: PrivacyRequestStatus,
  next: PrivacyRequestStatus,
) {
  if (!canTransitionPrivacyRequest(current, next)) {
    throw new PrivacyRequestServiceError(
      409,
      "invalid_transition",
      `Der Statuswechsel von ${current} nach ${next} ist nicht erlaubt.`,
    );
  }
}

export async function createPrivacyRequest(
  organizationId: string,
  input: PrivacyRequestCreateInput,
  actor: PrivacyActor,
) {
  const [subject] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, input.subjectUserId),
        eq(users.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!subject) {
    throw new PrivacyRequestServiceError(
      404,
      "not_found",
      "Die betroffene Person wurde nicht gefunden.",
    );
  }

  const now = new Date();
  const subjectReference = privacySubjectReference(organizationId, subject.id);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(privacyRequests)
      .values({
        organizationId,
        subjectUserId: subject.id,
        subjectReference,
        requestedById: actor.userId ?? null,
        clientRequestId: input.clientRequestId,
        type: input.type,
        status: "received",
        dueAt: dueDate(now),
        policyVersion: PRIVACY_POLICY_VERSION,
        policySnapshot: privacyPolicySnapshot(input.type),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [privacyRequests.organizationId, privacyRequests.clientRequestId],
      })
      .returning();

    if (!created) {
      const [existing] = await tx
        .select()
        .from(privacyRequests)
        .where(
          and(
            eq(privacyRequests.organizationId, organizationId),
            eq(privacyRequests.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1)
        .for("share");
      if (
        !existing ||
        existing.subjectReference !== subjectReference ||
        existing.type !== input.type
      ) {
        throw new PrivacyRequestServiceError(
          409,
          "idempotency_conflict",
          "Die externe Fall-ID wurde bereits fuer einen anderen Auftrag verwendet.",
        );
      }
      return { request: existing, created: false };
    }

    await appendRequestEvent(tx, {
      organizationId,
      requestId: created.id,
      actor,
      event: "request.received",
      toStatus: "received",
      metadata: { type: created.type, policyVersion: PRIVACY_POLICY_VERSION },
    });
    await appendActivity(tx, {
      organizationId,
      requestId: created.id,
      actor,
      type: "privacy_request.received",
      metadata: { requestType: created.type },
    });
    return { request: created, created: true };
  });
}

export async function listPrivacyRequests(organizationId: string) {
  return db
    .select({
      request: privacyRequests,
      subject: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(privacyRequests)
    .leftJoin(
      users,
      and(
        eq(users.id, privacyRequests.subjectUserId),
        eq(users.organizationId, privacyRequests.organizationId),
      ),
    )
    .where(eq(privacyRequests.organizationId, organizationId))
    .orderBy(desc(privacyRequests.createdAt));
}

export async function getPrivacyRequestDetail(
  organizationId: string,
  requestId: string,
) {
  const [record] = await db
    .select({
      request: privacyRequests,
      subject: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      },
    })
    .from(privacyRequests)
    .leftJoin(
      users,
      and(
        eq(users.id, privacyRequests.subjectUserId),
        eq(users.organizationId, privacyRequests.organizationId),
      ),
    )
    .where(
      and(
        eq(privacyRequests.id, requestId),
        eq(privacyRequests.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!record) return null;
  const [events, holds, artifacts] = await Promise.all([
    db
      .select()
      .from(privacyRequestEvents)
      .where(
        and(
          eq(privacyRequestEvents.organizationId, organizationId),
          eq(privacyRequestEvents.requestId, requestId),
        ),
      )
      .orderBy(asc(privacyRequestEvents.createdAt), asc(privacyRequestEvents.id)),
    db
      .select()
      .from(privacyLegalHolds)
      .where(
        and(
          eq(privacyLegalHolds.organizationId, organizationId),
          eq(privacyLegalHolds.requestId, requestId),
        ),
      )
      .orderBy(desc(privacyLegalHolds.createdAt)),
    db
      .select()
      .from(privacyExportArtifacts)
      .where(
        and(
          eq(privacyExportArtifacts.organizationId, organizationId),
          eq(privacyExportArtifacts.requestId, requestId),
        ),
      )
      .orderBy(desc(privacyExportArtifacts.createdAt)),
  ]);
  return { ...record, events, holds, artifacts };
}

export async function verifyPrivacyRequestIdentity(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
) {
  if (!actor.userId) {
    throw new PrivacyRequestServiceError(404, "not_found", "Owner nicht gefunden.");
  }
  return db.transaction(async (tx) => {
    const current = await lockRequest(tx, organizationId, requestId);
    assertTransition(current.status, "identity_verified");
    const now = new Date();
    const [updated] = await tx
      .update(privacyRequests)
      .set({
        status: "identity_verified",
        identityVerifiedAt: now,
        identityVerifiedById: actor.userId,
        statusReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(privacyRequests.id, requestId),
          eq(privacyRequests.organizationId, organizationId),
          eq(privacyRequests.status, current.status),
        ),
      )
      .returning();
    if (!updated) throw new PrivacyRequestServiceError(409, "invalid_transition", "Der Fall wurde parallel geaendert.");
    await appendRequestEvent(tx, {
      organizationId,
      requestId,
      actor,
      event: "identity.verified",
      fromStatus: current.status,
      toStatus: updated.status,
    });
    await appendActivity(tx, {
      organizationId,
      requestId,
      actor,
      type: "privacy_request.identity_verified",
    });
    return updated;
  });
}

export async function approvePrivacyRequest(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
) {
  if (!actor.userId) {
    throw new PrivacyRequestServiceError(404, "not_found", "Owner nicht gefunden.");
  }
  return db.transaction(async (tx) => {
    const current = await lockRequest(tx, organizationId, requestId);
    assertTransition(current.status, "approved");
    const now = new Date();
    const [updated] = await tx
      .update(privacyRequests)
      .set({
        status: "approved",
        approvedAt: now,
        approvedById: actor.userId,
        statusReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(privacyRequests.id, requestId),
          eq(privacyRequests.organizationId, organizationId),
          eq(privacyRequests.status, current.status),
        ),
      )
      .returning();
    if (!updated) throw new PrivacyRequestServiceError(409, "invalid_transition", "Der Fall wurde parallel geaendert.");
    await appendRequestEvent(tx, {
      organizationId,
      requestId,
      actor,
      event: "request.approved",
      fromStatus: current.status,
      toStatus: updated.status,
    });
    await appendActivity(tx, {
      organizationId,
      requestId,
      actor,
      type: "privacy_request.approved",
    });
    return updated;
  });
}

async function terminalTransition(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
  status: "rejected" | "cancelled",
  reason: string,
) {
  return db.transaction(async (tx) => {
    const current = await lockRequest(tx, organizationId, requestId);
    assertTransition(current.status, status);
    const [updated] = await tx
      .update(privacyRequests)
      .set({ status, statusReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(privacyRequests.id, requestId),
          eq(privacyRequests.organizationId, organizationId),
          eq(privacyRequests.status, current.status),
        ),
      )
      .returning();
    if (!updated) throw new PrivacyRequestServiceError(409, "invalid_transition", "Der Fall wurde parallel geaendert.");
    await appendRequestEvent(tx, {
      organizationId,
      requestId,
      actor,
      event: `request.${status}`,
      fromStatus: current.status,
      toStatus: status,
      metadata: { reason },
    });
    await appendActivity(tx, {
      organizationId,
      requestId,
      actor,
      type: `privacy_request.${status}`,
    });
    return updated;
  });
}

export function rejectPrivacyRequest(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
  reason: string,
) {
  return terminalTransition(organizationId, requestId, actor, "rejected", reason);
}

export function cancelPrivacyRequest(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
  reason: string,
) {
  return terminalTransition(organizationId, requestId, actor, "cancelled", reason);
}

export async function createPrivacyLegalHold(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
  input: {
    reference: string;
    scope: typeof privacyLegalHolds.$inferInsert.scope;
    reason: string;
    legalBasis: string;
    expiresAt?: Date | null;
  },
) {
  if (!actor.userId) {
    throw new PrivacyRequestServiceError(404, "not_found", "Owner nicht gefunden.");
  }
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, organizationId, requestId);
    if (
      request.status === "processing" ||
      ["completed", "rejected", "cancelled"].includes(request.status)
    ) {
      throw new PrivacyRequestServiceError(
        409,
        "invalid_transition",
        "Fuer einen laufenden oder abgeschlossenen Fall kann keine neue Aufbewahrungssperre angelegt werden.",
      );
    }
    const [hold] = await tx
      .insert(privacyLegalHolds)
      .values({
        organizationId,
        requestId,
        subjectUserId: request.subjectUserId,
        subjectReference: request.subjectReference,
        scope: input.scope,
        reference: input.reference,
        reason: input.reason,
        legalBasis: input.legalBasis,
        createdById: actor.userId,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    await appendRequestEvent(tx, {
      organizationId,
      requestId,
      actor,
      event: "legal_hold.created",
      metadata: { holdId: hold.id, scope: hold.scope, reference: hold.reference },
    });
    await appendActivity(tx, {
      organizationId,
      requestId,
      actor,
      type: "privacy_request.legal_hold_created",
      metadata: { holdId: hold.id, scope: hold.scope },
    });
    return hold;
  });
}

export async function releasePrivacyLegalHold(
  organizationId: string,
  requestId: string,
  holdId: string,
  actor: PrivacyActor,
  reason: string,
) {
  if (!actor.userId) {
    throw new PrivacyRequestServiceError(404, "not_found", "Owner nicht gefunden.");
  }
  return db.transaction(async (tx) => {
    await lockRequest(tx, organizationId, requestId);
    const [current] = await tx
      .select()
      .from(privacyLegalHolds)
      .where(
        and(
          eq(privacyLegalHolds.id, holdId),
          eq(privacyLegalHolds.requestId, requestId),
          eq(privacyLegalHolds.organizationId, organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) throw new PrivacyRequestServiceError(404, "not_found", "Die Aufbewahrungssperre wurde nicht gefunden.");
    if (current.releasedAt) throw new PrivacyRequestServiceError(409, "invalid_transition", "Die Aufbewahrungssperre wurde bereits aufgehoben.");
    const now = new Date();
    const [released] = await tx
      .update(privacyLegalHolds)
      .set({ releasedAt: now, releasedById: actor.userId, releaseReason: reason, updatedAt: now })
      .where(
        and(
          eq(privacyLegalHolds.id, holdId),
          eq(privacyLegalHolds.organizationId, organizationId),
          isNull(privacyLegalHolds.releasedAt),
        ),
      )
      .returning();
    if (!released) throw new PrivacyRequestServiceError(409, "invalid_transition", "Die Aufbewahrungssperre wurde parallel geaendert.");
    await appendRequestEvent(tx, {
      organizationId,
      requestId,
      actor,
      event: "legal_hold.released",
      metadata: { holdId: released.id, scope: released.scope },
    });
    await appendActivity(tx, {
      organizationId,
      requestId,
      actor,
      type: "privacy_request.legal_hold_released",
      metadata: { holdId: released.id, scope: released.scope },
    });
    return released;
  });
}

async function markRequestBlocked(
  tx: PrivacyTransaction,
  current: PrivacyRequest,
  actor: PrivacyActor,
  reason: string,
) {
  assertTransition(current.status, "blocked");
  const now = new Date();
  const [updated] = await tx
    .update(privacyRequests)
    .set({ status: "blocked", statusReason: reason, updatedAt: now })
    .where(
      and(
        eq(privacyRequests.id, current.id),
        eq(privacyRequests.organizationId, current.organizationId),
        eq(privacyRequests.status, current.status),
      ),
    )
    .returning();
  if (!updated) throw new PrivacyRequestServiceError(409, "invalid_transition", "Der Fall wurde parallel geaendert.");
  await appendRequestEvent(tx, {
    organizationId: current.organizationId,
    requestId: current.id,
    actor,
    event: "request.blocked",
    fromStatus: current.status,
    toStatus: "blocked",
    metadata: { reasonCode: reason },
  });
  await appendActivity(tx, {
    organizationId: current.organizationId,
    requestId: current.id,
    actor,
    type: "privacy_request.blocked",
    metadata: { reasonCode: reason },
  });
  return updated;
}

export async function persistPrivacyExportStorageIdentity(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
  claimToken: string;
  stored: StoredPrivacyExport;
}) {
  return db.transaction(async (tx) => {
    const current = await lockRequest(
      tx,
      input.organizationId,
      input.requestId,
    );
    if (
      current.status !== "processing" ||
      current.processingClaimToken !== input.claimToken
    ) {
      return { state: "claim_lost" as const };
    }
    const leaseActive = await processingClaimLeaseIsActive(tx, {
      organizationId: input.organizationId,
      requestId: input.requestId,
      claimToken: input.claimToken,
    });
    const [artifact] = await tx
      .update(privacyExportArtifacts)
      .set({
        storageVersionId: input.stored.storageVersionId,
        storageEtag: input.stored.storageEtag,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(privacyExportArtifacts.id, input.artifactId),
          eq(privacyExportArtifacts.organizationId, input.organizationId),
          eq(privacyExportArtifacts.requestId, input.requestId),
          eq(privacyExportArtifacts.status, "building"),
          eq(privacyExportArtifacts.storageDriver, input.stored.driver),
          eq(privacyExportArtifacts.storageKey, input.stored.storageKey),
          isNull(privacyExportArtifacts.storageVersionId),
          isNull(privacyExportArtifacts.storageEtag),
        ),
      )
      .returning({ id: privacyExportArtifacts.id });
    if (!artifact) return { state: "claim_lost" as const };
    return {
      state: leaseActive ? ("active" as const) : ("lease_expired" as const),
    };
  });
}

export async function recordStoredPrivacyExportCleanup(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
  stored: StoredPrivacyExport;
  deleted: boolean;
  actor: PrivacyActor;
}) {
  return db.transaction(async (tx) => {
    await lockRequest(tx, input.organizationId, input.requestId);
    const [current] = await tx
      .select()
      .from(privacyExportArtifacts)
      .where(
        and(
          eq(privacyExportArtifacts.id, input.artifactId),
          eq(privacyExportArtifacts.organizationId, input.organizationId),
          eq(privacyExportArtifacts.requestId, input.requestId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return false;
    if (current.status === "deleted" && input.deleted) return true;
    const reopenFailedCleanup =
      current.status === "deleted" &&
      !input.deleted &&
      current.readyAt === null &&
      current.manifestSha256 === null &&
      current.artifactSha256 === null &&
      current.sizeBytes === null &&
      current.fileCount === null &&
      current.failureCode !== null;
    if (
      (!reopenFailedCleanup &&
        !["building", "failed"].includes(current.status)) ||
      current.storageDriver !== input.stored.driver ||
      current.storageKey !== input.stored.storageKey ||
      (current.storageVersionId !== null &&
        current.storageVersionId !== input.stored.storageVersionId) ||
      (current.storageEtag !== null &&
        current.storageEtag !== input.stored.storageEtag)
    ) {
      return false;
    }
    if (!input.deleted && current.status === "failed") {
      const [existingCleanupFailure] = await tx
        .select({ id: privacyRequestEvents.id })
        .from(privacyRequestEvents)
        .where(
          and(
            eq(privacyRequestEvents.organizationId, input.organizationId),
            eq(privacyRequestEvents.requestId, input.requestId),
            eq(privacyRequestEvents.event, "export.cleanup_failed"),
            sql`${privacyRequestEvents.metadata}->>'artifactId' = ${input.artifactId}`,
            sql`${privacyRequestEvents.metadata}->>'reasonCode' = 'export_object_cleanup_failed'`,
          ),
        )
        .limit(1);
      if (existingCleanupFailure) return true;
    }
    const [updated] = await tx
      .update(privacyExportArtifacts)
      .set(
        input.deleted
          ? {
              status: "deleted",
              storageVersionId: input.stored.storageVersionId,
              storageEtag: input.stored.storageEtag,
              deletedAt: sql`clock_timestamp()`,
              failureCode: sql`coalesce(${privacyExportArtifacts.failureCode}, 'export_package_failed')`,
              failureDetail: null,
              updatedAt: sql`clock_timestamp()`,
            }
          : {
              status: "failed",
              storageVersionId: input.stored.storageVersionId,
              storageEtag: input.stored.storageEtag,
              deletedAt: null,
              failureCode: sql`coalesce(${privacyExportArtifacts.failureCode}, 'export_object_cleanup_failed')`,
              failureDetail: null,
              updatedAt: sql`clock_timestamp()`,
            },
      )
      .where(
        and(
          eq(privacyExportArtifacts.id, current.id),
          eq(privacyExportArtifacts.organizationId, input.organizationId),
          eq(privacyExportArtifacts.requestId, input.requestId),
          eq(privacyExportArtifacts.status, current.status),
          eq(privacyExportArtifacts.storageDriver, input.stored.driver),
          eq(privacyExportArtifacts.storageKey, input.stored.storageKey),
        ),
      )
      .returning({ id: privacyExportArtifacts.id });
    if (!updated) return false;
    await appendRequestEvent(tx, {
      organizationId: input.organizationId,
      requestId: input.requestId,
      actor: input.actor,
      event: input.deleted ? "export.deleted" : "export.cleanup_failed",
      metadata: {
        artifactId: input.artifactId,
        reasonCode: input.deleted
          ? "processing_failure_compensation"
          : "export_object_cleanup_failed",
      },
    });
    await appendActivity(tx, {
      organizationId: input.organizationId,
      requestId: input.requestId,
      actor: input.actor,
      type: input.deleted
        ? "privacy_request.export_deleted"
        : "privacy_request.export_cleanup_failed",
      metadata: { artifactId: input.artifactId },
    });
    return true;
  });
}

async function compensateStoredPrivacyExport(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
  stored: StoredPrivacyExport;
  actor: PrivacyActor;
}) {
  let deleted = false;
  try {
    await deletePrivacyExport({
      organizationId: input.organizationId,
      requestId: input.requestId,
      artifactId: input.artifactId,
      storageKey: input.stored.storageKey,
      storageDriver: input.stored.driver,
      storageVersionId: input.stored.storageVersionId,
      storageEtag: input.stored.storageEtag,
    });
    deleted = true;
  } catch {
    // The exact immutable identity is retained below for a bounded retry.
  }
  let recorded = false;
  try {
    recorded = await recordStoredPrivacyExportCleanup({ ...input, deleted });
  } catch {
    try {
      recorded = await recordStoredPrivacyExportCleanup({ ...input, deleted });
    } catch {
      // A database outage is retried by stale recovery after connectivity returns.
    }
  }
  return { deleted, recorded };
}

export async function processPrivacyRequest(
  organizationId: string,
  requestId: string,
  actor: PrivacyActor,
) {
  const prepared = await db.transaction(async (tx) => {
    const current = await lockRequest(tx, organizationId, requestId);
    if (current.status !== "approved") {
      throw new PrivacyRequestServiceError(409, "invalid_transition", "Nur freigegebene Faelle koennen verarbeitet werden.");
    }

    if (current.type === "erasure") {
      const [activeHold] = await tx
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(privacyLegalHolds.organizationId, organizationId),
            eq(privacyLegalHolds.subjectReference, current.subjectReference),
            isNull(privacyLegalHolds.releasedAt),
            sql`${privacyLegalHolds.startsAt} <= clock_timestamp()`,
            or(
              isNull(privacyLegalHolds.expiresAt),
              sql`${privacyLegalHolds.expiresAt} > clock_timestamp()`,
            ),
          ),
        )
        .limit(1)
        .for("share");
      if (activeHold) {
        return {
          kind: "blocked" as const,
          request: await markRequestBlocked(
            tx,
            current,
            actor,
            "legal_hold_active",
          ),
        };
      }
    }

    assertTransition(current.status, "processing");
    const [identity] = await tx
      .select({
        organizationSlug: organizations.slug,
        subjectEmail: users.email,
        subjectUserId: users.id,
        subjectRole: users.role,
      })
      .from(privacyRequests)
      .innerJoin(
        organizations,
        eq(organizations.id, privacyRequests.organizationId),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, privacyRequests.subjectUserId),
          eq(users.organizationId, privacyRequests.organizationId),
        ),
      )
      .where(
        and(
          eq(privacyRequests.id, requestId),
          eq(privacyRequests.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!identity) throw new PrivacyRequestServiceError(409, "processing_failed", "Die betroffene Person ist nicht mehr exportierbar.");
    if (current.type === "erasure" && identity.subjectRole !== "member") {
      throw new PrivacyRequestServiceError(
        409,
        "processing_failed",
        "Der gepruefte Loeschlauf ist ausschliesslich fuer Mitglieder freigegeben.",
      );
    }

    const claimToken = randomUUID();
    const artifact =
      current.type === "access_export"
        ? await (async () => {
            const artifactId = randomUUID();
            const storageKey = privacyExportStorageKey({
              organizationId,
              requestId,
              artifactId,
            });
            const [created] = await tx
              .insert(privacyExportArtifacts)
              .values({
                id: artifactId,
                organizationId,
                requestId,
                status: "building",
                format: "zip",
                storageDriver: getMediaStorageConfiguration().driver,
                storageKey,
                safeFileName: `privacy-export-${requestId.slice(0, 8)}.zip`,
                contentType: "application/zip",
                expiresAt: sql`clock_timestamp() + (${PRIVACY_EXPORT_RETENTION_DAYS}::integer * interval '1 day')`,
                createdAt: sql`clock_timestamp()`,
                updatedAt: sql`clock_timestamp()`,
              })
              .returning();
            if (!created) {
              throw new PrivacyRequestServiceError(
                500,
                "processing_failed",
                "Das Exportartefakt konnte nicht angelegt werden.",
              );
            }
            return created;
          })()
        : null;
    const [processing] = await tx
      .update(privacyRequests)
      .set({
        status: "processing",
        statusReason: null,
        processingStartedAt: sql`clock_timestamp()`,
        processingAttempt: current.processingAttempt + 1,
        processingClaimToken: claimToken,
        processingClaimedAt: sql`clock_timestamp()`,
        processingLeaseExpiresAt: sql`clock_timestamp() + (${PRIVACY_PROCESSING_LEASE_MS}::bigint * interval '1 millisecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(privacyRequests.id, requestId),
          eq(privacyRequests.organizationId, organizationId),
          eq(privacyRequests.status, current.status),
        ),
      )
      .returning();
    if (!processing) throw new PrivacyRequestServiceError(409, "invalid_transition", "Der Fall wurde parallel geaendert.");
    if (current.type === "erasure") {
      await tx
        .update(users)
        .set({ status: "disabled" })
        .where(
          and(
            eq(users.id, identity.subjectUserId),
            eq(users.organizationId, organizationId),
            eq(users.role, "member"),
          ),
        );
    }
    await appendRequestEvent(tx, {
      organizationId,
      requestId,
      actor,
      event:
        current.type === "access_export"
          ? "export.processing_started"
          : "erasure.processing_started",
      fromStatus: current.status,
      toStatus: processing.status,
      metadata: {
        ...(artifact ? { artifactId: artifact.id } : {}),
        attempt: processing.processingAttempt,
      },
    });
    await appendActivity(tx, {
      organizationId,
      requestId,
      actor,
      type: "privacy_request.processing_started",
      metadata: artifact ? { artifactId: artifact.id } : {},
    });
    return {
      kind: "processing" as const,
      request: processing,
      artifact,
      claimToken,
      ...identity,
    };
  });

  if (prepared.kind === "blocked") return prepared;

  if (prepared.request.type === "erasure") {
    const heartbeat = createPrivacyProcessingLeaseHeartbeat({
      organizationId,
      requestId,
      claimToken: prepared.claimToken,
    });
    try {
      await heartbeat.renewOrThrow();
      const mediaPlan = await buildMemberErasureMediaPlan({
        sql: postgresClient,
        organizationId,
        subjectUserId: prepared.subjectUserId,
        snapshotAt: prepared.request.processingStartedAt!,
      });
      await heartbeat.renewOrThrow();
      await purgeMemberErasureMedia(mediaPlan);
      await heartbeat.renewOrThrow();
      return await db.transaction(async (tx) => {
        const current = await lockActiveProcessingClaim(tx, {
          organizationId,
          requestId,
          claimToken: prepared.claimToken,
        });
        if (!current) {
          heartbeat.markLost();
          throw new PrivacyProcessingLeaseLostError();
        }
        const result = await applyMemberErasure({
          tx,
          organizationId,
          subjectUserId: prepared.subjectUserId,
          subjectReference: prepared.request.subjectReference,
          mediaPlan,
          now: new Date(),
        });
        const [completed] = await tx
          .update(privacyRequests)
          .set({
            status: "completed",
            statusReason: null,
            completedAt: sql`clock_timestamp()`,
            backupExpiresAt: sql`clock_timestamp() + (${PRIVACY_BACKUP_ERASURE_DAYS}::integer * interval '1 day')`,
            processingClaimToken: null,
            processingClaimedAt: null,
            processingLeaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(privacyRequests.id, requestId),
              eq(privacyRequests.organizationId, organizationId),
              eq(privacyRequests.status, "processing"),
              eq(privacyRequests.processingClaimToken, prepared.claimToken),
            ),
          )
          .returning();
        if (!completed) {
          heartbeat.markLost();
          throw new PrivacyProcessingLeaseLostError();
        }
        await appendRequestEvent(tx, {
          organizationId,
          requestId,
          actor,
          event: "erasure.completed",
          fromStatus: "processing",
          toStatus: "completed",
          metadata: result,
        });
        await appendActivity(tx, {
          organizationId,
          requestId,
          actor,
          type: "privacy_request.erasure_completed",
          metadata: {
            purgedMedia: result.purgedMedia,
            retainedSharedMedia: result.retainedSharedMedia,
            retentionExceptions: result.retentionExceptions,
          },
        });
        return { kind: "erasure_completed" as const, request: completed };
      });
    } catch (error) {
      if (!heartbeat.isLost()) {
        await db.transaction(async (tx) => {
          const current = await lockActiveProcessingClaim(tx, {
            organizationId,
            requestId,
            claimToken: prepared.claimToken,
          });
          if (!current) {
            heartbeat.markLost();
            return;
          }
          const [failed] = await tx
            .update(privacyRequests)
            .set({
              status: "failed",
              statusReason: "erasure_execution_failed",
              processingClaimToken: null,
              processingClaimedAt: null,
              processingLeaseExpiresAt: null,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(
              and(
                eq(privacyRequests.id, requestId),
                eq(privacyRequests.organizationId, organizationId),
                eq(privacyRequests.status, "processing"),
                eq(privacyRequests.processingClaimToken, prepared.claimToken),
              ),
            )
            .returning({ id: privacyRequests.id });
          if (!failed) {
            heartbeat.markLost();
            return;
          }
          await appendRequestEvent(tx, {
            organizationId,
            requestId,
            actor,
            event: "erasure.failed",
            fromStatus: "processing",
            toStatus: "failed",
            metadata: { reasonCode: "erasure_execution_failed" },
          });
          await appendActivity(tx, {
            organizationId,
            requestId,
            actor,
            type: "privacy_request.erasure_failed",
          });
        });
      }
      if (error instanceof PrivacyProcessingLeaseLostError) throw error;
      throw new PrivacyRequestServiceError(
        500,
        "processing_failed",
        "Der Loesch- und Anonymisierungslauf ist fehlgeschlagen.",
        error instanceof Error ? { cause: error } : undefined,
      );
    } finally {
      await heartbeat.stop();
    }
  }

  const exportArtifact = prepared.artifact;
  if (!exportArtifact) {
    throw new PrivacyRequestServiceError(
      500,
      "processing_failed",
      "Das Exportartefakt fehlt.",
    );
  }
  const heartbeat = createPrivacyProcessingLeaseHeartbeat({
    organizationId,
    requestId,
    claimToken: prepared.claimToken,
  });
  let stored: StoredPrivacyExport | null = null;
  try {
    await heartbeat.renewOrThrow();
    const payload = await buildUserDataExport(
      postgresClient,
      prepared.organizationSlug,
      prepared.subjectEmail.toLowerCase(),
    );
    await heartbeat.renewOrThrow();
    const binaryExport = await buildPrivacyBinaryExport({
      sql: postgresClient,
      organizationId,
      requestId,
      subjectUserId: prepared.subjectUserId,
      subjectReference: prepared.request.subjectReference,
      snapshotAt: prepared.request.processingStartedAt!,
      structuredPayload: payload,
    });
    await heartbeat.renewOrThrow();
    stored = await storePrivacyExport({
      organizationId,
      requestId,
      artifactId: exportArtifact.id,
      bytes: binaryExport.bytes,
      manifest: binaryExport.manifest,
    });
    const storedExport = stored;
    const identity = await persistPrivacyExportStorageIdentity({
      organizationId,
      requestId,
      artifactId: exportArtifact.id,
      claimToken: prepared.claimToken,
      stored: storedExport,
    });
    if (identity.state !== "active") {
      heartbeat.markLost();
      throw new PrivacyProcessingLeaseLostError();
    }
    await heartbeat.renewOrThrow();
    return await db.transaction(async (tx) => {
      if (binaryExport.snapshots.length) {
        const currentMedia = await tx
          .select({
            id: mediaAssets.id,
            status: mediaAssets.status,
            storageDriver: mediaAssets.storageDriver,
            storageVersionId: mediaAssets.storageVersionId,
            etag: mediaAssets.etag,
            contentSha256: mediaAssets.contentSha256,
            actualSizeBytes: mediaAssets.actualSizeBytes,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.organizationId, organizationId),
              inArray(
                mediaAssets.id,
                binaryExport.snapshots.map(({ id }) => id),
              ),
            ),
          )
          .for("share");
        const currentById = new Map(currentMedia.map((row) => [row.id, row]));
        for (const snapshot of binaryExport.snapshots) {
          const row = currentById.get(snapshot.id);
          if (
            !row ||
            row.status !== snapshot.status ||
            row.storageDriver !== snapshot.storageDriver ||
            row.storageVersionId !== snapshot.storageVersionId ||
            row.etag !== snapshot.etag ||
            row.contentSha256 !== snapshot.contentSha256 ||
            row.actualSizeBytes !== snapshot.sizeBytes
          ) {
            throw new PrivacyRequestServiceError(
              409,
              "processing_failed",
              "Ein gebundenes Media-Asset wurde waehrend des Exports geaendert.",
            );
          }
        }
      }
      const current = await lockActiveProcessingClaim(tx, {
        organizationId,
        requestId,
        claimToken: prepared.claimToken,
      });
      if (!current) {
        heartbeat.markLost();
        throw new PrivacyProcessingLeaseLostError();
      }
      const [artifact] = await tx
        .update(privacyExportArtifacts)
        .set({
          status: "ready",
          storageVersionId: storedExport.storageVersionId,
          storageEtag: storedExport.storageEtag,
          manifestSha256: storedExport.manifestSha256,
          artifactSha256: storedExport.artifactSha256,
          sizeBytes: storedExport.sizeBytes,
          fileCount: storedExport.fileCount,
          readyAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(privacyExportArtifacts.id, exportArtifact.id),
            eq(privacyExportArtifacts.organizationId, organizationId),
            eq(privacyExportArtifacts.requestId, requestId),
            eq(privacyExportArtifacts.status, "building"),
            eq(privacyExportArtifacts.storageDriver, storedExport.driver),
            eq(privacyExportArtifacts.storageKey, storedExport.storageKey),
          ),
        )
        .returning();
      if (!artifact) throw new PrivacyRequestServiceError(409, "invalid_transition", "Das Exportartefakt wurde parallel geaendert.");
      const [completed] = await tx
        .update(privacyRequests)
        .set({
          status: "completed",
          statusReason: null,
          completedAt: sql`clock_timestamp()`,
          processingClaimToken: null,
          processingClaimedAt: null,
          processingLeaseExpiresAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(privacyRequests.id, requestId),
            eq(privacyRequests.organizationId, organizationId),
            eq(privacyRequests.status, "processing"),
            eq(privacyRequests.processingClaimToken, prepared.claimToken),
          ),
        )
        .returning();
      if (!completed) {
        heartbeat.markLost();
        throw new PrivacyProcessingLeaseLostError();
      }
      await appendRequestEvent(tx, {
        organizationId,
        requestId,
        actor,
        event: "export.zip_ready",
        fromStatus: "processing",
        toStatus: "completed",
        metadata: {
          artifactId: artifact.id,
          sizeBytes: artifact.sizeBytes,
          fileCount: artifact.fileCount,
          artifactSha256: artifact.artifactSha256,
        },
      });
      await appendActivity(tx, {
        organizationId,
        requestId,
        actor,
        type: "privacy_request.export_completed",
        metadata: {
          artifactId: artifact.id,
          fileCount: artifact.fileCount,
        },
      });
      return { kind: "export_completed" as const, request: completed, artifact };
    });
  } catch (error) {
    const cleanup = stored
      ? await compensateStoredPrivacyExport({
          organizationId,
          requestId,
          artifactId: exportArtifact.id,
          stored,
          actor,
        })
      : null;
    if (!heartbeat.isLost()) {
      await db.transaction(async (tx) => {
        const current = await lockActiveProcessingClaim(tx, {
          organizationId,
          requestId,
          claimToken: prepared.claimToken,
        });
        if (!current) {
          heartbeat.markLost();
          return;
        }
        if (!cleanup?.recorded) {
          await tx
            .update(privacyExportArtifacts)
            .set(
              stored
                ? cleanup?.deleted
                  ? {
                      status: "deleted",
                      storageVersionId: stored.storageVersionId,
                      storageEtag: stored.storageEtag,
                      deletedAt: sql`clock_timestamp()`,
                      failureCode: "export_package_failed",
                      failureDetail: null,
                      updatedAt: sql`clock_timestamp()`,
                    }
                  : {
                      status: "failed",
                      storageVersionId: stored.storageVersionId,
                      storageEtag: stored.storageEtag,
                      failureCode: "export_object_cleanup_failed",
                      failureDetail: null,
                      updatedAt: sql`clock_timestamp()`,
                    }
                : {
                    status: "failed",
                    failureCode: "export_package_failed",
                    failureDetail: null,
                    updatedAt: sql`clock_timestamp()`,
                  },
            )
            .where(
              and(
                eq(privacyExportArtifacts.id, exportArtifact.id),
                eq(privacyExportArtifacts.organizationId, organizationId),
                eq(privacyExportArtifacts.requestId, requestId),
                eq(privacyExportArtifacts.status, "building"),
              ),
            );
        }
        const [failed] = await tx
          .update(privacyRequests)
          .set({
            status: "failed",
            statusReason: "export_package_failed",
            processingClaimToken: null,
            processingClaimedAt: null,
            processingLeaseExpiresAt: null,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(privacyRequests.id, requestId),
              eq(privacyRequests.organizationId, organizationId),
              eq(privacyRequests.status, "processing"),
              eq(privacyRequests.processingClaimToken, prepared.claimToken),
            ),
          )
          .returning({ id: privacyRequests.id });
        if (!failed) {
          heartbeat.markLost();
          return;
        }
        await appendRequestEvent(tx, {
          organizationId,
          requestId,
          actor,
          event: "export.failed",
          fromStatus: "processing",
          toStatus: "failed",
          metadata: {
            artifactId: exportArtifact.id,
            failureCode: "export_package_failed",
          },
        });
        await appendActivity(tx, {
          organizationId,
          requestId,
          actor,
          type: "privacy_request.processing_failed",
          metadata: {
            artifactId: exportArtifact.id,
            failureCode: "export_package_failed",
          },
        });
      });
    }
    if (error instanceof PrivacyRequestServiceError) throw error;
    throw new PrivacyRequestServiceError(
      500,
      "processing_failed",
      "Der strukturierte Export konnte nicht erstellt werden.",
      error instanceof Error ? { cause: error } : undefined,
    );
  } finally {
    await heartbeat.stop();
  }
}
