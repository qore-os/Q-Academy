import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  apiKeys,
  customDomainClaims,
  organizations,
  platformSettings,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import {
  checkCustomDomainDns,
  customDomainDnsRecordName,
  customDomainMutationGuard,
  issueCustomDomainChallenge,
  normalizeCustomDomainHostname,
  type ResolveTxt,
} from "@/lib/custom-domain-model";
import { assertOrganizationFeatureAvailable } from "@/lib/organization-contracts";
import { getPublicAppUrl } from "@/lib/server-environment";

type DomainReader = Pick<typeof db, "select">;

type ClaimRow = typeof customDomainClaims.$inferSelect;

function claimView(claim: ClaimRow, now = new Date()) {
  return {
    id: claim.id,
    hostname: claim.hostname,
    status: claim.status,
    expired:
      claim.status === "pending" &&
      claim.challengeExpiresAt.getTime() <= now.getTime(),
    revision: claim.revision,
    recordName: customDomainDnsRecordName(claim.hostname),
    challengeExpiresAt: claim.challengeExpiresAt,
    lastCheckedAt: claim.lastCheckedAt,
    lastCheckCode: claim.lastCheckCode,
    verifiedAt: claim.verifiedAt,
    revokedAt: claim.revokedAt,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

export async function listCustomDomainClaims(
  organizationId: string,
  reader: DomainReader = db,
) {
  const rows = await reader
    .select()
    .from(customDomainClaims)
    .where(eq(customDomainClaims.organizationId, organizationId))
    .orderBy(desc(customDomainClaims.createdAt), desc(customDomainClaims.id))
    .limit(20);
  return rows.map((row) => claimView(row));
}

async function requireActiveOwner(
  tx: ApiTransaction,
  input: { organizationId: string; actorUserId: string },
) {
  const [actor] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.id, input.actorUserId),
        eq(users.organizationId, input.organizationId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Custom Domains duerfen nur von einem aktiven Owner verwaltet werden.",
    );
  }
  return actor;
}

export async function requireCustomDomainApiKeyOwner(
  tx: ApiTransaction,
  input: { organizationId: string; apiKeyId: string },
) {
  const [actor] = await tx
    .select({ id: users.id })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
        eq(users.role, "owner"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
        eq(apiKeys.status, "active"),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Custom Domains erfordern einen API-Schluessel eines aktiven Owners.",
    );
  }
  return actor.id;
}

function assertUnmanagedHostname(hostname: string) {
  const publicHostname = normalizeCustomDomainHostname(
    new URL(getPublicAppUrl()).hostname,
  );
  const baseDomain = process.env.TENANT_BASE_DOMAIN
    ? normalizeCustomDomainHostname(process.env.TENANT_BASE_DOMAIN)
    : null;
  if (
    hostname === publicHostname ||
    (baseDomain &&
      (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)))
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Verwaltete Plattform- und Tenant-Hosts benoetigen keinen DNS-Claim.",
    );
  }
}

async function setBrandingLoginHostname(
  tx: ApiTransaction,
  organizationId: string,
  hostname: string | null,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('tenant-branding-login-hostname'))`,
  );
  const [settings] = await tx
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, organizationId),
        eq(platformSettings.key, "design"),
      ),
    )
    .limit(1)
    .for("update");
  const value = { ...(settings?.value ?? {}), loginHostname: hostname };
  await tx
    .insert(platformSettings)
    .values({ organizationId, key: "design", value })
    .onConflictDoUpdate({
      target: [platformSettings.organizationId, platformSettings.key],
      set: { value, updatedAt: new Date() },
    });
}

function mutationError(code: ReturnType<typeof customDomainMutationGuard>) {
  if (code === "tenant_mismatch") {
    return new ApiError(404, "not_found", "Domain-Claim nicht gefunden.");
  }
  if (code === "revision_mismatch") {
    return new ApiError(
      409,
      "conflict",
      "Der Domain-Claim wurde zwischenzeitlich geaendert.",
    );
  }
  if (code === "expired") {
    return new ApiError(
      409,
      "conflict",
      "Die DNS-Challenge ist abgelaufen und muss rotiert werden.",
    );
  }
  return new ApiError(
    409,
    "conflict",
    "Der Domain-Claim befindet sich nicht im erforderlichen Zustand.",
  );
}

async function lockedClaim(
  tx: ApiTransaction,
  input: { organizationId: string; claimId: string },
) {
  const [claim] = await tx
    .select()
    .from(customDomainClaims)
    .where(
      and(
        eq(customDomainClaims.id, input.claimId),
        eq(customDomainClaims.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!claim) {
    throw new ApiError(404, "not_found", "Domain-Claim nicht gefunden.");
  }
  return claim;
}

export async function createCustomDomainClaim(input: {
  organizationId: string;
  actorUserId: string;
  hostname: string;
}) {
  assertUnmanagedHostname(input.hostname);
  const issuedAt = new Date();
  const challenge = issueCustomDomainChallenge(issuedAt);
  const claim = await db.transaction(async (tx) => {
    await requireActiveOwner(tx, input);
    await assertOrganizationFeatureAvailable(
      tx,
      input.organizationId,
      "custom_domains",
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('custom-domain-claims'))`,
    );
    const expiredClaims = await tx
      .update(customDomainClaims)
      .set({
        status: "revoked",
        revokedAt: issuedAt,
        lastCheckedAt: issuedAt,
        lastCheckCode: "expired",
        revision: sql`${customDomainClaims.revision} + 1`,
        updatedAt: issuedAt,
      })
      .where(
        and(
          eq(customDomainClaims.status, "pending"),
          lte(customDomainClaims.challengeExpiresAt, issuedAt),
          or(
            eq(customDomainClaims.organizationId, input.organizationId),
            eq(customDomainClaims.hostname, input.hostname),
          ),
        ),
      )
      .returning({
        id: customDomainClaims.id,
        organizationId: customDomainClaims.organizationId,
        hostname: customDomainClaims.hostname,
        revision: customDomainClaims.revision,
      });
    for (const expired of expiredClaims) {
      await tx.insert(activityEvents).values({
        organizationId: expired.organizationId,
        userId: null,
        type: "custom_domain.expired",
        entityType: "custom_domain_claim",
        entityId: expired.id,
        metadata: { hostname: expired.hostname, revision: expired.revision },
      });
    }
    const [existing] = await tx
      .select({
        id: customDomainClaims.id,
        organizationId: customDomainClaims.organizationId,
      })
      .from(customDomainClaims)
      .where(
        and(
          ne(customDomainClaims.status, "revoked"),
          or(
            eq(customDomainClaims.organizationId, input.organizationId),
            eq(customDomainClaims.hostname, input.hostname),
          ),
        ),
      )
      .limit(1)
      .for("update");
    if (existing) {
      const conflict =
        existing.organizationId === input.organizationId
          ? "organization"
          : "hostname";
      throw new ApiError(
        409,
        "conflict",
        conflict === "organization"
          ? "Fuer diese Academy existiert bereits ein aktiver Domain-Claim."
          : "Dieser Hostname wird bereits von einer anderen Academy beansprucht.",
        { conflict },
      );
    }
    const [created] = await tx
      .insert(customDomainClaims)
      .values({
        organizationId: input.organizationId,
        hostname: input.hostname,
        challengeHash: challenge.challengeHash,
        challengeExpiresAt: challenge.expiresAt,
        createdById: input.actorUserId,
        createdAt: issuedAt,
        updatedAt: issuedAt,
      })
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      type: "custom_domain.claim_created",
      entityType: "custom_domain_claim",
      entityId: created.id,
      metadata: { hostname: created.hostname, revision: created.revision },
    });
    return created;
  });
  return {
    claim: claimView(claim, issuedAt),
    challenge: {
      recordName: customDomainDnsRecordName(claim.hostname),
      recordValue: challenge.recordValue,
      expiresAt: challenge.expiresAt,
    },
  };
}

export async function rotateCustomDomainChallenge(input: {
  organizationId: string;
  actorUserId: string;
  claimId: string;
  expectedRevision: number;
}) {
  const now = new Date();
  const challenge = issueCustomDomainChallenge(now);
  const claim = await db.transaction(async (tx) => {
    await requireActiveOwner(tx, input);
    await assertOrganizationFeatureAvailable(
      tx,
      input.organizationId,
      "custom_domains",
    );
    const current = await lockedClaim(tx, input);
    const guard = customDomainMutationGuard(current, {
      ...input,
      operation: "rotate",
      now,
    });
    if (guard !== "ok") throw mutationError(guard);
    const [updated] = await tx
      .update(customDomainClaims)
      .set({
        challengeHash: challenge.challengeHash,
        challengeExpiresAt: challenge.expiresAt,
        revision: current.revision + 1,
        lastCheckedAt: null,
        lastCheckCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(customDomainClaims.id, current.id),
          eq(customDomainClaims.organizationId, input.organizationId),
          eq(customDomainClaims.revision, input.expectedRevision),
        ),
      )
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      type: "custom_domain.challenge_rotated",
      entityType: "custom_domain_claim",
      entityId: current.id,
      metadata: { hostname: current.hostname, revision: updated.revision },
    });
    return updated;
  });
  return {
    claim: claimView(claim, now),
    challenge: {
      recordName: customDomainDnsRecordName(claim.hostname),
      recordValue: challenge.recordValue,
      expiresAt: challenge.expiresAt,
    },
  };
}

export async function verifyCustomDomainClaim(input: {
  organizationId: string;
  actorUserId: string;
  claimId: string;
  expectedRevision: number;
  resolveTxt?: ResolveTxt;
  timeoutMs?: number;
}) {
  const snapshot = await db.transaction(async (tx) => {
    await requireActiveOwner(tx, input);
    const current = await lockedClaim(tx, input);
    const guard = customDomainMutationGuard(current, {
      ...input,
      operation: "verify",
    });
    if (guard !== "ok" && guard !== "expired") throw mutationError(guard);
    return current;
  });
  const initiallyExpired =
    snapshot.challengeExpiresAt.getTime() <= Date.now();
  const dnsResult = initiallyExpired
    ? ({ code: "expired", recordCount: 0 } as const)
    : await checkCustomDomainDns({
        hostname: snapshot.hostname,
        expectedChallengeHash: snapshot.challengeHash,
        resolveTxt: input.resolveTxt,
        timeoutMs: input.timeoutMs,
      });
  const checkedAt = new Date();
  return db.transaction(async (tx) => {
    await requireActiveOwner(tx, input);
    if (dnsResult.code === "verified") {
      await assertOrganizationFeatureAvailable(
        tx,
        input.organizationId,
        "custom_domains",
      );
    }
    const current = await lockedClaim(tx, input);
    if (
      current.hostname !== snapshot.hostname ||
      current.challengeHash !== snapshot.challengeHash
    ) {
      throw mutationError("revision_mismatch");
    }
    const guard = customDomainMutationGuard(current, {
      ...input,
      operation: "verify",
      now: checkedAt,
    });
    if (guard !== "ok" && guard !== "expired") throw mutationError(guard);
    const code = guard === "expired" ? "expired" : dnsResult.code;
    if (code !== "verified") {
      const [updated] = await tx
        .update(customDomainClaims)
        .set({
          lastCheckedAt: checkedAt,
          lastCheckCode: code,
          updatedAt: checkedAt,
        })
        .where(
          and(
            eq(customDomainClaims.id, current.id),
            eq(customDomainClaims.organizationId, input.organizationId),
            eq(customDomainClaims.revision, input.expectedRevision),
          ),
        )
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        type: "custom_domain.verification_failed",
        entityType: "custom_domain_claim",
        entityId: current.id,
        metadata: {
          hostname: current.hostname,
          revision: current.revision,
          result: code,
          recordCount: dnsResult.recordCount,
        },
      });
      return { verified: false, code, claim: claimView(updated, checkedAt) };
    }
    const [updated] = await tx
      .update(customDomainClaims)
      .set({
        status: "verified",
        verifiedAt: checkedAt,
        lastCheckedAt: checkedAt,
        lastCheckCode: "verified",
        revision: current.revision + 1,
        updatedAt: checkedAt,
      })
      .where(
        and(
          eq(customDomainClaims.id, current.id),
          eq(customDomainClaims.organizationId, input.organizationId),
          eq(customDomainClaims.status, "pending"),
          eq(customDomainClaims.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated) throw mutationError("revision_mismatch");
    await setBrandingLoginHostname(
      tx,
      input.organizationId,
      updated.hostname,
    );
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      type: "custom_domain.verified",
      entityType: "custom_domain_claim",
      entityId: updated.id,
      metadata: { hostname: updated.hostname, revision: updated.revision },
    });
    return {
      verified: true,
      code: "verified" as const,
      claim: claimView(updated, checkedAt),
    };
  });
}

export async function revokeCustomDomainClaim(input: {
  organizationId: string;
  actorUserId: string;
  claimId: string;
  expectedRevision: number;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    await requireActiveOwner(tx, input);
    const current = await lockedClaim(tx, input);
    const guard = customDomainMutationGuard(current, {
      ...input,
      operation: "revoke",
      now,
    });
    if (guard !== "ok") throw mutationError(guard);
    const [updated] = await tx
      .update(customDomainClaims)
      .set({
        status: "revoked",
        revokedAt: now,
        revision: current.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(customDomainClaims.id, current.id),
          eq(customDomainClaims.organizationId, input.organizationId),
          eq(customDomainClaims.revision, input.expectedRevision),
        ),
      )
      .returning();
    const [settings] = await tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.organizationId, input.organizationId),
          eq(platformSettings.key, "design"),
        ),
      )
      .limit(1);
    if (settings?.value.loginHostname === current.hostname) {
      await setBrandingLoginHostname(tx, input.organizationId, null);
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      type: "custom_domain.revoked",
      entityType: "custom_domain_claim",
      entityId: current.id,
      metadata: { hostname: current.hostname, revision: updated.revision },
    });
    return claimView(updated, now);
  });
}

export async function verifiedCustomDomainHostname(
  organizationId: string,
  reader: DomainReader = db,
) {
  const [claim] = await reader
    .select({ hostname: customDomainClaims.hostname })
    .from(customDomainClaims)
    .where(
      and(
        eq(customDomainClaims.organizationId, organizationId),
        eq(customDomainClaims.status, "verified"),
        isNull(customDomainClaims.revokedAt),
      ),
    )
    .orderBy(asc(customDomainClaims.createdAt))
    .limit(1);
  return claim?.hostname ?? null;
}

export async function isCustomDomainTlsAuthorized(
  hostnameInput: string,
  reader: DomainReader = db,
) {
  const hostname = normalizeCustomDomainHostname(hostnameInput);
  if (!hostname) return false;
  const [claim] = await reader
    .select({ id: customDomainClaims.id })
    .from(customDomainClaims)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, customDomainClaims.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(customDomainClaims.hostname, hostname),
        eq(customDomainClaims.status, "verified"),
        isNull(customDomainClaims.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(claim);
}
