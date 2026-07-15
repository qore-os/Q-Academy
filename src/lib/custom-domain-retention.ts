import "server-only";

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
} from "drizzle-orm";

import { db } from "@/db";
import { customDomainClaims, privacyLegalHolds } from "@/db/schema";

export const CUSTOM_DOMAIN_REVOKED_RETENTION_DAYS = 90;

export async function cleanupRevokedCustomDomainClaims(options: {
  batchSize: number;
  dryRun?: boolean;
  now?: Date;
}) {
  const batchSize = Math.min(Math.max(Math.trunc(options.batchSize), 1), 1_000);
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() -
      CUSTOM_DOMAIN_REVOKED_RETENTION_DAYS * 86_400_000,
  );
  const condition = and(
    eq(customDomainClaims.status, "revoked"),
    lte(customDomainClaims.revokedAt, cutoff),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              customDomainClaims.organizationId,
            ),
            eq(
              privacyLegalHolds.subjectUserId,
              customDomainClaims.createdById,
            ),
            inArray(privacyLegalHolds.scope, [
              "all",
              "authentication",
              "audit",
            ]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: customDomainClaims.id })
      .from(customDomainClaims)
      .where(condition)
      .orderBy(
        asc(customDomainClaims.revokedAt),
        asc(customDomainClaims.id),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (options.dryRun || !candidates.length) {
      return {
        mode: options.dryRun ? ("dry-run" as const) : ("delete" as const),
        deleted: options.dryRun ? 0 : candidates.length,
        candidates: candidates.length,
        retentionDays: CUSTOM_DOMAIN_REVOKED_RETENTION_DAYS,
      };
    }
    const deleted = await tx
      .delete(customDomainClaims)
      .where(
        and(
          condition,
          inArray(
            customDomainClaims.id,
            candidates.map((candidate) => candidate.id),
          ),
        ),
      )
      .returning({ id: customDomainClaims.id });
    return {
      mode: "delete" as const,
      deleted: deleted.length,
      candidates: candidates.length,
      retentionDays: CUSTOM_DOMAIN_REVOKED_RETENTION_DAYS,
    };
  });
}
