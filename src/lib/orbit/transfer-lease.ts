import "server-only";

import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { mediaAssets, orbitTransferJobs } from "@/db/schema";

export const ORBIT_TRANSFER_LEASE_MS = 15 * 60_000;
export const ORBIT_TRANSFER_HEARTBEAT_MS = 30_000;

export class OrbitTransferClaimLostError extends Error {
  constructor() {
    super("The Orbit transfer claim is no longer active.");
    this.name = "OrbitTransferClaimLostError";
  }
}

export function orbitTransferLeaseDeadline(now = new Date()) {
  return new Date(now.getTime() + ORBIT_TRANSFER_LEASE_MS);
}

export async function renewOrbitTransferLease(input: {
  jobId: string;
  claimToken: string;
  targetOrganizationId: string;
  targetMediaIds: readonly string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const leaseExpiresAt = orbitTransferLeaseDeadline(now);
  return db.transaction(async (transaction) => {
    const [job] = await transaction
      .select({ id: orbitTransferJobs.id })
      .from(orbitTransferJobs)
      .where(
        and(
          eq(orbitTransferJobs.id, input.jobId),
          eq(orbitTransferJobs.status, "processing"),
          eq(orbitTransferJobs.claimToken, input.claimToken),
          eq(
            orbitTransferJobs.targetOrganizationId,
            input.targetOrganizationId,
          ),
          gt(orbitTransferJobs.leaseExpiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return null;

    if (input.targetMediaIds.length) {
      const reservations = await transaction
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.organizationId, input.targetOrganizationId),
            eq(mediaAssets.status, "pending"),
            inArray(mediaAssets.id, [...input.targetMediaIds]),
          ),
        )
        .for("update");
      if (reservations.length !== input.targetMediaIds.length) return null;
    }

    const [renewed] = await transaction
      .update(orbitTransferJobs)
      .set({ leaseExpiresAt, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(orbitTransferJobs.id, input.jobId),
          eq(orbitTransferJobs.status, "processing"),
          eq(orbitTransferJobs.claimToken, input.claimToken),
          gt(orbitTransferJobs.leaseExpiresAt, now),
        ),
      )
      .returning({ id: orbitTransferJobs.id });
    if (!renewed) return null;

    if (input.targetMediaIds.length) {
      const renewedReservations = await transaction
        .update(mediaAssets)
        .set({
          uploadExpiresAt: leaseExpiresAt,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(mediaAssets.organizationId, input.targetOrganizationId),
            eq(mediaAssets.status, "pending"),
            inArray(mediaAssets.id, [...input.targetMediaIds]),
          ),
        )
        .returning({ id: mediaAssets.id });
      if (renewedReservations.length !== input.targetMediaIds.length) {
        throw new OrbitTransferClaimLostError();
      }
    }
    return leaseExpiresAt;
  });
}

export function startOrbitTransferLeaseHeartbeat(input: {
  jobId: string;
  claimToken: string;
  targetOrganizationId: string;
  targetMediaIds: readonly string[];
  initialLeaseExpiresAt: Date;
  renewLease?: typeof renewOrbitTransferLease;
  now?: () => Date;
  retryDelayMs?: number;
}) {
  const controller = new AbortController();
  const renewLease = input.renewLease ?? renewOrbitTransferLease;
  const currentTime = input.now ?? (() => new Date());
  const retryDelayMs = input.retryDelayMs ?? 1_000;
  let stopped = false;
  let inFlight: Promise<Date | null> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastKnownLeaseExpiresAt = input.initialLeaseExpiresAt;

  const abortClaim = () => {
    if (!controller.signal.aborted) {
      controller.abort(new OrbitTransferClaimLostError());
    }
  };

  const armExpiryWatchdog = () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (stopped || controller.signal.aborted) return;
    const remainingMs = lastKnownLeaseExpiresAt.getTime() - currentTime().getTime();
    if (remainingMs <= 0) {
      abortClaim();
      return;
    }
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      if (currentTime() >= lastKnownLeaseExpiresAt) {
        abortClaim();
        return;
      }
      armExpiryWatchdog();
    }, remainingMs);
    expiryTimer.unref?.();
  };

  const retryBeforeExpiry = () => {
    if (stopped || retryTimer || controller.signal.aborted) return;
    const remainingMs = lastKnownLeaseExpiresAt.getTime() - currentTime().getTime();
    if (remainingMs <= 0) {
      abortClaim();
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void renew();
    }, Math.min(retryDelayMs, remainingMs));
    retryTimer.unref?.();
  };

  const renew = () => {
    if (stopped) return Promise.resolve<Date | null>(null);
    if (!inFlight) {
      inFlight = renewLease({
        jobId: input.jobId,
        claimToken: input.claimToken,
        targetOrganizationId: input.targetOrganizationId,
        targetMediaIds: input.targetMediaIds,
      })
        .then((leaseExpiresAt) => {
          if (stopped) return null;
          if (!leaseExpiresAt) {
            abortClaim();
            return null;
          }
          lastKnownLeaseExpiresAt = leaseExpiresAt;
          armExpiryWatchdog();
          return leaseExpiresAt;
        })
        .catch((error) => {
          if (stopped) return null;
          if (error instanceof OrbitTransferClaimLostError) {
            abortClaim();
            return null;
          }
          if (currentTime() >= lastKnownLeaseExpiresAt) {
            abortClaim();
            return null;
          }
          retryBeforeExpiry();
          return lastKnownLeaseExpiresAt;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  const timer = setInterval(() => {
    void renew();
  }, ORBIT_TRANSFER_HEARTBEAT_MS);
  timer.unref?.();
  armExpiryWatchdog();

  return {
    signal: controller.signal,
    async assertActive() {
      const leaseExpiresAt = await new Promise<Date | null>(
        (resolve, reject) => {
          const onAbort = () =>
            reject(
              controller.signal.reason instanceof Error
                ? controller.signal.reason
                : new OrbitTransferClaimLostError(),
            );
          if (controller.signal.aborted) {
            onAbort();
            return;
          }
          controller.signal.addEventListener("abort", onAbort, { once: true });
          void renew().then(resolve, reject).finally(() => {
            controller.signal.removeEventListener("abort", onAbort);
          });
        },
      );
      if (!leaseExpiresAt) throw new OrbitTransferClaimLostError();
      controller.signal.throwIfAborted();
      return leaseExpiresAt;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (retryTimer) clearTimeout(retryTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
    },
  };
}
