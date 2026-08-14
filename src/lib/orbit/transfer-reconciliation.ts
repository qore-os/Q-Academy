import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  mediaAssets,
  orbitTransferItems,
  orbitTransferJobs,
} from "@/db/schema";

export async function reconcileStaleOrbitTransfers(
  batchSize: number,
  now = new Date(),
) {
  return db.transaction(async (transaction) => {
    const candidates = await transaction
      .select({
        id: orbitTransferJobs.id,
        workspaceId: orbitTransferJobs.workspaceId,
        sourceOrganizationId: orbitTransferJobs.sourceOrganizationId,
        targetOrganizationId: orbitTransferJobs.targetOrganizationId,
        requestedByAccountId: orbitTransferJobs.requestedByAccountId,
        claimToken: orbitTransferJobs.claimToken,
      })
      .from(orbitTransferJobs)
      .where(
        and(
          eq(orbitTransferJobs.status, "processing"),
          lte(orbitTransferJobs.leaseExpiresAt, now),
        ),
      )
      .orderBy(asc(orbitTransferJobs.leaseExpiresAt), asc(orbitTransferJobs.id))
      .limit(Math.max(1, Math.min(batchSize, 100)))
      .for("update", { skipLocked: true });
    let reconciled = 0;
    for (const candidate of candidates) {
      const mediaItems = await transaction
        .select({ targetId: orbitTransferItems.targetId })
        .from(orbitTransferItems)
        .where(
          and(
            eq(orbitTransferItems.jobId, candidate.id),
            eq(orbitTransferItems.kind, "media_asset"),
          ),
        );
      const targetIds = mediaItems.map((item) => item.targetId);
      if (targetIds.length) {
        const reservations = await transaction
          .select({
            id: mediaAssets.id,
            status: mediaAssets.status,
            uploadExpiresAt: mediaAssets.uploadExpiresAt,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.organizationId, candidate.targetOrganizationId),
              inArray(mediaAssets.id, targetIds),
            ),
          )
          .for("update");
        if (
          reservations.some(
            (reservation) =>
              reservation.status === "pending" &&
              reservation.uploadExpiresAt > now,
          ) ||
          reservations.some(
            (reservation) =>
              reservation.status !== "pending" &&
              reservation.status !== "deleted",
          )
        ) {
          continue;
        }
        await transaction
          .update(mediaAssets)
          .set({ uploadExpiresAt: now, updatedAt: now })
          .where(
            and(
              eq(mediaAssets.organizationId, candidate.targetOrganizationId),
              eq(mediaAssets.status, "pending"),
              inArray(mediaAssets.id, targetIds),
            ),
          );
      }
      const [failed] = await transaction
        .update(orbitTransferJobs)
        .set({
          status: "failed",
          failureCode: "transfer_reservation_expired",
          claimToken: null,
          leaseExpiresAt: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(orbitTransferJobs.id, candidate.id),
            eq(orbitTransferJobs.status, "processing"),
            eq(orbitTransferJobs.claimToken, candidate.claimToken!),
            lte(orbitTransferJobs.leaseExpiresAt, now),
          ),
        )
        .returning({ id: orbitTransferJobs.id });
      if (!failed) continue;
      // Keep the insert list aligned with the media worker's column-level grant.
      await transaction.execute(sql`
        insert into orbit_audit_events (
          workspace_id, actor_account_id, action, resource_type, resource_id,
          source_organization_id, target_organization_id, outcome, metadata
        ) values (
          ${candidate.workspaceId}, ${candidate.requestedByAccountId},
          'transfer.failed', 'transfer_job', ${candidate.id},
          ${candidate.sourceOrganizationId}, ${candidate.targetOrganizationId},
          'failed', jsonb_build_object(
            'failureCode', 'transfer_reservation_expired'
          )
        )
      `);
      reconciled += 1;
    }
    return reconciled;
  });
}
